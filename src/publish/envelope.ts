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
 * ocean-node 4.2's JSON body limit, which applies to `POST /api/services/decrypt`:
 * `fileInfoRoute.use(express.json())` (`httpRoutes/fileInfo.ts:13`) has no path and is
 * mounted before the provider routes, so express's default `'100kb'` (102 400 bytes)
 * applies to every JSON request. A larger body gets a 413 and the asset is never indexed.
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
 * would exceed `MAX_DECRYPT_BODY_BYTES`: ocean-node 4.2 would answer 413 and never index
 * the asset.
 */
export function assertEnvelopeDecryptable(ciphertextLength: number): void {
  const body = envelopeDecryptBodyBytes(ciphertextLength)

  if (body > MAX_DECRYPT_BODY_BYTES)
    throw new Error(
      `The signed DDO is too large for ocean-node 4.2 to index: the indexer would send its envelope back in a ${body}-byte decrypt request, and the node's JSON body limit is ${NODE_DECRYPT_BODY_LIMIT_BYTES} bytes (express.json's default; larger requests get 413 and the asset is never indexed). nautilus refuses above ${MAX_DECRYPT_BODY_BYTES} bytes, which is a signed JWS of at most ${maxDecryptableJwsLength()} characters (about ${Math.floor((maxDecryptableJwsLength() * 3) / 4 / 1024)} KB of DDO JSON). Shorten the DDO: descriptions, address lists in credentials, policies, services.`
    )
}

/**
 * Before any transaction: throws when even the smallest JWS of `ddo` (its JSON in
 * base64url, without the header and signature) gives an envelope the node cannot decrypt.
 * The pre-transaction DDO has placeholder files, which are shorter than the encrypted
 * ones, so this underestimates and never refuses a DDO that would fit;
 * `buildEnvelope` checks the real size.
 */
export function assertDdoFitsDecryptLimit(ddo: Record<string, unknown>): void {
  const payloadLength = Buffer.from(JSON.stringify(ddo), 'utf8').toString(
    'base64url'
  ).length

  assertEnvelopeDecryptable(envelopeCiphertextLengthFor(payloadLength + 2))
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

/**
 * Throws for a pointer ocean-node 4.2 cannot dereference as a DDO. Applies to every
 * `RemoteStore`, custom ones included.
 *
 * Steps 8–9: the pointer must be a plain JSON object with a known `type`. The decrypt
 * handler resolves it without a consumer address, and node persistent storage requires
 * one, so a bucket-backed DDO is never indexed.
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
      `A '${type}' pointer cannot hold a DDO: ocean-node 4.2 resolves remote DDOs without a consumer address, so it cannot read them from its own bucket storage. Use an IpfsRemoteStore or S3RemoteStore instead.`
    )

  if (
    typeof type !== 'string' ||
    !DDO_STORAGE_TYPES.includes(type.toLowerCase())
  )
    throw new Error(
      `The remote store returned a pointer of type ${JSON.stringify(type)}; ocean-node 4.2 reads DDOs only from ${DDO_STORAGE_TYPES.join(', ')}.`
    )

  // The node joins an IPFS hash under `/ipfs/` on its gateway, so it must be a CID and
  // nothing path-like.
  if (type.toLowerCase() === 'ipfs') {
    const hash = (pointer as { hash?: unknown }).hash
    if (typeof hash !== 'string' || !isCid(hash))
      throw new Error(
        `The remote store returned an IPFS pointer whose hash ${JSON.stringify(hash)} is not a CIDv0 (Qm…) or CIDv1 (b…/k…).`
      )
  }

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
 * Steps 14 and 16 on the signer's output: whatever a `DdoSigner` returned (a walt.id wallet,
 * a custom service) must be a compact JWS whose payload, `vc` unwrapped as the node does, is
 * the DDO that was validated: same `id` and `version`. nautilus never sees the document the
 * store will hold otherwise.
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

  const payload =
    claims.vc && typeof claims.vc === 'object'
      ? (claims.vc as Record<string, unknown>)
      : claims

  for (const field of ['id', 'version'] as const)
    if (payload[field] !== ddo[field])
      throw new Error(
        `The DDO signer signed a document with ${field} ${JSON.stringify(payload[field])}, not the validated DDO's ${JSON.stringify(ddo[field])}.`
      )
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
  const metadata = (await nft.getMetadata(nftAddress)) as unknown[]
  const state = Array.isArray(metadata) ? metadata[2] : undefined

  // Fail closed: an unreadable state must not pass for ACTIVE.
  if (state === undefined || state === null || state === '')
    throw new Error(
      `Could not read the metadata state of NFT ${nftAddress} (getMetaData returned ${JSON.stringify(metadata, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}).`
    )

  return Number(state)
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
