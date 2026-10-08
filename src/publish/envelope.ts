/**
 * The encrypted DDO envelope, in exactly the shape ocean-node 4.2 indexes, and the rules
 * for writing it.
 *
 * Kept out of the package's exports: these are the format's invariants, and the publish
 * flow is the only thing that should produce or check them. Step numbers refer to the
 * indexer pipeline in ocean-node 4.2 (`MetadataEventProcessor.processEvent`,
 * `BaseProcessor.decryptDDO`, `DecryptDdoHandler.handle`).
 */
import { createHash } from 'node:crypto'
import type { Nft, StorageObject } from '@oceanprotocol/lib'
import { getAddress, getBytes, isHexString, toBeHex } from 'ethers'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import { isCid } from '../remote/cid.js'
import { CREDENTIAL_TYPE, credentialClaims } from '../signing/claims.js'
import { decodeCredential } from '../signing/vc.js'

/** The metadata flags nautilus writes: always `0x02`, ECIES-encrypted by the node. */
export const ENCRYPTED_METADATA_FLAGS = 0x02

/**
 * Throws for `encrypt: false`. The option existed in 2.0.0-beta.0; it is gone because a
 * plaintext pointer or envelope would put the DDO's location, or the DDO itself, in clear.
 */
export function assertEncryptOption(options: unknown): void {
  if ((options as { encrypt?: unknown } | undefined)?.encrypt === false)
    throw new Error(
      'encrypt: false is not supported: DDO pointers and envelopes are always node-encrypted.'
    )
}

/**
 * Builds the envelope that goes to the remote store.
 *
 * What ocean-node 4.2 does with it (`BaseProcessor.decryptDDO`,
 * `MetadataEventProcessor.processEvent`):
 *
 *   1. it fetches the stored object and `JSON.parse`s it;
 *   2. it compares `0x` + sha256(`JSON.stringify` of that object) to the on-chain hash;
 *   3. it has the node decrypt `encryptedData`, which must give `{ encryptedData: <hex> }`;
 *   4. it decodes that hex as UTF-8 and `JSON.parse`s it, which must give the compact JWS;
 *   5. it decodes the JWS payload and checks its `id` against the NFT.
 *
 * So:
 *
 *   inner    = hexlify(utf8(JSON.stringify(jws)))
 *   envelope = JSON.stringify({ encryptedData: node.encrypt({ encryptedData: inner }) })
 *
 * This is the enterprise market's `encryptAsset: true` format
 * (`signAssetAndUploadToIpfs`). The envelope has a single string-valued key, so
 * parsing and re-serializing it gives the same bytes back: the hash holds whatever
 * whitespace a store or gateway adds.
 */
export async function buildEnvelope(
  node: OceanNodeClient,
  jwt: string
): Promise<string> {
  // Refuse before asking the node to encrypt something its indexer cannot read back.
  assertEnvelopeDecryptable(expectedEnvelopeCiphertextLength(jwt))

  const inner = hexlify(JSON.stringify(jwt))
  const content = { encryptedData: inner }

  // `OceanNodeClient.encrypt` sends `JSON.stringify(content)`: that is the plaintext.
  const encryptedData = assertCiphertextOf(
    'envelope',
    await node.encrypt(content),
    JSON.stringify(content),
    [jwt]
  )

  assertEnvelopeDecryptable(encryptedData.length)

  return JSON.stringify({ encryptedData })
}

/**
 * The largest JSON request body ocean-node 4.2 accepts, including the indexer's
 * `POST /api/services/decrypt`: express's default `'100kb'` (102 400 bytes, set by
 * `express.json()` in `httpRoutes/fileInfo.ts:13`). A larger body gets a 413 and the asset
 * is not indexed.
 */
export const NODE_DECRYPT_BODY_LIMIT_BYTES = 100 * 1024

/** Headroom nautilus keeps below `NODE_DECRYPT_BODY_LIMIT_BYTES`. */
export const DECRYPT_BODY_SAFETY_MARGIN_BYTES = 4 * 1024

