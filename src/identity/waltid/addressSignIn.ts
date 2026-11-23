/**
 * Sign-in with an organisation address for walt.id wallet-api2, for scripts, backends and
 * CI jobs that hold the key of one of the organisation's EVM addresses and no browser
 * session (design `wallet-api2-address-sign-in`).
 *
 *   1. An ephemeral P-256 key is made in memory (WebCrypto, never exported or persisted).
 *   2. `POST auth/address/challenge` `{ address, chainId, jkt, scopes }` at the wallet UI's
 *      address gateway answers an EIP-4361 message.
 *   3. nautilus rebuilds that message from what it asked for and compares it byte for byte
 *      (domain and URI of this gateway, the EIP-55 address, the chain, the statement of the
 *      scopes, the resources with its own key thumbprint, a window open now). Only then
 *      does the signer sign it (`signMessage`, EIP-191).
 *   4. `POST auth/address/token` with a DPoP proof answers a short-lived token
 *      (`pxa_…`) bound to the key, for the address's wallet.
 *
 * Every later request carries `Authorization: DPoP pxa_…` and a fresh proof. The token is
 * cached and renewed 60 seconds before it expires; concurrent callers share one sign-in.
 * Use one `AddressSignIn` per process (and one address per pipeline).
 */
import type { Signer } from 'ethers'
import { getAddress } from 'ethers'
import { sanitize } from '../../node/messages.js'
import { errorMessage, fetchText } from '../../utils/http.js'
import { assertSecureTransport } from '../../utils/transport.js'
import { addressRefusal, NOT_FOUND_HINT } from './addressErrors.js'
import {
  ADDRESS_SIGN_IN_SCOPES,
  type AddressSignInScope,
  checkSignInMessage,
  SignInMessageMismatch
} from './addressMessage.js'
import { WaltIdWalletError } from './client.js'
import { DpopKey } from './dpop.js'
import {
  type AddressSignInAccount,
  WalletApi2HttpClient,
  type WalletApi2TokenSource
} from './wallet2.js'

export type { AddressSignInScope } from './addressMessage.js'

const DEFAULT_TIMEOUT_MS = 30_000
/** The whole sign-in (challenge, signing, token) by default. */
const DEFAULT_SIGN_IN_TIMEOUT_MS = 60_000
/** After a failed renewal, the old token is used this long before the next attempt. */
const RENEW_RETRY_MS = 5_000
/** The longest token lifetime accepted (wallet-api2 issues 2 minutes to 4 hours). */
const MAX_EXPIRES_IN_SECONDS = 86_400
/** Sign in again this long before the token expires. */
const RENEW_BEFORE_MS = 60_000
/** The address token's form (wallet-api2 `TOKEN_REGEX`). */
const ADDRESS_TOKEN = /^pxa_[A-Za-z0-9_-]{43}$/
const MAX_MESSAGE_LENGTH = 500

export interface AddressSignInOptions {
  /**
   * The wallet UI's address gateway, exactly as wallet-api2 knows it
   * (`ADDRESS_SIGN_IN_PUBLIC_URL`), e.g. `https://wallet.example.org/api/address-gateway`.
   * The sign-in message must name it, and every DPoP proof does.
   */
  gateway: string
  /** The key of the organisation address. Signs the sign-in message only. */
  signer: Signer
  /** The chain the message names. Default: the signer's provider's network. */
  chainId?: number
  /**
   * Whether the address is a smart account (ERC-1271). wallet-api2 decides how to check the
   * signature from how the address was linked, so this only adds checks: `true` refuses an
   * address without code (an undeployed account: ERC-6492 signatures are not supported),
   * `'auto'` (default) reads the code only to explain a failed sign-in, `false` reads
   * nothing.
   */
  smartAccount?: 'auto' | boolean
  /** Default `['present']`. Add `'sign-ddo'` for `WalletApi2VcSigner`. */
  scopes?: AddressSignInScope[]
  /** Accept a plain `http://` gateway on a host other than a loopback one. Default `false`. */
  allowInsecureTransport?: boolean
  /** Per-request timeout in milliseconds. Default 30 s. */
  timeoutMs?: number
  /**
   * The whole sign-in in milliseconds: challenge, `signMessage` (a remote or hardware signer
   * may wait for approval) and token. Default 60 s.
   */
  signInTimeoutMs?: number
  fetchImpl?: typeof fetch
}

