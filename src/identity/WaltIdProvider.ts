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
import { debugEnabled, debugRaw } from '../log/debug.js'
import { sanitize } from '../node/messages.js'
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

/** How much of the wallet's rejection goes into a `CredentialPresentationError`. */
const MAX_PRESENTATION_ERROR_LENGTH = 500

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

/**
 * Why a presentation failed, as `CredentialPresentationError.reason`:
 *
 * - `verifier-rejected`: the wallet posted the presentation and the verifier refused it
 *   (`details.errorMessage` says what the wallet reported);
 * - `wallet-failed`: the wallet answered the presentation with an error of its own, before
 *   the verifier (`details.errorMessage`);
 * - `no-matching-credential`: the wallet holds no credential of the requested types that
 *   satisfies the presentation definition;
 * - `none-selected`: `onSelectCredentials` chose none of the matches;
 * - `wallet-setup`: no wallet session, wallet or DID, or the wallet is another account's;
 * - `request-invalid`: the presentation request or definition was refused before anything
 *   was presented (not an `openid4vp://` URL, an insecure or link-local URI, a credential
 *   type the asset does not ask for, no definition).
 */
export type CredentialPresentationReason =
  | 'verifier-rejected'
  | 'wallet-failed'
  | 'no-matching-credential'
  | 'none-selected'
  | 'wallet-setup'
  | 'request-invalid'

/**
 * Raised when the wallet could not answer the presentation request. `reason` says which step
 * failed; `details` carries what is known, never the presentation, the wallet's redirect URI
 * or the policy-server session id.
 *
 * When the verifier refused the presentation, `PolicySessionResolver` asks the node for the
 * verifier's per-policy results and, when they name failed policies, throws a
 * `PolicyDeniedError` with this error as its `cause`.
 */
export class CredentialPresentationError extends Error {
  /**
   * Which step failed. A custom provider that does not say is `'wallet-failed'`: a step
   * before the verifier, so `PolicySessionResolver` does not ask the verifier which policy
   * failed. Pass `'verifier-rejected'` when the verifier refused the presentation.
   */
  readonly reason: CredentialPresentationReason
  /**
   * For `verifier-rejected` and `wallet-failed`: `{ errorMessage }`, the wallet's message,
   * redacted and bounded. For `no-matching-credential`: what the wallet reports missing.
   */
  readonly details?: unknown

  constructor(
    message: string,
    details?: unknown,
    reason: CredentialPresentationReason = 'wallet-failed'
  ) {
    super(message)
    this.name = 'CredentialPresentationError'
    this.reason = reason
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
        `The wallet belongs to ${signerAddress}, but the session is bound to ${challenge.consumerAddress}. Use a provider whose signer is the consumer's.`,
        undefined,
        'wallet-setup'
      )

    const service = getService(challenge.asset, challenge.serviceId)
    const requestedTypes = requestedCredentialTypes(
      getCredentials(challenge.asset),
      service && getServiceCredentials(service)
    )

    if (!requestedTypes.size)
      throw new CredentialPresentationError(
        `Service ${challenge.serviceId} of ${challenge.asset.id} asks for no credential type, so there is nothing to present.`,
        undefined,
        'request-invalid'
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
      requestedTypes,
      challenge.sessionId
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
        'The policy server returned no presentation definition.',
        undefined,
        'request-invalid'
      )

