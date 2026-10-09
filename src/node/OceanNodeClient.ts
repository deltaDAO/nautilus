/**
 * The single seam between nautilus and ocean-node.
 *
 * ocean-node replaced both Aquarius and Provider. ocean.js still exposes them as two
 * objects — the `Aquarius` class for metadata and `ProviderInstance` for services — so
 * this client puts them behind one façade, binds the node URI and auth mode once, and
 * gives every call the same error contract.
 *
 * Why a wrapper rather than calling ocean.js directly:
 *
 *   - **Error handling.** Several ocean.js methods swallow failures and return
 *     `null`/`undefined` (`Aquarius.validate`, `sendPreparedTransaction`). A silent
 *     `undefined` three frames later is far worse than a throw at the call site.
 *   - **Auth.** Every method takes `SignerOrAuthTokenOrSignature` separately; binding it
 *     once removes a repeated argument and a repeated mistake.
 *   - **The policy-server slot.** `policyServer` is an opaque `any` threaded through five
 *     methods. Keeping it in one place is what lets the identity layer stay out of the flows.
 *
 * One thing this client deliberately does *not* do: cache endpoint discovery. Every
 * `ProviderInstance` call re-fetches the node root to resolve its service endpoint, which
 * costs two extra round-trips per operation, but `getEndpoints`/`getServiceEndpoints` live
 * on `HttpProvider` and are not reachable through the `BaseProvider` façade, so there is
 * no supported way to hand them in. What *is* memoized is nautilus's own repeated
 * probing — see `isValidNode()`.
 */
import type { AssetV5, ValidateMetadata } from '@oceanprotocol/ddo-js'
import {
  Aquarius,
  type ComputeAlgorithm,
  type ComputeAsset,
  type ComputeEnvironment,
  type ComputeJob,
  type ComputeJobMetadata,
  type ComputeOutput,
  type ComputeResourceRequest,
  type ComputeResultStream,
  type DownloadResponse,
  type FileInfo,
  LoggerInstance,
  type NodeComputeJob,
  type NodeStatus,
  type PersistentStorageFileEntry,
  type ProviderComputeInitializeResults,
  type ProviderInitialize,
  ProviderInstance,
  type SearchQuery,
  type StorageObject,
  signRequest,
  type UserCustomParameters
} from '@oceanprotocol/lib'
import {
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  type Signer,
  toUtf8Bytes
} from 'ethers'
import {
  assertQualifiedJobId,
  assertResultIndex,
  withQualifiedJobId
} from '../compute/jobs.js'
import type { PolicyServerPayload } from '../ddo/types.js'
import {
  errorMessage,
  type FetchedText,
  fetchText,
  MAX_TIMER_MS,
  RequestTimeoutError
} from '../utils/http.js'
import { assertSecureTransport, parseHttpUrl } from '../utils/transport.js'
import { warnOnce } from '../utils/warn.js'
import {
  authTokenAddress,
  isAuthToken,
  isCompleteSignature,
  isSigner,
  type NodeAuth,
  resolveConsumerAddress
} from './auth.js'

/** Payload accepted by the `policyServer` slots: one entry, or one per compute asset. */
export type PolicyServerArg =
  | PolicyServerPayload
  | PolicyServerPayload[]
  | null
  | undefined

export interface OceanNodeClientOptions {
  /** The ocean-node URI. An HTTP URL, or a peerId/multiaddr to use the libp2p transport. */
  nodeUri: string
  chainId: number
  /** A Signer, a JWT auth token, or a pre-computed signature. */
  auth: NodeAuth
  /** Required when `auth` is a JWT, which nautilus cannot decode. */
  consumerAddress?: string
  /**
   * Accept a plain `http://` `nodeUri` on a host other than `localhost`, `127.0.0.0/8`,
   * `::1` or `*.localhost`. Default `false`, the same rule as `Nautilus.create`: node auth
   * travels with every request, and the plaintext DDO pointer goes to the node for
   * encryption. The rule also applies to the `nodeUri` argument of `encrypt` and
   * `getFileInfo` (a service's `serviceEndpoint`). Carried over to `forEndpoint` clients. A
   * libp2p peer id or multiaddr is not an HTTP URL and is not affected.
   */
  allowInsecureTransport?: boolean
  /**
   * How long one `encrypt` call may take, in milliseconds: the nonce lookup, the signature
   * and the node's answer, including the one retry after a rejected nonce. Default 120 s,
   * which leaves room for a wallet's signature prompt. A call that runs out throws an
   * `OceanNodeError`, and the next queued call starts. Carried over to `forEndpoint`
   * clients.
   */
  requestTimeoutMs?: number
}

/** The default of `OceanNodeClientOptions.requestTimeoutMs`. */
const DEFAULT_ENCRYPT_TIMEOUT_MS = 120_000

/** Thrown when ocean-node rejects a request or answers unusably. */
export class OceanNodeError extends Error {
  readonly operation: string
  readonly cause?: unknown

  constructor(operation: string, message: string, cause?: unknown) {
    super(`[ocean-node] ${operation}: ${message}`)
    this.name = 'OceanNodeError'
    this.operation = operation
    this.cause = cause
  }
}

/** Thrown when the node has recorded that it could not index an asset. */
export class IndexingError extends OceanNodeError {
  readonly did: string
  readonly txId?: string
  /** The node's record, including its `error` message. */
  readonly state: IndexingState

  constructor(did: string, state: IndexingState, txId?: string) {
    const error = state.error?.trim() || 'marked invalid without a message'
    const hint = indexingErrorHint(error)

    super(
      'waitForIndexer',
      `the node could not index ${did}${txId ? ` (tx ${txId})` : ''}: ${error}${hint ? `. Hint: ${hint}` : ''}`
    )
    this.name = 'IndexingError'
    this.did = did
    this.txId = txId
    this.state = state
  }
}

/** Actions nautilus sends to the policy server through the node's passthrough. */
export enum PolicyServerAction {
  /** The presentation definition of a session. */
  GET_PD = 'getPD',
  /** The verifier's record of a session: whether its presentation was verified. */
  CHECK_SESSION_ID = 'checkSessionId'
}

/** One VC or VP policy the verifier ran on a presentation, without its data. */
export interface PolicyCheckResult {
  /** The credential type it ran on (`VerifiablePresentation` for a VP policy). */
  credential?: string
  /** The policy's name, e.g. `signature` or `holder-binding`. */
  policy: string
  success: boolean
  /** Why it failed, as the verifier said it, bounded. */
  error?: string
}

/**
 * Thrown when the policy server refuses a consumer for a service, before anything is
 * ordered or paid: `initiate` answered with the policy server's own refusal (a 4xx reply
 * with `success: false`: the address is not on the asset's allow list, the asset's
 * `SSIpolicy` cannot be read, …), or the verifier did not accept the presentation
 * (`checkSessionId`).
 *
 * Not an `OceanNodeError`: the policy server answered, and the answer was no. Anything the
 * node says itself (a rejected nonce or signature, an asset it has not indexed, a policy
 * server it cannot reach), a network error, a timeout, a rate limit or a 5xx stays an
 * `OceanNodeError`.
 */
export class PolicyDeniedError extends Error {
  readonly did: string
  readonly serviceId: string
  /** The address the policy server checked, as it was sent. */
  readonly consumerAddress: string
  /**
   * The policy server's status for the refusal (403 for an address it does not allow, 422
   * for an `SSIpolicy` it cannot read). `undefined` when the presentation was not verified.
   */
  readonly code?: number
  /** The policy server's reason, bounded and without control characters. */
  readonly reason: string
  /**
   * The verifier's per-policy results, when the presentation was not verified. Only the
   * policy names, outcomes and errors: never the presentation or its token.
   */
  readonly policyResults?: PolicyCheckResult[]

  constructor(params: {
    nodeUri: string
    did: string
    serviceId: string
    consumerAddress: string
    code?: number
    reason: string
    policyResults?: PolicyCheckResult[]
  }) {
    const reason = boundedNodeMessage(params.reason) || 'no reason given'

    super(
      `The policy server of ${params.nodeUri} refused service ${params.serviceId} of ${params.did} for ${params.consumerAddress}${params.code ? ` (${params.code})` : ''}: ${reason}. Nothing was ordered or paid. Check the asset's credentials (its address allow list and SSIpolicy) with the publisher.`
    )
    this.name = 'PolicyDeniedError'
    this.did = params.did
    this.serviceId = params.serviceId
    this.consumerAddress = params.consumerAddress
    this.code = params.code
    this.reason = reason
    this.policyResults = params.policyResults
  }
}

/** The request `initializePolicyVerification` sends. */
export interface PolicyVerificationRequest {
  documentId: string
  serviceId: string
  /**
   * The address the session is opened for. Pass `policySessionAddress(...)`: the node
   * forwards the address it authenticated, which for a JWT is the token's own.
   */
  consumerAddress: string
  policyServer: PolicyServerPayload
}

/**
 * The policy server's envelope. `message` is the payload: for `initiate`
 * `{ sessionId, redirectUri }`, for `checkSessionId` the verifier's session record, and for
 * a refusal `{ error, redirectUri }` or a string.
 */
export interface PolicyServerReply {
  success?: boolean
  httpStatus?: number
  message?: unknown
}

/** What `checkPolicySession` reports. */
export interface PolicySessionCheck {
  /** `true` only when the verifier reports `verificationResult: true`. */
  verified: boolean
  /**
   * The verifier's per-policy results. The rest of its record, the presentation and its
   * `vp_token` included, is dropped.
   */
  policyResults: PolicyCheckResult[]
}

/**
 * The node accepts the indexer's decrypt call only when the signed message hash
 * (`keccak256(address + nonce + "decryptDDO")`) does not start with a zero byte (see
 * `nonceHandler.verifySignatureForConsumer` and `RawPrivateKeyProvider.signMessage`).
 * The stored nonce advances only on success, so once the next nonce is such a nonce,
 * later decrypt calls use it again. The node operator resolves it by advancing the node
 * address's stored nonce once (any command signed ocean.js-style with the node key).
 */
const STUCK_INDEXER_NONCE_HINT =
  "If the node logs 'consumer address and nonce signature mismatch' for its own address, its indexer nonce is stuck and later assets fail the same way until the operator advances the stored nonce of the node's address; OceanNodeClient.getIndexerNonceState() reports it"

/**
 * Whether the node accepts its indexer's decrypt call signed with `nonce`, i.e. whether
 * `keccak256(address + nonce + "decryptDDO")` does not start with a zero byte. See
 * `STUCK_INDEXER_NONCE_HINT`. The address is the checksummed form the node signs with.
 */
