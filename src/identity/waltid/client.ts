/**
 * A narrow client for the walt.id wallet API.
 *
 * Deliberately small — eleven calls — because these are the **v1** endpoints
 * (`/wallet-api/*`), which walt.id has marked for deprecation in favour of `*-api2`
 * (OID4VCI/VP 1.0). Keeping the surface this thin means a v2 backend is a new
 * implementation of `WaltIdWallet`, not a rewrite of the exchange logic.
 */
import type { Signer } from 'ethers'
import { debugEnabled, debugRaw } from '../../log/debug.js'
import { sanitize } from '../../node/messages.js'

/**
 * How much of the wallet's answer goes into a `WaltIdWalletError`. The answer is redacted
 * (a rejected presentation's `redirectUri` carries the policy-server session id) and
 * bounded; the raw answer goes to the sensitive debug channel (topic `wallet`).
 */
const MAX_WALLET_MESSAGE_LENGTH = 500

export interface WaltIdSession {
  token: string
  session_id?: string
  status?: string
  expiration?: string
}

export interface WaltIdWalletRef {
  id: string
  name?: string
  addedOn?: string
  permission?: string
}

export interface WaltIdKeyRef {
  keyId: { id: string }
  algorithm?: string
}

export interface WaltIdDidRef {
  did: string
  alias?: string
  default?: boolean
}

export interface WaltIdCredential {
  id: string
  document?: unknown
  parsedDocument?: unknown
}

export interface PresentationResult {
  redirectUri?: string
  /**
   * Why the presentation failed, as the wallet said it. From `WaltIdHttpWallet`: only the
   * wallet's `errorMessage`, without control characters, credentials redacted, at most 500
   * characters.
   */
  errorMessage?: string
  /**
   * Who refused it, when the wallet answered with an error (`WaltIdHttpWallet`: HTTP 400):
   * `'verifier'` when the wallet posted the presentation and the verifier refused it (the
   * wallet's answer then carries a `redirectUri`, which is not kept: it holds the
   * policy-server session id), `'wallet'` when the wallet failed before.
   *
   * A custom `WaltIdWallet` that leaves it out but sets `errorMessage` (or an error
   * `redirectUri`) is read as `'verifier'`: `WaltIdCredentialProvider` then throws a
   * `verifier-rejected` error, and `PolicySessionResolver` asks the verifier which policy
   * failed.
   */
  rejectedBy?: 'verifier' | 'wallet'
}

export interface WaltIdWallet {
  authenticate(signer: Signer): Promise<WaltIdSession>
  isSessionValid(token: string): Promise<boolean>
  logout(token: string): Promise<void>
  listWallets(token: string): Promise<WaltIdWalletRef[]>
  listKeys(walletId: string, token: string): Promise<WaltIdKeyRef[]>
  listDids(walletId: string, token: string): Promise<WaltIdDidRef[]>
  sign(
    walletId: string,
    keyId: string,
    payload: unknown,
    token: string
  ): Promise<string>
  matchCredentials(
    walletId: string,
    presentationDefinition: unknown,
    token: string
  ): Promise<WaltIdCredential[]>
  unmatchedCredentials(
    walletId: string,
    presentationDefinition: unknown,
    token: string
  ): Promise<unknown[]>
  resolvePresentationRequest(
    walletId: string,
    request: string,
    token: string
  ): Promise<string>
  usePresentationRequest(
    walletId: string,
    did: string,
    presentationRequest: string,
    selectedCredentials: string[],
    token: string,
    disclosures?: Record<string, string>
  ): Promise<PresentationResult>
}

export class WaltIdWalletError extends Error {
  readonly status?: number
  /**
   * The machine-readable code of a wallet-api2 address sign-in or address token refusal
   * (`{ error, message, hint }`: `sign_in_disabled`, `verifier_not_allowed`, …), of the
   * wallet UI's address gateway (`hanko_token_not_accepted`, `not_found`, …), or one of
   * nautilus's own checks before anything is signed (`message_unexpected`,
   * `wrong_endpoint`, `smart_account_not_deployed`, `signer_mismatch`).
   */
  readonly code?: string
  /** What to do, and who fixes it, as the server said it (redacted, bounded). */
  readonly hint?: string
  /** Seconds to wait, from a `429` answer's `Retry-After`. */
  readonly retryAfter?: number

