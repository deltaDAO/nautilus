/**
 * Opens the policy-server session that ocean-node checks on a download or a compute job.
 *
 * The exchange, as the policy server runs it:
 *
 *   1. `initiate` (the node's `initializePSVerification`) checks the consumer's address
 *      against the asset's allow list and opens a session bound to that (consumer, asset,
 *      service). It answers `{ sessionId, redirectUri }`, or refuses.
 *   2. Only when the asset or service carries an `SSIpolicy` that asks for credentials:
 *      `redirectUri` is an openid4vp request, which the `CredentialProvider` answers from the
 *      wallet, and `checkSessionId` must then report `verificationResult: true`.
 *   3. The session id goes into the `policyServer` slot of the download URL, or of
 *      `initializeCompute` and `computeStart`.
 *
 * Every flow resolves its sessions before it asks for fees or orders anything, so a
 * refusal costs nothing.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import {
  getCredentials,
  getService,
  getServiceCredentials,
  hasCredentials
} from '../ddo/read.js'
import type { PolicyServerPayload } from '../ddo/types.js'
import {
  type OceanNodeClient,
  OceanNodeError,
  PolicyDeniedError,
  type PolicyServerReply
} from '../node/OceanNodeClient.js'
import {
  type CredentialProvider,
  emptyPolicyServerPayload
} from './CredentialProvider.js'
import { assertPolicySatisfied, requiresPresentation } from './policy.js'
import { MemorySessionStore, type SessionStore } from './session.js'

export interface PolicySessionResolverOptions {
  /**
   * Answers the openid4vp request of a service whose `SSIpolicy` asks for credentials, for
   * example a `WaltIdCredentialProvider`. Not needed for a service gated by addresses only.
   */
  credentials?: CredentialProvider
  /** Where verified sessions are kept. Defaults to an in-memory store. */
  sessionStore?: SessionStore
}

/** One service a session is needed for. */
export interface PolicySessionRequest {
  /**
   * The node that checks the policy: a download's `serviceEndpoint`, or the node running
   * the compute job. A session is only known to the policy server behind the node that
   * opened it.
   */
  node: OceanNodeClient
  asset: AssetV5
  serviceId: string
  /**
   * Sent to `initiate` as it is. The policy server hashes this exact string into the
   * session id and compares it with the address of the download or compute call, so it
   * must be the address that call is made with (`signer.getAddress()`).
   */
  consumerAddress: string
}

export class PolicySessionResolver {
  private credentials?: CredentialProvider
  private readonly sessions: SessionStore

  constructor(options: PolicySessionResolverOptions = {}) {
    this.credentials = options.credentials
    this.sessions = options.sessionStore || new MemorySessionStore()
  }

  /** Swaps the credential provider. Sessions already verified stay cached. */
  setCredentialProvider(credentials: CredentialProvider | undefined): void {
    this.credentials = credentials
  }

  /** Clears the cached sessions. */
  clearSessions(): void {
    this.sessions.clear()
  }

  /**
   * The session for one service, as the payload for the node's `policyServer` slot.
   *
   * `null` when the node checks none: neither the asset nor the service has `credentials`,
   * or the node has no policy server.
   *
   * Throws a `PolicyDeniedError` when the policy server refuses the consumer, or the
   * verifier does not accept the presentation; an `Error` before `initiate` when the
   * service asks for a presentation and no credential provider is set; and an
   * `OceanNodeError` when the node or the policy server cannot answer.
   */
  async resolve(
    request: PolicySessionRequest
  ): Promise<PolicyServerPayload | null> {
    const { node, asset, serviceId, consumerAddress } = request

    const service = getService(asset, serviceId)
    if (!service)
      throw new Error(`Asset ${asset.id} has no service with id ${serviceId}.`)

    if (!hasCredentials(asset, service)) return null

    const key = {
      nodeUri: node.nodeUri,
      did: asset.id,
      serviceId,
      consumerAddress
    }

    const cached = this.sessions.get(key)
    if (cached) return emptyPolicyServerPayload(cached.sessionId)

    if ((await node.hasPolicyServer()) === false) return null

    const assetCredentials = getCredentials(asset)
    const serviceCredentials = getServiceCredentials(service)

    assertPolicySatisfied({
      did: asset.id,
      serviceId,
      assetCredentials,
      serviceCredentials,
      canPresent: !!this.credentials
    })

    const reply = await node.initializePolicyVerification({
      documentId: asset.id,
      serviceId,
      consumerAddress,
      policyServer: emptyPolicyServerPayload('')
    })

    if (!reply) return null

    const { sessionId, redirectUri } = readInitiateReply(reply)

    if (!sessionId)
      throw new OceanNodeError(
        'initializePolicyVerification',
        `the policy server opened no session for service ${serviceId} of ${asset.id}: ${JSON.stringify(reply).slice(0, 200)}`
      )

    if (requiresPresentation(assetCredentials, serviceCredentials)) {
      if (!redirectUri)
        throw new OceanNodeError(
          'initializePolicyVerification',
          `the policy server asked for a presentation for service ${serviceId} of ${asset.id}, but sent no openid4vp request`
        )

      await (this.credentials as CredentialProvider).present({
        asset,
        serviceId,
        consumerAddress,
        node,
        sessionId,
        redirectUri
      })

      const check = await node.checkPolicySession(sessionId)

      if (!check.verified)
        throw new PolicyDeniedError({
          nodeUri: node.nodeUri,
          did: asset.id,
          serviceId,
          consumerAddress,
          reason: `the verifier did not accept the presentation${describeFailedPolicies(check.result)}`,
          details: check.result
        })
    }

    this.sessions.set(key, { sessionId })

    return emptyPolicyServerPayload(sessionId)
  }
}

// #region reply shapes

/**
 * The session id and openid4vp request in an `initiate` answer.
 *
 * The policy server sends both as `message: { sessionId, redirectUri }`. The session id
 * is also in the redirect, as `sessionId=` (appended to the success redirect), `id=` (a
 * configured redirect with `$id`) or `state=` (the openid4vp request), which are read in
 * that order when `message.sessionId` is missing.
 */
function readInitiateReply(reply: PolicyServerReply): {
  sessionId?: string
  redirectUri?: string
} {
  const { message } = reply

  const fields =
    typeof message === 'string'
      ? { redirectUri: message }
      : message && typeof message === 'object'
        ? (message as { sessionId?: unknown; redirectUri?: unknown })
        : {}

  const redirectUri =
    typeof fields.redirectUri === 'string' && fields.redirectUri
      ? fields.redirectUri
      : undefined

  const sessionId =
    (typeof fields.sessionId === 'string' && fields.sessionId) ||
    (redirectUri &&
      (queryParam(redirectUri, 'sessionId') ||
        queryParam(redirectUri, 'id') ||
        queryParam(redirectUri, 'state'))) ||
    undefined

  return { sessionId, redirectUri }
}

function queryParam(uri: string, name: string): string | undefined {
  const match = uri.match(new RegExp(`[?&]${name}=([^&#]*)`))

  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

interface SessionRecord {
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

/** The VC/VP policies the verifier reports as failed, as `" (policy: reason; …)"`. */
function describeFailedPolicies(result: unknown): string {
  const results = (result as SessionRecord | undefined)?.policyResults?.results
  const failures: string[] = []

  for (const entry of results || [])
    for (const policy of entry?.policyResults || [])
      if (policy?.is_success === false)
        failures.push(
          [
            policy.policy || policy.policyName,
            policy.description || policy.reason
          ]
            .filter(Boolean)
            .join(': ')
        )

  return failures.length ? ` (${failures.join('; ')})` : ''
}

// #endregion