export function isIndexerNonceSignable(
  nodeAddress: string,
  nonce: number | bigint | string
): boolean {
  const message = `${getAddress(nodeAddress)}${String(nonce)}decryptDDO`

  return !keccak256(toUtf8Bytes(message)).startsWith('0x00')
}

/** What `getIndexerNonceState` reports. */
export interface IndexerNonceState {
  /** The node's own address (`providerAddress`), which signs the indexer's decrypt calls. */
  nodeAddress: string
  /** The nonce the node has stored for that address. */
  storedNonce: number
  /** The nonce the indexer signs its next decrypt call with: `storedNonce + 1`. */
  nextNonce: number
  /**
   * `true` when the node will not accept that call (`401 consumer address and nonce
   * signature mismatch`). Since the stored nonce only advances on success, encrypted DDOs
   * are not indexed until the operator advances the nonce.
   */
  stuck: boolean
}

/**
 * Thrown by `publish()`, `completePublish()` and `edit()` before any transaction when the
 * node's indexer nonce is stuck (`IndexerNonceState.stuck`): the asset would go on chain
 * without being indexed.
 */
export class IndexerNonceStuckError extends OceanNodeError {
  readonly state: IndexerNonceState

  constructor(state: IndexerNonceState) {
    super(
      'indexer preflight',
      `refusing to publish: the indexer nonce of this node is stuck. Its address ${state.nodeAddress} has stored nonce ${state.storedNonce}, and the node does not accept a decrypt call signed with nonce ${state.nextNonce}, so an encrypted DDO published to this node would not be indexed until the operator advances that stored nonce. Nothing was spent. Ask the node operator to advance it, or pass { checkIndexerNonce: false } to publish anyway.`
    )
    this.name = 'IndexerNonceStuckError'
    this.state = state
  }
}

/**
 * A hint for node errors whose message does not name their cause.
 *
 * The indexer decrypts the stored envelope with a second decrypt call. When that call does
 * not succeed, the error the node records is a UTF-8 or hex decoding error, so the hint
 * lists the likely causes.
 */
function indexingErrorHint(error: string): string | undefined {
  if (/invalid codepoint|UNEXPECTED_CONTINUE|invalid BytesLike/i.test(error))
    return "the node could not decrypt the envelope (its decrypt call returned a 401 nonce or authorization error, a 413 for an envelope over its 100 KB request limit, or a 429/403 rate-limit answer); check the node's logs, AUTHORIZED_DECRYPTERS and MAX_REQ_PER_MINUTE"

  if (/401|Unauthorized/i.test(error) && /decrypt/i.test(error))
    return `the node's decrypt call was refused (401 Unauthorized); check the node's logs, its nonce handling and AUTHORIZED_DECRYPTERS. ${STUCK_INDEXER_NONCE_HINT}`

  return undefined
}

/**
 * One record of the node's DDO indexing state (`GET /api/aquarius/state/ddo`).
 *
 * ocean-node 4.2 keeps two kinds of record per asset, under different ids:
 *
 *   - a **success** under the asset's `did:ope:` DID, with no `nft` and a blank `txId`
 *     (`" "`). Look it up by `{ did }`.
 *   - a **failure** under the `did:op:` form of the id, with `nft` and the real `txId`.
 *     Look it up by `{ txId }`. A later success does not clear it, so a lookup by
 *     `{ nft }` can return a failure from an earlier transaction.
 */
export interface IndexingState {
  /** The id the node filed it under: `did:ope:` for a success, `did:op:` for a failure. */
  did?: string
  chainId?: number
  /** Only on failure records. */
  nft?: string
  /** The transaction, on failure records. A single space on success records. */
  txId?: string
  valid: boolean
  /** The node's error message. A single space when there is none. */
  error?: string
}

export type IndexingStateQuery =
  | { did: string }
  | { nft: string }
  | { txId: string }

export interface WaitForIndexerOptions {
  /**
   * Delay between polls. Default 7 s: each poll is up to two requests (the asset, and the
   * indexing state when there is a `txid`), so one wait stays at or below 18 requests a
   * minute, under ocean-node's default `MAX_REQ_PER_MINUTE` of 30 per IP. When the node
   * answers 429 (or 403 "Too many active connections"), the next poll waits longer:
   * `2 × intervalMs` (counting an `intervalMs` under 1 s as 1 s), doubling with each
   * rate-limit answer in a row, and at least as long as the node asks (`Retry-After`, or
   * "Try again in N seconds") plus 1 s; never more than 60 s.
   */
  intervalMs?: number
  /**
   * How long to wait before throwing. Default 5 minutes. One last lookup runs when the
   * time is up, so the wait can end up to one request (at least 1 s) later.
   */
  timeoutMs?: number
  /**
   * Timeout for each request to the node, capped by what is left of `timeoutMs` (but at
   * least 1 s, or `requestTimeoutMs` when that is shorter). Default 15 s. Over P2P it
   * bounds each asset lookup as a whole, ocean.js's own dial and retries included.
   */
  requestTimeoutMs?: number
  /**
   * How many asset lookups in a row may fail (network error, timeout, an HTTP status other
   * than 2xx or 404) before this throws an `OceanNodeError` carrying the last error,
   * instead of waiting out the timeout. Default 5.
   */
  maxConsecutiveFailures?: number
  /** Aborting rejects with the signal's reason. */
  signal?: AbortSignal
}

const DEFAULT_INDEXER_INTERVAL_MS = 7_000
/** The longest wait after a rate-limit answer. */
const MAX_RATE_LIMIT_BACKOFF_MS = 60_000
/**
 * The least `intervalMs` the rate-limit backoff doubles from, so an `intervalMs` of 0 (or a
 * few ms) still backs off by seconds: a 403 "Too many active connections" has no
 * `Retry-After`.
 */
const MIN_RATE_LIMIT_BACKOFF_BASE_MS = 1_000
const DEFAULT_INDEXER_TIMEOUT_MS = 300_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5
/** The least time a lookup gets, so the last one at the deadline can still succeed. */
const MIN_REQUEST_BUDGET_MS = 1_000
/** The interval 2.0.0-beta.0 polled at (ocean.js's `waitForIndexer` default). */
const LEGACY_INDEXER_INTERVAL_MS = 30_000

/**
 * Throws an `OceanNodeError` for a timing option that is not a finite number of 0 or
 * more: `Infinity`, `NaN` or a negative value would otherwise turn into a 1 ms timer.
 */
function assertDuration(operation: string, name: string, value: unknown): void {
  if (value === undefined) return

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new OceanNodeError(
      operation,
      `${name} must be a finite number, 0 or more; got ${String(value)}`
    )
}

/**
 * 2.0.0-beta.0's `waitForIndexer` took `{ interval, maxRetries }`. They are not part of
 * the options any more, but code passing them must not silently get a different wait: map
 * them (when the new names are absent) and say so. `maxRetries` without `interval` counts
 * beta.0's 30 s polls, so the wait is as long as it was; the polls themselves stay 7 s apart.
 */
function resolveIndexerOptions(
  options: WaitForIndexerOptions
): WaitForIndexerOptions {
  const legacy = options as WaitForIndexerOptions & {
    interval?: unknown
    maxRetries?: unknown
  }

  if (legacy.interval === undefined && legacy.maxRetries === undefined)
    return options

  warnOnce(
    'waitForIndexer-legacy-options',
    "waitForIndexer: the options `interval` and `maxRetries` were replaced by `intervalMs` and `timeoutMs` in 2.0.0-beta.1. They are mapped for now (intervalMs = interval, timeoutMs = interval × maxRetries, with beta.0's 30 s when interval is absent) but will be removed; rename them."
  )

  const interval =
    typeof legacy.interval === 'number' && legacy.interval >= 0
      ? legacy.interval
      : undefined
  const intervalMs = options.intervalMs ?? interval
  const retries =
    typeof legacy.maxRetries === 'number' && legacy.maxRetries > 0
      ? legacy.maxRetries
      : undefined

  return {
    ...options,
    intervalMs,
    timeoutMs:
      options.timeoutMs ??
      (retries !== undefined
        ? retries * (intervalMs ?? LEGACY_INDEXER_INTERVAL_MS)
        : undefined)
  }
}

/**
 * Whether a state record is a failure: `valid: false`, or any real error message. The 4.2
 * node records a DDO it dropped at the database write as `valid: true` plus an error.
 */
function isIndexingFailure(state: IndexingState): boolean {
  return (
    state.valid === false ||
    (typeof state.error === 'string' && state.error.trim() !== '')
  )
}

/** Whether a state record is about this transaction. Success records carry `" "`. */
function isRecordFor(state: IndexingState, txid: string): boolean {
  return state.txId?.trim().toLowerCase() === txid.toLowerCase()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)

    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
      Math.min(Math.max(ms, 0), MAX_TIMER_MS)
    )

    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** One poll's lookup: the asset, "not yet", a rate-limit answer, or a failed request. */
type Lookup =
  | { kind: 'indexed'; asset: AssetV5 }
  | { kind: 'pending' }
  | { kind: 'rate-limited'; error: NodeRateLimitedError }
  | { kind: 'failed'; error: unknown }

/**
 * The node turned a request away for its rate limit: `429` ("Rate limit exceeded. Try
 * again in N seconds.", `MAX_REQ_PER_MINUTE` per IP) or `403` ("Too many active
 * connections", `MAX_CONNECTIONS_PER_MINUTE` across all IPs). Internal.
 */
class NodeRateLimitedError extends OceanNodeError {
  /** How long the node asked to wait, when it said. */
  readonly retryAfterMs?: number

  constructor(operation: string, response: FetchedText) {
    super(
      operation,
      `the node rate-limited the request: ${response.status} ${response.statusText} ${boundedNodeMessage(response.body)}`.trim()
    )
    this.name = 'NodeRateLimitedError'
    this.retryAfterMs = retryAfterMs(response)
  }
}

/** Whether a response is the node's rate limiter rather than an answer. */
function isRateLimited(response: FetchedText): boolean {
  if (response.status === 429) return true

  return (
    response.status === 403 &&
    /too many active connections|rate limit/i.test(response.body)
  )
}

/**
 * The wait the node asked for, capped at 60 s: `Retry-After` (delay-seconds or an
 * HTTP-date), or ocean-node's "Try again in N seconds".
 */