/** A signed-in address: its token, the key it is bound to, and what the server said. */
interface Session {
  token: string
  key: DpopKey
  /** Epoch milliseconds. */
  expiresAt: number
  renewAt: number
  walletId: string
  organizationId: string
  tokenId: string
  scopes: string[]
  address: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A token source that signs in with the key of an organisation address. */
export class AddressSignIn implements WalletApi2TokenSource {
  /** The gateway URL, without a trailing slash. */
  readonly gateway: string
  /** The scopes asked for, in canonical order. */
  readonly scopes: AddressSignInScope[]
  readonly #signer: Signer
  readonly #options: AddressSignInOptions
  readonly #fetchImpl: typeof fetch
  readonly #signInTimeoutMs: number
  readonly #timeoutMs: number
  /** The current session: true private fields, so no log, inspect or JSON shows a token. */
  #session?: Session
  #pending?: Promise<Session>
  /** No renewal attempt before this time (epoch ms), after one failed. */
  #renewRetryAt = 0
  #lastWalletId?: string
  #lastAddress?: string
  #client?: WalletApi2HttpClient

  constructor(options: AddressSignInOptions) {
    if (!options || typeof options.gateway !== 'string')
      throw new WaltIdWalletError(
        'create',
        'AddressSignIn needs the address gateway URL (gateway)'
      )
    const gateway = normalizeGateway(options.gateway)
    try {
      assertSecureTransport(
        gateway,
        'gateway',
        options.allowInsecureTransport === true
      )
    } catch (error) {
      throw new WaltIdWalletError('create', errorMessage(error))
    }
    if (!options.signer || typeof options.signer.signMessage !== 'function')
      throw new WaltIdWalletError(
        'create',
        'AddressSignIn needs the signer of the organisation address'
      )
    const scopes = options.scopes ?? ['present']
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      new Set(scopes).size !== scopes.length ||
      scopes.some((scope) => !ADDRESS_SIGN_IN_SCOPES.includes(scope))
    )
      throw new WaltIdWalletError(
        'create',
        `scopes must be a non-empty list of ${ADDRESS_SIGN_IN_SCOPES.join(', ')}`
      )
    if (
      options.chainId !== undefined &&
      !(Number.isSafeInteger(options.chainId) && options.chainId > 0)
    )
      throw new WaltIdWalletError(
        'create',
        'chainId must be a positive integer'
      )

    const signInTimeoutMs =
      options.signInTimeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS
    if (
      !Number.isInteger(signInTimeoutMs) ||
      signInTimeoutMs < 1 ||
      signInTimeoutMs > 2_147_483_647
    )
      throw new WaltIdWalletError(
        'create',
        'signInTimeoutMs must be an integer from 1 to 2147483647 ms'
      )
    this.#signInTimeoutMs = signInTimeoutMs
    this.gateway = gateway
    this.scopes = ADDRESS_SIGN_IN_SCOPES.filter((scope) =>
      scopes.includes(scope)
    )
    this.#signer = options.signer
    this.#options = options
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** What a log line or `console.log` shows: never the token or the key. */
  toJSON(): Record<string, unknown> {
    return {
      gateway: this.gateway,
      scopes: this.scopes,
      address: this.address,
      walletId: this.walletId,
      signedIn: this.#session !== undefined
    }
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `AddressSignIn ${JSON.stringify(this.toJSON())}`
  }

  /** Address tokens go to the gateway only. */
  get endpoint(): string {
    return this.gateway
  }

