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
import { debugEnabled, debugRaw } from '../log/debug.js'
import { type Logger, log } from '../log/logger.js'
import { MAX_NODE_MESSAGE_LENGTH, sanitize } from '../node/messages.js'
import {
  type OceanNodeClient,
  OceanNodeError,
  type PolicyCheckResult,
  PolicyDeniedError,
  type PolicyServerReply,
  type PolicySessionCheck
} from '../node/OceanNodeClient.js'
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
import { CredentialPresentationError } from './WaltIdProvider.js'

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

/** What a refusal's reason starts with; the failed policies follow in parentheses. */
const REFUSED =
  'the node reports that the verifier did not accept the presentation'
/** How much of one failed policy goes into a refusal's reason. */
const MAX_DESCRIBED_FAILURE = 80

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
  /** Where this resolver's log events go. Default: the process-wide logger. */
  logger?: Logger
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
      (options.logger ?? log).emit(
        'identity.sessions.presented_persisted',
        'persistPresentedSessions is on: presented policy-server sessions are kept in your sessionStore. Their ids let anyone read the presentation (vp_token) through the node until the verifier forgets them; keep that store private.',
        undefined,
        { once: 'persist-presented-sessions' }
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
   * or the node has no policy server, as its status says (`hasPolicyServer`) or, when the
   * status does not say, its answer to `initiate`. A node without one checks the
   * credentials itself.
   *
   * Throws a `PolicyDeniedError` when the policy server refuses the consumer, or the
   * verifier does not accept the presentation; an `Error` before `initiate` when the
   * service asks for a presentation and no credential provider is set; and an
   * `OceanNodeError` when the node or the policy server cannot answer.
   *
   * When the provider's `present()` throws because the verifier refused the presentation (a
   * `CredentialPresentationError` with reason `verifier-rejected`, or any other error, from a
   * custom provider), the verifier's record of the session is read (`checkSessionId`, best
   * effort, cut after 15 s): if it names failed policies, a `PolicyDeniedError` with
   * `policyResults` is thrown, the provider's error as its `cause`; otherwise the provider's
   * error. A `CredentialPresentationError` for a step before the verifier
   * (`no-matching-credential`, `wallet-failed`, …) is thrown as it is, without the read.
   * Either way the session is not cached.
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

    // The node has no policy server after all (upstream ocean-node 4.2.0 does not report
    // `isPSConfigured`, and an empty `POLICY_SERVER_URL` reports one): no session.
    if (!reply) return null

    const { sessionId, redirectUri } = readInitiateReply(reply)
    if (debugEnabled('sensitive', 'policy'))
      debugRaw('policy', 'policy-server session opened (initiate)', reply)

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

      const denied = (results: PolicyCheckResult[], cause?: unknown) =>
        new PolicyDeniedError({
          nodeUri: node.nodeUri,
          did: asset.id,
          serviceId,
          consumerAddress,
          reason: refusalReason(results),
          policyResults: results,
          cause
        })

      try {
        await (this.credentials as CredentialProvider).present({
          asset,
          serviceId,
          consumerAddress,
          node,
          sessionId,
          redirectUri
        })
      } catch (error) {
        // The wallet's error says only that the presentation failed. The verifier's record
        // of the session says which policy refused it, when the verifier saw it.
        const failed = reachedVerifier(error)
          ? await failedPolicies(node, sessionId, error)
          : undefined
        throw failed ? denied(failed, error) : error
      }

      const check = await node.checkPolicySession(sessionId)

      if (!check.verified) throw denied(check.policyResults)
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

/**
 * How long the read after a refused presentation may take: the caller's error waits for it,
 * and over P2P ocean.js applies no timeout of its own.
 */
const FAILED_PRESENTATION_READ_TIMEOUT_MS = 15_000

/**
 * Whether a failed `present()` may have reached the verifier: a `CredentialPresentationError`
 * says which step failed, and only `verifier-rejected` did. A custom provider's other error
 * says nothing about it, so the verifier is asked.
 */
function reachedVerifier(error: unknown): boolean {
  return (
    !(error instanceof CredentialPresentationError) ||
    error.reason === 'verifier-rejected'
  )
}

/**
 * After a presentation that may have reached the verifier (`reachedVerifier`): the
 * verifier's per-policy results for the session, when it ran the policies and some failed
 * (one `checkSessionId` read through the node, as after a successful presentation).
 * `undefined` when the verifier reports no failed policy (it never saw the presentation, or
 * the session expired) or the read fails: the error of the presentation then stands. A failing read goes to the debug channel only;
 * the read is cut after 15 s.
 */
async function failedPolicies(
  node: OceanNodeClient,
  sessionId: string,
  error: unknown
): Promise<PolicyCheckResult[] | undefined> {
  if (debugEnabled('sensitive', 'policy'))
    debugRaw('policy', 'presentation failed', { sessionId, error })

  let check: PolicySessionCheck
  try {
    // Bounded over P2P too, where ocean.js applies no timeout of its own, and whether or
    // not the transport honours the signal: the caller's error waits for this read.
    const signal = AbortSignal.timeout(FAILED_PRESENTATION_READ_TIMEOUT_MS)
    check = await Promise.race<PolicySessionCheck>([
      node.checkPolicySession(sessionId, signal),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true
        })
      })
    ])
  } catch (checkError) {
    if (debugEnabled('sensitive', 'policy'))
      debugRaw(
        'policy',
        'checkSessionId after the failed presentation failed',
        {
          sessionId,
          error: checkError
        }
      )
    return undefined
  }

  return !check.verified &&
    check.policyResults.some((result) => !result.success)
    ? check.policyResults
    : undefined
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

/**
 * The reason of a refusal: `REFUSED`, then the VC/VP policies the verifier reports as
 * failed, as `" (policy: error; …)"`. The node relays them (and the node is the publisher's
 * choice, for a download), so they are bounded and stripped of control characters in
 * `readPolicyResults`.
 *
 * `PolicyDeniedError` cuts its reason at `MAX_NODE_MESSAGE_LENGTH`, so this one fits as that
 * error redacts it again (which can lengthen a cut failure: `token=<reda…` becomes
 * `token=<redacted>`), and the closing parenthesis is never cut: each failure is cut at 80
 * characters, as many as fit are listed, and the rest counted (`; 2 more in policyResults`).
 */
function refusalReason(results: PolicyCheckResult[]): string {
  const failures = results
    .filter((result) => !result.success)
    .map((result) => {
      const text = [result.policy, result.error].filter(Boolean).join(': ')
      return text.length > MAX_DESCRIBED_FAILURE
        ? `${text.slice(0, MAX_DESCRIBED_FAILURE)}…`
        : text
    })
  if (!failures.length) return REFUSED

  const listing = (shown: number) => {
    const more = failures.length - shown
    const counted = more
      ? `${more}${shown ? ' more' : ''} in policyResults`
      : ''
    return `${REFUSED} (${[...failures.slice(0, shown), counted].filter(Boolean).join('; ')})`
  }
  const fits = (reason: string) =>
    sanitize(reason, Number.MAX_SAFE_INTEGER, null).length <=
    MAX_NODE_MESSAGE_LENGTH

  for (let shown = failures.length; shown > 0; shown--)
    if (fits(listing(shown))) return listing(shown)
  return listing(0)
}

// #endregion
