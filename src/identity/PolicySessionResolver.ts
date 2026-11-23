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
import type {
  DdoCredentials,
  PolicyServerPayload,
  SsiSessionPayload
} from '../ddo/types.js'
import { debugEnabled, debugRaw } from '../log/debug.js'
import { type Logger, log } from '../log/logger.js'
import {
  MAX_NODE_MESSAGE_LENGTH,
  sanitize,
  sessionIdRemover
} from '../node/messages.js'
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
import {
  hasSsiEntries,
  isSsiPolicyV2Credential,
  requestUriHost,
  type SsiCapabilities,
  type SsiResult,
  type SsiStatusResult
} from './ssi.js'
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
/** The reason of a native SSI session still pending after the last `ssiStatus`. */
const PENDING =
  'the node still reports the SSI session pending: the verifier has not received or not finished checking the presentation'
/** The reason of a native SSI session whose presentation window closed. */
const EXPIRED =
  'the node reports the SSI session expired before a presentation was verified'

/** `ssiStatus` attempts after a presentation, by default. */
export const DEFAULT_SSI_STATUS_ATTEMPTS = 5
/** Milliseconds between `ssiStatus` attempts, by default. */
export const DEFAULT_SSI_STATUS_INTERVAL_MS = 2_000
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
  /**
   * Nodes with the native SSI module: how often, and how far apart, `ssiStatus` is asked
   * after the wallet presented, while the node still reports the session `pending`.
   * Default 5 attempts, 2 s apart. Every attempt is a signed command (one nonce, and one
   * signature: a prompt with an interactive wallet).
   */
  ssiStatusPolling?: { attempts?: number; intervalMs?: number }
}

/** A session `resolveSession` opened, and which protocol it belongs to. */
export type ResolvedPolicySession =
  | {
      /** A node with a policy server. */
      protocol: 'policy-server'
      sessionId: string
      payload: PolicyServerPayload
    }
  | {
      /** A node with the native SSI module (`ssiInitiate`). */
      protocol: 'ssi'
      sessionId: string
      payload: SsiSessionPayload
    }