  /** The wallet of the address, once signed in. */
  get walletId(): string | undefined {
    return this.#session?.walletId ?? this.#lastWalletId
  }

  /** The address signed in as (EIP-55), once signed in. */
  get address(): string | undefined {
    return this.#session?.address ?? this.#lastAddress
  }

  /** A current token: the cached one, or a new sign-in (shared by concurrent callers). */
  async getToken(signal?: AbortSignal): Promise<string> {
    return (await this.current(signal)).token
  }

  /**
   * Forgets the token (only if it is still the current one), and revokes it at the gateway
   * on a best-effort basis, so refused tokens do not pile up toward the address's cap of
   * active sessions.
   */
  invalidate(token?: string): void {
    const session = this.#session
    if (!session) return
    if (token !== undefined && token !== session.token) return
    this.#session = undefined
    this.retire(session)
  }

  async authorize(request: {
    method: string
    url: string
    signal?: AbortSignal
  }): Promise<{ token: string; headers: Record<string, string> }> {
    const target = URL.canParse(request.url) ? new URL(request.url) : undefined
    const gateway = new URL(this.gateway)
    const basePath = gateway.pathname.replace(/\/$/, '')
    if (
      !target ||
      target.origin !== gateway.origin ||
      target.username ||
      target.password ||
      UNSAFE_URL.test(request.url) ||
      target.pathname.includes('%') ||
      (target.pathname !== basePath &&
        !target.pathname.startsWith(`${basePath}/`))
    )
      throw new WaltIdWalletError(
        'authorize',
        'address tokens may only authorize requests to the configured gateway',
        undefined,
        { code: 'wrong_endpoint' }
      )

    const session = await this.current(request.signal)
    return {
      token: session.token,
      headers: {
        Authorization: `DPoP ${session.token}`,
        DPoP: await session.key.proof(
          request.method,
          this.gateway + target.pathname.slice(basePath.length),
          session.token
        )
      }
    }
  }