/** The largest decrypt request body nautilus lets an envelope need. */
export const MAX_DECRYPT_BODY_BYTES =
  NODE_DECRYPT_BODY_LIMIT_BYTES - DECRYPT_BODY_SAFETY_MARGIN_BYTES

/**
 * The size in bytes of the indexer's second decrypt request for an envelope whose
 * `encryptedData` is `ciphertextLength` hex characters long (`0x` included).
 *
 * The indexer sends `JSON.stringify(payload)` (`BaseProcessor.decryptDDO`) with, for the
 * envelope, `transactionId: ''`, the ciphertext as `encryptedDocument` and no
 * `documentHash`. The fields whose length varies are counted at their maximum: a 16-digit
 * chain id and a 20-digit nonce (the indexer falls back to `Date.now()`).
 */
export function envelopeDecryptBodyBytes(ciphertextLength: number): number {
  const payload = JSON.stringify({
    transactionId: '',
    chainId: Number.MAX_SAFE_INTEGER,
    decrypterAddress: `0x${'0'.repeat(40)}`,
    dataNftAddress: `0x${'0'.repeat(40)}`,
    encryptedDocument: '',
    flags: ENCRYPTED_METADATA_FLAGS,
    signature: `0x${'0'.repeat(130)}`,
    nonce: '9'.repeat(20)
  })

  return Buffer.byteLength(payload, 'utf8') + ciphertextLength
}

/**
 * The length, in hex characters with `0x`, of the node's ciphertext for the envelope of
 * a compact JWS of `jwsLength` characters: `{"encryptedData":"0x<hex of "<jws>">"}`
 * encrypted with ECIES (`ECIES_OVERHEAD_BYTES` more than the plaintext).
 */
export function envelopeCiphertextLengthFor(jwsLength: number): number {
  const plaintextBytes = '{"encryptedData":""}'.length + 2 + 2 * (jwsLength + 2)

  return 2 + 2 * (ECIES_OVERHEAD_BYTES + plaintextBytes)
}

function expectedEnvelopeCiphertextLength(jwt: string): number {
  // A compact JWS is ASCII, so its JSON string is the JWS plus two quotes; anything else
  // is counted at its real UTF-8 size.
  return envelopeCiphertextLengthFor(
    Buffer.byteLength(JSON.stringify(jwt), 'utf8') - 2
  )
}

/** The longest compact JWS whose envelope stays within `MAX_DECRYPT_BODY_BYTES`. */
export function maxDecryptableJwsLength(): number {
  let low = 0
  let high = MAX_DECRYPT_BODY_BYTES
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (
      envelopeDecryptBodyBytes(envelopeCiphertextLengthFor(mid)) <=
      MAX_DECRYPT_BODY_BYTES
    )
      low = mid
    else high = mid - 1
  }
  return low
}

/**
 * Throws when the indexer's decrypt request for an envelope of this ciphertext length
 * would exceed `MAX_DECRYPT_BODY_BYTES`: the node would answer 413 and not index the
 * asset.
 */
export function assertEnvelopeDecryptable(ciphertextLength: number): void {
  const body = envelopeDecryptBodyBytes(ciphertextLength)

  if (body > MAX_DECRYPT_BODY_BYTES)
    throw new Error(
      `The signed DDO is too large for the node to index: the indexer would send its envelope back in a ${body}-byte decrypt request, and the node accepts decrypt requests up to ${NODE_DECRYPT_BODY_LIMIT_BYTES} bytes (a larger request gets 413 and the asset is not indexed). nautilus refuses above ${MAX_DECRYPT_BODY_BYTES} bytes, which is a signed JWS of at most ${maxDecryptableJwsLength()} characters (about ${Math.floor((maxDecryptableJwsLength() * 3) / 4 / 1024)} KB of DDO JSON). Shorten the DDO: descriptions, address lists in credentials, policies, services.`
    )
}

