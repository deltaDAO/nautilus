/**
 * Signing the DDO credential with a key held in walt.id wallet-api2
 * (`POST /wallet/{walletId}/keys/{keyId}/sign`), as the pontusx market does, for scripts
 * that sign in with an organisation address (`AddressSignIn`, scope `sign-ddo`).
 *
 * For address tokens wallet-api2 signs DDO credentials only, in the market's shape
 * (`DdoCredentialCheck`): top-level `@context`, `id`, `type` (`['VerifiableCredential']`),
 * `issuer`, `version`, `credentialSubject` and `additionalDdos`, nothing else (so none of
 * the JWT claims `iss`, `sub`, `jti` the other signers add), and a `credentialSubject` with
 * only the DDO's own fields. `prepareDocument` gives the publish flow that shape before it
 * validates, so what is validated is what is signed.
 */
import { quoteText } from '../identity/waltid/addressErrors.js'
import { WaltIdWalletError } from '../identity/waltid/client.js'
import {
  WalletApi2HttpClient,
  type WalletApi2TokenSource
} from '../identity/waltid/wallet2.js'
import { sanitize } from '../node/messages.js'
import { JWS_SIGNING_ALLOWANCE } from '../publish/envelope.js'
import { CREDENTIAL_TYPE } from './claims.js'
import type { DdoSigner, SignedCredential } from './vc.js'

/** The top-level fields wallet-api2 accepts in a DDO credential signed with an address token. */
export const WALLET_API2_DDO_FIELDS: readonly string[] = [
  '@context',
  'id',
  'type',
  'issuer',
  'version',
  'credentialSubject',
  'additionalDdos'
]

/** The `credentialSubject` fields it accepts. */
export const WALLET_API2_DDO_SUBJECT_FIELDS: readonly string[] = [
  'chainId',
  'nftAddress',
  'metadata',
  'services',
  'credentials',
  'license',
  'dataspace',
  'stats'
]

/** JWS algorithms a wallet-api2 key signs with. */
const JWS_ALGORITHMS = new Set([
  'ES256',
  'ES384',
  'ES512',
  'ES256K',
  'EdDSA',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512'
])

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export interface WalletApi2VcSignerOptions {
  /**
   * The sign-in to sign with: `credentials.signIn` of
   * `WalletApi2CredentialProvider.withAddressSignIn({ …, scopes: ['present', 'sign-ddo'] })`,
   * or an `AddressSignIn`. Any `WalletApi2TokenSource` works; with one that names no
   * wallet (a Hanko token), pass `walletId` and `walletApi`.
   */
  signIn: WalletApi2TokenSource & { readonly scopes?: readonly string[] }
  /** The wallet key to sign with (wallet-api2's key id). */
  keyId: string
  /**
   * The DID the credential is issued as: a DID of the address's wallet whose verification
   * methods include `keyId`'s key. The organisation's did:web needs "Present as the
   * organisation" for the address.
   */
  issuer: string
  /** Default: the wallet of the sign-in. */
  walletId?: string
  /** Default: the sign-in's gateway (`signIn.endpoint`). */
  walletApi?: string
  allowInsecureTransport?: boolean
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether two JSON values are equal, key order aside. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, i) => jsonEqual(entry, b[i]))
    )
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
    )
  }
  return a === b
}

/** The JSON text of a base64url JWS part. */
function decodeText(part: string): string {
  return Buffer.from(part, 'base64url').toString('utf8')
}

/**
 * Whether JSON `text` has an object with the same key twice. `JSON.parse` keeps the last
 * one silently, so a JWS could carry a payload another parser reads differently.
 */
function hasDuplicateKeys(text: string): boolean {
  const frames: { object: boolean; keys: Set<string>; expectKey: boolean }[] =
    []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const top = frames.at(-1)
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      if (top?.object && top.expectKey) {
        let key: string
        try {
          key = JSON.parse(text.slice(i, j + 1))
        } catch {
          return true
        }
        if (top.keys.has(key)) return true
        top.keys.add(key)
        top.expectKey = false
      }
      i = j
    } else if (c === '{')
      frames.push({ object: true, keys: new Set(), expectKey: true })
    else if (c === '[')
      frames.push({ object: false, keys: new Set(), expectKey: false })
    else if (c === '}' || c === ']') frames.pop()
    else if (c === ',' && top?.object) top.expectKey = true
  }
  return false
}