  constructor(
    operation: string,
    message: string,
    status?: number,
    extra: { code?: string; hint?: string; retryAfter?: number } = {}
  ) {
    super(`[walt.id] ${operation}: ${message}`)
    this.name = 'WaltIdWalletError'
    this.status = status
    if (extra.code !== undefined) this.code = extra.code
    if (extra.hint !== undefined) this.hint = extra.hint
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter
  }
}

/**
 * The longest nonce the legacy web3 login signs. walt.id answers `Sign in: 0x` and 64 hex
 * characters (ktor-authnz), older versions a UUID or a signed nonce token (a JWT).
 */
const MAX_LEGACY_NONCE_LENGTH = 1024

/**
 * What the legacy web3 login signs: one line of base64url, hex, a UUID or a JWT, optionally
 * after `Sign in: `. Nothing with a line break or other prose.
 */
const LEGACY_NONCE = /^(?:Sign in: )?[A-Za-z0-9._~+/=:-]{8,}$/

/** The first line of an EIP-4361 (Sign-In with Ethereum) message. */
const SIWE_MARKER = /wants you to sign in with your ethereum account/i

/** Whether base64url `part` decodes to JSON (an object, an array or a string). */
function decodesToJson(part: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return undefined
  try {
    const text = atob(
      part
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(part.length / 4) * 4, '=')
    )
    return /^\s*[[{"]/.test(text) ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

/**
 * Throws unless `nonce` is a short nonce of the form the legacy web3 login expects, and
 * returns it without surrounding whitespace. The signer's key is the same one that signs in
 * to wallet-api2 with an EIP-4361 message and, with `Eip191VcSigner`, signs DDOs as
 * `personal_sign` over `<header>.<payload>`: a malicious endpoint posing as a legacy wallet
 * could hand nautilus either and turn the signature into an address token or a signed DDO.
 * So nautilus refuses, besides anything that is not one line of nonce characters:
 *
 * - a Sign-In with Ethereum message;
 * - an unsigned JWS signing input: two dot-separated parts whose first decodes to JSON
 *   (`Eip191VcSigner`'s input is one), and any dotted nonce whose first part is a JOSE
 *   header (`{"alg": …}`) other than a whole three-part JWT, the signed nonce token some
 *   walt.id versions answer.
 */
export function assertLegacyNonce(nonce: unknown): string {
  if (typeof nonce !== 'string')
    throw new WaltIdWalletError(
      'auth/account/web3/nonce',
      'the wallet answered no nonce to sign'
    )
  const trimmed = nonce.trim()
  if (SIWE_MARKER.test(trimmed))
    throw new WaltIdWalletError(
      'auth/account/web3/nonce',
      'the wallet asked nautilus to sign a Sign-In with Ethereum message instead of a nonce. Refused: this is how a token for another service would be obtained with your key. Check the walletApi URL.',
      undefined,
      { code: 'message_unexpected' }
    )
  if (trimmed.length > MAX_LEGACY_NONCE_LENGTH || !LEGACY_NONCE.test(trimmed))
    throw new WaltIdWalletError(
      'auth/account/web3/nonce',
      `the wallet asked nautilus to sign text that is not a login nonce (${trimmed.length} characters). Refused: nautilus signs only a one-line nonce with this key.`,
      undefined,
      { code: 'message_unexpected' }
    )
  const parts = trimmed.split('.')
  if (parts.length > 1) {
    const header = decodesToJson(parts[0])
    const jose =
      typeof header === 'object' &&
      header !== null &&
      !Array.isArray(header) &&
      'alg' in header
    const ethSigned =
      jose &&
      String((header as { alg: unknown }).alg)
        .toUpperCase()
        .startsWith('ETH')
    if (
      (parts.length === 2 && header !== undefined) ||
      (jose && parts.length !== 3) ||
      ethSigned
    )
      throw new WaltIdWalletError(
        'auth/account/web3/nonce',
        'the wallet asked nautilus to sign a JWS signing input (header.payload) instead of a nonce. Refused: signed with this key it would be a signed credential, such as a DDO.',
        undefined,
        { code: 'message_unexpected' }
      )
  }
  return trimmed
}

export interface WaltIdHttpWalletOptions {
  /** Base URL of the walt.id wallet API, e.g. `https://wallet.example.org`. */
  apiUrl: string
  fetchImpl?: typeof fetch
}

/** walt.id v1 (`/wallet-api/*`) over HTTP. */
export class WaltIdHttpWallet implements WaltIdWallet {
  private readonly apiUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: WaltIdHttpWalletOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl || fetch
  }

  /**
   * Web3 login: fetch a nonce, sign it with the Ethereum key, exchange it for a bearer
   * token. walt.id auto-registers an account the first time it sees an address.
   */
  async authenticate(signer: Signer): Promise<WaltIdSession> {
    const nonce = await this.request<string>(
      'auth/account/web3/nonce',
      { method: 'GET' },
      { raw: true }
    )

    const challenge = assertLegacyNonce(nonce)
    const signed = await signer.signMessage(challenge)

    return this.request<WaltIdSession>('auth/account/web3/signed', {
      method: 'POST',
      body: JSON.stringify({
        challenge,
        signed,
        publicKey: await signer.getAddress()
      })
    })
  }

  async isSessionValid(token: string): Promise<boolean> {
    try {
      await this.request('auth/session', { method: 'GET' }, { token })
      return true
    } catch {
      return false
    }
  }

  async logout(token: string): Promise<void> {
    await this.request('auth/logout', { method: 'POST' }, { token })
  }

  async listWallets(token: string): Promise<WaltIdWalletRef[]> {
    const response = await this.request<{ wallets?: WaltIdWalletRef[] }>(
      'wallet/accounts/wallets',
      { method: 'GET' },
      { token }
    )

    return response?.wallets || []
  }

  async listKeys(walletId: string, token: string): Promise<WaltIdKeyRef[]> {
    return (
      (await this.request<WaltIdKeyRef[]>(
        `wallet/${walletId}/keys`,
        { method: 'GET' },
        { token }
      )) || []
    )
  }

  async listDids(walletId: string, token: string): Promise<WaltIdDidRef[]> {
    return (
      (await this.request<WaltIdDidRef[]>(
        `wallet/${walletId}/dids`,
        { method: 'GET' },
        { token }
      )) || []
    )
  }

  /** Signs a payload with a wallet-held key — used to sign the DDO as a JWT VC. */
  async sign(
    walletId: string,
    keyId: string,
    payload: unknown,
    token: string
  ): Promise<string> {
    return this.request<string>(
      `wallet/${walletId}/keys/${encodeURIComponent(keyId)}/sign`,
      { method: 'POST', body: JSON.stringify(payload) },
      { token, raw: true }
    )
  }

  async matchCredentials(
    walletId: string,
    presentationDefinition: unknown,
    token: string
  ): Promise<WaltIdCredential[]> {
    return (
      (await this.request<WaltIdCredential[]>(
        `wallet/${walletId}/exchange/matchCredentialsForPresentationDefinition`,
        { method: 'POST', body: JSON.stringify(presentationDefinition) },
        { token }
      )) || []
    )
  }

  /** Which required credentials the wallet is missing — turns a denial into a useful message. */
  async unmatchedCredentials(
    walletId: string,
    presentationDefinition: unknown,
    token: string
  ): Promise<unknown[]> {
    return (
      (await this.request<unknown[]>(
        `wallet/${walletId}/exchange/unmatchedCredentialsForPresentationDefinition`,
        { method: 'POST', body: JSON.stringify(presentationDefinition) },
        { token }
      )) || []
    )
  }

  async resolvePresentationRequest(
    walletId: string,
    request: string,
    token: string
  ): Promise<string> {
    return this.request<string>(
      `wallet/${walletId}/exchange/resolvePresentationRequest`,
      { method: 'POST', body: request, contentType: 'text/plain' },
      { token, raw: true }
    )
  }

  /**
   * Posts the verifiable presentation. The wallet sends the `vp_token` to whatever
   * `response_uri` the resolved request carries — which the policy server rewrote to point
   * at its own proxy, so the node observes the exchange.
   */
  async usePresentationRequest(
    walletId: string,
    did: string,
    presentationRequest: string,
    selectedCredentials: string[],
    token: string,
    disclosures?: Record<string, string>
  ): Promise<PresentationResult> {
    // A rejected presentation comes back as a 400, which is a result rather than a
    // transport failure.
    return this.request<PresentationResult>(
      `wallet/${walletId}/exchange/usePresentationRequest`,
      {
        method: 'POST',
        body: JSON.stringify({
          did,
          presentationRequest,
          selectedCredentials,
          ...(disclosures ? { disclosures } : {})
        })
      },
      { token, onBadRequest: readPresentationRejection }
    )
  }

  private async request<T>(
    path: string,
    init: RequestInit & { contentType?: string },
    options: {
      token?: string
      raw?: boolean
      /** Reads a 400 answer's body into the result, in place of a `WaltIdWalletError`. */
      onBadRequest?: (body: string) => T
    } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': init.contentType || 'application/json'
    }
    if (options.token) headers.Authorization = `Bearer ${options.token}`

    const url = `${this.apiUrl}/wallet-api/${path}`

    let response: Response
    try {
      response = await this.fetchImpl(url, { ...init, headers })
    } catch (error) {
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', `request to ${path} failed`, error)
      throw new WaltIdWalletError(
        path,
        sanitize(
          error instanceof Error ? error.message : String(error),
          MAX_WALLET_MESSAGE_LENGTH,
          null
        )
      )
    }

    const text = await response.text()

    if (!response.ok) {
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', `answer HTTP ${response.status} to ${path}`, {
          status: response.status,
          statusText: response.statusText,
          body: text
        })
      if (response.status === 400 && options.onBadRequest)
        return options.onBadRequest(text)
      throw new WaltIdWalletError(
        path,
        sanitize(text, MAX_WALLET_MESSAGE_LENGTH, null) ||
          `${response.status} ${response.statusText}`,
        response.status
      )
    }

    if (options.raw) return text.trim() as unknown as T

    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }
}