/**
 * What nautilus allows, in characters, for the parts of a compact JWS that are not the
 * credential payload: the two dots, the base64url header and the base64url signature,
 * plus anything a custom signer adds to the payload beyond `credentialClaims`.
 *
 * The built-in signers stay below it: `Eip191VcSigner` adds 221 characters (a fixed
 * header and the base64url of the `0x`-hex 65-byte signature), and walt.id's
 * `POST /wallet/{wallet}/keys/{keyId}/sign` signs the posted credential unchanged under a
 * `{ typ, kid, alg }` header, with signatures of at most 683 characters (RS512, a 4096-bit
 * RSA key), which leaves room for a key id of about 200 characters.
 */
export const JWS_SIGNING_ALLOWANCE = 1024

/**
 * The longest compact JWS a signer can return for `ddo` issued by `issuer`, within
 * `JWS_SIGNING_ALLOWANCE`: the base64url of `credentialClaims(ddo, issuer)` plus the
 * allowance.
 */
export function maxJwsLengthFor(
  ddo: Record<string, unknown>,
  issuer: string
): number {
  const payload = Buffer.byteLength(
    JSON.stringify(credentialClaims(ddo, issuer)),
    'utf8'
  )

  // Unpadded base64url: 4 characters per 3 bytes, rounded up.
  return Math.ceil((payload * 4) / 3) + JWS_SIGNING_ALLOWANCE
}

/**
 * Before any transaction: throws unless the envelope of `ddo`, signed by `issuer`, fits
 * the node's decrypt limit even at its largest.
 *
 * An upper bound for every signer within `JWS_SIGNING_ALLOWANCE`, the built-in ones
 * included. `ddo` must be the pre-transaction document, whose placeholder files have the
 * length of the node's ciphertext (`nodeCiphertextLength`): every other field already has
 * its final length, since the stand-in addresses and DID are as long as the real ones. The
 * JWS is then at most `maxJwsLengthFor`. So a DDO this passes stays within the limit after
 * the mint, unless a custom signer adds more than the allowance; `buildEnvelope` checks
 * the real size before anything is stored either way.
 */
export function assertDdoFitsDecryptLimit(
  ddo: Record<string, unknown>,
  issuer: string
): void {
  const jwsLength = maxJwsLengthFor(ddo, issuer)
  const body = envelopeDecryptBodyBytes(envelopeCiphertextLengthFor(jwsLength))

  if (body > MAX_DECRYPT_BODY_BYTES)
    throw new Error(
      `The DDO is too large for the node to index: signed, its JWS can be up to ${jwsLength} characters (the credential plus ${JWS_SIGNING_ALLOWANCE} for the header and signature), and the indexer would send its envelope back in a decrypt request of up to ${body} bytes. The node accepts decrypt requests up to ${NODE_DECRYPT_BODY_LIMIT_BYTES} bytes (a larger request gets 413 and the asset is not indexed), so nautilus refuses above ${MAX_DECRYPT_BODY_BYTES} bytes, a JWS of at most ${maxDecryptableJwsLength()} characters. Checked before any transaction. Shorten the DDO: descriptions, address lists in credentials, policies, services, files.`
    )
}

/**
 * The length, in hex characters with `0x`, of ocean-node 4.2's ciphertext for
 * `plaintext`: ECIES adds `ECIES_OVERHEAD_BYTES`, and the node answers in hex.
 */
export function nodeCiphertextLength(plaintext: string): number {
  return 2 + 2 * (ECIES_OVERHEAD_BYTES + Buffer.byteLength(plaintext, 'utf8'))
}

/** `0x` + sha256 of the exact envelope string: what the node compares on chain. */
export function hashEnvelope(envelope: string): string {
  return `0x${createHash('sha256').update(envelope).digest('hex')}`
}

/**
 * Node ciphertext is a `0x` hex string; the decrypt handler reads it with `getBytes`.
 * Anything else would only fail later, on the node, after the transaction.
 */