function retryAfterMs(response: FetchedText): number | undefined {
  const header = response.retryAfter?.trim()
  let ms: number | undefined

  if (header && /^\d+$/.test(header)) ms = Number(header) * 1000
  else if (header && Number.isFinite(Date.parse(header)))
    ms = Math.max(0, Date.parse(header) - Date.now())
  else {
    const seconds = /try again in (\d+) seconds?/i.exec(response.body)?.[1]
    if (seconds) ms = Number(seconds) * 1000
  }

  return ms === undefined ? undefined : Math.min(ms, MAX_RATE_LIMIT_BACKOFF_MS)
}

/**
 * A node URI as `forEndpoint` keys it: an HTTP URL as the URL parser writes it (scheme and
 * host lower-cased, a default port dropped), without trailing slashes; a peer id or
 * multiaddr trimmed of them.
 */
function normalizeNodeUri(uri: string): string {
  const url = parseHttpUrl(uri)

  return (url ? url.href : uri.trim()).replace(/\/+$/, '')
}

/** Whether the node URI is an `http:`/`https:` URL, judged as the transport rule judges it. */
function isHttpUri(uri: string): boolean {
  return parseHttpUrl(uri) !== undefined
}

/**
 * The query as the node stores it: ES maps `nft` and `txId` as exact keywords, and the node
 * files `nft` checksummed and `txId` lower-case. `did` must be a `did:op:`/`did:ope:` id.
 */
function normalizeStateQuery(query: IndexingStateQuery): [string, string] {
  const [key, raw] =
    'txId' in query
      ? ['txId', query.txId]
      : 'did' in query
        ? ['did', query.did]
        : ['nft', (query as { nft: string }).nft]

  const value = typeof raw === 'string' ? raw.trim() : ''

  if (!value)
    throw new OceanNodeError('getIndexingState', 'pass a did, an nft or a txId')

  if (key === 'nft') {
    if (!isAddress(value))
      throw new OceanNodeError(
        'getIndexingState',
        `nft ${JSON.stringify(value)} is not an address`
      )
    return [key, getAddress(value)]
  }

  if (key === 'txId') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value))
      throw new OceanNodeError(
        'getIndexingState',
        `txId ${JSON.stringify(value)} is not a 32-byte 0x hex transaction hash`
      )
    return [key, value.toLowerCase()]
  }

  if (!/^did:ope?:/.test(value))
    throw new OceanNodeError(
      'getIndexingState',
      `did ${JSON.stringify(value)} is not a did:op: or did:ope: id`
    )

  return [key, value]
}

/** The node's answer when a signed command reuses a nonce it has already seen. */
const NONCE_REJECTED = /not a valid nonce/i

/** The command string ocean-node verifies an `initializePSVerification` signature with. */
const POLICY_SERVER_INITIALIZE = 'PolicyServerInitialize'

/**
 * The largest policy-server answer read: an `initiate` reply is an openid4vp URL, a
 * `checkSessionId` reply the verifier's record of one presentation.
 */
const MAX_POLICY_REPLY_BYTES = 256 * 1024

/** What ocean.js puts before the node's message when a P2P command fails. */
const P2P_ERROR_PREFIX = /^P2P command error: /

/**
 * How long a "no policy server" answer is kept. ocean-node reads its `POLICY_SERVER_URL`
 * once, at startup, so only a restart changes the answer; a node restarted with a policy
 * server is asked again after this long.
 */
const NO_POLICY_SERVER_TTL_MS = 10 * 60 * 1000

/**
 * Whether an `initiate` failure over P2P is a node without a policy server. ocean-node
 * (upstream and OceanProtocolEnterprise 4.2 alike) answers `initiate` with a bare
 * `{"httpStatus":404}` status frame when `POLICY_SERVER_URL` is unset or empty, which
 * ocean.js 9.2 throws as exactly this message, wrapped in `P2P command error: …` with it as
 * the `cause`. The node's own 404 (an asset it has not indexed) carries its text instead,
 * `Not found`.
 */
function isP2pNoPolicyServer(error: unknown): boolean {
  for (
    let current = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as { cause?: unknown }).cause, depth++
  )
    if (current.message === 'Gateway node error: 404') return true

  return false
}

/** The policy server's `{ success, httpStatus, message }` envelope, or `undefined`. */
function parsePolicyServerReply(text: string): PolicyServerReply | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return undefined

  const reply = parsed as PolicyServerReply

  return typeof reply.success === 'boolean' ? reply : undefined
}

/**
 * The policy server's reply in an error ocean.js threw: over HTTP it throws the body of a
 * failed answer as the message, over P2P the node's error text after `P2P command error: `,
 * with the bare text as the `cause`.
 */
function policyServerReplyIn(error: unknown): PolicyServerReply | undefined {
  for (
    let current = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as { cause?: unknown }).cause, depth++
  ) {
    const reply = parsePolicyServerReply(
      current.message.replace(P2P_ERROR_PREFIX, '')
    )
    if (reply) return reply
  }

  return undefined
}

/**
 * Whether a reply is the policy server refusing the request: `success: false` with a 4xx.
 * A 5xx is the policy server or its verifier failing, not a refusal.
 */
function isPolicyRefusal(reply: PolicyServerReply | undefined): boolean {
  const status = reply?.httpStatus

  return (
    reply?.success === false &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  )
}

/**
 * The reason in a refusal: the policy server's `message.error` (`"Access denied: Address
 * not allowed at asset level."`) or `message`, else the whole reply. Bounded by
 * `PolicyDeniedError`.
 */
function policyServerReason(reply: PolicyServerReply): string {
  const { message } = reply

  if (typeof message === 'string' && message.trim()) return message

  const error =
    message && typeof message === 'object'
      ? (message as { error?: unknown }).error
      : undefined
  if (typeof error === 'string' && error.trim()) return error

  return JSON.stringify(reply)
}

/** A walt.id verifier session record, as `checkSessionId` returns it. */
function isSessionRecord(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    'verificationResult' in (value as object)
  )
}

/**
 * The per-policy results in a verifier session record
 * (`policyResults.results[].policyResults[]`), reduced to name, outcome and error. Each
 * policy's `result` and `args`, and everything else in the record (`tokenResponse` with the
 * `vp_token`, the presentation definition), are dropped.
 */
function readPolicyResults(record: unknown): PolicyCheckResult[] {
  const results = (
    record as {
      policyResults?: { results?: unknown }
    } | null
  )?.policyResults?.results
  if (!Array.isArray(results)) return []

  const read: PolicyCheckResult[] = []

  for (const entry of results) {
    const { credential, policyResults } = (entry ?? {}) as {
      credential?: unknown
      policyResults?: unknown
    }
    if (!Array.isArray(policyResults)) continue

    for (const raw of policyResults) {
      const { policy, is_success, error } = (raw ?? {}) as {
        policy?: unknown
        is_success?: unknown
        error?: unknown
      }
      if (typeof policy !== 'string') continue

      const reason =
        error === undefined || error === null
          ? undefined
          : boundedNodeMessage(
              typeof error === 'string'
                ? error.split('\n')[0]
                : ((error as { message?: unknown }).message ?? error)
            )

      read.push({
        ...(typeof credential === 'string' ? { credential } : {}),
        policy,
        success: is_success === true,
        ...(reason ? { error: reason } : {})
      })
    }
  }

  return read
}

/** How much of a node's error body goes into an error message. */
const MAX_NODE_MESSAGE_LENGTH = 200

/** C0 and C1 control characters, DEL, and the line and paragraph separators. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const MESSAGE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g

/**
 * A node's or policy server's text for an error message: control characters replaced by a
 * space, at most `MAX_NODE_MESSAGE_LENGTH` characters.
 */
