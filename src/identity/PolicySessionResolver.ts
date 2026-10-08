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
 *
 * A session id is a credential. The node accepts it for the download or compute job it was
 * opened for, and anyone holding the id of a presented session can read the verifier's
 * record of it through the node's passthrough (`checkSessionId` is not signed), the
 * presentation (`vp_token`) included. Keep session ids out of logs, URLs you share and
 * stores other parties can read.
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
  type PolicyCheckResult,
  PolicyDeniedError,
  type PolicyServerReply
} from '../node/OceanNodeClient.js'
import { warnOnce } from '../utils/warn.js'
import {
  type CredentialProvider,
  emptyPolicyServerPayload
} from './CredentialProvider.js'
import { assertPolicySatisfied, requiresPresentation } from './policy.js'
import {
  MemorySessionStore,
  type SessionEntry,
  type SessionKey,
  type SessionStore
} from './session.js'

/**
 * How long a cached session is reused by default: 2 minutes from `initiate`.
 *
 * walt.id's verifier keeps a presentation session for 5 minutes from its creation (its
 * default; the policy server sets no other), and the session has to outlive the fee
 * request, the orders and, for a compute job, the escrow before the node checks it. A
 * session reused at most 2 minutes in leaves 3 for that. An address-only session holds no
 * state in the policy server, but a policy server that restarts or runs another handler
 * may not honour it as long, so the same bound applies to it.
 */
export const DEFAULT_SESSION_TTL_MS = 2 * 60 * 1000

export interface PolicySessionResolverOptions {
  /**
   * Answers the openid4vp request of a service whose `SSIpolicy` asks for credentials, for
   * example a `WaltIdCredentialProvider`. Not needed for a service gated by addresses only.
   */
  credentials?: CredentialProvider
  /**
   * Where sessions are kept. Defaults to an in-memory store.
   *
   * Only sessions opened without a presentation (an address-only gate) go here, unless
   * `persistPresentedSessions`: a presented session stays in memory, in this resolver.
   */
  sessionStore?: SessionStore
  /**
   * Also keep presented sessions (a service whose `SSIpolicy` asks for credentials) in
   * `sessionStore`. Default `false`.
   *
   * Opt in only for a store no one else can read: the id of a presented session lets anyone
   * read the verifier's record of it through the node, the presentation (`vp_token`) and the
   * holder's credentials included, until the verifier forgets it.
   */
  persistPresentedSessions?: boolean
  /**
   * How long, in milliseconds from `initiate`, a cached session is reused. An older entry
   * is deleted and the session opened again. `0` turns the cache off. Default:
   * `DEFAULT_SESSION_TTL_MS` (2 minutes).
   */
  sessionTtlMs?: number
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
   * The consumer: `signer.getAddress()`, unchanged (checksummed, for an ethers signer),
   * which is what ocean.js sends with the download and `computeStart`.
   *
   * The session is opened for, and cached under, `node.policySessionAddress(consumerAddress)`:
   * the address the node forwards to the policy server, which hashes it into the session id
   * as it is. For a Signer that is this string; for a JWT, the address in the token.
   */
  consumerAddress: string
}

export class PolicySessionResolver {
  private credentials?: CredentialProvider
  /** Sessions opened without a presentation, and presented ones when persisted. */
  private readonly sessions: SessionStore
  /** Presented sessions: `sessions` when persisted, else memory only. */
  private readonly presentedSessions: SessionStore
  private readonly sessionTtlMs: number

  constructor(options: PolicySessionResolverOptions = {}) {
    const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS

    if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 0)
      throw new Error(
        `sessionTtlMs must be a finite number of milliseconds, 0 or more; got ${sessionTtlMs}.`
      )

    this.credentials = options.credentials
    this.sessions = options.sessionStore || new MemorySessionStore()
    this.presentedSessions =
      options.persistPresentedSessions || !options.sessionStore
        ? this.sessions
        : new MemorySessionStore()
    this.sessionTtlMs = sessionTtlMs