export function assertCiphertext(what: string, value: string): string {
  // `true`: whole bytes only. `getBytes` rejects an odd number of hex digits.
  if (!isHexString(value, true) || value.length <= 2)
    throw new Error(
      `The node returned no usable ciphertext for the ${what}; expected a 0x hex string.`
    )

  return value
}

/**
 * What ECIES adds to a plaintext on ocean-node 4.2: its `RawPrivateKeyProvider` calls
 * eciesjs 0.5 with the default config, so the output is a 65-byte uncompressed ephemeral
 * public key, a 16-byte AES-256-GCM nonce and a 16-byte tag, followed by the ciphertext of
 * the same length as the plaintext. `/api/services/encrypt` always uses ECIES.
 */
export const ECIES_OVERHEAD_BYTES = 65 + 16 + 16

/** Matching window: 32 bytes of a plaintext form found in the "ciphertext" is a leak. */
const PLAINTEXT_WINDOW = 32

/**
 * Throws unless `ciphertext` can be node ciphertext of `plaintext`: a `0x` hex string, at
 * least `ECIES_OVERHEAD_BYTES` longer than the plaintext, and containing no 32-byte run of
 * the plaintext (or of any `secrets`) in UTF-8, hex, base64 or as a JSON string literal.
 *
 * nautilus knows each plaintext it sends to the node, so this is a known-plaintext check
 * rather than a guess at what plaintext looks like. It catches a node, proxy or test double
 * that echoes its input, in any of those encodings and with any prefix or suffix (a BOM, a
 * trailing NUL).
 */
export function assertCiphertextOf(
  what: string,
  ciphertext: string,
  plaintext: string,
  secrets: string[] = []
): string {
  assertCiphertext(what, ciphertext)

  const bytes = Buffer.from(getBytes(ciphertext))
  const plaintextBytes = Buffer.byteLength(plaintext, 'utf8')

  if (bytes.length < plaintextBytes + ECIES_OVERHEAD_BYTES)
    throw new Error(
      `Refusing to write the ${what}: the node returned ${bytes.length} bytes for a ${plaintextBytes}-byte plaintext, but ECIES output is at least ${plaintextBytes + ECIES_OVERHEAD_BYTES} bytes, so it cannot be ciphertext. nautilus only writes node-encrypted data.`
    )

  const leaked = findPlaintext(bytes, [plaintext, ...secrets])

  if (leaked)
    throw new Error(
      `Refusing to write the ${what}: what the node returned contains the plaintext (${leaked}), so it is not ciphertext. nautilus only writes node-encrypted data.`
    )

  return ciphertext
}

/** The first encoding of any of `texts` that appears in `bytes`, or `undefined`. */
function findPlaintext(bytes: Buffer, texts: string[]): string | undefined {
  const haystack = bytes.toString('latin1')
  const windows = new Set<string>()
  for (let i = 0; i + PLAINTEXT_WINDOW <= haystack.length; i++)
    windows.add(haystack.slice(i, i + PLAINTEXT_WINDOW))

  for (const text of texts) {
    const utf8 = Buffer.from(text, 'utf8')
    const forms: [string, string][] = [
      ['UTF-8', utf8.toString('latin1')],
      ['hex', utf8.toString('hex')],
      ['upper-case hex', utf8.toString('hex').toUpperCase()],
      ['base64', utf8.toString('base64')],
      ['base64url', utf8.toString('base64url')],
      [
        'a JSON string literal',
        Buffer.from(JSON.stringify(text), 'utf8').toString('latin1')
      ]
    ]

    for (const [name, form] of forms) {
      if (form.length < 16) continue

      if (form.length <= PLAINTEXT_WINDOW) {
        if (haystack.includes(form)) return name
        continue
      }

      for (let i = 0; i + PLAINTEXT_WINDOW <= form.length; i++)
        if (windows.has(form.slice(i, i + PLAINTEXT_WINDOW))) return name
    }
  }

  return undefined
}