    return definition
  }

  private async answer(
    signer: Signer,
    presentationDefinition: unknown,
    presentationRequest: string,
    requestedTypes: Set<string>,
    sessionId: string
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
        missing,
        'no-matching-credential'
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
        'No credentials were selected to present.',
        undefined,
        'none-selected'
      )

    const did = await this.getDid(walletId, token)

    const resolved = await this.wallet.resolvePresentationRequest(
      walletId,
      presentationRequest,
      token
    )

    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'resolved presentation request', resolved)

    const result = await this.wallet.usePresentationRequest(
      walletId,
      did,
      resolved,
      selected.map((credential) => credential.id),
      token
    )

    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'presentation answer', result)

    if (
      result.rejectedBy ||
      result.errorMessage ||
      result.redirectUri?.includes('error')
    ) {
      // The raw answer went to the debug channel. The error keeps the wallet's message only,
      // redacted: an error redirect carries the policy-server session id, and so does the
      // verifier's text for an expired or unknown session, which the wallet passes on.
      const errorMessage = result.errorMessage
        ? sanitize(
            withoutSessionId(result.errorMessage, sessionId),
            MAX_PRESENTATION_ERROR_LENGTH,
            null
          )
        : undefined
      const reason =
        result.rejectedBy === 'wallet' ? 'wallet-failed' : 'verifier-rejected'
      const what =
        reason === 'wallet-failed'
          ? 'The wallet could not present the credentials'
          : 'The verifier rejected the presentation'

      throw new CredentialPresentationError(
        errorMessage ? `${what}: ${errorMessage}` : `${what}.`,
        errorMessage ? { errorMessage } : undefined,
        reason
      )
    }
  }

  private async getWalletSession(signer: Signer): Promise<WaltIdSession> {
    if (this.session && (await this.wallet.isSessionValid(this.session.token)))
      return this.session

    this.session = await this.wallet.authenticate(signer)

    if (!this.session?.token)
      throw new CredentialPresentationError(
        'walt.id did not return a session token for this account.',
        undefined,
        'wallet-setup'
      )

    return this.session
  }

  private async getWalletId(token: string): Promise<string> {
    if (this.options.walletId) return this.options.walletId
    if (this.resolvedWalletId) return this.resolvedWalletId

    const wallets = await this.wallet.listWallets(token)

    if (!wallets.length)
      throw new CredentialPresentationError(
        'This walt.id account owns no wallet.',
        undefined,
        'wallet-setup'
      )

    this.resolvedWalletId = wallets[0].id

    return this.resolvedWalletId
  }

  private async getDid(walletId: string, token: string): Promise<string> {
    if (this.options.did) return this.options.did

    const dids = await this.wallet.listDids(walletId, token)

    if (!dids.length)
      throw new CredentialPresentationError(
        'This walt.id wallet holds no DID.',
        undefined,
        'wallet-setup'
      )

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
 * `text` without the policy-server session id `sessionId` (8 characters or more), nor any
 * part of it of 32 characters or more (the policy server's id is two SHA-256 hashes joined
 * by `-`, the second the secret one), wherever they stand: also inside a URL,
 * percent-encoded or JSON-escaped text, and in any letter case (A to Z). Found as literal
 * text, not by a regular expression built from the id: the node chooses it, and one of
 * 33 KB or more made too large a pattern, which threw a `SyntaxError` quoting it.
 */
function withoutSessionId(text: string, sessionId: string): string {
  const parts = [
    ...(sessionId.length >= 8 ? [sessionId] : []),
    ...sessionId.split('-').filter((part) => part.length >= 32)
  ]

  return parts.reduce(
    (current, part) => withoutText(current, asciiLowerCase(part)),
    text
  )
}

/** `text` with every occurrence of `part` (lower case), in any letter case, redacted. */
function withoutText(text: string, part: string): string {
  const folded = asciiLowerCase(text)
  let kept = ''
  let from = 0
  for (
    let at = folded.indexOf(part);
    at !== -1;
    at = folded.indexOf(part, from)
  ) {
    kept += `${text.slice(from, at)}<redacted>`
    from = at + part.length
  }

  return kept + text.slice(from)
}

/** `text` with A to Z in lower case only, so it keeps its length and indexes. */
function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase())
}

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
      'The presentation request is not a URL.',
      undefined,
      'request-invalid'
    )
  }

  if (request.protocol !== 'openid4vp:')
    throw new CredentialPresentationError(
      `The presentation request must be an openid4vp:// URL, not ${request.protocol}`,
      undefined,
      'request-invalid'
    )

  for (const param of PRESENTATION_URI_PARAMS) {
    const value = request.searchParams.get(param)
    if (value === null) continue

    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new CredentialPresentationError(
        `The presentation request's ${param} is not a URL.`,
        undefined,
        'request-invalid'
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
        `The presentation request's ${param} must be https:// (http:// only on a loopback host, or with allowInsecureTransport), not ${url.protocol}//${host}.`,
        undefined,
        'request-invalid'
      )

    if (METADATA_HOSTS.has(host) || isLinkLocal(host))
      throw new CredentialPresentationError(
        `The presentation request's ${param} points at a link-local or metadata address (${host}).`,
        undefined,
        'request-invalid'
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
      'The presentation definition has no input descriptors.',
      undefined,
      'request-invalid'
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
        `The presentation definition asks for ${JSON.stringify(unrequested)?.slice(0, 100)}, which the service does not request (it requests ${[...requestedTypes].join(', ')}).`,
        undefined,
        'request-invalid'
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
