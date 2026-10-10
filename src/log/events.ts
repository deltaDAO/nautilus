import type { LogLevelName } from './levels.js'

/**
 * The part of nautilus an event comes from. `config` is nautilus's own setup (the logging
 * environment variables); `oceanjs` is reserved for ocean.js's own log lines.
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
  'config.oceanjs.not_active': {
    level: 'warn',
    component: 'config',
    description:
      "configureLogging() was given an oceanjs mode ('capture', 'passthrough' or 'silent'), which a later release implements: until then ocean.js prints its own lines, unredacted, at the level LoggerInstance.setLevel() sets (errors only by default).",
    fields: ['mode'],
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

  'node.indexer_nonce.zero_byte_accepted': {
    level: 'debug',
    component: 'node',
    description:
      "The node's next indexer nonce hashes to a zero byte, which ocean-node before 4.2.2 refuses (a stuck indexer); this node's version accepts it, so the publish preflight does not refuse it.",
    fields: ['nodeUri', 'nodeVersion', 'nextNonce']
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
      'The previous order could not be looked up on chain, so a new one is placed.',
    fields: ['datatokenAddress', 'error']
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
  }
} as const satisfies Record<string, LogEventSpec>

/** The name of a catalogued event. */
export type LogEventName = keyof typeof LOG_EVENTS

/** Whether `name` is a catalogued event. */
export function isLogEventName(name: unknown): name is LogEventName {
  return typeof name === 'string' && Object.hasOwn(LOG_EVENTS, name)
}