/**
 * Throws unless `metadata` is node ciphertext of `pointerPlaintext` under flags `0x02`.
 *
 * The check right before `setMetadata`: whatever produced the metadata, nothing readable
 * goes on chain.
 */
export function assertEncryptedMetadata(
  prepared: {
    flags: number
    metadata: string
    metadataHash: string
  },
  pointerPlaintext: string
): void {
  // Step 7: only `flags & 2` is decrypted; without it the node cannot read metadata.
  if (prepared.flags !== ENCRYPTED_METADATA_FLAGS)
    throw new Error(
      `Refusing to write metadata with flags ${toBeHex(prepared.flags)}: nautilus only writes node-encrypted metadata (flags 0x02).`
    )

  assertCiphertextOf('pointer', prepared.metadata, pointerPlaintext)

  // Step 10: compared as `0x` + lowercase sha256 hex.
  if (!/^0x[0-9a-f]{64}$/.test(prepared.metadataHash))
    throw new Error(
      'Refusing to write metadata without a lowercase 0x-prefixed sha256 metadata hash.'
    )
}

/**
 * The `remote.type`s ocean-node 4.2 can read a DDO from (`getStorageClass`, which matches
 * case-insensitively). `nodePersistentStorage` is a storage type too, but not readable here.
 */
const DDO_STORAGE_TYPES = ['ipfs', 'url', 's3', 'arweave', 'ftp']

/** A non-empty string, after trimming. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * The storage classes' own path test (`isFilePath` in `UrlStorage`, `IpfsStorage` and
 * `ArweaveStorage`): a `/` with at least one character before it.
 */
const PATH_LIKE = /^(.+)\/([^/]*)$/

