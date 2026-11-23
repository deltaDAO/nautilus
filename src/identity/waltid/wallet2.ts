/**
 * A narrow client for walt.id's **wallet-api2** (OpenID4VP 1.0, DCQL), as the pontusx
 * identity stack runs it (deltaDAO/pontusx-identity): organisations, wallets per EVM
 * address, keys in OpenBao, and sign-in through Hanko.
 *
 * Presenting is handle based, so what is signed is exactly what was reviewed:
 *
 *   1. `POST /wallet/{walletId}/credentials/present/preview-handle` resolves the request
 *      once and answers an opaque, single-use handle (300 s) with the preview: the verifier,
 *      the `transaction_data`, the credentials matching each DCQL query, and the required
 *      combinations of query ids;
 *   2. `POST …/present/submit-handle` signs and sends exactly that request with the chosen
 *      credentials, or `POST …/present/reject-handle` declines it.
 *
 * The one-shot `present` routes are refused by the platform. Every call carries a token
 * from a `WalletApi2TokenSource`: the account's Hanko session JWT (`Authorization: Bearer`;
 * pass it, or a function that returns a fresh one), or an address token of a script that
 * signed in with an organisation address (`AddressSignIn`: `Authorization: DPoP pxa_…`
 * and a DPoP proof per request, through the wallet UI's address gateway).
 */
import { debugEnabled, debugRaw } from '../../log/debug.js'
import { sanitize } from '../../node/messages.js'
import { errorMessage, fetchText } from '../../utils/http.js'
import { assertSecureTransport } from '../../utils/transport.js'
import {
  addressRefusal,
  NOT_FOUND_HINT,
  plainJsonError
} from './addressErrors.js'
import { WaltIdWalletError } from './client.js'

/** How much of wallet-api2's answer goes into a `WaltIdWalletError`. */
const MAX_WALLET_MESSAGE_LENGTH = 500
/** The largest answer read: a preview carries the matching credentials' data. */
const MAX_WALLET_REPLY_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

/** One wallet of the caller's organisation, by the EVM address it belongs to. */
export interface WalletApi2WalletRef {
  walletId: string
  address?: string
  walletName?: string
}

/** One credential of the wallet that matches one DCQL query. */
export interface WalletApi2CredentialOption {
  queryId: string
  credentialId: string
  /** The query accepts several credentials. */
  multiple?: boolean
  format?: string
  issuer?: string
  subject?: string
  label?: string
  /** The credential's data (claims): never logged by nautilus. */
  credentialData?: unknown
  /** `org`: held in the organisation's store; `wallet`: the wallet's own. */
  store?: string
}

/** A `transaction_data` item of the request, decoded. */
export interface WalletApi2TransactionData {
  type: string
  credentialQueryIds?: string[]
  details?: Record<string, unknown>
  rawJson?: Record<string, unknown>
}

/** Who the presentation is signed as, as wallet-api2 resolved it at preview. */
export interface WalletApi2Holder {
  did: string
  keyId?: string
  verificationMethod?: string
  alg?: string
  source?: string
}

/** wallet-api2's preview of a presentation request (`PresentationPreviewResponse`). */
export interface WalletApi2Preview {
  /** The request is valid and can be answered. */
  valid: boolean
  keyId?: string
  clientId?: string
  verifier?: { name?: string }
  /** Where the presentation will be posted. */
  responseUri?: string
  transactionData: WalletApi2TransactionData[]
  credentialOptions: WalletApi2CredentialOption[]
  /**
   * The required combinations: for each, one of its `options` (a list of query ids) must be
   * presented in full. Optional credential sets are not listed.
   */
  credentialRequirements: { options: string[][] }[]
  /** Why the request is not valid (an OpenID4VP error code). */
  error?: { code: string; message?: string }
  holder?: WalletApi2Holder
}