/** What `resolve` hands the node's `policyServer` slot. */
export type PolicySessionPayload = PolicyServerPayload | SsiSessionPayload

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
  private readonly logger: Logger
  private readonly statusAttempts: number
  private readonly statusIntervalMs: number

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
    this.logger = options.logger ?? log

    const attempts =
      options.ssiStatusPolling?.attempts ?? DEFAULT_SSI_STATUS_ATTEMPTS
    const intervalMs =
      options.ssiStatusPolling?.intervalMs ?? DEFAULT_SSI_STATUS_INTERVAL_MS
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60)
      throw new Error(
        `ssiStatusPolling.attempts must be a whole number from 1 to 60; got ${attempts}.`
      )
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 60_000)
      throw new Error(
        `ssiStatusPolling.intervalMs must be from 0 to 60000 milliseconds; got ${intervalMs}.`
      )
    this.statusAttempts = attempts
    this.statusIntervalMs = intervalMs

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
  ): Promise<PolicySessionPayload | null> {
    return (await this.resolveSession(request))?.payload ?? null
  }

  /**
   * As `resolve`, with the protocol of the session: `'policy-server'` for a node with a
   * policy server, `'ssi'` for a node with the native SSI module. A compute job needs it to
   * shape its `policyServer` field (`{ sessionId, sessionIds }` for the native module).
   *
   * Which protocol a node speaks is read from its status (`getSsiCapabilities`): a node that
   * announces an `ssi` block, or whose status cannot be read for a service with an
   * `SSIpolicyV2` entry, gets the native flow:
   *
   *   1. no session when neither the asset nor the service has an SSI entry: the node checks
   *      addresses and access lists itself;
   *   2. `ssiInitiate` (a refusal throws a `PolicyDeniedError`, `source: 'ssi'`);
   *   3. the credential provider presents the OpenID4VP 1.0 request (`protocol: 'oid4vp'`),
   *      which must point at the node's announced verifier host;
   *   4. `ssiStatus` until the session is no longer `pending` (`ssiStatusPolling`): only
   *      `verified` passes; `failed` and `expired` throw a `PolicyDeniedError` whose
   *      `policyResults` carry the node's results (`scope`, `credential` = DCQL query id).
   *
   * Native sessions are never cached: the node consumes one on the download (for one order)
   * or on the compute start (for one job), so each flow opens its own.
   */
  async resolveSession(
    request: PolicySessionRequest
  ): Promise<ResolvedPolicySession | null> {
    const { node, asset, serviceId } = request

    const service = getService(asset, serviceId)
    if (!service)
      throw new Error(`Asset ${asset.id} has no service with id ${serviceId}.`)

    if (!hasCredentials(asset, service)) return null

    const assetCredentials = getCredentials(asset)
    const serviceCredentials = getServiceCredentials(service)

    const ssi = await node.getSsiCapabilities()
    if (
      ssi ||
      (ssi === undefined &&
        (hasV2Entries(assetCredentials) || hasV2Entries(serviceCredentials)))
    )
      return this.resolveSsi(
        request,
        assetCredentials,
        serviceCredentials,
        ssi ?? undefined
      )

    const payload = await this.resolvePolicyServer(request)
    return payload
      ? { protocol: 'policy-server', sessionId: payload.sessionId, payload }
      : null
  }

  /** The policy-server flow of `resolveSession`. */
  private async resolvePolicyServer(
    request: PolicySessionRequest
  ): Promise<PolicyServerPayload | null> {
    const { node, asset, serviceId } = request
    const service = getService(asset, serviceId) as NonNullable<
      ReturnType<typeof getService>
    >

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

  /** The native SSI flow of `resolveSession`. */
  private async resolveSsi(
    request: PolicySessionRequest,
    assetCredentials: DdoCredentials | undefined,
    serviceCredentials: DdoCredentials | undefined,
    capabilities: SsiCapabilities | undefined
  ): Promise<ResolvedPolicySession | null> {
    const { node, asset, serviceId } = request

    // The node checks addresses and access lists itself, on every request.
    if (!hasSsiEntries(assetCredentials) && !hasSsiEntries(serviceCredentials))
      return null

    if (capabilities && !capabilities.enabled)
      throw new OceanNodeError(
        'ssiInitiate',
        `service ${serviceId} of ${asset.id} asks for verifiable credentials, and ${node.nodeUri} has no SSI verifier configured, so it denies every consumer. Nothing was ordered or paid.`
      )

    const credentials = this.credentials
    if (!credentials)
      throw new Error(
        `Service ${serviceId} of ${asset.id} requires a verifiable presentation, and no credential provider is set to make one. Pass a WalletApi2CredentialProvider as \`credentials\` to Nautilus.create(), or call setCredentialProvider(). Nothing was ordered or paid.`
      )

    const sessionAddress = node.policySessionAddress(request.consumerAddress)
    // Before the session: one opened and never presented stays pending at the node, and
    // counts against the consumer's few pending sessions.
    await credentials.prepare?.({
      asset,
      serviceId,
      consumerAddress: sessionAddress,
      node
    })

    const opened = await node.ssiInitiate({
      documentId: asset.id,
      serviceId,
      consumerAddress: sessionAddress
    })
    if (!opened.required) return null

    const { sessionId, consumerAddress } = opened
    if (debugEnabled('sensitive', 'policy'))
      debugRaw('policy', 'SSI session opened (ssiInitiate)', opened)

    if (opened.deprecated)
      this.logger.emit(
        'identity.ssi.legacy_policy',
        `${asset.id} gates service ${serviceId} with the deprecated SSIpolicy format; the node translates it for now. Ask the publisher to move it to SSIpolicyV2.`,
        { did: asset.id, serviceId, nodeUri: node.nodeUri },
        { once: JSON.stringify(['ssi-legacy', node.nodeUri, asset.id]) }
      )

    const verifierHost = capabilities?.verifierPublicHost
    const requestHost = requestUriHost(opened.requestUri)
    if (!verifierHost)
      this.logger.emit(
        'identity.ssi.verifier_unannounced',
        `${node.nodeUri} does not announce its verifier host, so nautilus cannot check that the presentation request (${requestHost ?? 'no request_uri'}) comes from this node's verifier.`,
        { nodeUri: node.nodeUri, requestHost },
        { once: JSON.stringify(['ssi-verifier', node.nodeUri]) }
      )
    else if (requestHost !== verifierHost)
      throw new CredentialPresentationError(
        `The presentation request points at ${requestHost ?? 'no request_uri'}, not at the verifier ${node.nodeUri} announces (${verifierHost}). It was not created by this node's verifier, so nothing was presented, ordered or paid.`,
        undefined,
        'request-invalid'
      )

    const statusRequest = {
      sessionId,
      documentId: asset.id,
      serviceId,
      consumerAddress
    }
    const denied = (status: SsiStatusResult, cause?: unknown) =>
      new PolicyDeniedError({
        nodeUri: node.nodeUri,
        did: asset.id,
        serviceId,
        consumerAddress,
        reason: refusalReason(
          toPolicyResults(status.results, sessionId),
          status.status === 'pending'
            ? PENDING
            : status.status === 'expired'
              ? EXPIRED
              : REFUSED
        ),
        policyResults: toPolicyResults(status.results, sessionId),
        source: 'ssi',
        cause
      })

    try {
      await credentials.present({
        protocol: 'oid4vp',
        asset,
        serviceId,
        consumerAddress,
        node,
        sessionId,
        redirectUri: opened.requestUri,
        ...(opened.dcql ? { dcql: opened.dcql } : {}),
        ...(opened.expiresAt ? { expiresAt: opened.expiresAt } : {}),
        ...(verifierHost ? { verifierHost } : {})
      })
    } catch (error) {
      if (reachedVerifier(error)) {
        const status = await boundedStatus(node, statusRequest, error)
        if (
          status &&
          (status.status === 'failed' ||
            status.status === 'expired' ||
            status.results.some((result) => !result.success))
        )
          throw denied(status, error)
      }
      throw error
    }

    let status = await node.ssiStatus(statusRequest)
    for (
      let attempt = 1;
      attempt < this.statusAttempts && status.status === 'pending';
      attempt++
    ) {
      await sleep(this.statusIntervalMs)
      status = await node.ssiStatus(statusRequest)
    }

    if (status.status !== 'verified') throw denied(status)

    return { protocol: 'ssi', sessionId, payload: { sessionId } }
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

/** Whether the `allow` list of a credentials block has an `SSIpolicyV2` entry. */
function hasV2Entries(credentials: DdoCredentials | undefined): boolean {
  return (
    Array.isArray(credentials?.allow) &&
    credentials.allow.some(isSsiPolicyV2Credential)
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How long an error result of an SSI result may be in a `PolicyCheckResult`. */
const MAX_SSI_RESULT_ERROR = 100

/**
 * The node's SSI results as `PolicyCheckResult`s: the scope and the DCQL query id kept, the
 * texts bounded and without the session id.
 */
function toPolicyResults(
  results: SsiResult[],
  sessionId: string
): PolicyCheckResult[] {
  const remove = sessionIdRemover(sessionId)
  const clean = (text: string, max: number) =>
    remove(sanitize(remove(text), max, null))

  return results.map((result) => ({
    scope: clean(result.scope, 40),
    ...(result.credentialId
      ? { credential: clean(result.credentialId, 80) }
      : {}),
    policy: clean(result.name, 80),
    success: result.success,
    ...(result.error
      ? { error: clean(result.error, MAX_SSI_RESULT_ERROR) }
      : {})
  }))
}

/**
 * After a presentation that may have reached the verifier: the session's status, read once
 * and cut after 15 s, or `undefined` when the read fails (the presentation's error then
 * stands). As `failedPolicies` does for the policy server.
 */
async function boundedStatus(
  node: OceanNodeClient,
  request: Parameters<OceanNodeClient['ssiStatus']>[0],
  error: unknown
): Promise<SsiStatusResult | undefined> {
  if (debugEnabled('sensitive', 'policy'))
    debugRaw('policy', 'presentation failed (SSI)', {
      sessionId: request.sessionId,
      error
    })

  const signal = AbortSignal.timeout(FAILED_PRESENTATION_READ_TIMEOUT_MS)
  try {
    return await Promise.race<SsiStatusResult>([
      node.ssiStatus(request, signal),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true
        })
      })
    ])
  } catch (statusError) {
    if (debugEnabled('sensitive', 'policy'))
      debugRaw('policy', 'ssiStatus after the failed presentation failed', {
        sessionId: request.sessionId,
        error: statusError
      })
    return undefined
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
function refusalReason(
  results: PolicyCheckResult[],
  lead: string = REFUSED
): string {
  const failures = results
    .filter((result) => !result.success)
    .map((result) => {
      const name = [result.scope, result.policy].filter(Boolean).join('/')
      const target =
        result.scope && result.credential ? ` (${result.credential})` : ''
      const text = [`${name}${target}`, result.error].filter(Boolean).join(': ')
      return text.length > MAX_DESCRIBED_FAILURE
        ? `${text.slice(0, MAX_DESCRIBED_FAILURE)}…`
        : text
    })
  if (!failures.length) return lead

  const listing = (shown: number) => {
    const more = failures.length - shown
    const counted = more
      ? `${more}${shown ? ' more' : ''} in policyResults`
      : ''
    return `${lead} (${[...failures.slice(0, shown), counted].filter(Boolean).join('; ')})`
  }
  const fits = (reason: string) =>
    sanitize(reason, Number.MAX_SAFE_INTEGER, null).length <=
    MAX_NODE_MESSAGE_LENGTH

  for (let shown = failures.length; shown > 0; shown--)
    if (fits(listing(shown))) return listing(shown)
  return listing(0)
}

// #endregion
