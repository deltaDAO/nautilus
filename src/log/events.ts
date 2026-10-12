import type { LogLevelName } from './levels.js'

/**
 * The part of nautilus an event comes from. `config` is nautilus's own setup (the logging
 * environment variables); `oceanjs` is ocean.js's own log lines, captured
 * (`configureLogging({ oceanjs })`).
 */
export type LogComponent =
  | 'publish'
  | 'edit'
  | 'access'
  | 'compute'
  | 'lifecycle'
  | 'node'
  | 'chain'
  | 'store'
  | 'identity'
  | 'config'
  | 'oceanjs'

/** Every component, in the order above. */
export const LOG_COMPONENTS: readonly LogComponent[] = [
  'publish',
  'edit',
  'access',
  'compute',
  'lifecycle',
  'node',
  'chain',
  'store',
  'identity',
  'config',
  'oceanjs'
]

/** What the catalogue says about one event. */
export interface LogEventSpec {
  level: LogLevelName
  component: LogComponent
  /** One sentence: when the event is emitted and what it means. */
  description: string
  /** The `fields` it carries, besides `did`, `txHash` and `durationMs`. */
  fields?: readonly string[]
  /** Emitted at most once per process (or per instance logger) for the same subject. */
  once?: boolean
}

/**
 * Every event nautilus logs. The name (`component.step.outcome`) is stable: filter and
 * alert on it, not on the message, which may change. Each event has one level and one
 * component; the catalogue is the single source of both, and of the reference page.
 */