/** What `preview-handle` answers. */
export interface WalletApi2PreviewHandle {
  /** Opaque and single use: consumed by `submit` or `reject`, even a failed one. */
  handle: string
  expiresAt?: string
  preview: WalletApi2Preview
}

/** What `submit-handle` answers. */
export interface WalletApi2SubmitResult {
  /** `false` when the verifier refused the presentation. */
  transmissionSuccess?: boolean
  /** The verifier's redirect, when it sent one. */
  redirectTo?: string
}

/** The wallet-api2 calls `WalletApi2CredentialProvider` makes. */
export interface WalletApi2 {
  /** The wallets of the caller's organisation the caller may use (`GET /org/wallets`). */
  listWallets(signal?: AbortSignal): Promise<WalletApi2WalletRef[]>
  previewPresentation(
    walletId: string,
    request: { requestUrl: string; did?: string; keyId?: string },
    signal?: AbortSignal
  ): Promise<WalletApi2PreviewHandle>
  submitPresentation(
    walletId: string,
    request: {
      handle: string
      selectedCredentialOptions: { queryId: string; credentialId: string }[]
      did?: string
      keyId?: string
    },
    signal?: AbortSignal
  ): Promise<WalletApi2SubmitResult>
  rejectPresentation(
    walletId: string,
    request: { handle: string; errorCode?: string; errorDescription?: string },
    signal?: AbortSignal
  ): Promise<void>
}

/** What `GET /auth/account` answers for an address token: what the address may do. */
export interface AddressSignInAccount {
  /** `evm-address`. */
  method: string
  /** The address, lower case. */
  address: string
  organizationId: string
  walletId: string
  /** The token's non-secret id, as the wallet UI's "Active sessions" lists it. */
  tokenId: string
  /** When the token expires (ISO 8601). */
  expiresAt: string
  /** The scopes the token was granted: `present`, `sign-ddo`. */
  scopes: string[]
  /** Whether the address may present (and sign DDOs) as the organisation's did:web. */
  didWebHolder: boolean
  /** Whether DDO signing (scope `sign-ddo`) is switched on for the address. */
  ddoSigning: boolean
  /** The verifiers the address may present to: exact `client_id`, `response_uri` origin. */
  verifiers: { clientId: string; responseUriOrigin: string }[]
  /**
   * The credentials the address may present, without claim values: its wallet's own
   * (`store: 'wallet'`) and the organisation credentials whose access list names it
   * (`store: 'org'`).
   */
  presentableCredentials: {
    id: string
    type: string[]
    format: string
    store: string
  }[]
}

/**
 * Where `WalletApi2HttpClient` gets the authorization of each request.
 *
 * - The account's Hanko session JWT: pass a string or a function to `token`, or wrap it
 *   with `staticTokenSource()`; sent as `Authorization: Bearer`.
 * - An address token (`AddressSignIn`): `Authorization: DPoP pxa_…` with a fresh DPoP proof
 *   per request (`authorize`), only to the gateway it was issued for (`endpoint`).
 *
 * When a request with a token from a source object is answered `401`, the client calls
 * `invalidate(token)` and retries the request once, if the source then gives another token.
 */
export interface WalletApi2TokenSource {
  /** A current token. Never logged. */
  getToken(): Promise<string>
  /**
   * Forgets `token` (or the current token), so the next `getToken()` gets a new one. A
   * `token` that is no longer the current one (another caller renewed it) is ignored.
   */
  invalidate(token?: string): void
  /** The wallet the token is for, once known (an address token is for one wallet). */
  readonly walletId?: string
  /** The address the token belongs to, once known (address tokens). */
  readonly address?: string
  /**
   * The base URL the token may be sent to (address tokens: the gateway URL). A client for
   * another URL refuses the source (`wrong_endpoint`).
   */
  readonly endpoint?: string
  /**
   * The headers of one request to `url` with `method`, and the token they carry. Without
   * it, `Authorization: Bearer <getToken()>`. Called again for a retry, so a DPoP source
   * makes a fresh proof.
   */
  authorize?(request: {
    method: string
    url: string
    signal?: AbortSignal
  }): Promise<{ token: string; headers: Record<string, string> }>
}