    if (options.sessionStore && options.persistPresentedSessions)
      warnOnce(
        'persist-presented-sessions',
        'persistPresentedSessions is on: presented policy-server sessions are kept in your sessionStore. Their ids let anyone read the presentation (vp_token) through the node until the verifier forgets them; keep that store private.'
      )
  }

  /** Swaps the credential provider. Sessions already verified stay cached. */
  setCredentialProvider(credentials: CredentialProvider | undefined): void {
    this.credentials = credentials
  }

  /** Clears the cached sessions. */
  clearSessions(): void {
    this.sessions.clear()
    this.presentedSessions.clear()
  }

  /**
   * The session for one service, as the payload for the node's `policyServer` slot.
   *
   * `null` when the node checks none: neither the asset nor the service has `credentials`,
   * or the node's status says it has no policy server (`hasPolicyServer`). When the status
   * cannot be read, the session is opened all the same.
   *
   * Throws a `PolicyDeniedError` when the policy server refuses the consumer, or the
   * verifier does not accept the presentation; an `Error` before `initiate` when the
   * service asks for a presentation and no credential provider is set; and an
   * `OceanNodeError` when the node or the policy server cannot answer.
   */
  async resolve(
    request: PolicySessionRequest
  ): Promise<PolicyServerPayload | null> {
    const { node, asset, serviceId } = request

    const service = getService(asset, serviceId)
    if (!service)
      throw new Error(`Asset ${asset.id} has no service with id ${serviceId}.`)

    if (!hasCredentials(asset, service)) return null

    const consumerAddress = node.policySessionAddress(request.consumerAddress)
    const key: SessionKey = {
      nodeUri: node.nodeUri,
      did: asset.id,
      serviceId,
      consumerAddress
    }

    const cached = await this.reusable(key, node)
    if (cached) return emptyPolicyServerPayload(cached)

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

    // Taken before `initiate`: the verifier counts a session's lifetime from its creation.
    const createdAt = Date.now()

    const reply = await node.initializePolicyVerification({
      documentId: asset.id,
      serviceId,
      consumerAddress,
      policyServer: emptyPolicyServerPayload('')
    })

    const { sessionId, redirectUri } = readInitiateReply(reply)

    if (!sessionId)
      throw new OceanNodeError(
        'initializePolicyVerification',
        `the policy server opened no session for service ${serviceId} of ${asset.id}`
      )

    const presented = requiresPresentation(assetCredentials, serviceCredentials)

    if (presented) {
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
          reason: `the verifier did not accept the presentation${describeFailedPolicies(check.policyResults)}`,
          policyResults: check.policyResults
        })
    }

    if (this.sessionTtlMs > 0)
      (presented ? this.presentedSessions : this.sessions).set(key, {
        sessionId,
        createdAt,
        presented
      })

    return emptyPolicyServerPayload(sessionId)
  }

  /**
   * The cached session id for `key`, if it can still be spent; a stale entry is deleted.
   *
   * An entry is stale once it is `sessionTtlMs` old (or carries no valid `createdAt`). A
   * presented session is also asked about again (`checkSessionId`, one call through the
   * node) and is stale unless the verifier still reports it verified: it lives in the
   * verifier, which forgets it on expiry or a restart. A check that fails outright counts
   * as stale too, and `initiate` then reports what is wrong with the node.
   */
  private async reusable(
    key: SessionKey,
    node: OceanNodeClient
  ): Promise<string | undefined> {
    const presented = this.presentedSessions.get(key)
    const store = presented ? this.presentedSessions : this.sessions
    const entry = presented ?? this.sessions.get(key)
    if (!entry) return undefined

    if (!this.isFresh(entry)) {
      store.delete(key)
      return undefined
    }

    if (entry.presented) {
      const check = await node
        .checkPolicySession(entry.sessionId)
        .catch(() => undefined)

      if (!check?.verified) {
        store.delete(key)
        return undefined
      }
    }

    return entry.sessionId
  }

  private isFresh(entry: SessionEntry): boolean {
    const { createdAt } = entry
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt))
      return false

    const age = Date.now() - createdAt

    return age >= 0 && age < this.sessionTtlMs
  }
}

// #region reply shapes

/**
 * The session id and openid4vp request in an `initiate` answer: the policy server (1.3)
 * sends both as `message: { sessionId, redirectUri }`.
 */
function readInitiateReply(reply: PolicyServerReply): {
  sessionId?: string
  redirectUri?: string
} {
  const { sessionId, redirectUri } = (
    reply.message && typeof reply.message === 'object' ? reply.message : {}
  ) as { sessionId?: unknown; redirectUri?: unknown }

  return {
    sessionId:
      typeof sessionId === 'string' && sessionId ? sessionId : undefined,
    redirectUri:
      typeof redirectUri === 'string' && redirectUri ? redirectUri : undefined
  }
}

/** The VC/VP policies the verifier reports as failed, as `" (policy: error; …)"`. */
function describeFailedPolicies(results: PolicyCheckResult[]): string {
  const failures = results
    .filter((result) => !result.success)
    .map((result) => [result.policy, result.error].filter(Boolean).join(': '))

  return failures.length ? ` (${failures.join('; ')})` : ''
}

// #endregion
