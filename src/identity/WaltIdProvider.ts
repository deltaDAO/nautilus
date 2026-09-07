/**
 * Drives the credential presentation exchange end to end.
 *
 * The topology is a deliberate loop, so that the node observes every exchange:
 *
 *   nautilus -> ocean-node -> policy-server -> walt.id verifier
 *   walt.id wallet -> policy-server proxy -> ocean-node -> policy-server -> verifier
 *
 * Nautilus only ever talks to the first hop (ocean-node, via `PolicyServerPassthrough`)
 * and to the wallet. The session id it gets back is the whole point: that is what goes
 * into ocean-node's `policyServer` slot on the subsequent download or compute call.
 *
 * Selection is **headless by default** — all matching credentials, and the wallet's first
 * DID — so scripts and CI work unattended. Supply `onSelectCredentials`/`onSelectDid` to
 * drive a UI instead.
 */
import { LoggerInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type { PolicyServerPayload } from '../ddo/types.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import {
  type CredentialChallenge,
  type CredentialProvider,
  emptyPolicyServerPayload
} from './CredentialProvider.js'
import { MemorySessionStore, type SessionStore } from './session.js'
import {
  type WaltIdCredential,
  type WaltIdDidRef,
  WaltIdHttpWallet,
  type WaltIdSession,
  type WaltIdWallet
} from './waltid/client.js'

/** Actions the policy server accepts through the node's passthrough endpoint. */
export enum PolicyServerAction {
  INITIATE = 'initiate',
  GET_PD = 'getPD',
  CHECK_SESSION_ID = 'checkSessionId',
  PRESENTATION_REQUEST = 'presentationRequest',
  DOWNLOAD = 'download',
  PASSTHROUGH = 'passthrough'
}

export interface WaltIdCredentialProviderOptions {
  /** Base URL of the walt.id wallet API. Ignored if `wallet` is supplied. */
  walletApi?: string
  /** A custom wallet implementation — for a walt.id api2 backend, or for tests. */
  wallet?: WaltIdWallet
  /** The signer used to authenticate to the wallet. Defaults to the node client's signer. */
  signer?: Signer
  /** Pin a wallet. Defaults to the first the account owns. */
  walletId?: string
  /** Pin a holder DID. Defaults to `onSelectDid`, else the first DID. */
  did?: string
  /** Choose which credentials to present. Defaults to all that match. */
  onSelectCredentials?: (
    matches: WaltIdCredential[],
    presentationDefinition: unknown
  ) => Promise<WaltIdCredential[]>
  /** Choose the holder DID. Defaults to the first. */
  onSelectDid?: (dids: WaltIdDidRef[]) => Promise<string>
  /** Override the session cache. Defaults to an in-memory store. */
  sessionStore?: SessionStore
}

/** Raised when the policy could not be satisfied, carrying the reason where known. */
export class CredentialPresentationError extends Error {
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'CredentialPresentationError'
    this.details = details
  }
}

export class WaltIdCredentialProvider implements CredentialProvider {
  private readonly node: OceanNodeClient
  private readonly wallet: WaltIdWallet
  private readonly options: WaltIdCredentialProviderOptions
  private readonly sessions: SessionStore

  private session?: WaltIdSession
  private resolvedWalletId?: string

  constructor(node: OceanNodeClient, options: WaltIdCredentialProviderOptions) {
    if (!options.wallet && !options.walletApi)
      throw new Error(
        'WaltIdCredentialProvider needs either a walletApi URL or a wallet implementation.'
      )

    this.node = node
    this.options = options
    this.wallet =
      options.wallet ||
      new WaltIdHttpWallet({ apiUrl: options.walletApi as string })
    this.sessions = options.sessionStore || new MemorySessionStore()
  }

  async resolve(
    challenge: CredentialChallenge
  ): Promise<PolicyServerPayload | null> {
    const { asset, serviceId, consumerAddress } = challenge
    const key = { did: asset.id, serviceId, consumerAddress }

    const cached = this.sessions.get(key)
    if (cached)
      return cached.skipped ? null : emptyPolicyServerPayload(cached.sessionId)

    // 1. Ask the node to start a verification. A null answer means the node advertises no
    //    policy-server endpoint at all, so nothing is gated here.
    const initiated = (await this.node.initializePolicyVerification({
      documentId: asset.id,
      serviceId,
      consumerAddress,
      policyServer: emptyPolicyServerPayload('')
    })) as InitiateResponse | null

    if (!initiated) {
      LoggerInstance.debug(
        '[identity] node advertises no policy server; continuing without SSI'
      )
      this.sessions.set(key, { sessionId: '', skipped: true })
      return null
    }

    const message = normalizeInitiateMessage(initiated)

    // 2. A `success` redirect means no presentation is needed — either the asset carries no
    //    SSI policy, or this consumer is already verified.
    if (message.redirectUri?.includes('success')) {
      const sessionId = extractQueryParam(message.redirectUri, 'id') || ''
      this.sessions.set(key, { sessionId, skipped: !sessionId })
      return sessionId ? emptyPolicyServerPayload(sessionId) : null
    }

    // 3. The session id must come from the server. Policy-server session ids embed
    //    sha256(consumerAddress:documentId:serviceId), so an invented one is rejected with
    //    ADDRESS_NOT_ALLOWED. (The ocean-cli generates its own here and is wrong.)
    const sessionId =
      message.sessionId ||
      (message.redirectUri
        ? extractQueryParam(message.redirectUri, 'state')
        : undefined)

    if (!sessionId)
      throw new CredentialPresentationError(
        'The policy server did not return a session id for this verification.',
        initiated
      )

    const presentationRequest = message.redirectUri
    if (!presentationRequest)
      throw new CredentialPresentationError(
        'The policy server did not return an openid4vp request.',
        initiated
      )

    // 4. Fetch the presentation definition through the node's passthrough.
    const presentationDefinition =
      await this.getPresentationDefinition(sessionId)

    // 5-7. Satisfy it with the wallet.
    await this.present(presentationDefinition, presentationRequest)

    this.sessions.set(key, { sessionId, skipped: false })

    return emptyPolicyServerPayload(sessionId)
  }