/** Whether `value` parses as a URL with one of `protocols`. */
function hasProtocol(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * What each storage class of ocean-node 4.2 needs to fetch the object
 * (`src/components/storage/*Storage.ts`: the constructor's `validate()` and
 * `getReadableStream()`), as a description of the first missing piece, or `undefined`.
 * Node configuration (`IPFS_GATEWAY`, `ARWEAVE_GATEWAY`, `UNSAFE_URLS`) is not visible
 * from here.
 */
const POINTER_CHECKS: Record<
  string,
  (pointer: Record<string, unknown>) => string | undefined
> = {
  // `IpfsStorage` joins the hash under `/ipfs/` on its gateway, so it must be a CID and
  // nothing path-like.
  ipfs: ({ hash }) =>
    typeof hash === 'string' && isCid(hash)
      ? undefined
      : `its hash ${JSON.stringify(hash)} is not a CIDv0 (Qm…) or CIDv1 (b…/k…)`,

  // `UrlStorage` requires `url` and a GET or POST `method`, treats anything not starting
  // with `http://` or `https://` that contains a `/` as a file path, and fetches the URL
  // with `headers`.
  url: ({ url, method, headers }) => {
    if (!isFilled(url)) return '`url` is missing'
    if (
      !(url.startsWith('http://') || url.startsWith('https://')) ||
      !hasProtocol(url, ['http:', 'https:'])
    )
      return '`url` must be an absolute http:// or https:// URL'
    if (
      typeof method !== 'string' ||
      !['get', 'post'].includes(method.toLowerCase())
    )
      return "`method` must be 'GET' or 'POST'"
    if (
      headers !== undefined &&
      (!isPlainObject(headers) ||
        Object.values(headers).some((value) => typeof value !== 'string'))
    )
      return '`headers` must be an object of string values'
    return undefined
  },

  // `S3Storage` requires these five `s3Access` strings, prefixes an `endpoint` that does
  // not start with `http` with `https://`, and passes `region` (default `us-east-1`) and
  // `forcePathStyle` to the AWS SDK.
  s3: ({ s3Access }) => {
    if (!isPlainObject(s3Access)) return '`s3Access` is missing'
    for (const field of [
      'bucket',
      'objectKey',
      'endpoint',
      'accessKeyId',
      'secretAccessKey'
    ])
      if (!isFilled(s3Access[field])) return `\`s3Access.${field}\` is missing`
    const endpoint = s3Access.endpoint as string
    if (
      !hasProtocol(
        endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
        ['http:', 'https:']
      )
    )
      return '`s3Access.endpoint` is not a host or an http(s) URL'
    // The node defaults both with `??`, so `null` counts as unset.
    if (s3Access.region != null && !isFilled(s3Access.region))
      return '`s3Access.region` must be a non-empty string when set'
    if (
      s3Access.forcePathStyle != null &&
      typeof s3Access.forcePathStyle !== 'boolean'
    )
      return '`s3Access.forcePathStyle` must be a boolean when set'
    return undefined
  },

  // `ArweaveStorage` joins `transactionId` onto its gateway; it refuses a URL or a path.
  arweave: ({ transactionId }) => {
    if (!isFilled(transactionId)) return '`transactionId` is missing'
    if (
      transactionId.startsWith('http://') ||
      transactionId.startsWith('https://') ||
      PATH_LIKE.test(transactionId)
    )
      return '`transactionId` must be a transaction id, not a URL or a path'
    return undefined
  },

  // `FTPStorage` requires an `ftp://` or `ftps://` `url`.
  ftp: ({ url }) => {
    if (!isFilled(url)) return '`url` is missing'
    if (!hasProtocol(url, ['ftp:', 'ftps:']))
      return '`url` must be an ftp:// or ftps:// URL'
    return undefined
  }
}

/**
 * Throws for a pointer ocean-node 4.2 cannot dereference as a DDO. Applies to every
 * `RemoteStore`, custom ones included.
 *
 * Steps 8–9: the pointer must be a plain JSON object with a known `type`, carrying the
 * fields that type's storage class needs (`POINTER_CHECKS`). The decrypt handler resolves
 * it without a consumer address, and node persistent storage requires one, so a
 * bucket-backed DDO is not indexed.
 */
export function assertDdoPointer(pointer: StorageObject): void {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer))
    throw new Error(
      `The remote store returned no pointer object (got ${JSON.stringify(pointer)}).`
    )

  const type = (pointer as { type?: unknown }).type

  if (
    typeof type === 'string' &&
    type.toLowerCase() === 'nodepersistentstorage'
  )
    throw new Error(
      `A '${type}' pointer cannot hold a DDO: ocean-node 4.2 resolves remote DDOs without a consumer address, and its bucket storage requires one. Use an IpfsRemoteStore or S3RemoteStore instead.`
    )

  if (
    typeof type !== 'string' ||
    !DDO_STORAGE_TYPES.includes(type.toLowerCase())
  )
    throw new Error(
      `The remote store returned a pointer of type ${JSON.stringify(type)}; ocean-node 4.2 reads DDOs only from ${DDO_STORAGE_TYPES.join(', ')}.`
    )

  const problem = POINTER_CHECKS[type.toLowerCase()](
    pointer as unknown as Record<string, unknown>
  )
  if (problem)
    throw new Error(
      `The remote store returned a '${type}' pointer that ocean-node 4.2 cannot read a DDO from: ${problem}.`
    )

  // The node receives the pointer as JSON, so it must survive the round trip unchanged.
  // An already wrapped `{ remote }` would make the node follow a second hop (step 11).
  const json = JSON.stringify(pointer)
  if (JSON.stringify(JSON.parse(json)) !== json || 'remote' in pointer)
    throw new Error(
      'The remote store returned a pointer that is not a plain storage object.'
    )
}

/**
 * The on-chain pointer's plaintext, exactly as the node decrypts it: `{ remote }` and no
 * other key (step 8, `isRemoteDDO`). Returned as the object `OceanNodeClient.encrypt`
 * serializes with `JSON.stringify`.
 */