/** The header members wallet-api2 writes; anything else (`crit`, `b64`, `jwk`) is refused. */
const HEADER_MEMBERS = new Set(['alg', 'kid', 'typ'])

function signingError(message: string, hint: string): WaltIdWalletError {
  return new WaltIdWalletError('keys/sign', message, undefined, {
    code: 'signature_invalid',
    hint
  })
}

/** Signs with a wallet-api2 key, authenticated by an address sign-in. */
export class WalletApi2VcSigner implements DdoSigner {
  private readonly options: WalletApi2VcSignerOptions
  private readonly client: WalletApi2HttpClient

  constructor(options: WalletApi2VcSignerOptions) {
    if (!options?.signIn)
      throw new Error('WalletApi2VcSigner needs a sign-in (signIn).')
    if (typeof options.keyId !== 'string' || !options.keyId)
      throw new Error('WalletApi2VcSigner needs the wallet key id (keyId).')
    if (
      typeof options.issuer !== 'string' ||
      !options.issuer.startsWith('did:')
    )
      throw new Error('WalletApi2VcSigner needs the issuer DID (issuer).')
    const walletApi = options.walletApi ?? options.signIn.endpoint
    if (!walletApi)
      throw new Error(
        'WalletApi2VcSigner needs walletApi for a sign-in that names no gateway.'
      )
    this.options = options
    this.client = new WalletApi2HttpClient({
      apiUrl: walletApi,
      token: options.signIn,
      allowInsecureTransport: options.allowInsecureTransport,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl
    })
  }

  async getIssuer(): Promise<string> {
    return this.options.issuer
  }

  /**
   * `ddo` with only the fields wallet-api2 signs: the other top-level fields (indexer
   * data) and the `credentialSubject` fields outside its list (`id`, `version`, which the
   * node does not need) are left out.
   */
  prepareDocument(ddo: Record<string, unknown>): Record<string, unknown> {
    const shaped: Record<string, unknown> = {}
    for (const key of WALLET_API2_DDO_FIELDS)
      if (Object.hasOwn(ddo, key) && ddo[key] !== undefined)
        shaped[key] = ddo[key]
    if (isPlainObject(ddo.credentialSubject)) {
      const subject: Record<string, unknown> = {}
      for (const key of WALLET_API2_DDO_SUBJECT_FIELDS)
        if (
          Object.hasOwn(ddo.credentialSubject, key) &&
          ddo.credentialSubject[key] !== undefined
        )
          subject[key] = ddo.credentialSubject[key]
      shaped.credentialSubject = subject
    }
    return shaped
  }

  async sign(ddo: Record<string, unknown>): Promise<SignedCredential> {
    const { issuer, keyId } = this.options
    const extra = Object.keys(ddo).filter(
      (key) => !WALLET_API2_DDO_FIELDS.includes(key) && ddo[key] !== undefined
    )
    const subject = isPlainObject(ddo.credentialSubject)
      ? ddo.credentialSubject
      : undefined
    const extraSubject = subject
      ? Object.keys(subject).filter(
          (key) =>
            !WALLET_API2_DDO_SUBJECT_FIELDS.includes(key) &&
            subject[key] !== undefined
        )
      : []
    if (extra.length || extraSubject.length)
      throw new WaltIdWalletError(
        'keys/sign',
        `wallet-api2 signs only the DDO fields ${WALLET_API2_DDO_FIELDS.join(', ')} (credentialSubject: ${WALLET_API2_DDO_SUBJECT_FIELDS.join(', ')}); this DDO also has ${[...extra, ...extraSubject.map((key) => `credentialSubject.${key}`)].join(', ')}. Pass it through prepareDocument() first (publish and edit do).`,
        undefined,
        {
          code: 'not_a_ddo',
          hint: 'Developer: sign through publish() or edit(), or call prepareDocument() before sign().'
        }
      )

    const declared = ddo.issuer
    if (typeof declared === 'string' && declared && declared !== issuer)
      throw new WaltIdWalletError(
        'keys/sign',
        `The DDO declares issuer ${quoteText(declared, 200)} but it is being signed by "${issuer}". Either remove setIssuer(), or sign with the identity you declared.`,
        undefined,
        {
          code: 'issuer_mismatch',
          hint: 'Developer: make setIssuer() and the signer issuer the same DID.'
        }
      )

    const scopes = this.options.signIn.scopes
    if (Array.isArray(scopes) && !scopes.includes('sign-ddo'))
      throw new WaltIdWalletError(
        'keys/sign',
        "the sign-in has no scope sign-ddo. Sign in with scopes: ['present', 'sign-ddo'] (and ask an admin to turn on \"Sign asset descriptions (DDOs)\" for the address).",
        undefined,
        {
          code: 'scope_not_enabled',
          hint: "Developer: sign in with scopes ['present', 'sign-ddo']; admin: turn on \"Sign asset descriptions (DDOs)\" for the address."
        }
      )

    const credential: Record<string, unknown> = {
      ...ddo,
      type: [...CREDENTIAL_TYPE],
      issuer
    }

    let walletId = this.options.walletId
    if (!walletId) {
      await this.options.signIn.getToken()
      walletId = this.options.signIn.walletId
    }
    if (!walletId)
      throw new WaltIdWalletError(
        'keys/sign',
        'the sign-in names no wallet; pass walletId',
        undefined,
        { code: 'invalid_request', hint: 'Developer: pass walletId.' }
      )

    const jws = await this.client.signDdo(walletId, keyId, credential)
    this.assertJws(jws, credential)
    return { jwt: jws, issuer }
  }