  /** Clears cached sessions — call after switching accounts. */
  clearSessions(): void {
    this.sessions.clear()
  }

  /**
   * Re-checks a session and, if it failed, digs the specific failing VC policy out of the
   * verifier's report. A named policy beats a bare "access denied".
   */
  async explainFailure(sessionId: string): Promise<string | undefined> {
    const response = (await this.node.policyServerPassthrough({
      action: PolicyServerAction.CHECK_SESSION_ID,
      sessionId
    })) as CheckSessionResponse | undefined

    const results = response?.message?.policyResults?.results || []
    const failures: string[] = []

    for (const result of results)
      for (const policy of result?.policyResults || [])
        if (policy?.is_success === false)
          failures.push(
            [
              policy.policy || policy.policyName,
              policy.description || policy.reason
            ]
              .filter(Boolean)
              .join(': ')
          )

    return failures.length ? failures.join('; ') : undefined
  }

  private async getPresentationDefinition(sessionId: string): Promise<unknown> {
    const response = (await this.node.policyServerPassthrough({
      action: PolicyServerAction.GET_PD,
      sessionId
    })) as { message?: unknown } | undefined

    const definition = response?.message

    if (!definition)
      throw new CredentialPresentationError(
        'The policy server returned no presentation definition.',
        response
      )

    return definition
  }

  private async present(
    presentationDefinition: unknown,
    presentationRequest: string
  ): Promise<void> {
    const { token } = await this.getWalletSession()
    const walletId = await this.getWalletId(token)

    const matches = await this.wallet.matchCredentials(
      walletId,
      presentationDefinition,
      token
    )

    if (!matches.length) {
      const missing = await this.wallet
        .unmatchedCredentials(walletId, presentationDefinition, token)
        .catch(() => [])

      throw new CredentialPresentationError(
        'The wallet holds no credential satisfying the requested presentation definition.',
        missing
      )
    }

    const selected = this.options.onSelectCredentials
      ? await this.options.onSelectCredentials(matches, presentationDefinition)
      : matches

    if (!selected.length)
      throw new CredentialPresentationError(
        'No credentials were selected to present.'
      )

    const did = await this.getDid(walletId, token)

    const resolved = await this.wallet.resolvePresentationRequest(
      walletId,
      presentationRequest,
      token
    )

    const result = await this.wallet.usePresentationRequest(
      walletId,
      did,
      resolved,
      selected.map((credential) => credential.id),
      token
    )

    if (result.errorMessage || result.redirectUri?.includes('error'))
      throw new CredentialPresentationError(
        result.errorMessage || 'The verifier rejected the presentation.',
        result
      )
  }

  private async getWalletSession(): Promise<WaltIdSession> {
    if (this.session && (await this.wallet.isSessionValid(this.session.token)))
      return this.session

    const signer = this.options.signer || this.node.requireSigner()
    this.session = await this.wallet.authenticate(signer)

    if (!this.session?.token)
      throw new CredentialPresentationError(
        'walt.id did not return a session token for this account.'
      )

    return this.session
  }

  private async getWalletId(token: string): Promise<string> {
    if (this.options.walletId) return this.options.walletId
    if (this.resolvedWalletId) return this.resolvedWalletId

    const wallets = await this.wallet.listWallets(token)

    if (!wallets.length)
      throw new CredentialPresentationError(
        'This walt.id account owns no wallet.'
      )

    this.resolvedWalletId = wallets[0].id

    return this.resolvedWalletId
  }

  private async getDid(walletId: string, token: string): Promise<string> {
    if (this.options.did) return this.options.did

    const dids = await this.wallet.listDids(walletId, token)

    if (!dids.length)
      throw new CredentialPresentationError('This walt.id wallet holds no DID.')

    if (this.options.onSelectDid) return this.options.onSelectDid(dids)

    return (dids.find((did) => did.default) || dids[0]).did
  }
}

// #region response shapes
// The policy server's envelope is `{success, message, httpStatus}`, but `message` is
// either a bare openid4vp URL string or an object, so it is normalized here.

interface InitiateResponse {
  success?: boolean
  message?: string | { sessionId?: string; redirectUri?: string }
}

interface CheckSessionResponse {
  message?: {
    policyResults?: {
      results?: {
        policyResults?: {
          is_success?: boolean
          policy?: string
          policyName?: string
          description?: string
          reason?: string
        }[]
      }[]
    }
  }
}

function normalizeInitiateMessage(response: InitiateResponse): {
  sessionId?: string
  redirectUri?: string
} {
  const { message } = response

  if (!message) return {}
  if (typeof message === 'string') return { redirectUri: message }

  return message
}

function extractQueryParam(uri: string, name: string): string | undefined {
  const match = uri.match(new RegExp(`[?&]${name}=([^&]*)`))

  return match ? decodeURIComponent(match[1]) : undefined
}

// #endregion
