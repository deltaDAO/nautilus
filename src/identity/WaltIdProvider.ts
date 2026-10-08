/**
 * Answers the policy server's openid4vp request from a walt.id wallet.
 *
 * The topology is a deliberate loop, so that the node observes every exchange:
 *
 *   nautilus -> ocean-node -> policy-server -> walt.id verifier
 *   walt.id wallet -> policy-server proxy -> ocean-node -> policy-server -> verifier
 *
 * nautilus opens the session and checks the result itself (`PolicySessionResolver`). This
 * provider does the part in between: it fetches the presentation definition through the
 * node's passthrough, matches it against the wallet, and has the wallet answer the request.
 *
 * Selection is **headless by default**: all matching credentials, and the wallet's first
 * DID, so scripts and CI work unattended. Supply `onSelectCredentials`/`onSelectDid` to
 * drive a UI instead.
 */
import type { Signer } from 'ethers'
import {
  type OceanNodeClient,
  PolicyServerAction
} from '../node/OceanNodeClient.js'
import type {
  CredentialChallenge,
  CredentialProvider
} from './CredentialProvider.js'
import {
  type WaltIdCredential,
  type WaltIdDidRef,
  WaltIdHttpWallet,
  type WaltIdSession,
  type WaltIdWallet
} from './waltid/client.js'

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
}

/** Raised when the wallet could not answer the presentation request, carrying the reason where known. */
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

  private session?: WaltIdSession
  private resolvedWalletId?: string

  /**
   * @param node supplies the signer that logs in to walt.id when `options.signer` is not
   * set. The presentation itself goes through the node in each challenge.
   */
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
  }

  async present(challenge: CredentialChallenge): Promise<void> {
    // The session belongs to the node that opened it, and only that node's policy server
    // can hand out its presentation definition.
    const presentationDefinition = await this.getPresentationDefinition(
      challenge.node,
      challenge.sessionId
    )

    await this.answer(presentationDefinition, challenge.redirectUri)
  }

  private async getPresentationDefinition(
    node: OceanNodeClient,
    sessionId: string
  ): Promise<unknown> {
    const response = (await node.policyServerPassthrough({
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

  private async answer(
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