function boundedNodeMessage(value: unknown): string {
  const text = (
    typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))
  )
    .replace(MESSAGE_CONTROL_CHARACTERS, ' ')
    .trim()

  return text.length > MAX_NODE_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_NODE_MESSAGE_LENGTH)}…`
    : text
}

/** Resolves once `promise` settles; rejects with `signal.reason` if `signal` aborts first. */
function untilSettled(
  promise: Promise<unknown>,
  signal: AbortSignal | undefined
): Promise<void> {
  if (!signal)
    return promise.then(
      () => undefined,
      () => undefined
    )

  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)

    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })

    const done = () => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    promise.then(done, done)
  })
}

async function attempt<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new OceanNodeError(
      operation,
      error instanceof Error ? error.message : String(error),
      error
    )
  }
}

export class OceanNodeClient {
  readonly nodeUri: string
  readonly chainId: number

  private readonly aquarius: Aquarius
  private auth: NodeAuth
  private consumerAddressOverride?: string
  private readonly allowInsecureTransport: boolean
  private readonly requestTimeoutMs: number

  /**
   * Tail of this client's signed commands, see `serializeSigned`. One client has one auth,
   * so this is a queue per address.
   */
  private signedQueue: Promise<unknown> = Promise.resolve()

  /**
   * Whether the node has a policy server, once its status or an `initiate` said so, and
   * until when that holds. See `hasPolicyServer`.
   */
  private policyServerAnswer?: { configured: boolean; until: number }

  /**
   * The clients `forEndpoint` hands out, keyed by normalised node URI, shared by every
   * client derived from the same one: so each node has one client, one signing queue and
   * one `hasPolicyServer` answer.
   */
  private endpoints: Map<string, OceanNodeClient>

  /** Memoized `isValidProvider` probes, keyed by URI. Service endpoints are re-checked
   * once per service on every publish, and the answer does not change mid-run. */
  private static readonly validityCache = new Map<string, Promise<boolean>>()

  /**
   * Throws an `OceanNodeError` for a plain `http://` `nodeUri` on a non-loopback host,
   * unless `allowInsecureTransport` (see `OceanNodeClientOptions`), and for a
   * `requestTimeoutMs` that is not a positive finite number.
   */
  constructor(options: OceanNodeClientOptions) {
    this.allowInsecureTransport = options.allowInsecureTransport === true

    this.assertTransport('create', options.nodeUri)

    assertDuration('create', 'requestTimeoutMs', options.requestTimeoutMs)
    if (options.requestTimeoutMs === 0)
      throw new OceanNodeError('create', 'requestTimeoutMs must be more than 0')
    this.requestTimeoutMs = Math.min(
      options.requestTimeoutMs ?? DEFAULT_ENCRYPT_TIMEOUT_MS,
      MAX_TIMER_MS
    )

    this.nodeUri = options.nodeUri
    this.chainId = options.chainId
    this.auth = options.auth
    this.consumerAddressOverride = options.consumerAddress
    this.aquarius = new Aquarius(options.nodeUri)
    this.endpoints = new Map([[normalizeNodeUri(options.nodeUri), this]])
  }

  /**
   * The client for a node, carrying this one's auth, chain and consumer address.
   *
   * Consume flows need this: a service's file object is encrypted with a key local to the
   * node in its `serviceEndpoint` (see `encrypt`), so `initialize` and the download must be
   * addressed to that node — the configured one cannot decrypt.
   *
   * One client per node: every client derived from this one returns the same client for
   * the same URI (scheme and host case, a default port and trailing slashes normalised),
   * and this very client for its own. So parallel calls to one node share its signing
   * queue, and do not sign the same nonce, and its `hasPolicyServer` answer. A client whose
   * auth no longer matches this one's (after `setAuth`) is replaced.
   *
   * The JWT caveat from `encrypt` applies here too: a token minted for one node is
   * rejected by another, so cross-node consume needs Signer auth.
   *
   * The transport rule applies to the other node as well: a plain `http://` endpoint on a
   * non-loopback host throws an `OceanNodeError` unless this client was created with
   * `allowInsecureTransport: true`, since this client's auth would travel to it.
   */
  forEndpoint(uri: string): OceanNodeClient {
    const key = normalizeNodeUri(uri)
    const existing = this.endpoints.get(key)

    if (
      existing &&
      existing.auth === this.auth &&
      existing.consumerAddressOverride === this.consumerAddressOverride
    )
      return existing

    const client = new OceanNodeClient({
      nodeUri: key,
      chainId: this.chainId,
      auth: this.auth,
      consumerAddress: this.consumerAddressOverride,
      allowInsecureTransport: this.allowInsecureTransport,
      requestTimeoutMs: this.requestTimeoutMs
    })
    client.endpoints = this.endpoints
    this.endpoints.set(key, client)

    return client
  }

  /**
   * The transport rule (see `OceanNodeClientOptions.allowInsecureTransport`) for a node this
   * client sends to, as an `OceanNodeError` of `operation`.
   */
  private assertTransport(operation: string, uri: string): void {
    try {
      assertSecureTransport(uri, 'nodeUri', this.allowInsecureTransport)
    } catch (error) {
      throw new OceanNodeError(operation, errorMessage(error), error)
    }
  }

  /** Swap in a session token after minting one, so later calls skip nonce-and-sign. */
  setAuth(auth: NodeAuth, consumerAddress?: string): void {
    this.auth = auth
    if (consumerAddress) this.consumerAddressOverride = consumerAddress
  }

  getAuth(): NodeAuth {
    return this.auth
  }

  /** The signer, when one is available. Contract calls need a real signer, not a token. */
  requireSigner(): Signer {
    if (!isSigner(this.auth))
      throw new OceanNodeError(
        'requireSigner',
        'this operation needs a Signer, but the client was constructed with an auth token or a pre-computed signature'
      )

    return this.auth
  }

  async getConsumerAddress(): Promise<string> {
    return resolveConsumerAddress(this.auth, this.consumerAddressOverride)
  }

  // #region metadata

  /** Resolves a DID. Throws rather than returning `undefined` for an unknown asset. */
  async resolve(did: string, signal?: AbortSignal): Promise<AssetV5> {
    const asset = await attempt('resolve', () =>
      this.aquarius.resolve(did, signal)
    )

    if (!asset) throw new OceanNodeError('resolve', `no asset found for ${did}`)

    return asset as unknown as AssetV5
  }

  /**
   * Blocks until the indexer has picked up the asset, or the update identified by `txid`.
   *
   * With a `txid` (publish and edit always have one), each round also reads the node's
   * failure record for that transaction (`getIndexingState({ txId })`). When there is one,
   * this throws an `IndexingError` with the node's message instead of waiting out the
   * timeout. Only a record whose `txId` is this transaction counts: a later success does
   * not remove an earlier failure record, so a record for another transaction is ignored. The state
   * endpoint is optional: when it fails, only the early exit is lost.
   *
   * Polls every `intervalMs` (default 7 s, so at most 18 requests a minute: ocean-node
   * rate-limits each IP to `MAX_REQ_PER_MINUTE`, default 30). A rate-limit answer (429, or
   * 403 "Too many active connections") is not a failure: the next poll waits longer (see
   * `WaitForIndexerOptions.intervalMs`), never more than 60 s.
   *
   * Each request has its own timeout (`requestTimeoutMs`); over P2P it bounds each lookup.
   * The read-only GETs follow redirects (see `getPublic`). After `maxConsecutiveFailures`
   * failed asset lookups in a row this throws an `OceanNodeError` with the last error, so a
   * wrong node URL or a node that answers 500 is reported as such rather than as "not
   * indexed". When `timeoutMs` is up, one last lookup runs; then this throws an
   * `OceanNodeError`. Throws an `OceanNodeError` for a timing option that is negative or not
   * finite, and rejects with the signal's reason when `signal` aborts.
   */
  async waitForIndexer(
    did: string,
    txid?: string,
    options: WaitForIndexerOptions = {}
  ): Promise<AssetV5> {
    const resolved = resolveIndexerOptions(options)
    const { signal } = resolved

    for (const name of [
      'intervalMs',
      'timeoutMs',
      'requestTimeoutMs',
      'maxConsecutiveFailures'
    ] as const)
      assertDuration('waitForIndexer', name, resolved[name])

    const intervalMs = resolved.intervalMs ?? DEFAULT_INDEXER_INTERVAL_MS
    const timeoutMs = resolved.timeoutMs ?? DEFAULT_INDEXER_TIMEOUT_MS
    const requestTimeoutMs =
      resolved.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const maxFailures =
      resolved.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
    const deadline = Date.now() + timeoutMs
    const what = `${did}${txid ? ` (tx ${txid})` : ''}`

    let failures = 0
    let rateLimits = 0
    let lastLookupError: unknown
    let lastStateError: unknown
    let lastRateLimit: NodeRateLimitedError | undefined

    // Capped by the time left, but never below a second: after a backoff that ends at the
    // deadline, the last lookup would otherwise get 1 ms and always fail.
    const requestBudget = () =>
      Math.max(
        Math.min(requestTimeoutMs, MIN_REQUEST_BUDGET_MS),
        Math.min(requestTimeoutMs, deadline - Date.now())
      )

    for (;;) {
      if (signal?.aborted) throw signal.reason

      const lookup = await this.lookupIndexed(
        did,
        txid,
        signal,
        requestBudget()
      )

      if (lookup.kind === 'indexed') return lookup.asset

      // A rate-limit answer is not a failure of the node: wait longer and ask again.
      let rateLimited: NodeRateLimitedError | undefined =
        lookup.kind === 'rate-limited' ? lookup.error : undefined

      if (lookup.kind === 'failed') {
        if (signal?.aborted) throw signal.reason

        failures++
        lastLookupError = lookup.error

        if (failures >= maxFailures)
          throw new OceanNodeError(
            'waitForIndexer',
            `${failures} lookups of ${what} in a row failed; the last one: ${errorMessage(lookup.error)}. Check the node URI and that the node is up.`,
            lookup.error
          )
      } else if (lookup.kind === 'pending') {
        failures = 0
        lastLookupError = undefined
      }

      if (!rateLimited && txid && isHttpUri(this.nodeUri)) {
        try {
          const state = await this.readIndexingState(
            { txId: txid },
            signal,
            requestBudget()
          )

          if (state && isRecordFor(state, txid) && isIndexingFailure(state))
            throw new IndexingError(did, state, txid)

          lastStateError = undefined
        } catch (error) {
          if (error instanceof IndexingError) throw error
          if (signal?.aborted) throw signal.reason

          if (error instanceof NodeRateLimitedError) rateLimited = error
          else lastStateError = error
        }
      }

      let delay = intervalMs
      if (rateLimited) {
        rateLimits++
        lastRateLimit = rateLimited
        const backoff = Math.min(
          MAX_RATE_LIMIT_BACKOFF_MS,
          Math.max(intervalMs, MIN_RATE_LIMIT_BACKOFF_BASE_MS) *
            2 ** Math.min(rateLimits, 10)
        )
        delay = Math.min(
          MAX_RATE_LIMIT_BACKOFF_MS,
          Math.max(
            backoff,
            rateLimited.retryAfterMs !== undefined
              ? rateLimited.retryAfterMs + 1_000
              : 0
          )
        )
        LoggerInstance.debug(
          `[waitForIndexer] ${this.nodeUri} rate-limited the lookup of ${what}; next try in ${Math.round(delay / 1000)}s`
        )
      } else rateLimits = 0

      // Sleep until the next poll or the deadline, whichever is first; a poll at the
      // deadline is the last one.
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        if (signal?.aborted) throw signal.reason

        const last = lastLookupError ?? lastStateError ?? lastRateLimit
        const limited = lastRateLimit
          ? ' The node rate-limited some of these lookups (its MAX_REQ_PER_MINUTE), so they were spaced out; a longer intervalMs avoids that.'
          : ''
        throw new OceanNodeError(
          'waitForIndexer',
          `${what} was not indexed within ${Math.round(timeoutMs / 1000)}s. The node may be behind; getIndexingState() shows what it recorded.${limited}${last ? ` Last request error: ${errorMessage(last)}` : ''}`,
          last
        )
      }

      await sleep(Math.min(delay, remaining), signal)
    }
  }

  /**
   * One lookup: the asset, if it is indexed (at `txid`, when given).
   *
   * Over HTTP this reads `GET /api/aquarius/assets/ddo/<did>` itself, so a failing request
   * is told apart from a 404 ("not indexed yet"). Over P2P it falls back to ocean.js's
   * `waitForIndexer` with one retry and no delay (see `lookupIndexedP2p`).
   */
  private async lookupIndexed(
    did: string,
    txid: string | undefined,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<Lookup> {
    if (!isHttpUri(this.nodeUri))
      return this.lookupIndexedP2p(did, txid, signal, timeoutMs)

    const url = `${this.nodeUri.replace(/\/+$/, '')}/api/aquarius/assets/ddo/${encodeURIComponent(did)}`

    try {
      const response = await this.getPublic(url, timeoutMs, signal)

      if (response.status === 404) return { kind: 'pending' }
      if (isRateLimited(response))
        return {
          kind: 'rate-limited',
          error: new NodeRateLimitedError('waitForIndexer', response)
        }
      if (!response.ok)
        return {
          kind: 'failed',
          error: new Error(
            `GET ${url} answered ${response.status} ${response.statusText} ${response.body.slice(0, 200)}`.trim()
          )
        }

      const asset = JSON.parse(response.body) as AssetV5

      if (!txid) return { kind: 'indexed', asset }

      // v5 keeps the event under `indexedMetadata`; v4 had it at the top level.
      const fields = asset as unknown as {
        indexedMetadata?: { event?: { txid?: unknown } }
        event?: { txid?: unknown }
      }
      const indexedTx =
        fields?.indexedMetadata?.event?.txid ?? fields?.event?.txid

      return typeof indexedTx === 'string' &&
        indexedTx.toLowerCase() === txid.toLowerCase()
        ? { kind: 'indexed', asset }
        : { kind: 'pending' }
    } catch (error) {
      if (signal?.aborted) throw signal.reason

      return { kind: 'failed', error }
    }
  }

  /**
   * A P2P lookup through ocean.js's `waitForIndexer`, bounded by `timeoutMs`.
   *
   * ocean.js 9.2.1 bounds the stages of a P2P call (10 s to dial, 60 s per idle read), not
   * the call: it retries a failed dial up to 5 times, and neither its wait for a free
   * request slot nor its backoff between retries looks at the signal. So the call gets a
   * signal that also aborts after `timeoutMs`, and is raced against that, so a call that
   * does not settle cannot hold up the wait's deadline or its failure count.
   *
   * ocean.js swallows its own errors, so its answer is the asset or "not yet"; only running
   * out of `timeoutMs` is reported as a failed lookup.
   */
  private async lookupIndexedP2p(
    did: string,
    txid: string | undefined,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<Lookup> {
    if (signal?.aborted) throw signal.reason

    const controller = new AbortController()
    let stop!: (reason: unknown) => void
    const stopped = new Promise<never>((_, reject) => {
      stop = reject
    })
    // `stopped` is rejected before `controller` aborts, so the race settles with it, not
    // with the `null` that ocean.js turns its own abort into.
    const halt = (reason: unknown) => {
      stop(reason)
      controller.abort(reason)
    }
    const timer = setTimeout(
      () => halt(new RequestTimeoutError(timeoutMs)),
      Math.min(timeoutMs, MAX_TIMER_MS)
    )
    const onAbort = () => halt(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const asset = await Promise.race([
        this.aquarius
          .waitForIndexer(did, txid, controller.signal, 0, 1)
          .catch(() => null),
        stopped
      ])

      return asset
        ? { kind: 'indexed', asset: asset as unknown as AssetV5 }
        : { kind: 'pending' }
    } catch (error) {
      if (signal?.aborted) throw signal.reason

      return { kind: 'failed', error }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * A read-only `GET` to the node that follows redirects, e.g. from a reverse proxy in front
   * of `/api/aquarius`. Safe because it carries no credentials (no `Authorization`, no
   * token, no body), only `Accept`. The transport rule still applies to where it ends:
   * `fetchText` refuses a redirect to plain `http://` on a non-loopback host, unless the
   * node URI is such a URL already (`allowInsecureTransport`).
   */
  private getPublic(
    url: string,
    timeoutMs: number,
    signal: AbortSignal | undefined
  ): Promise<FetchedText> {
    return fetchText(
      fetch,
      url,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { timeoutMs, signal, followRedirects: true }
    )
  }

  /**
   * The node's own address (`providerAddress` in `GET /`), or `undefined` when the node
   * does not say or is reached over P2P. The indexer signs its decrypt calls with this key.
   *
   * Throws an `OceanNodeError` when the request fails (network error, timeout, a non-2xx
   * status) or the body is not JSON. Rejects with the signal's reason when `signal` aborts.
   */
  async getNodeAddress(signal?: AbortSignal): Promise<string | undefined> {
    if (!isHttpUri(this.nodeUri)) return undefined

    let response: Awaited<ReturnType<typeof fetchText>>
    try {
      response = await this.getPublic(
        `${this.nodeUri.replace(/\/+$/, '')}/`,
        DEFAULT_REQUEST_TIMEOUT_MS,
        signal
      )
    } catch (error) {
      if (signal?.aborted) throw error
      throw new OceanNodeError('getNodeAddress', errorMessage(error), error)
    }

    if (!response.ok)
      throw new OceanNodeError(
        'getNodeAddress',
        `${response.status} ${response.statusText} ${boundedNodeMessage(response.body)}`.trim()
      )

    let info: unknown
    try {
      info = JSON.parse(response.body)
    } catch (error) {
      throw new OceanNodeError(
        'getNodeAddress',
        `the node answered with something that is not JSON: ${boundedNodeMessage(response.body)}`,
        error
      )
    }

    const address =
      info && typeof info === 'object'
        ? (info as { providerAddress?: unknown }).providerAddress
        : undefined

    return typeof address === 'string' && isAddress(address)
      ? getAddress(address)
      : undefined
  }

  /**
   * Read-only check whether the node's indexer nonce is stuck (see
   * `IndexerNonceState.stuck`). Two GETs: the node's root and
   * `/api/services/nonce` for the node's own address. Nothing is signed or sent.
   *
   * `undefined` over P2P or when the node reports no address. Throws an `OceanNodeError`
   * when a request fails or the nonce answer is unusable.
   */
  async getIndexerNonceState(
    signal?: AbortSignal
  ): Promise<IndexerNonceState | undefined> {
    const nodeAddress = await this.getNodeAddress(signal)
    if (!nodeAddress) return undefined

    let response: Awaited<ReturnType<typeof fetchText>>
    try {
      response = await this.getPublic(
        `${this.nodeUri.replace(/\/+$/, '')}/api/services/nonce?userAddress=${nodeAddress}`,
        DEFAULT_REQUEST_TIMEOUT_MS,
        signal
      )
    } catch (error) {
      if (signal?.aborted) throw error
      throw new OceanNodeError(
        'getIndexerNonceState',
        errorMessage(error),
        error
      )
    }

    if (!response.ok)
      throw new OceanNodeError(
        'getIndexerNonceState',
        `${response.status} ${response.statusText} ${boundedNodeMessage(response.body)}`.trim()
      )

    let raw: unknown
    try {
      raw = (JSON.parse(response.body) as { nonce?: unknown } | null)?.nonce
    } catch (error) {
      throw new OceanNodeError(
        'getIndexerNonceState',
        `the node answered with something that is not JSON: ${boundedNodeMessage(response.body)}`,
        error
      )
    }

    // The node answers `{ nonce: "<n>" }`, and `{}`/`null` for an address it has not seen.
    const storedNonce =
      raw === undefined || raw === null || raw === '' ? 0 : Number(raw)

    if (!Number.isSafeInteger(storedNonce) || storedNonce < 0)
      throw new OceanNodeError(
        'getIndexerNonceState',
        `the node answered with an unusable nonce: ${boundedNodeMessage(response.body)}`
      )

    const nextNonce = storedNonce + 1

    return {
      nodeAddress,
      storedNonce,
      nextNonce,
      stuck: !isIndexerNonceSignable(nodeAddress, nextNonce)
    }
  }

  /**
   * The indexer's record for an asset or a transaction, or `undefined` if it has none.
   * HTTP nodes only: the endpoint (`GET /api/aquarius/state/ddo`) has no P2P command.
   *
   * See `IndexingState` for how ocean-node 4.2 files them: `{ did }` (the `did:ope:` DID)
   * finds the success record, `{ txId }` the failure record of that transaction. `{ nft }`
   * finds failure records only, possibly from an earlier transaction. A failure is
   * `valid: false`, or `valid: true` with an error (a DDO dropped at the database write),
   * so treat any non-blank `error` as a failure too.
   */
  async getIndexingState(
    query: IndexingStateQuery,
    signal?: AbortSignal
  ): Promise<IndexingState | undefined> {
    return this.readIndexingState(query, signal, DEFAULT_REQUEST_TIMEOUT_MS)
  }

  private async readIndexingState(
    query: IndexingStateQuery,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<IndexingState | undefined> {
    if (!isHttpUri(this.nodeUri))
      throw new OceanNodeError(
        'getIndexingState',
        'the indexing state is only served over HTTP; this client uses a P2P node URI'
      )

    const [key, value] = normalizeStateQuery(query)

    const url = `${this.nodeUri.replace(/\/+$/, '')}/api/aquarius/state/ddo?${key}=${encodeURIComponent(value)}`

    const response = await attempt('getIndexingState', () =>
      this.getPublic(url, timeoutMs, signal)
    ).catch((error) => {
      // Like the other calls: an abort rejects with the signal's own reason.
      if (signal?.aborted) throw signal.reason
      throw error
    })

    if (response.status === 404) return undefined

    if (isRateLimited(response))
      throw new NodeRateLimitedError('getIndexingState', response)

    if (!response.ok)
      throw new OceanNodeError(
        'getIndexingState',
        `${response.status} ${response.statusText} ${response.body.slice(0, 200)}`.trim()
      )

    let state: IndexingState
    try {
      state = JSON.parse(response.body) as IndexingState
    } catch (error) {
      throw new OceanNodeError(
        'getIndexingState',
        'the node answered with something that is not JSON',
        error
      )
    }

    if (!state || typeof state !== 'object' || typeof state.valid !== 'boolean')
      throw new OceanNodeError(
        'getIndexingState',
        `the node answered with something that is not an indexing state record: ${JSON.stringify(state)?.slice(0, 200)}`
      )

    return state
  }

  /** Raw metadata query. Note the endpoint-path caveat in the module docs of `../index`. */
  async query(query: SearchQuery, signal?: AbortSignal): Promise<unknown> {
    return attempt('query', () => this.aquarius.querySearch(query, signal))
  }

  /** Resolves many DIDs in one query, keyed by lower-cased DID. */
  async resolveMany(dids: string[]): Promise<Record<string, AssetV5>> {
    if (!dids.length) return {}

    const response = (await this.query({
      query: {
        bool: {
          filter: [{ ids: { values: dids.map((d) => d.toLowerCase()) } }]
        }
      },
      size: dids.length
    })) as { hits?: { hits?: { _source?: AssetV5 }[] } }

    const assets: Record<string, AssetV5> = {}

    for (const hit of response?.hits?.hits || []) {
      const asset = hit._source
      if (asset?.id) assets[asset.id.toLowerCase()] = asset
    }

    return assets
  }

  /**
   * Asks the node to validate a DDO and return its authoritative metadata hash.
   *
   * Only needed when writing the DDO itself on chain. Nautilus publishes a signed
   * `{remote}` pointer and computes that hash client-side, so this is here for callers
   * who need the node-validated hash instead. `Aquarius.validate` logs and returns
   * `undefined` on failure, which is normalized to a throw.
   */
  async validateRemote(
    ddo: unknown,
    signal?: AbortSignal
  ): Promise<ValidateMetadata> {
    const result = await attempt('validate', () =>
      this.aquarius.validate(
        // biome-ignore lint/suspicious/noExplicitAny: ocean.js types this parameter as the v4 DDO
        ddo as any,
        this.requireSigner(),
        this.nodeUri,
        signal
      )
    )

    if (!result?.valid || !result.hash)
      throw new OceanNodeError(
        'validate',
        'the node did not return a metadata hash; the DDO was rejected'
      )

    return result
  }

  // #endregion

  // #region files and encryption

  /** `true` if the URI answers as an ocean-node. Memoized per URI for the process. */
  async isValidNode(uri: string = this.nodeUri): Promise<boolean> {
    const cached = OceanNodeClient.validityCache.get(uri)
    if (cached) return cached

    const probe = ProviderInstance.isValidProvider(uri).catch(() => false)
    OceanNodeClient.validityCache.set(uri, probe)

    return probe
  }

  /** Clears the memoized node probes. Only needed in tests. */
  static clearValidityCache(): void {
    OceanNodeClient.validityCache.clear()
  }

  /**
   * @param nodeUri the node to ask. Defaults to the configured one, but a service must be
   * checked against the node it advertises — that is the node that has to read the file at
   * consume time. Another node gets the client's transport rule: a plain `http://` URI on a
   * non-loopback host throws an `OceanNodeError` unless `allowInsecureTransport`, since the
   * plaintext file object (URLs, headers) goes to it.
   */
  async getFileInfo(
    file: StorageObject,
    withChecksum = false,
    signal?: AbortSignal,
    nodeUri: string = this.nodeUri
  ): Promise<FileInfo[]> {
    if (nodeUri !== this.nodeUri) this.assertTransport('getFileInfo', nodeUri)

    return attempt('getFileInfo', () =>
      ProviderInstance.getFileInfo(file, nodeUri, withChecksum, signal)
    )
  }

  /** File info for an already-published service, used to derive algorithm checksums. */
  async checkDidFiles(
    did: string,
    serviceId: string,
    withChecksum = true,
    signal?: AbortSignal
  ): Promise<FileInfo[]> {
    return attempt('checkDidFiles', () =>
      ProviderInstance.checkDidFiles(
        did,
        serviceId,
        this.nodeUri,
        withChecksum,
        signal
      )
    )
  }

  /**
   * Node-side encryption, used for service file objects and for the on-chain metadata.
   * Unlike ocean.js 3.x this requires auth, so the client's signer/token is passed through.
   */
  /**
   * @param nodeUri the node that performs the encryption. Defaults to the configured one.
   *
   * Node encryption keys are node-local, so a service's file object must be encrypted by
   * the node in its own `serviceEndpoint` — ciphertext from any other node is one the
   * advertised node cannot decrypt, and the published service is simply unusable.
   *
   * When `auth` is a JWT rather than a Signer it was minted for one node and another will
   * reject it; pass a Signer if services point at nodes other than the configured one.
   *
   * Another `nodeUri` gets the client's transport rule: a plain `http://` URI on a
   * non-loopback host throws an `OceanNodeError` unless `allowInsecureTransport`, since the
   * plaintext and the signed command go to it.
   *
   * Throws an `OceanNodeError` unless the node answers with `0x`-prefixed hex ciphertext,
   * after one retry when the node rejected the nonce. Calls are serialized per client. Each
   * call, its retry included, has `requestTimeoutMs` (default 120 s) and then throws an
   * `OceanNodeError`; the time it waits in the queue does not count. Aborting `signal`, while
   * queued or running, rejects with the signal's reason.
   */
  async encrypt(
    data: unknown,
    policyServer?: PolicyServerArg,
    signal?: AbortSignal,
    nodeUri: string = this.nodeUri
  ): Promise<string> {
    if (nodeUri !== this.nodeUri) this.assertTransport('encrypt', nodeUri)

    return this.serializeSigned('encrypt', signal, async (callSignal) => {
      const first = await this.encryptOnce(
        data,
        policyServer,
        callSignal,
        nodeUri
      )
      if ('ciphertext' in first) return first.ciphertext

      // ocean.js reads a fresh nonce on every call, so one retry gets past a nonce another
      // request for this address used in between. A pre-computed signature carries a fixed
      // nonce and a JWT carries none: retrying either would fail the same way.
      if (
        !isSigner(this.auth) ||
        callSignal.aborted ||
        !NONCE_REJECTED.test(first.error.message)
      )
        throw first.error

      const second = await this.encryptOnce(
        data,
        policyServer,
        callSignal,
        nodeUri
      )
      if ('ciphertext' in second) return second.ciphertext

      throw second.error
    })
  }

  /**
   * One encrypt call, with its result checked. ocean.js 9.2 returns the HTTP body without
   * looking at the status, so a rejection (`401 nonce: 1 is not a valid nonce`) comes back
   * as if it were ciphertext. On success ocean-node answers `0x` + the hex of the
   * ciphertext (`EncryptHandler`), so anything else is the node's error message.
   */
  private async encryptOnce(
    data: unknown,
    policyServer: PolicyServerArg,
    signal: AbortSignal | undefined,
    nodeUri: string
  ): Promise<{ ciphertext: string } | { error: OceanNodeError }> {
    let result: unknown
    try {
      result = await ProviderInstance.encrypt(
        data,
        this.chainId,
        nodeUri,
        this.auth,
        policyServer ?? undefined,
        signal
      )
    } catch (error) {
      return {
        error: new OceanNodeError(
          'encrypt',
          error instanceof Error ? error.message : String(error),
          error
        )
      }
    }

    if (!result || result === '0x')
      return {
        error: new OceanNodeError(
          'encrypt',
          'the node returned an empty ciphertext'
        )
      }

    if (typeof result === 'string' && isHexString(result, true))
      return { ciphertext: result }

    return {
      error: new OceanNodeError(
        'encrypt',
        `the node did not return ciphertext: ${boundedNodeMessage(result)}`
      )
    }
  }

  /**
   * Runs signed commands of this client one at a time.
   *
   * With a Signer, ocean.js reads the address's nonce from the node and signs nonce + 1 on
   * every call. Two calls in flight read the same nonce, and the node rejects the second
   * (`nonce: N is not a valid nonce`). Publishing an asset encrypts all its services' files
   * at once, so this happens on every multi-service publish. JWT and pre-computed
   * signature auth need no queue.
   *
   * Every call runs under `withRequestTimeout`, so a call that hangs gives up its place
   * after `requestTimeoutMs`. A queued call whose `signal` aborts leaves the queue at once;
   * the calls behind it still wait for the ones before it.
   */
  private serializeSigned<T>(
    operation: string,
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason)

    const run = () => this.withRequestTimeout(operation, signal, fn)

    if (!isSigner(this.auth)) return run()

    const previous = this.signedQueue
    const task = untilSettled(previous, signal).then(run)
    // Neither a failed, timed-out or aborted call nor its rejection holds up the queue.
    this.signedQueue = Promise.all([previous, task.catch(() => undefined)])

    return task
  }

  /**
   * Runs `fn` with a signal that aborts when `signal` does or after `requestTimeoutMs`, and
   * settles as soon as it aborts, even when `fn` does not honour the signal. Rejects with
   * `signal.reason` when the caller aborted, or an `OceanNodeError` on timeout.
   */
  private async withRequestTimeout<T>(
    operation: string,
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (signal?.aborted) throw signal.reason

    const timeoutMs = this.requestTimeoutMs
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

    let onAbort = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(
          signal?.aborted
            ? signal.reason
            : new OceanNodeError(
                operation,
                `timed out after ${timeoutMs} ms (requestTimeoutMs)`
              )
        )
      combined.addEventListener('abort', onAbort, { once: true })
    })

    try {
      return await Promise.race([fn(combined), aborted])
    } finally {
      combined.removeEventListener('abort', onAbort)
    }
  }

  // #endregion

  // #region access

  /** Provider fees and any reusable order for a service. */
  async initialize(
    did: string,
    serviceId: string,
    options: {
      fileIndex?: number
      consumerAddress?: string
      userdata?: UserCustomParameters
      computeEnv?: string
      validUntil?: number
      signal?: AbortSignal
    } = {}
  ): Promise<ProviderInitialize> {
    const consumerAddress =
      options.consumerAddress || (await this.getConsumerAddress())

    const result = await attempt('initialize', () =>
      ProviderInstance.initialize(
        did,
        serviceId,
        options.fileIndex ?? 0,
        consumerAddress,
        this.nodeUri,
        options.signal,
        options.userdata,
        options.computeEnv,
        options.validUntil
      )
    )

    if (!result)
      throw new OceanNodeError(
        'initialize',
        `the node did not advertise an initialize endpoint for ${did}`
      )

    return result
  }

  /**
   * Builds the one-time download URL. `policyServer` carries the policy-server session id
   * when the node checks the service's credentials.
   */
  async getDownloadUrl(
    did: string,
    serviceId: string,
    transferTxId: string,
    options: {
      fileIndex?: number
      policyServer?: PolicyServerArg
      userdata?: UserCustomParameters
    } = {}
  ): Promise<string> {
    const url = await attempt('getDownloadUrl', () =>
      ProviderInstance.getDownloadUrl(
        did,
        serviceId,
        options.fileIndex ?? 0,
        transferTxId,
        this.nodeUri,
        this.auth,
        options.policyServer ?? undefined,
        options.userdata
      )
    )

    if (!url)
      throw new OceanNodeError(
        'getDownloadUrl',
        'the node returned no download URL'
      )

    return typeof url === 'string'
      ? url
      : (url as DownloadResponse as unknown as string)
  }

  // #endregion

  // #region compute

  async getComputeEnvironments(
    signal?: AbortSignal
  ): Promise<ComputeEnvironment[]> {
    const environments = await attempt('getComputeEnvironments', () =>
      ProviderInstance.getComputeEnvironments(this.nodeUri, signal)
    )

    return environments || []
  }

  async initializeCompute(params: {
    datasets: ComputeAsset[]
    algorithm: ComputeAlgorithm
    computeEnv: string
    paymentToken: string
    validUntil: number
    resources: ComputeResourceRequest[]
    consumerAddress?: string
    policyServer?: PolicyServerArg
    queueMaxWaitTime?: number
    output?: ComputeOutput
    signal?: AbortSignal
  }): Promise<ProviderComputeInitializeResults> {
    const consumerAddress =
      params.consumerAddress || (await this.getConsumerAddress())

    const result = await attempt('initializeCompute', () =>
      ProviderInstance.initializeCompute(
        params.datasets,
        params.algorithm,
        params.computeEnv,
        params.paymentToken,
        params.validUntil,
        this.nodeUri,
        consumerAddress,
        params.resources,
        this.chainId,
        params.policyServer ?? undefined,
        params.signal,
        params.queueMaxWaitTime,
        undefined,
        params.output
      )
    )

    if (!result)
      throw new OceanNodeError(
        'initializeCompute',
        'the node returned no init result'
      )

    return result
  }

  async computeStart(params: {
    computeEnv: string
    datasets: ComputeAsset[]
    algorithm: ComputeAlgorithm
    maxJobDuration: number
    paymentToken: string
    resources: ComputeResourceRequest[]
    metadata?: ComputeJobMetadata
    additionalViewers?: string[]
    output?: ComputeOutput
    policyServer?: PolicyServerArg
    queueMaxWaitTime?: number
    outputBucketId?: string
    signal?: AbortSignal
  }): Promise<NodeComputeJob[]> {
    const jobs = await attempt('computeStart', () =>
      ProviderInstance.computeStart(
        this.nodeUri,
        this.auth,
        params.computeEnv,
        params.datasets,
        params.algorithm,
        params.maxJobDuration,
        params.paymentToken,
        params.resources,
        this.chainId,
        params.metadata,
        params.additionalViewers,
        params.output,
        params.policyServer ?? undefined,
        params.signal,
        params.queueMaxWaitTime,
        undefined,
        params.outputBucketId
      )
    )

    return toJobArray('computeStart', jobs).map(withQualifiedJobId)
  }

  /** Free compute: no order, no escrow, no payment token. Gated by `env.free`. */
  async freeComputeStart(params: {
    computeEnv: string
    datasets: ComputeAsset[]
    algorithm: ComputeAlgorithm
    resources?: ComputeResourceRequest[]
    metadata?: ComputeJobMetadata
    additionalViewers?: string[]
    output?: ComputeOutput
    policyServer?: PolicyServerArg
    queueMaxWaitTime?: number
    outputBucketId?: string
    signal?: AbortSignal
  }): Promise<NodeComputeJob[]> {
    const jobs = await attempt('freeComputeStart', () =>
      ProviderInstance.freeComputeStart(
        this.nodeUri,
        this.auth,
        params.computeEnv,
        params.datasets,
        params.algorithm,
        params.resources,
        params.metadata,
        params.additionalViewers,
        params.output,
        params.policyServer ?? undefined,
        params.signal,
        params.queueMaxWaitTime,
        undefined,
        params.outputBucketId
      )
    )

    return toJobArray('freeComputeStart', jobs).map(withQualifiedJobId)
  }

  /**
   * Jobs of this client's consumer, with ids in the `<environmentHash>-<jobId>` form.
   *
   * With a `jobId`, which must be in that form, the node answers with that job only.
   * Without one, it lists every job of the consumer, or of `agreementId`.
   */
  async computeStatus(
    jobId?: string,
    agreementId?: string,
    signal?: AbortSignal
  ): Promise<NodeComputeJob[]> {
    if (jobId !== undefined) assertQualifiedJobId(jobId)

    const status = await attempt('computeStatus', () =>
      ProviderInstance.computeStatus(
        this.nodeUri,
        this.auth,
        jobId,
        agreementId,
        signal
      )
    )

    const jobs = Array.isArray(status) ? status : status ? [status] : []

    return jobs.map(withQualifiedJobId)
  }

  /**
   * Status of one job, or `undefined` if the node does not know it.
   *
   * @param jobId `<environmentHash>-<jobId>`, as `computeStart` returns it
   */
  async getComputeJob(
    jobId: string,
    signal?: AbortSignal
  ): Promise<NodeComputeJob | undefined> {
    const jobs = await this.computeStatus(jobId, undefined, signal)

    return jobs.find((job) => job.jobId === jobId)
  }

  async computeStop(
    jobId: string,
    agreementId?: string,
    signal?: AbortSignal
  ): Promise<NodeComputeJob[]> {
    assertQualifiedJobId(jobId)

    const jobs = await attempt('computeStop', () =>
      ProviderInstance.computeStop(
        jobId,
        this.nodeUri,
        this.auth,
        agreementId,
        signal
      )
    )

    return toJobArray('computeStop', jobs).map(withQualifiedJobId)
  }

  async getComputeResultUrl(jobId: string, index: number): Promise<string> {
    assertQualifiedJobId(jobId)
    assertResultIndex(index)

    const url = await attempt('getComputeResultUrl', () =>
      ProviderInstance.getComputeResultUrl(
        this.nodeUri,
        this.auth,
        jobId,
        index
      )
    )

    if (!url)
      throw new OceanNodeError(
        'getComputeResultUrl',
        'the node returned no result URL'
      )

    return url
  }

  /** Streams a result instead of handing back a URL. */
  async getComputeResult(
    jobId: string,
    index: number,
    offset = 0
  ): Promise<ComputeResultStream> {
    assertQualifiedJobId(jobId)
    assertResultIndex(index)

    return attempt('getComputeResult', () =>
      ProviderInstance.getComputeResult(
        this.nodeUri,
        this.auth,
        jobId,
        index,
        offset
      )
    )
  }

  /**
   * Streams a running job's algorithm output. The node serves these logs only while the
   * algorithm runs; a finished job's are in its `algorithmLog` result.
   *
   * Treat the job id as a secret: ocean-node 4.2.2 checks the request's signature but not
   * that the signer owns the job, so anyone who has the id can stream a running job's logs.
   */
  async getComputeLogs(
    jobId: string,
    signal?: AbortSignal
  ): Promise<ComputeResultStream> {
    assertQualifiedJobId(jobId)

    const logs: ComputeResultStream | null = await attempt(
      'computeStreamableLogs',
      () =>
        ProviderInstance.computeStreamableLogs(
          this.nodeUri,
          this.auth,
          jobId,
          signal
        )
    )

    if (!logs)
      throw new OceanNodeError(
        'computeStreamableLogs',
        'the node returned no logs for the job'
      )

    return logs
  }

  // #endregion

  // #region policy server

  /**
   * Whether the node has a policy server: `isPSConfigured` from its status, or what an
   * `initiate` through this client showed. `undefined` when neither has said: the status
   * cannot be read, or does not say, as on upstream ocean-node 4.2.0, which does not
   * report `isPSConfigured`.
   *
   * A "yes" is kept for the lifetime of this client (the node reads its `POLICY_SERVER_URL`
   * once, at startup), even past an `initiate` answered without one; a "no" for 10
   * minutes, so a node restarted with a policy server is found; a failed read is not kept,
   * so the next call asks again. Rejects with the signal's reason when `signal` aborts.
   */
  async hasPolicyServer(signal?: AbortSignal): Promise<boolean | undefined> {
    const known = this.knownPolicyServer()
    if (known !== undefined) return known

    let status: unknown
    try {
      status = await this.getNodeStatus(signal)
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      LoggerInstance.debug(
        `[ocean-node] could not read the status of ${this.nodeUri}: ${errorMessage(error)}`
      )
      return undefined
    }

    const configured = (status as { isPSConfigured?: unknown } | null)
      ?.isPSConfigured
    if (typeof configured !== 'boolean') return undefined

    this.rememberPolicyServer(configured)

    return configured
  }

  /** The kept `hasPolicyServer` answer, while it holds. */
  private knownPolicyServer(): boolean | undefined {
    const known = this.policyServerAnswer
    if (known && Date.now() < known.until) return known.configured

    this.policyServerAnswer = undefined
    return undefined
  }

  private rememberPolicyServer(configured: boolean): void {
    this.policyServerAnswer = {
      configured,
      until: configured
        ? Number.POSITIVE_INFINITY
        : Date.now() + NO_POLICY_SERVER_TTL_MS
    }
  }

  /** An opened session, which shows the node has a policy server. */
  private opened(reply: PolicyServerReply): PolicyServerReply {
    this.rememberPolicyServer(true)

    return reply
  }

  /**
   * An `initiate` answered as a node without a policy server does: `null`, remembered for
   * `hasPolicyServer` when nothing else was known.
   *
   * Also `null` when this client knew the node to have one, but then the "yes" is kept, so
   * the next call opens a session again: OceanProtocolEnterprise ocean-node reports
   * `isPSConfigured` for a `POLICY_SERVER_URL` that is set but empty, as its
   * `.env.node.example` ships it, and such a node grants every request without a session
   * (warned about once); a policy server behind a proxy that failed for a moment must not
   * lose its sessions for long.
   */
  private noPolicyServer(): null {
    if (!this.knownPolicyServer()) {
      this.rememberPolicyServer(false)
      return null
    }

    warnOnce(
      `empty-policy-server-url:${normalizeNodeUri(this.nodeUri)}`,
      `${this.nodeUri} reported a policy server but answers as a node without one: its POLICY_SERVER_URL is likely set but empty, and it then checks no credentials at all.`
    )

    return null
  }

  /**
   * The address a policy-server session opened through this client is bound to, for the
   * caller's `consumerAddress` (`signer.getAddress()`). Pass it to
   * `initializePolicyVerification` and key a session cache on it.
   *
   * The policy server hashes the address the node forwards into the session id, and the
   * node checks the session against the address of the download or compute call. The node
   * forwards the address it authenticated (ocean-node `Auth`): for a Signer, the request's,
   * so `consumerAddress` as given; for a JWT, the address stored with the token, whatever
   * the request says, and ocean.js sends that one with the download too; for a pre-computed
   * signature, its own `consumerAddress`. A JWT whose payload does not decode leaves
   * `consumerAddress` as given.
   */
  policySessionAddress(consumerAddress: string): string {
    const auth = this.auth

    if (isAuthToken(auth)) return authTokenAddress(auth) ?? consumerAddress
    if (isCompleteSignature(auth)) return auth.consumerAddress

    return consumerAddress
  }

  /**
   * Starts a policy-server verification for one service (the policy server's `initiate`)
   * and returns its answer, `{ success: true, message: { sessionId, redirectUri } }`.
   *
   * `null` when the node has no policy server, and needs no session: ocean-node answers
   * `initiate` with a 404 and no body (over P2P, a bare `{"httpStatus":404}`) when its
   * `POLICY_SERVER_URL` is unset or empty, and neither the node's own errors nor the policy
   * server's answer that way. `hasPolicyServer` remembers it, as it remembers an opened
   * session's "yes": upstream ocean-node 4.2.0 does not report `isPSConfigured`, so this is
   * how a node like it is told apart.
   *
   * Throws a `PolicyDeniedError` only for the policy server's own refusal: a reply with
   * `success: false` and a 4xx `httpStatus`. Everything else throws an `OceanNodeError` with
   * the status: the node's own 401 (a rejected nonce or signature, "Auth not configured"),
   * its 404 for an asset it has not indexed (`Not found`), its 400 when it cannot reach
   * the policy server, a rate limit, a 5xx, a network error, a timeout, and an answer that
   * is not a policy-server reply. With a Signer, a rejected nonce is retried once, as
   * `encrypt` does. Calls are serialized with this client's other signed commands, and each
   * call, its retry included, has `requestTimeoutMs`.
   *
   * Over HTTP nautilus signs and sends the command itself, the way ocean.js signs it
   * (`consumerAddress + (stored nonce + 1) + "PolicyServerInitialize"`, or the JWT as
   * `Authorization`), because ocean.js 9.2 loses the node's own errors: on a failed answer
   * it throws `JSON.stringify(await response.json())`. That keeps the policy server's reply,
   * which is JSON and carries its `httpStatus`, but the node answers its own errors in plain
   * text, so `response.json()` throws a `SyntaxError` instead and the status and the text
   * are gone, the rejected nonce among them. Over P2P ocean.js keeps the node's text
   * (`P2P command error: …`), so the command goes through it.
   */
  async initializePolicyVerification(
    request: PolicyVerificationRequest,
    signal?: AbortSignal
  ): Promise<PolicyServerReply | null> {
    return this.serializeSigned(
      'initializePolicyVerification',
      signal,
      async (callSignal) => {
        try {
          return await this.initiateOnce(request, callSignal)
        } catch (error) {
          // A fresh nonce is read on every call, so one retry gets past a nonce another
          // request for this address used in between. A pre-computed signature carries a
          // fixed nonce and a JWT none: retrying either would fail the same way.
          if (
            !isSigner(this.auth) ||
            callSignal.aborted ||
            !(error instanceof OceanNodeError) ||
            !NONCE_REJECTED.test(error.message)
          )
            throw error

          return this.initiateOnce(request, callSignal)
        }
      }
    )
  }

  /** One `initiate`, see `initializePolicyVerification`. */
  private async initiateOnce(
    request: PolicyVerificationRequest,
    signal: AbortSignal
  ): Promise<PolicyServerReply | null> {
    const operation = 'initializePolicyVerification'

    const failure = (
      reply: PolicyServerReply | undefined,
      message: string,
      cause?: unknown
    ) =>
      reply && isPolicyRefusal(reply)
        ? new PolicyDeniedError({
            nodeUri: this.nodeUri,
            did: request.documentId,
            serviceId: request.serviceId,
            consumerAddress: request.consumerAddress,
            code: reply.httpStatus,
            reason: policyServerReason(reply)
          })
        : new OceanNodeError(operation, message, cause)

    if (!isHttpUri(this.nodeUri)) {
      let reply: PolicyServerReply | undefined
      try {
        reply = (await ProviderInstance.initializePSVerification(
          this.nodeUri,
          this.auth,
          request,
          signal
        )) as PolicyServerReply | undefined
      } catch (error) {
        if (isP2pNoPolicyServer(error)) return this.noPolicyServer()

        throw failure(
          policyServerReplyIn(error),
          boundedNodeMessage(errorMessage(error)),
          error
        )
      }

      if (reply?.success === true) return this.opened(reply)

      throw failure(
        reply,
        `the node answered with something other than an opened session: ${boundedNodeMessage(reply)}`
      )
    }

    let response: FetchedText
    try {
      const { nonce, signature, authorization } = await this.signCommand(
        request.consumerAddress,
        POLICY_SERVER_INITIALIZE,
        signal
      )

      response = await fetchText(
        fetch,
        `${this.nodeUri.replace(/\/+$/, '')}/api/services/initializePSVerification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authorization ? { Authorization: authorization } : {})
          },
          body: JSON.stringify({ ...request, nonce, signature })
        },
        {
          timeoutMs: this.requestTimeoutMs,
          signal,
          maxBodyBytes: MAX_POLICY_REPLY_BYTES
        }
      )
    } catch (error) {
      throw new OceanNodeError(operation, errorMessage(error), error)
    }

    // Exactly empty: the node's own 404 says `Not found`, the policy server's is JSON.
    if (response.status === 404 && response.body === '')
      return this.noPolicyServer()

    const reply = parsePolicyServerReply(response.body)
    if (response.ok && reply?.success === true) return this.opened(reply)

    throw failure(
      reply,
      `${response.status} ${response.statusText} ${boundedNodeMessage(response.body)}`.trim()
    )
  }

  /**
   * Asks the policy server whether the presentation for a session was verified
   * (`checkSessionId`, through the node's passthrough), and returns the verifier's
   * per-policy results only.
   *
   * The policy server answers an unverified session with an error status and the
   * verifier's record; that comes back here as `verified: false`, not as a throw. A node or
   * policy server that answers anything else throws an `OceanNodeError`.
   *
   * Over HTTP the request is sent by nautilus, with a bounded read: ocean.js would log the
   * body of the error answer, which holds the presentation (`vp_token`).
   */
  async checkPolicySession(
    sessionId: string,
    signal?: AbortSignal
  ): Promise<PolicySessionCheck> {
    const operation = 'checkPolicySession'
    const command = {
      policyServerPassthrough: {
        action: PolicyServerAction.CHECK_SESSION_ID,
        sessionId
      }
    }

    let reply: PolicyServerReply | undefined
    let failed: string | undefined

    if (isHttpUri(this.nodeUri)) {
      let response: FetchedText
      try {
        response = await fetchText(
          fetch,
          `${this.nodeUri.replace(/\/+$/, '')}/api/services/PolicyServerPassthrough`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command)
          },
          {
            timeoutMs: this.requestTimeoutMs,
            signal,
            maxBodyBytes: MAX_POLICY_REPLY_BYTES
          }
        )
      } catch (error) {
        if (signal?.aborted) throw signal.reason
        throw new OceanNodeError(operation, errorMessage(error), error)
      }

      reply = parsePolicyServerReply(response.body)
      if (!response.ok)
        failed = `${response.status} ${response.statusText}`.trim()
    } else {
      try {
        reply = (await ProviderInstance.PolicyServerPassthrough(
          this.nodeUri,
          command,
          signal
        )) as PolicyServerReply | undefined
      } catch (error) {
        if (signal?.aborted) throw signal.reason

        reply = policyServerReplyIn(error)
        if (!reply)
          throw new OceanNodeError(
            operation,
            boundedNodeMessage(errorMessage(error))
          )
        failed = 'the policy server refused'
      }
    }

    const record = reply?.message

    if (isSessionRecord(record))
      return {
        verified:
          !failed &&
          (record as { verificationResult?: unknown }).verificationResult ===
            true,
        policyResults: readPolicyResults(record)
      }

    if (failed || reply?.success !== true)
      throw new OceanNodeError(
        operation,
        boundedNodeMessage(
          `${failed ?? ''} ${reply ? policyServerReason(reply) : 'the answer is not a policy-server reply'}`
        )
      )

    return { verified: false, policyResults: [] }
  }

  /**
   * The `nonce` and `signature` ocean-node checks on a signed command, the way ocean.js
   * makes them: a Signer signs `consumerAddress + (stored nonce + 1) + command`, a
   * pre-computed signature is sent as it is, and a JWT goes in `Authorization` instead.
   */
  private async signCommand(
    consumerAddress: string,
    command: string,
    signal: AbortSignal
  ): Promise<{ nonce?: string; signature?: string; authorization?: string }> {
    const auth = this.auth

    if (isAuthToken(auth)) return { authorization: auth }
    if (isCompleteSignature(auth))
      return { nonce: auth.nonce, signature: auth.signature }

    const nonce = String(
      (await ProviderInstance.getNonce(this.nodeUri, consumerAddress, signal)) +
        1
    )
    const signature = await signRequest(
      auth,
      `${consumerAddress}${nonce}${command}`
    )

    if (!signature) throw new Error(`could not sign the ${command} command`)

    return { nonce, signature }
  }

  /** Forwards an action to the policy server through the node. */
  async policyServerPassthrough(
    action: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return attempt('PolicyServerPassthrough', () =>
      ProviderInstance.PolicyServerPassthrough(
        this.nodeUri,
        { policyServerPassthrough: action },
        signal
      )
    )
  }

  // #endregion

  // #region node

  async getNodeStatus(signal?: AbortSignal): Promise<NodeStatus> {
    return attempt('getNodeStatus', () =>
      ProviderInstance.getNodeStatus(this.nodeUri, signal)
    )
  }

  // #endregion

  // #region persistent storage

  async createBucket(
    accessLists: Parameters<
      typeof ProviderInstance.createPersistentStorageBucket
    >[2]['accessLists'],
    label?: string
  ): Promise<string> {
    const bucket = await attempt('createPersistentStorageBucket', () =>
      ProviderInstance.createPersistentStorageBucket(this.nodeUri, this.auth, {
        accessLists,
        label
      })
    )

    if (!bucket?.bucketId)
      throw new OceanNodeError(
        'createPersistentStorageBucket',
        'no bucketId returned'
      )

    return bucket.bucketId
  }

  async uploadFile(
    bucketId: string,
    fileName: string,
    content: Parameters<typeof ProviderInstance.uploadPersistentStorageFile>[4]
  ): Promise<PersistentStorageFileEntry> {
    return attempt('uploadPersistentStorageFile', () =>
      ProviderInstance.uploadPersistentStorageFile(
        this.nodeUri,
        this.auth,
        bucketId,
        fileName,
        content
      )
    )
  }

  async getFileObject(
    bucketId: string,
    fileName: string
  ): Promise<StorageObject> {
    return attempt('getPersistentStorageFileObject', () =>
      ProviderInstance.getPersistentStorageFileObject(
        this.nodeUri,
        this.auth,
        bucketId,
        fileName
      )
    ) as Promise<StorageObject>
  }

  // #endregion
}

function toJobArray(
  operation: string,
  jobs: ComputeJob | ComputeJob[]
): NodeComputeJob[] {
  if (!jobs)
    throw new OceanNodeError(operation, 'the node returned no compute job')

  return Array.isArray(jobs) ? jobs : [jobs]
}