  /**
   * Signs in if needed, then asks the gateway what this address may do
   * (`GET auth/account`): its wallet, the verifiers it may present to, whether it may act
   * as the organisation's did:web, and the credentials it may present (no claim values).
   */
  async check(signal?: AbortSignal): Promise<AddressSignInAccount> {
    this.#client ??= new WalletApi2HttpClient({
      apiUrl: this.gateway,
      token: this,
      allowInsecureTransport: this.#options.allowInsecureTransport,
      timeoutMs: this.#timeoutMs,
      fetchImpl: this.#fetchImpl
    })
    return this.#client.account(signal)
  }

  /** A token a newer one replaced, or one refused: revoked in the background. */
  private retire(session: Session): void {
    if (Date.now() >= session.expiresAt) return
    void this.revoke(session).catch(() => undefined)
  }

  private async revoke(session: Session): Promise<void> {
    const url = `${this.gateway}/auth/logout`
    const response = await this.post('auth/logout', url, undefined, {
      Authorization: `DPoP ${session.token}`,
      DPoP: await session.key.proof('POST', url, session.token)
    })
    if (!response.ok) throw this.refusal('auth/logout', response)
  }

  /**
   * Revokes the current token (`POST auth/logout`) and forgets it. The next request signs
   * in again. Use it at the end of a CI job, so its session does not count against the
   * address's active sessions until it expires.
   */
  async signOut(): Promise<void> {
    // A sign-in under way would otherwise leave a token nobody revokes.
    if (this.#pending) await this.#pending.catch(() => undefined)
    const session = this.#session
    this.#session = undefined
    if (!session) return
    await this.revoke(session)
  }

  private async current(signal?: AbortSignal): Promise<Session> {
    signal?.throwIfAborted()
    const session = this.#session
    const now = Date.now()
    if (session && now < session.renewAt) return session
    // A renewal failed a moment ago and the token still works: no new attempt yet.
    if (
      session &&
      now < this.#renewRetryAt &&
      now < session.expiresAt - RENEW_RETRY_MS
    )
      return session
    this.#pending ??= this.signIn().finally(() => {
      this.#pending = undefined
    })
    try {
      return await abortable(this.#pending, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      // A renewal that fails while the token still has a few seconds left keeps it.
      if (
        session &&
        this.#session === session &&
        Date.now() < session.expiresAt - RENEW_RETRY_MS
      ) {
        this.#renewRetryAt = Date.now() + RENEW_RETRY_MS
        return session
      }
      throw error
    }
  }

  /** The sign-in, bounded by `signInTimeoutMs` as a whole. */
  private async signIn(): Promise<Session> {
    const limit = this.#signInTimeoutMs
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new WaltIdWalletError(
          'auth/address',
          `the sign-in did not finish within ${limit} ms (challenge, signing, token). A signer that waits for approval needs a longer signInTimeoutMs.`,
          undefined,
          { code: 'sign_in_timeout' }
        )
        controller.abort(error)
        reject(error)
      }, limit)
    })
    try {
      return await Promise.race([this.signInSteps(controller.signal), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private async signInSteps(signal: AbortSignal): Promise<Session> {
    const address = getAddress(await this.#signer.getAddress())
    const chainId = await this.chainId()
    if (this.#options.smartAccount === true) await this.assertDeployed(address)

    const key = await DpopKey.create()

    const challengeUrl = `${this.gateway}/auth/address/challenge`
    const challenged = await this.post(
      'auth/address/challenge',
      challengeUrl,
      { address, chainId, jkt: key.thumbprint, scopes: this.scopes },
      {},
      signal
    )
    if (!challenged.ok) throw this.refusal('auth/address/challenge', challenged)
    const challenge = this.json('auth/address/challenge', challenged.body)
    const message = challenge.message
    if (typeof message !== 'string' || typeof challenge.challenge !== 'string')
      throw new WaltIdWalletError(
        'auth/address/challenge',
        'the gateway answered without a message or a challenge',
        challenged.status,
        { code: 'wrong_endpoint' }
      )

    try {
      checkSignInMessage(
        message,
        {
          gateway: this.gateway,
          address,
          chainId,
          jkt: key.thumbprint,
          scopes: this.scopes
        },
        {
          nowSeconds: Date.now() / 1000,
          ...(typeof challenge.expiresAt === 'string'
            ? { expiresAt: challenge.expiresAt }
            : {})
        }
      )
    } catch (error) {
      if (!(error instanceof SignInMessageMismatch)) throw error
      throw new WaltIdWalletError(
        'auth/address/challenge',
        `${error.message} A different domain or URI usually means wallet-api2's ADDRESS_SIGN_IN_PUBLIC_URL is not this gateway URL (for example localhost against the public URL): use the URL it names, or ask the operators to set it.`,
        undefined,
        { code: 'message_unexpected' }
      )
    }

    signal.throwIfAborted()
    const signature = await this.#signer.signMessage(message)
    signal.throwIfAborted()

    const tokenUrl = `${this.gateway}/auth/address/token`
    const issued = await this.post(
      'auth/address/token',
      tokenUrl,
      { message, challenge: challenge.challenge, signature },
      { DPoP: await key.proof('POST', tokenUrl) },
      signal
    )
    if (!issued.ok) {
      const error = this.refusal('auth/address/token', issued)
      if (error.code === 'sign_in_failed')
        throw await this.explain(error, address)
      throw error
    }
    const answer = this.json('auth/address/token', issued.body)
    const token = answer.accessToken
    const expiresIn = answer.expiresIn
    const walletId = answer.walletId
    if (
      typeof token !== 'string' ||
      !ADDRESS_TOKEN.test(token) ||
      answer.tokenType !== 'DPoP' ||
      typeof expiresIn !== 'number' ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn < 1 ||
      expiresIn > MAX_EXPIRES_IN_SECONDS ||
      typeof walletId !== 'string' ||
      !/^[A-Za-z0-9._~:@+-]{1,200}$/.test(walletId) ||
      typeof answer.address !== 'string'
    )
      throw new WaltIdWalletError(
        'auth/address/token',
        'the gateway answered no usable address token (a pxa_ token of type DPoP, its lifetime, the address and its wallet)',
        issued.status,
        { code: 'wrong_endpoint' }
      )
    if (answer.address.toLowerCase() !== address.toLowerCase())
      throw new WaltIdWalletError(
        'auth/address/token',
        `the gateway issued a token for ${sanitize(answer.address, 42, null)}, not for ${address}`,
        issued.status,
        { code: 'signer_mismatch' }
      )

    const now = Date.now()
    const lifetime = expiresIn * 1000
    const session: Session = {
      token,
      key,
      expiresAt: now + lifetime,
      renewAt: now + lifetime - Math.min(RENEW_BEFORE_MS, lifetime / 2),
      walletId,
      organizationId:
        typeof answer.organizationId === 'string' ? answer.organizationId : '',
      tokenId: typeof answer.tokenId === 'string' ? answer.tokenId : '',
      scopes: Array.isArray(answer.scopes)
        ? answer.scopes.filter((s): s is string => typeof s === 'string')
        : [...this.scopes],
      address
    }
    const replaced = this.#session
    this.#session = session
    this.#renewRetryAt = 0
    if (replaced && replaced.token !== session.token) this.retire(replaced)
    this.#lastWalletId = walletId
    this.#lastAddress = address
    return session
  }

  /** The chain id: the option, or the signer's network. */
  private async chainId(): Promise<number> {
    if (this.#options.chainId !== undefined) return this.#options.chainId
    const provider = this.#signer.provider
    if (!provider)
      throw new WaltIdWalletError(
        'auth/address/challenge',
        'the signer has no provider to read the chain id from: pass chainId, or connect the signer to a provider',
        undefined,
        { code: 'signer_without_provider' }
      )
    return Number((await provider.getNetwork()).chainId)
  }

  /** `smartAccount: true`: the account must be deployed (no ERC-6492). */
  private async assertDeployed(address: string): Promise<void> {
    const provider = this.#signer.provider
    if (!provider)
      throw new WaltIdWalletError(
        'auth/address/challenge',
        'smartAccount: true needs a signer with a provider, to check that the account is deployed: connect the signer to a provider, or leave smartAccount out',
        undefined,
        { code: 'signer_without_provider' }
      )
    const code = await provider.getCode(address)
    if (!code || code === '0x')
      throw new WaltIdWalletError(
        'auth/address/challenge',
        `${address} has no code on chain: the smart account is not deployed. Deploy the account or sign in with an EOA (signatures of undeployed accounts, ERC-6492, are not supported).`,
        undefined,
        { code: 'smart_account_not_deployed' }
      )
  }

  /** `sign_in_failed`, with what the address's code on chain says about the cause. */
  private async explain(
    error: WaltIdWalletError,
    address: string
  ): Promise<WaltIdWalletError> {
    if (this.#options.smartAccount === false) return error
    let code: string | undefined
    try {
      code = await this.#signer.provider?.getCode(address)
    } catch {
      return error
    }
    if (code === undefined) return error
    const note =
      code === '0x'
        ? `${address} has no code on chain: if it is a smart account, deploy it (ERC-6492 is not supported); otherwise check that the signer holds this address's key.`
        : `${address} is a contract: wallet-api2 checks ERC-1271 only for addresses linked as smart accounts. Ask an admin to check how the address was linked.`
    return new WaltIdWalletError(
      'auth/address/token',
      `${error.message.replace(/^\[walt\.id\] auth\/address\/token: /, '')} ${note}`,
      error.status,
      {
        code: error.code,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.retryAfter !== undefined
          ? { retryAfter: error.retryAfter }
          : {})
      }
    )
  }

  private async post(
    path: string,
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal
  ): Promise<Awaited<ReturnType<typeof fetchText>>> {
    try {
      return await fetchText(
        this.#fetchImpl,
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
            ...headers
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        },
        { timeoutMs: this.#timeoutMs, maxBodyBytes: 64 * 1024, signal }
      )
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      throw new WaltIdWalletError(
        path,
        sanitize(errorMessage(error), MAX_MESSAGE_LENGTH, null)
      )
    }
  }

  private json(path: string, body: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(body)
      if (isRecord(parsed)) return parsed
    } catch {
      // below
    }
    throw new WaltIdWalletError(
      path,
      `${this.gateway} answered with something that is not JSON: it is not the address gateway (…/api/address-gateway).`,
      undefined,
      { code: 'wrong_endpoint' }
    )
  }

  /** A non-2xx answer of the gateway as a `WaltIdWalletError` with its code. */
  private refusal(
    path: string,
    response: Awaited<ReturnType<typeof fetchText>>
  ): WaltIdWalletError {
    const refusal = addressRefusal(response.body)
    const retryAfter = Number(response.retryAfter)
    const extra = {
      ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfter } : {})
    }
    if (!refusal)
      return new WaltIdWalletError(
        path,
        `${this.gateway} answered ${sanitize(`${response.status} ${response.statusText}`.trim(), 100, null)} without an address sign-in error: it is not the wallet UI's address gateway (…/api/address-gateway), or the gateway is not deployed.`,
        response.status,
        { code: 'wrong_endpoint', ...extra }
      )
    const hint = refusal.code === 'not_found' ? NOT_FOUND_HINT : refusal.hint
    return new WaltIdWalletError(
      path,
      `${refusal.message} (${refusal.code})${hint ? ` ${hint}` : ''}`,
      response.status,
      {
        code: refusal.code,
        ...(hint ? { hint } : {}),
        ...extra
      }
    )
  }
}

/** `promise`, or the signal's reason as soon as `signal` aborts (the work goes on). */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/** Control characters, backslashes and whitespace inside the URL. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const UNSAFE_URL = /[\u0000-\u0020\u007f-\u009f\\]/

/**
 * The gateway URL without a trailing slash, as a URL parser reads it except for an explicit default port: an
 * http(s) URL without user info, query, fragment, an empty port, control
 * characters, backslashes or anything the parser would rewrite (upper-case host, `..`,
 * percent-encoding). wallet-api2 compares the sign-in message's domain and URI and every
 * DPoP `htu` with its configured URL byte for byte, so nautilus uses the URL as given.
 */
function normalizeGateway(input: string): string {
  const refuse = (why: string) =>
    new WaltIdWalletError(
      'create',
      `gateway ${why}, e.g. https://wallet.example.org/api/address-gateway (got ${sanitize(input, 200, null)})`
    )
  const gateway = input.trim().replace(/\/+$/, '')
  if (UNSAFE_URL.test(gateway))
    throw refuse(
      'must not contain whitespace, control characters or backslashes'
    )
  if (!/^https?:\/\/[^/?#@]+(?:\/[^?#]*)?$/i.test(gateway))
    throw refuse('must be an http(s) URL without query, fragment or user info')
  if (gateway.includes('%')) throw refuse('must not be percent-encoded')
  if (/^https?:\/\/[^/]*:(?:\/|$)/i.test(gateway))
    throw refuse('must not have an empty port')
  let parsed: URL
  try {
    parsed = new URL(gateway)
  } catch {
    throw refuse('is not a valid URL')
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  const read = `${parsed.origin}${path}`
  // URL.origin omits a default port even when wallet-api2 includes it in its signed bytes.
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
  const explicitDefault =
    !parsed.port && gateway === `${parsed.origin}:${defaultPort}${path}`
  if (read !== gateway && !explicitDefault)
    throw refuse(
      `must be written as a URL parser reads it (${sanitize(read, 200, null)}): lower-case host, no dot segments or percent-encoding`
    )
  return gateway
}