/**
 * A token source for a fixed token or a function that returns a current one (a Hanko
 * session JWT, or a test token): `Authorization: Bearer`. `invalidate()` does nothing, so a
 * `401` is not retried with the same token.
 */
export function staticTokenSource(
  token: string | (() => string | Promise<string>)
): WalletApi2TokenSource {
  if (!token)
    throw new WaltIdWalletError(
      'create',
      'staticTokenSource needs a token or a function returning one'
    )
  return {
    getToken: async () => (typeof token === 'function' ? token() : token),
    invalidate: () => undefined
  }
}

function isTokenSource(value: unknown): value is WalletApi2TokenSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as WalletApi2TokenSource).getToken === 'function' &&
    typeof (value as WalletApi2TokenSource).invalidate === 'function'
  )
}

export interface WalletApi2HttpClientOptions {
  /**
   * Base URL of wallet-api2, e.g. `https://wallet-api.example.org`; for an address token,
   * the wallet UI's address gateway, e.g. `https://wallet.example.org/api/address-gateway`.
   */
  apiUrl: string
  /**
   * The account's session token (a Hanko session JWT on the platform), or a function that
   * returns a current one; it is asked for on every request. Sent as `Authorization:
   * Bearer`, never logged. Or a `WalletApi2TokenSource` (an `AddressSignIn`), whose
   * requests are retried once after a `401`.
   */
  token: string | (() => string | Promise<string>) | WalletApi2TokenSource
  /**
   * Accept a plain `http://` `apiUrl` on a host other than a loopback one. Default `false`:
   * the token travels with every request.
   */
  allowInsecureTransport?: boolean
  /** Per-request timeout in milliseconds. Default 30 s. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = 2048): string | undefined {
  return typeof value === 'string' && value && value.length <= max
    ? value
    : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** wallet-api2 over HTTP. */
export class WalletApi2HttpClient implements WalletApi2 {
  private readonly apiUrl: string
  private readonly token: WalletApi2HttpClientOptions['token']
  /** The token source object, when one was given (retries after a 401). */
  private readonly source?: WalletApi2TokenSource
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: WalletApi2HttpClientOptions) {
    if (
      typeof options.apiUrl !== 'string' ||
      !/^https?:\/\//i.test(options.apiUrl.trim())
    )
      throw new WaltIdWalletError('create', 'walletApi must be an http(s) URL')
    try {
      assertSecureTransport(
        options.apiUrl,
        'walletApi',
        options.allowInsecureTransport === true
      )
    } catch (error) {
      throw new WaltIdWalletError('create', errorMessage(error))
    }
    if (!options.token)
      throw new WaltIdWalletError(
        'create',
        'wallet-api2 needs the account session token (token)'
      )
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
    if (/[\u0000-\u001f\u007f\\]/.test(options.apiUrl))
      throw new WaltIdWalletError(
        'create',
        'walletApi must not contain control characters or backslashes'
      )

    this.apiUrl = options.apiUrl.trim().replace(/\/+$/, '')
    this.token = options.token
    if (isTokenSource(options.token)) {
      this.source = options.token
      const endpoint = options.token.endpoint
      if (endpoint !== undefined && endpoint !== this.apiUrl)
        throw new WaltIdWalletError(
          'create',
          `this address token is issued for ${endpoint} and is only sent there, not to ${this.apiUrl}. Use the address gateway URL as walletApi (WalletApi2CredentialProvider.withAddressSignIn sets it).`,
          undefined,
          { code: 'wrong_endpoint' }
        )
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async listWallets(signal?: AbortSignal): Promise<WalletApi2WalletRef[]> {
    const data = await this.request('org/wallets', 'GET', undefined, signal)
    const list = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data.wallets)
        ? data.wallets
        : []

    return list.filter(isRecord).flatMap((wallet): WalletApi2WalletRef[] => {
      const walletId = str(wallet.walletId ?? wallet.id, 200)
      if (!walletId) return []
      const address = str(wallet.address, 100)
      const walletName = str(wallet.walletName ?? wallet.name, 200)
      return [
        {
          walletId,
          ...(address ? { address } : {}),
          ...(walletName ? { walletName } : {})
        }
      ]
    })
  }

  async previewPresentation(
    walletId: string,
    request: { requestUrl: string; did?: string; keyId?: string },
    signal?: AbortSignal
  ): Promise<WalletApi2PreviewHandle> {
    const data = await this.request(
      `wallet/${this.segment(walletId, 'walletId')}/credentials/present/preview-handle`,
      'POST',
      request,
      signal
    )
    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'presentation preview (preview-handle)', data)

    const handle = isRecord(data) ? str(data.handle, 512) : undefined
    if (!isRecord(data) || !handle || !isRecord(data.preview))
      throw new WaltIdWalletError(
        'credentials/present/preview-handle',
        'wallet-api2 answered without a handle or a preview'
      )

    return {
      handle,
      ...(str(data.expiresAt, 64)
        ? { expiresAt: data.expiresAt as string }
        : {}),
      preview: readPreview(data.preview)
    }
  }

