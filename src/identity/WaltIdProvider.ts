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
 *
 * The request comes from the node, and for a download that is the node in the service's
 * `serviceEndpoint`, which the publisher chose. So the provider trusts none of it: the
 * request must be an `openid4vp://` URL whose `request_uri`, `response_uri` and
 * `presentation_definition_uri` are `https://` (or `http://` on a loopback host), every
 * input descriptor of the presentation definition must ask for a credential type the
 * asset's or service's `request_credentials` name, and only credentials of those types are
 * presented. The wallet is used only for the session's own consumer.
 */
import type { Signer } from 'ethers'
import {
  getCredentials,
  getService,
  getServiceCredentials
} from '../ddo/read.js'
import {
  type OceanNodeClient,
  PolicyServerAction
} from '../node/OceanNodeClient.js'
import { isLoopbackHost } from '../utils/transport.js'
import type {
  CredentialChallenge,
  CredentialProvider
} from './CredentialProvider.js'
import { requestedCredentialTypes } from './policy.js'
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
  /**
   * The signer used to authenticate to the wallet. Defaults to the node client's signer.
   * Its address must be the consumer's: the provider refuses to present one account's
   * credentials for a session bound to another.
   */
  signer?: Signer
  /** Pin a wallet. Defaults to the first the account owns. */
  walletId?: string
  /** Pin a holder DID. Defaults to `onSelectDid`, else the first DID. */
  did?: string
  /**
   * Accept a plain `http://` `request_uri`, `response_uri` or `presentation_definition_uri`
   * on a host other than a loopback one, e.g. a policy-server proxy on a private network.
   * Default `false`. Other schemes, link-local hosts and cloud metadata addresses are
   * refused either way.
   */
  allowInsecureTransport?: boolean
  /**
   * Choose which credentials to present, from the matches of a requested type. Defaults to
   * all of them. A credential returned that is not among `matches` is not presented.
   */
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
    const signer = this.options.signer || this.node.requireSigner()
    const signerAddress = await signer.getAddress()

    if (signerAddress.toLowerCase() !== challenge.consumerAddress.toLowerCase())
      throw new CredentialPresentationError(
        `The wallet belongs to ${signerAddress}, but the session is bound to ${challenge.consumerAddress}. Use a provider whose signer is the consumer's.`
      )

    const service = getService(challenge.asset, challenge.serviceId)
    const requestedTypes = requestedCredentialTypes(
      getCredentials(challenge.asset),
      service && getServiceCredentials(service)
    )

    if (!requestedTypes.size)
      throw new CredentialPresentationError(
        `Service ${challenge.serviceId} of ${challenge.asset.id} asks for no credential type, so there is nothing to present.`
      )

    assertPresentationRequest(
      challenge.redirectUri,
      this.options.allowInsecureTransport === true
    )

    // The session belongs to the node that opened it, and only that node's policy server
    // can hand out its presentation definition.
    const presentationDefinition = await this.getPresentationDefinition(
      challenge.node,
      challenge.sessionId
    )

    assertDefinitionRequests(presentationDefinition, requestedTypes)

    await this.answer(
      signer,
      presentationDefinition,
      challenge.redirectUri,
      requestedTypes
    )
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
        'The policy server returned no presentation definition.'
      )

    return definition
  }

  private async answer(
    signer: Signer,
    presentationDefinition: unknown,
    presentationRequest: string,
    requestedTypes: Set<string>
  ): Promise<void> {
    const { token } = await this.getWalletSession(signer)
    const walletId = await this.getWalletId(token)

    const matches = (
      await this.wallet.matchCredentials(
        walletId,
        presentationDefinition,
        token
      )
    ).filter((credential) =>
      credentialTypes(credential).some((type) => requestedTypes.has(type))
    )

    if (!matches.length) {
      const missing = await this.wallet
        .unmatchedCredentials(walletId, presentationDefinition, token)
        .catch(() => [])

      throw new CredentialPresentationError(
        `The wallet holds no credential of the requested types (${[...requestedTypes].join(', ')}) satisfying the presentation definition.`,
        missing
      )
    }

    const matchedIds = new Set(matches.map((credential) => credential.id))
    const selected = (
      this.options.onSelectCredentials
        ? await this.options.onSelectCredentials(
            matches,
            presentationDefinition
          )
        : matches
    ).filter((credential) => matchedIds.has(credential.id))

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

  private async getWalletSession(signer: Signer): Promise<WaltIdSession> {
    if (this.session && (await this.wallet.isSessionValid(this.session.token)))
      return this.session

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

// #region request checks

/** The openid4vp parameters whose URL the wallet fetches from, or posts the presentation to. */
const PRESENTATION_URI_PARAMS = [
  'request_uri',
  'response_uri',
  'presentation_definition_uri'
]

/** Cloud metadata services, by host name and by address. */
const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.azure.internal',
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254'
])