export const LOG_EVENTS = {
  // config
  'config.env.invalid': {
    level: 'warn',
    component: 'config',
    description:
      'A NAUTILUS_LOG_* or NAUTILUS_DEBUG* environment variable has a value nautilus does not know. It is ignored, and the default (or the configured value) stays.',
    fields: ['variable', 'value', 'allowed'],
    once: true
  },

  // chain
  'chain.config.ready': {
    level: 'debug',
    component: 'chain',
    description:
      'Nautilus.create() resolved the chain config: the chain id and the ocean-node.',
    fields: ['chainId', 'nodeUri']
  },
  'chain.config.no_defaults': {
    level: 'debug',
    component: 'chain',
    description:
      'ocean.js ships no config for the chain, so only the config passed to Nautilus.create() is used.',
    fields: ['chainId']
  },

  'chain.nonce.resending': {
    level: 'warn',
    component: 'chain',
    description:
      'A transaction was refused for its nonce (a collision with another send of the same key, or a stale nonce from the RPC) and the chain does not have it: the nonce guard sends the same transaction again with the nonce in nextNonce. A transaction that moves value is sent again only once it is proven, through the verificationProvider as well, that it can never be mined (on both RPCs, another call of the account holds its nonce in the blocks since the send).',
    fields: ['address', 'txNonce', 'nextNonce', 'code']
  },
  'chain.nonce.already_sent': {
    level: 'info',
    component: 'chain',
    description:
      'A transaction was refused for its nonce, but the chain already has it by hash: the nonce guard waits for that one and sends nothing again.',
    fields: ['address', 'txNonce', 'code']
  },
  'chain.nonce.gave_up': {
    level: 'warn',
    component: 'chain',
    description:
      "The nonce guard stopped after a refusal for the nonce: it could not prove the transaction was never sent, or a resend failed for another reason (reason 'may-have-been-sent'), it was refused three times, the refusal named no transaction of this send, or the nonce was not nautilus's to set. The error says which. attemptsComplete: whether attempts lists every transaction the send may have broadcast.",
    fields: ['reason', 'code', 'attempts', 'attemptsComplete', 'moneySend']
  },
  'chain.nonce.counter_reset': {
    level: 'warn',
    component: 'chain',
    description:
      "The nonce guard's counter was ahead of the RPC's pending count, and the last transaction it counted is dropped: sent more than a minute ago, unknown by hash on two reads, and the account has not mined past its nonce. The counter falls back to the pending count.",
    fields: ['address', 'txNonce', 'pending']
  },
  'chain.send.failed': {
    level: 'debug',
    component: 'chain',
    description:
      'A send failed for a reason other than its nonce (a wallet rejection, insufficient funds, a timeout, a network error). Not retried. maySent: whether the transaction may still have reached the chain (false only for a refusal before the broadcast). confirmTransaction() names this cause when ocean.js returns no transaction and it is the only send to that contract on record.',
    fields: ['code', 'maySent']
  },

  'node.indexer_nonce.zero_byte_accepted': {
    level: 'info',
    component: 'node',
    description:
      "The node's next indexer nonce (or this publish's second decrypt nonce) hashes to a zero byte, which ocean-node before 4.2.2 refuses (a stuck indexer); the node reports 4.2.2 or later, so the publish preflight neither refuses nor warns. The version is self-reported, and only the OE fork's 4.2.2 has the fix: an upstream ocean-node with the same number would leave the asset unindexed.",
    fields: ['nodeUri', 'nodeVersion', 'nonce'],
    once: true
  },

  // publish (also edit and completePublish, which write metadata the same way)
  'publish.preflight.publisher_is_node': {
    level: 'warn',
    component: 'publish',
    description:
      "The publisher's address is the node's own. The indexer signs its decrypt calls with the same key, the nonces collide, and the asset goes on chain but is not indexed.",
    fields: ['publisher', 'nodeAddress', 'nodeUri'],
    once: true
  },
  'publish.preflight.node_address_unreadable': {
    level: 'debug',
    component: 'publish',
    description:
      "The node's address could not be read, so the publisher-is-node check was skipped.",
    fields: ['nodeUri', 'error']
  },
  'publish.preflight.denies_all': {
    level: 'warn',
    component: 'publish',
    description:
      "A node that checks this asset has a policy server, and the asset's credentials have no address allow list: the policy server will refuse every consumer. Once per node and asset: the asset's DID, or before the mint the publisher's address and the asset's name (a publisher's same-named assets warn once per node).",
    fields: ['endpoint', 'did', 'name'],
    once: true
  },
  'publish.preflight.policy_server_unknown': {
    level: 'debug',
    component: 'publish',
    description:
      'A node could not be asked whether it has a policy server, so the denies-all check skipped it.',
    fields: ['endpoint', 'error']
  },
  'publish.preflight.indexer_nonce_unreadable': {
    level: 'debug',
    component: 'publish',
    description:
      "The indexer's nonce could not be read, so the stuck-nonce check was skipped.",
    fields: ['nodeUri', 'error']
  },
  'publish.preflight.indexer_nonce_will_stick': {
    level: 'warn',
    component: 'publish',
    description:
      "The indexer's second decrypt call for this asset will be signed with a nonce the node does not accept: unless another decrypt moves the nonce first, the asset will not be indexed and the indexer nonce will be stuck. Once per node and nonce.",
    fields: ['nodeUri', 'decryptNonce'],
    once: true
  },
  'publish.preflight.pending_unreadable': {
    level: 'warn',
    component: 'publish',
    description:
      "completePublish() could not read the signer's pending transaction count, so it cannot tell whether an earlier metadata transaction is still pending. It goes on.",
    fields: ['nftAddress', 'error']
  },
  'publish.tokens.created': {
    level: 'debug',
    component: 'publish',
    description: 'The NFT and its first datatoken were created.',
    fields: ['nftAddress', 'datatokenAddress']
  },
  'publish.metadata.sending': {
    level: 'debug',
    component: 'publish',
    description: 'The metadata transaction is about to be sent.',
    fields: ['nftAddress', 'lifecycleState', 'flags']
  },
  'publish.metadata.nonce_refused': {
    level: 'warn',
    component: 'publish',
    description:
      'The metadata transaction was refused for its nonce and the nonce guard did not get it through. The stored envelope is removed only when proven is true: no transaction of the write is known on two reads, the account has mined past their nonces, and no metadata event carries this metadataHash; otherwise it is kept (cleanup: kept).',
    fields: ['nftAddress', 'attempts', 'proven']
  },
  'publish.metadata.replaced': {
    level: 'debug',
    component: 'publish',
    description:
      'The metadata transaction was replaced (sped up) in the wallet, and the replacement was mined.',
    fields: ['sent', 'mined']
  },
  'publish.metadata.events_unchecked': {
    level: 'warn',
    component: 'publish',
    description:
      'The block of the metadata transaction could not be checked for other metadata events on the same NFT, so a concurrent writer would go unnoticed.',
    fields: ['nftAddress', 'blockNumber', 'error']
  },

  // edit
  'edit.price.setting': {
    level: 'debug',
    component: 'edit',
    description: "editPrice() is setting the fixed-rate exchange's new rate.",
    fields: ['exchangeId', 'newPrice']
  },

  // lifecycle
  'lifecycle.state.unchanged': {
    level: 'warn',
    component: 'lifecycle',
    description:
      'setAssetLifecycleState() was asked for the state the asset is in already; nothing was sent.',
    fields: ['state']
  },

  // access (and the orders of compute)
  'access.order.lookup_failed': {
    level: 'warn',
    component: 'access',
    description:
      'The previous order could not be checked on chain (rate limit, no answer, incomplete scan or RPC error), and a new order is placed anyway: the service is free, or `orderOnLookupFailure` is set. A service that costs anything throws an `OrderCheckError` instead.',
    fields: ['datatokenAddress', 'serviceId', 'reason', 'free', 'error']
  },
  'access.order.previous_found': {
    level: 'debug',
    component: 'access',
    description: 'A previous order of the consumer was found on chain.',
    fields: ['orderTxId', 'usableTxId']
  },
  'access.order.sending': {
    level: 'debug',
    component: 'access',
    description: 'A datatoken order is about to be sent.',
    fields: ['schema', 'templateId', 'datatokenAddress', 'total']
  },
  'access.order.settled': {
    level: 'debug',
    component: 'access',
    description:
      'The order of an access() call was settled: placed, extended or reused.',
    fields: ['reused']
  },

  // compute
  'compute.environment.defaulted': {
    level: 'debug',
    component: 'compute',
    description:
      "No compute environment was given, so the node's first one is used.",
    fields: ['environmentId', 'count']
  },
  'compute.duration.capped': {
    level: 'warn',
    component: 'compute',
    description:
      "The requested maxJobDuration exceeds the environment's limit and was capped to it. Once per node, environment, requested duration and limit.",
    fields: ['requested', 'ceiling'],
    once: true
  },
  'compute.escrow.not_quoted': {
    level: 'debug',
    component: 'compute',
    description:
      'The node quoted no escrow payment, so the escrow is not funded.'
  },
  'compute.escrow.zero_quote': {
    level: 'debug',
    component: 'compute',
    description:
      'The node quoted an escrow payment of zero, so the escrow is not funded.'
  },
  'compute.escrow.deposited': {
    level: 'debug',
    component: 'compute',
    description: 'The escrow deposit for a paid job was made.',
    fields: ['paymentToken', 'amount']
  },
  'compute.job.started': {
    level: 'debug',
    component: 'compute',
    description: 'The node started the compute job(s).',
    fields: ['jobIds']
  },
  'compute.result.not_ready': {
    level: 'info',
    component: 'compute',
    description:
      'getComputeResult() found no result yet, but may later: the job has not finished or not listed its output.',
    fields: ['jobId']
  },
  'compute.result.unavailable': {
    level: 'warn',
    component: 'compute',
    description:
      'getComputeResult() found no result and will not: the node does not know the job, or the job has no such result. Once per node, job and reason.',
    fields: ['jobId'],
    once: true
  },

  // node
  'node.indexer_wait.legacy_options': {
    level: 'warn',
    component: 'node',
    description:
      'waitForIndexer() got the beta.0 options interval and maxRetries; they are mapped to intervalMs and timeoutMs for now.',
    once: true
  },
  'node.indexer_wait.rate_limited': {
    level: 'debug',
    component: 'node',
    description:
      'The node rate-limited a waitForIndexer() poll; the next poll waits longer.',
    fields: ['nodeUri', 'what', 'delayMs']
  },
  'node.status.unreadable': {
    level: 'debug',
    component: 'node',
    description:
      "The node's status could not be read, so whether it has a policy server is unknown.",
    fields: ['nodeUri', 'error']
  },
  'node.policy_server.empty_url': {
    level: 'warn',
    component: 'node',
    description:
      'The node reported a policy server but answers as a node without one: its POLICY_SERVER_URL is likely set but empty, and it checks no credentials at all.',
    fields: ['nodeUri'],
    once: true
  },

  // operations: one started and one finished or failed event per public call
  'publish.operation.started': {
    level: 'debug',
    component: 'publish',
    description:
      "A call of publish() or completePublish() started; the event's operation names the call, and its opId is on every event of the call."
  },
  'publish.operation.finished': {
    level: 'info',
    component: 'publish',
    description:
      'A call of publish() or completePublish() returned, after durationMs.'
  },
  'publish.operation.failed': {
    level: 'info',
    component: 'publish',
    description:
      'A call of publish() or completePublish() threw, after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },
  'edit.operation.started': {
    level: 'debug',
    component: 'edit',
    description:
      "A call of edit() or setServicePrice() started; the event's operation names the call, and its opId is on every event of the call."
  },
  'edit.operation.finished': {
    level: 'info',
    component: 'edit',
    description:
      'A call of edit() or setServicePrice() returned, after durationMs.'
  },
  'edit.operation.failed': {
    level: 'info',
    component: 'edit',
    description:
      'A call of edit() or setServicePrice() threw, after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },
  'lifecycle.operation.started': {
    level: 'debug',
    component: 'lifecycle',
    description:
      "A call of setAssetLifecycleState() started; the event's operation names the call, and its opId is on every event of the call."
  },
  'lifecycle.operation.finished': {
    level: 'info',
    component: 'lifecycle',
    description:
      'A call of setAssetLifecycleState() returned, after durationMs.'
  },
  'lifecycle.operation.failed': {
    level: 'info',
    component: 'lifecycle',
    description:
      'A call of setAssetLifecycleState() threw, after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },
  'access.operation.started': {
    level: 'debug',
    component: 'access',
    description:
      "A call of access() started; the event's operation names the call, and its opId is on every event of the call."
  },
  'access.operation.finished': {
    level: 'info',
    component: 'access',
    description: 'A call of access() returned, after durationMs.'
  },
  'access.operation.failed': {
    level: 'info',
    component: 'access',
    description:
      'A call of access() threw, after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },
  'compute.operation.started': {
    level: 'debug',
    component: 'compute',
    description:
      "A call of compute(), freeCompute() or stopCompute() started; the event's operation names the call, and its opId is on every event of the call."
  },
  'compute.operation.finished': {
    level: 'info',
    component: 'compute',
    description:
      'A call of compute(), freeCompute() or stopCompute() returned, after durationMs.'
  },
  'compute.operation.failed': {
    level: 'info',
    component: 'compute',
    description:
      'A call of compute(), freeCompute() or stopCompute() threw, after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },
  'compute.query.started': {
    level: 'debug',
    component: 'compute',
    description:
      "A call of getComputeStatus() or getComputeResult(), which apps poll, started; the event's operation names the call, and its opId is on every event of the call."
  },
  'compute.query.finished': {
    level: 'debug',
    component: 'compute',
    description:
      'A call of getComputeStatus() or getComputeResult(), which apps poll, returned after durationMs.'
  },
  'compute.query.failed': {
    level: 'debug',
    component: 'compute',
    description:
      'A call of getComputeStatus() or getComputeResult(), which apps poll, threw after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },
  'node.operation.started': {
    level: 'debug',
    component: 'node',
    description:
      "A call of waitForIndexer() started; the event's operation names the call, and its opId is on every event of the call."
  },
  'node.operation.finished': {
    level: 'info',
    component: 'node',
    description: 'A call of waitForIndexer() returned, after durationMs.'
  },
  'node.operation.failed': {
    level: 'info',
    component: 'node',
    description:
      'A call of waitForIndexer() threw, after durationMs; the error it threw carries the same opId (error.opId).',
    fields: ['error']
  },

  // store
  'store.s3.shared_credentials': {
    level: 'warn',
    component: 'store',
    description:
      'S3RemoteStore was given one key pair for reads and writes (allowSharedCredentials): the write key goes, node-encrypted, into every on-chain pointer.',
    fields: ['accessKeyId'],
    once: true
  },
  'store.s3.writable_read_key': {
    level: 'warn',
    component: 'store',
    description:
      "S3RemoteStore's read key can write or delete in the bucket (allowWritableReadKey).",
    fields: ['bucket', 'can'],
    once: true
  },

  // identity
  'identity.sessions.presented_persisted': {
    level: 'warn',
    component: 'identity',
    description:
      'persistPresentedSessions is on: presented policy-server sessions are kept in the sessionStore, and their ids let anyone read the presentation through the node.',
    once: true
  },

  // oceanjs: ocean.js's own lines, captured (configureLogging({ oceanjs: 'capture' }))
  'oceanjs.logger.error': {
    level: 'error',
    component: 'oceanjs',
    description:
      "ocean.js logged an error through its LoggerInstance, e.g. a refused node request or, after a refused compute start or initialize, the request payload ('Payload was:'). Redacted like every event: the nonce, signature and policy-server session ids are <redacted>. ocean.js usually throws right after; nautilus's error says what failed.",
    fields: ['method', 'args']
  },
  'oceanjs.logger.warn': {
    level: 'warn',
    component: 'oceanjs',
    description: 'ocean.js logged a warning through its LoggerInstance.',
    fields: ['method', 'args']
  },
  'oceanjs.logger.log': {
    level: 'info',
    component: 'oceanjs',
    description:
      "ocean.js logged a line through its LoggerInstance's log or bypass method. Only when ocean.js's own level is Log or Verbose (bypass: always).",
    fields: ['method', 'args']
  },
  'oceanjs.logger.debug': {
    level: 'debug',
    component: 'oceanjs',
    description:
      "ocean.js logged a debug line through its LoggerInstance, e.g. P2P dial details. Only when ocean.js's own level is Verbose.",
    fields: ['method', 'args']
  },
  'oceanjs.capture.nested_dropped': {
    level: 'warn',
    component: 'oceanjs',
    description:
      'ocean.js logged a line while nautilus was capturing one of its lines, e.g. from a sink or debug sink that logs through LoggerInstance. The nested line is dropped, not printed: printed through ocean.js it would be unredacted.',
    once: true
  },
  'oceanjs.capture.unavailable': {
    level: 'warn',
    component: 'oceanjs',
    description:
      "ocean.js's LoggerInstance is frozen, sealed or not extensible (or a method is read-only), so nautilus can't capture its lines: ocean.js prints them itself, unredacted, whatever the oceanjs mode, which reads 'passthrough'. The advice depends on the case: a frozen logger's level can't be changed after it is frozen. Logged when nautilus is imported.",
    fields: ['methods'],
    once: true
  },
  'oceanjs.capture.moved': {
    level: 'warn',
    component: 'oceanjs',
    description:
      "Another copy of nautilus in the process (e.g. one bundled into a plugin) passed oceanjs to configureLogging: it now receives ocean.js's lines, or with 'passthrough' ocean.js prints them itself, unredacted. Logged by the copy that received them until then.",
    fields: ['mode']
  }
} as const satisfies Record<string, LogEventSpec>

/** The name of a catalogued event. */
export type LogEventName = keyof typeof LOG_EVENTS

/** Whether `name` is a catalogued event. */
export function isLogEventName(name: unknown): name is LogEventName {
  return typeof name === 'string' && Object.hasOwn(LOG_EVENTS, name)
}