  async submitPresentation(
    walletId: string,
    request: {
      handle: string
      selectedCredentialOptions: { queryId: string; credentialId: string }[]
      did?: string
      keyId?: string
    },
    signal?: AbortSignal
  ): Promise<WalletApi2SubmitResult> {
    const data = await this.request(
      `wallet/${this.segment(walletId, 'walletId')}/credentials/present/submit-handle`,
      'POST',
      request,
      signal
    )
    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'presentation answer (submit-handle)', data)

    const answer = isRecord(data) ? data : {}
    const success = answer.transmission_success ?? answer.transmissionSuccess
    const redirect = str(answer.redirect_to ?? answer.redirectTo)

    return {
      ...(typeof success === 'boolean' ? { transmissionSuccess: success } : {}),
      ...(redirect ? { redirectTo: redirect } : {})
    }
  }

  async rejectPresentation(
    walletId: string,
    request: { handle: string; errorCode?: string; errorDescription?: string },
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(
      `wallet/${this.segment(walletId, 'walletId')}/credentials/present/reject-handle`,
      'POST',
      request,
      signal
    )
  }

  /**
   * What `GET /auth/account` answers: for an address token, what the address may do
   * (verifiers, did:web switch, presentable credentials, without claim values).
   */
  async account(signal?: AbortSignal): Promise<AddressSignInAccount> {
    const data = await this.request('auth/account', 'GET', undefined, signal)
    const account = readAccount(data)
    if (!account)
      throw new WaltIdWalletError(
        'auth/account',
        'the answer is not the account of an address token. Is walletApi the address gateway (…/api/address-gateway)?',
        undefined,
        { code: 'wrong_endpoint' }
      )
    return account
  }

  /**
   * Signs `credential` (a DDO credential) with the wallet key `keyId`
   * (`POST /wallet/{walletId}/keys/{keyId}/sign`); answers the compact JWS. With an address
   * token this needs the scope `sign-ddo`.
   */
  async signDdo(
    walletId: string,
    keyId: string,
    credential: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const text = await this.request(
      `wallet/${this.segment(walletId, 'walletId')}/keys/${this.segment(keyId, 'keyId')}/sign`,
      'POST',
      credential,
      signal,
      { raw: true }
    )
    return typeof text === 'string' ? text.trim() : ''
  }

  /**
   * One path segment. Through the address gateway (a source that names its `endpoint`) the
   * id is sent as it is, which is what wallet-api2 sees and what the DPoP proof's `htu`
   * must name, so only the gateway's segment characters are accepted
   * (`[A-Za-z0-9._~:@+-]`). Elsewhere it is percent-encoded.
   */
  private segment(id: string, name: string): string {
    if (this.source?.endpoint === undefined) return encodeURIComponent(id)
    if (!GATEWAY_SEGMENT.test(id) || id === '.' || id === '..')
      throw new WaltIdWalletError(
        name,
        `${name} ${JSON.stringify(id.slice(0, 100))} cannot go through the address gateway: it accepts only letters, digits and . _ ~ : @ + - in a path segment.`,
        undefined,
        { code: 'invalid_request' }
      )
    return id
  }

  /** The headers of one request, and the token they carry. */
  private async authorize(
    method: string,
    url: string,
    path: string,
    signal?: AbortSignal
  ): Promise<{ token: string; headers: Record<string, string> }> {
    const source = this.source
    if (source?.authorize) return source.authorize({ method, url, signal })
    const token = source
      ? await source.getToken()
      : typeof this.token === 'function'
        ? await this.token()
        : (this.token as string)
    if (!token)
      throw new WaltIdWalletError(path, 'no session token for wallet-api2')
    return { token, headers: { Authorization: `Bearer ${token}` } }
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal?: AbortSignal,
    options: { raw?: boolean } = {}
  ): Promise<unknown> {
    const url = `${this.apiUrl}/${path}`
    let response = await this.send(path, url, method, body, signal)

    // A 401 is retried at most once, and only when a new attempt can succeed:
    //   - token_invalid / token_expired (or WWW-Authenticate error="invalid_token"): the
    //     source signs in again;
    //   - dpop_invalid: the same token with a fresh proof (a clock step, a replayed jti);
    //   - anything else (a fixed Hanko token, an unknown 401) is not retried.
    // A 401 without the gateway's coded answer is no address gateway: that is reported
    // before any retry.
    if (response.status === 401 && this.source) {
      const refusal = addressRefusal(response.body)
      const invalidToken =
        refusal?.code === 'token_invalid' ||
        refusal?.code === 'token_expired' ||
        /error="?invalid_token"?/i.test(response.wwwAuthenticate ?? '')
      const dpop = response.scheme === 'DPoP'
      if (dpop && !refusal) throw this.wrongEndpoint(path, response.status)
      if (invalidToken) {
        this.source.invalidate(response.token)
        const renews =
          this.source.authorize !== undefined ||
          (await this.source.getToken()) !== response.token
        if (renews) response = await this.send(path, url, method, body, signal)
      } else if (dpop && refusal?.code === 'dpop_invalid')
        response = await this.send(path, url, method, body, signal)
    }

    if (!response.ok) {
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', `answer HTTP ${response.status} to ${path}`, {
          status: response.status,
          body: response.body
        })
      const refusal = addressRefusal(response.body)
      const plain = refusal ? undefined : plainJsonError(response.body)
      const dpop = response.scheme === 'DPoP'
      // An address token refused without the gateway's or wallet-api2's own answer: the
      // URL is not the address gateway (wallet-api2 itself, a proxy, another service). A
      // 404 with a JSON error ("Key not found") is wallet-api2's own answer.
      if (
        dpop &&
        !refusal &&
        (response.status === 401 || (response.status === 404 && !plain))
      )
        throw this.wrongEndpoint(path, response.status)
      const retryAfter = Number(response.retryAfter)
      const hint =
        refusal?.code === 'not_found'
          ? NOT_FOUND_HINT
          : (refusal?.hint ??
            (dpop &&
            plain &&
            (response.status === 404 || response.status === 400)
              ? 'Developer: check walletId and keyId (wallet-api2 refused them for this address); admin: check that the key and the issuer DID belong to the address wallet.'
              : undefined))
      throw new WaltIdWalletError(
        path,
        refusal
          ? `${refusal.message} (${refusal.code})`
          : (plain ??
              (walletErrorText(response.body) ||
                sanitize(
                  `${response.status} ${response.statusText}`.trim(),
                  100,
                  null
                ))),
        response.status,
        {
          ...(refusal?.code ? { code: refusal.code } : {}),
          ...(hint ? { hint } : {}),
          ...(Number.isFinite(retryAfter) && retryAfter >= 0
            ? { retryAfter }
            : {})
        }
      )
    }

    if (options.raw) return response.body
    if (!response.body.trim()) return undefined
    try {
      return JSON.parse(response.body)
    } catch {
      throw new WaltIdWalletError(
        path,
        'wallet-api2 answered with something that is not JSON'
      )
    }
  }

  private wrongEndpoint(path: string, status: number): WaltIdWalletError {
    return new WaltIdWalletError(
      path,
      `${this.apiUrl} answered ${status} without an address-token error: it is not the wallet UI's address gateway (…/api/address-gateway).`,
      status,
      { code: 'wrong_endpoint' }
    )
  }

  /** One request with fresh authorization. */
  private async send(
    path: string,
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    signal?: AbortSignal
  ): Promise<
    Awaited<ReturnType<typeof fetchText>> & { token: string; scheme: string }
  > {
    const { token, headers } = await this.authorize(method, url, path, signal)
    const scheme = /^DPoP\s/i.test(headers.Authorization ?? '')
      ? 'DPoP'
      : 'Bearer'

    try {
      const response = await fetchText(
        this.fetchImpl,
        url,
        {
          method,
          headers: {
            Accept: 'application/json',
            ...headers,
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {})
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        },
        {
          timeoutMs: this.timeoutMs,
          signal,
          maxBodyBytes: MAX_WALLET_REPLY_BYTES
        }
      )
      return { ...response, token, scheme }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', `request to ${path} failed`, error)
      throw new WaltIdWalletError(
        path,
        sanitize(errorMessage(error), MAX_WALLET_MESSAGE_LENGTH, null)
      )
    }
  }
}