/**
 * Refuses a presentation request the wallet must not follow: anything but an
 * `openid4vp://` URL, and a `request_uri`, `response_uri` or `presentation_definition_uri`
 * that is not `https://` (or `http://` on a loopback host, or anywhere with
 * `allowInsecure`), or that points at a link-local or cloud metadata address. The wallet
 * fetches the first and the last, and posts the presentation to the second.
 */
function assertPresentationRequest(
  redirectUri: string,
  allowInsecure = false
): void {
  let request: URL
  try {
    request = new URL(redirectUri)
  } catch {
    throw new CredentialPresentationError(
      'The presentation request is not a URL.'
    )
  }

  if (request.protocol !== 'openid4vp:')
    throw new CredentialPresentationError(
      `The presentation request must be an openid4vp:// URL, not ${request.protocol}`
    )

  for (const param of PRESENTATION_URI_PARAMS) {
    const value = request.searchParams.get(param)
    if (value === null) continue

    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new CredentialPresentationError(
        `The presentation request's ${param} is not a URL.`
      )
    }

    const host = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')

    const allowedScheme =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && (allowInsecure || isLoopbackHost(host)))

    if (!allowedScheme)
      throw new CredentialPresentationError(
        `The presentation request's ${param} must be https:// (http:// only on a loopback host, or with allowInsecureTransport), not ${url.protocol}//${host}.`
      )

    if (METADATA_HOSTS.has(host) || isLinkLocal(host))
      throw new CredentialPresentationError(
        `The presentation request's ${param} points at a link-local or metadata address (${host}).`
      )
  }
}

/** `169.254.0.0/16` and `fe80::/10`. */
function isLinkLocal(host: string): boolean {
  return (
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  )
}

/**
 * Refuses a presentation definition that asks for anything the service did not: every
 * input descriptor must be named after a requested credential type (as walt.id's verifier
 * names them), and every `pattern` or `const` its fields filter on must be one.
 */
function assertDefinitionRequests(
  presentationDefinition: unknown,
  requestedTypes: Set<string>
): void {
  const descriptors = (
    presentationDefinition as { input_descriptors?: unknown } | null
  )?.input_descriptors

  if (!Array.isArray(descriptors) || !descriptors.length)
    throw new CredentialPresentationError(
      'The presentation definition has no input descriptors.'
    )

  for (const descriptor of descriptors) {
    const { id, constraints } = (descriptor ?? {}) as {
      id?: unknown
      constraints?: { fields?: unknown }
    }

    const asked = [
      id,
      ...(Array.isArray(constraints?.fields) ? constraints.fields : []).flatMap(
        (field) => filterValues((field as { filter?: unknown } | null)?.filter)
      )
    ]

    const unrequested = asked.find(
      (value) => typeof value !== 'string' || !requestedTypes.has(value)
    )

    if (unrequested !== undefined)
      throw new CredentialPresentationError(
        `The presentation definition asks for ${JSON.stringify(unrequested)?.slice(0, 100)}, which the service does not request (it requests ${[...requestedTypes].join(', ')}).`
      )
  }
}

/** The `pattern` and `const` values of a field filter, and of its `contains`. */
function filterValues(filter: unknown): unknown[] {
  if (!filter || typeof filter !== 'object') return []

  const {
    pattern,
    const: constant,
    contains
  } = filter as {
    pattern?: unknown
    const?: unknown
    contains?: unknown
  }

  return [
    ...(pattern === undefined ? [] : [pattern]),
    ...(constant === undefined ? [] : [constant]),
    ...filterValues(contains)
  ]
}

/** The `type` of a wallet credential, from its parsed document (a W3C VC, or a JWT's `vc`). */
function credentialTypes(credential: WaltIdCredential): string[] {
  const document = credential.parsedDocument as
    | { type?: unknown; vc?: { type?: unknown } }
    | undefined
  const type = document?.type ?? document?.vc?.type

  return (Array.isArray(type) ? type : [type]).filter(
    (value): value is string => typeof value === 'string'
  )
}

// #endregion