export function pointerPlaintext(pointer: StorageObject): {
  remote: StorageObject
} {
  assertDdoPointer(pointer)

  // Validate and encrypt one plain snapshot, not the store's live object: an inherited
  // `type` or a getter could otherwise pass the check and serialize differently.
  const snapshot = JSON.parse(JSON.stringify(pointer)) as StorageObject
  assertDdoPointer(snapshot)

  return { remote: snapshot }
}

/**
 * The JWT registered claims (RFC 7519 §4.1). A signer may add them to the payload: the
 * built-in signers set `iss`, `sub` and `jti`, and a custom one may set the others. They
 * are not compared with the DDO unless the DDO itself has them.
 */
const REGISTERED_CLAIMS = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']

/**
 * Steps 14 and 16 on the signer's output: whatever a `DdoSigner` returned (a walt.id wallet,
 * a custom service) must be a compact JWS whose payload, `vc` unwrapped as the node does, is
 * the DDO that was validated. That payload is the document the node indexes, and nautilus
 * never sees it otherwise.
 *
 * Every field is compared with the validated DDO as JSON (key order aside), except:
 *
 *   - the registered claims (`REGISTERED_CLAIMS`) the DDO does not have itself;
 *   - `type`, which may also be `['VerifiableCredential']`, as the built-in signers write it;
 *   - `issuer`, which may differ from the DDO's in the case of an Ethereum address, as the
 *     signer's own checksummed address; or be any non-empty string when the DDO declares
 *     none;
 *   - with a `vc` wrapper, every claim outside `vc`: the node does not index them.
 *
 * The built-in signers pass by construction: `Eip191VcSigner` signs `credentialClaims`, and
 * walt.id signs the credential it is posted unchanged.
 */
export function assertSignedDdo(
  jwt: string,
  ddo: Record<string, unknown>
): void {
  let claims: Record<string, unknown>
  try {
    claims = decodeCredential(jwt)
  } catch (error) {
    throw new Error(
      `The DDO signer did not return a compact JWS: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // The node's test (`getDataFromProof`): any truthy `vc` replaces the payload.
  const payload = claims.vc ? claims.vc : claims

  if (!isPlainObject(payload))
    throw new Error(
      'The DDO signer signed a `vc` claim that is not a JSON object; the node would index it as the DDO.'
    )

  for (const field of ['id', 'version'] as const)
    if (payload[field] !== ddo[field])
      throw new Error(
        `The DDO signer signed a document with ${field} ${JSON.stringify(payload[field])}, not the validated DDO's ${JSON.stringify(ddo[field])}.`
      )

  // As the signer received it: `undefined` fields dropped.
  const expected = JSON.parse(JSON.stringify(ddo)) as Record<string, unknown>

  for (const key of new Set([
    ...Object.keys(payload),
    ...Object.keys(expected)
  ])) {
    if (!has(expected, key) && REGISTERED_CLAIMS.includes(key)) continue

    if (key === 'type' && jsonEqual(payload.type, CREDENTIAL_TYPE)) continue

    if (key === 'issuer' && isAcceptedIssuer(payload.issuer, expected.issuer))
      continue

    const difference = firstDifference(payload[key], expected[key], key)
    if (difference !== undefined)
      throw new Error(
        `The DDO signer signed a document that differs from the validated DDO at ${difference}. The signed payload is what the node indexes, so nautilus stores only the document it validated.`
      )
  }
}

function has(object: object, key: string): boolean {
  return Object.hasOwn(object, key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isAcceptedIssuer(signed: unknown, declared: unknown): boolean {
  if (typeof signed !== 'string' || !signed) return false
  if (typeof declared !== 'string' || !declared) return true

  const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value)

  return (
    signed === declared ||
    (isAddress(signed) &&
      isAddress(declared) &&
      signed.toLowerCase() === declared.toLowerCase())
  )
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return firstDifference(a, b, '') === undefined
}

/** The path of the first place `a` and `b` differ as JSON values, or `undefined`. */
function firstDifference(
  a: unknown,
  b: unknown,
  path: string
): string | undefined {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return path

    for (let i = 0; i < a.length; i++) {
      const difference = firstDifference(a[i], b[i], `${path}[${i}]`)
      if (difference !== undefined) return difference
    }

    return undefined
  }

  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return path

    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!has(a, key) || !has(b, key)) return `${path}.${key}`

      const difference = firstDifference(a[key], b[key], `${path}.${key}`)
      if (difference !== undefined) return difference
    }

    return undefined
  }

  return a === b ? undefined : path
}