/** A path segment the address gateway forwards (pontusx-wallet-ui `SEGMENT`). */
const GATEWAY_SEGMENT = /^[A-Za-z0-9._~:@+-]+$/

/** `GET /auth/account` of an address token, with its types checked. */
function readAccount(data: unknown): AddressSignInAccount | undefined {
  if (!isRecord(data) || data.method !== 'evm-address') return undefined
  const walletId = str(data.walletId, 200)
  const address = str(data.address, 100)
  if (!walletId || !address) return undefined
  return {
    method: 'evm-address',
    address,
    organizationId: str(data.organizationId, 200) ?? '',
    walletId,
    tokenId: str(data.tokenId, 100) ?? '',
    expiresAt: str(data.expiresAt, 64) ?? '',
    scopes: stringArray(data.scopes),
    didWebHolder: data.didWebHolder === true,
    ddoSigning: data.ddoSigning === true,
    verifiers: (Array.isArray(data.verifiers) ? data.verifiers : [])
      .filter(isRecord)
      .flatMap((entry) => {
        const clientId = str(entry.clientId)
        const responseUriOrigin = str(
          entry.responseUriOrigin ?? entry.responseUriHost
        )
        return clientId && responseUriOrigin
          ? [{ clientId, responseUriOrigin }]
          : []
      }),
    presentableCredentials: (Array.isArray(data.presentableCredentials)
      ? data.presentableCredentials
      : []
    )
      .filter(isRecord)
      .slice(0, 500)
      .flatMap((entry) => {
        const id = str(entry.id, 300)
        return id
          ? [
              {
                id,
                type: stringArray(entry.type),
                format: str(entry.format, 50) ?? '',
                store: str(entry.store, 20) ?? ''
              }
            ]
          : []
      })
  }
}

