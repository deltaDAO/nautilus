/**
 * A narrow client for the walt.id wallet API.
 *
 * Deliberately small — eleven calls — because these are the **v1** endpoints
 * (`/wallet-api/*`), which walt.id has marked for deprecation in favour of `*-api2`
 * (OID4VCI/VP 1.0). Keeping the surface this thin means a v2 backend is a new
 * implementation of `WaltIdWallet`, not a rewrite of the exchange logic.
 */
import type { Signer } from 'ethers'

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
  errorMessage?: string
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

  constructor(operation: string, message: string, status?: number) {
    super(`[walt.id] ${operation}: ${message}`)
    this.name = 'WaltIdWalletError'
    this.status = status
  }
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

    const signed = await signer.signMessage(nonce)

    return this.request<WaltIdSession>('auth/account/web3/signed', {
      method: 'POST',
      body: JSON.stringify({
        challenge: nonce,
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
    try {
      return await this.request<PresentationResult>(
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
        { token }
      )
    } catch (error) {
      // A rejected presentation comes back as a 400 carrying `{redirectUri, errorMessage}`,
      // which is a result rather than a transport failure.
      if (error instanceof WaltIdWalletError && error.status === 400)
        return { errorMessage: error.message }

      throw error
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit & { contentType?: string },
    options: { token?: string; raw?: boolean } = {}
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
      throw new WaltIdWalletError(
        path,
        error instanceof Error ? error.message : String(error)
      )
    }

    const text = await response.text()

    if (!response.ok)
      throw new WaltIdWalletError(
        path,
        text || `${response.status} ${response.statusText}`,
        response.status
      )

    if (options.raw) return text.trim() as unknown as T

    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }
}