  /**
   * The answer must be a compact JWS of exactly `credential`: a header of `alg` (a JOSE
   * signature algorithm), `kid` (a verification method of the issuer) and `typ` only, and
   * a payload without duplicate keys that equals the credential.
   */
  private assertJws(jws: string, credential: Record<string, unknown>): void {
    const { issuer } = this.options
    const operator =
      'Report it to the wallet operators: wallet-api2 answered something it does not sign.'
    if (!COMPACT_JWS.test(jws))
      throw signingError(
        'wallet-api2 returned no compact JWS for the DDO.',
        operator
      )
    const [headerPart, payloadPart] = jws.split('.')
    let header: unknown
    let payload: unknown
    let headerText: string
    let payloadText: string
    try {
      headerText = decodeText(headerPart)
      payloadText = decodeText(payloadPart)
      header = JSON.parse(headerText)
      payload = JSON.parse(payloadText)
    } catch {
      throw signingError(
        'wallet-api2 returned a JWS that does not decode.',
        operator
      )
    }
    if (hasDuplicateKeys(headerText) || hasDuplicateKeys(payloadText))
      throw signingError(
        'wallet-api2 returned a JWS with a duplicate key.',
        operator
      )
    if (
      !isPlainObject(header) ||
      Object.keys(header).some((key) => !HEADER_MEMBERS.has(key))
    )
      throw signingError(
        'wallet-api2 returned a JWS whose header has members other than alg, kid and typ.',
        operator
      )
    if (typeof header.alg !== 'string' || !JWS_ALGORITHMS.has(header.alg))
      throw signingError(
        `wallet-api2 returned a JWS with the algorithm ${sanitize(String(header.alg), 20, null)}, not a JOSE signature algorithm.`,
        operator
      )
    if (typeof header.kid !== 'string' || !header.kid.startsWith(`${issuer}#`))
      throw signingError(
        `wallet-api2 signed with ${typeof header.kid === 'string' ? quoteText(header.kid, 200) : 'no key id'}, not with a verification method of ${issuer}.`,
        `Developer: use a keyId whose key is a verification method of ${issuer}; admin: check the issuer DID's document in the wallet.`
      )
    if (!jsonEqual(payload, credential))
      throw signingError(
        'wallet-api2 signed a document other than the DDO credential it was sent.',
        operator
      )
    const overhead = jws.length - payloadPart.length
    if (overhead > JWS_SIGNING_ALLOWANCE)
      throw signingError(
        `wallet-api2's JWS header and signature take ${overhead} characters, more than the ${JWS_SIGNING_ALLOWANCE} nautilus allows for them when it sizes the envelope.`,
        'Developer: sign with a key whose signatures are shorter (an EC or a smaller RSA key), or a shorter key id.'
      )
  }
}