/** Step 16: `did:ope:` + sha256(checksummed NFT address + decimal chain id). */
export function expectedDid(nftAddress: string, chainId: number): string {
  return `did:ope:${createHash('sha256')
    .update(getAddress(nftAddress) + chainId.toString(10))
    .digest('hex')}`
}

/** Throws unless `did` is the one the node derives for this NFT, so step 16 passes. */
export function assertDid(
  did: unknown,
  nftAddress: string,
  chainId: number
): void {
  const expected = expectedDid(nftAddress, chainId)

  if (did !== expected)
    throw new Error(
      `The DDO id ${JSON.stringify(did)} is not the DID of NFT ${nftAddress} on chain ${chainId} (${expected}); the node would reject it.`
    )
}

/**
 * Lifecycle states metadata may be written with or onto: ACTIVE, END_OF_LIFE,
 * ORDERING_DISABLED_TEMPORARILY and ASSET_UNLISTED.
 *
 * DEPRECATED (2) and REVOKED_BY_PUBLISHER (3) are refused both ways. Step 2: the indexer
 * then replaces the DDO with a stub, one-way. Step 6: the decrypt handler refuses to
 * decrypt for an asset in either state.
 */
const WRITABLE_STATES = [0, 1, 4, 5]

/** Throws for a lifecycle state metadata must not be written in. */
export function assertWritableState(state: number, where: string): void {
  if (!WRITABLE_STATES.includes(state))
    throw new Error(
      `Refusing to write metadata: ${where} is in lifecycle state ${state}. ocean-node does not decrypt or index metadata for a DEPRECATED (2) or REVOKED_BY_PUBLISHER (3) asset, and both states are one-way.`
    )
}

/** The NFT's lifecycle state on chain (`getMetaData()`'s `metaDataState`). */
export async function readMetadataState(
  nft: Pick<Nft, 'getMetadata'>,
  nftAddress: string
): Promise<number> {
  return (await readMetadataStatus(nft, nftAddress)).state
}

/**
 * The NFT's lifecycle state and whether it carries metadata, from one `getMetaData()`
 * read (`metaDataState` and `hasMetaData`).
 */
export async function readMetadataStatus(
  nft: Pick<Nft, 'getMetadata'>,
  nftAddress: string
): Promise<{ state: number; hasMetadata: boolean }> {
  const metadata = (await nft.getMetadata(nftAddress)) as unknown[]
  const state = Array.isArray(metadata) ? metadata[2] : undefined

  // Fail closed: an unreadable state must not pass for ACTIVE.
  if (state === undefined || state === null || state === '')
    throw new Error(
      `Could not read the metadata state of NFT ${nftAddress} (getMetaData returned ${JSON.stringify(metadata, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}).`
    )

  return { state: Number(state), hasMetadata: Boolean(metadata[3]) }
}

/**
 * Step 3: the indexer asks the node named on chain to decrypt, and encryption keys are
 * node-local. So the node written on chain must be the one that encrypted.
 */
export function assertSameNode(nodeUri: string, encryptedBy: string): void {
  const normalize = (uri: string) =>
    uri.trim().replace(/\/+$/, '').toLowerCase()

  if (normalize(nodeUri) !== normalize(encryptedBy))
    throw new Error(
      `Refusing to write metadata naming ${nodeUri} as the decryptor: the envelope and pointer were encrypted by ${encryptedBy}, and only that node can decrypt them.`
    )
}

function hexlify(value: string): string {
  return `0x${Buffer.from(value, 'utf8').toString('hex')}`
}