/** The message of a wallet-api2 error answer (`{ error, message }`), redacted and bounded. */
function walletErrorText(body: string): string {
  let said: string | undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed))
      said = [parsed.message, parsed.error, parsed.code].find(
        (text): text is string => typeof text === 'string' && !!text.trim()
      )
  } catch {
    said = body
  }
  return said ? sanitize(said, MAX_WALLET_MESSAGE_LENGTH, null) : ''
}

/** The parts of a preview nautilus reads, with their types checked. */
function readPreview(raw: Record<string, unknown>): WalletApi2Preview {
  const error = isRecord(raw.error)
    ? {
        code: str(raw.error.code, 100) ?? 'invalid_request',
        ...(str(raw.error.message, 500)
          ? { message: raw.error.message as string }
          : {})
      }
    : undefined
  const holder =
    isRecord(raw.holder) && str(raw.holder.did, 2200)
      ? {
          did: raw.holder.did as string,
          ...(str(raw.holder.keyId, 300)
            ? { keyId: raw.holder.keyId as string }
            : {}),
          ...(str(raw.holder.verificationMethod, 2200)
            ? { verificationMethod: raw.holder.verificationMethod as string }
            : {}),
          ...(str(raw.holder.alg, 30) ? { alg: raw.holder.alg as string } : {}),
          ...(str(raw.holder.source, 30)
            ? { source: raw.holder.source as string }
            : {})
        }
      : undefined
  const verifierName = isRecord(raw.verifier)
    ? str(raw.verifier.name, 200)
    : undefined

  return {
    valid: raw.valid === true,
    ...(str(raw.keyId, 300) ? { keyId: raw.keyId as string } : {}),
    ...(str(raw.clientId) ? { clientId: raw.clientId as string } : {}),
    ...(verifierName ? { verifier: { name: verifierName } } : {}),
    ...(str(raw.responseUri) ? { responseUri: raw.responseUri as string } : {}),
    transactionData: (Array.isArray(raw.transactionData)
      ? raw.transactionData
      : []
    )
      .filter(isRecord)
      .slice(0, 50)
      .map((item) => ({
        type: typeof item.type === 'string' ? item.type : '',
        credentialQueryIds: stringArray(item.credentialQueryIds),
        ...(isRecord(item.details) ? { details: item.details } : {}),
        ...(isRecord(item.rawJson) ? { rawJson: item.rawJson } : {})
      })),
    credentialOptions: (Array.isArray(raw.credentialOptions)
      ? raw.credentialOptions
      : []
    )
      .filter(isRecord)
      .slice(0, 500)
      .flatMap((option): WalletApi2CredentialOption[] => {
        const queryId = str(option.queryId, 200)
        const credentialId = str(option.credentialId, 200)
        if (!queryId || !credentialId) return []
        return [
          {
            queryId,
            credentialId,
            multiple: option.multiple === true,
            ...(str(option.format, 50)
              ? { format: option.format as string }
              : {}),
            ...(str(option.issuer) ? { issuer: option.issuer as string } : {}),
            ...(str(option.subject)
              ? { subject: option.subject as string }
              : {}),
            ...(str(option.label, 500)
              ? { label: option.label as string }
              : {}),
            ...(option.credentialData !== undefined
              ? { credentialData: option.credentialData }
              : {}),
            ...(str(option.store, 20) ? { store: option.store as string } : {})
          }
        ]
      }),
    credentialRequirements: (Array.isArray(raw.credentialRequirements)
      ? raw.credentialRequirements
      : []
    )
      .filter(isRecord)
      .map((requirement) => ({
        options: (Array.isArray(requirement.options)
          ? requirement.options
          : []
        ).filter(
          (option): option is string[] =>
            Array.isArray(option) &&
            option.length > 0 &&
            option.every((id) => typeof id === 'string')
        )
      }))
      .filter((requirement) => requirement.options.length > 0),
    ...(error ? { error } : {}),
    ...(holder ? { holder } : {})
  }
}