/**
 * The wallet's 400 answer to `usePresentationRequest`, reduced to its message.
 *
 * walt.id answers `{ redirectUri, errorMessage }` when it posted the presentation and the
 * verifier refused it, and `{ errorMessage }` when it failed itself. The `redirectUri` is
 * the verifier's error page, `…/error?id=<policy-server session id>`: a credential, so it is
 * dropped, and only whether it was there is kept. An exception in the wallet's route (an
 * `IllegalArgumentException`, a malformed request) is answered by walt.id's error handler
 * as `{ exception, id, status, code, message }`: its `message` is kept. The raw answer went
 * to the debug channel (topic `wallet`) when it was read.
 */
function readPresentationRejection(body: string): PresentationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }

  const answer =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as {
          redirectUri?: unknown
          errorMessage?: unknown
          message?: unknown
        })
      : undefined
  const said = [answer?.errorMessage, answer?.message].find(
    (text): text is string => typeof text === 'string' && !!text.trim()
  )
  const errorMessage = said
    ? sanitize(said, MAX_WALLET_MESSAGE_LENGTH, null)
    : ''

  return {
    errorMessage:
      errorMessage ||
      (answer
        ? 'the wallet gave no reason'
        : `the wallet's answer is not JSON (HTTP 400)`),
    rejectedBy: answer && 'redirectUri' in answer ? 'verifier' : 'wallet'
  }
}
