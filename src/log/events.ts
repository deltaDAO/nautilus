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
      "configureLogging() was given oceanjs 'passthrough' or 'silent', which a later release implements: until then ocean.js prints its own lines, unredacted, at the level LoggerInstance.setLevel() sets (errors only by default).",
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
      "A node that checks this asset has a policy server, and the asset's credentials have no address allow list: the policy server will refuse every consumer.",
    fields: ['endpoint']
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
      "The indexer's second decrypt call for this asset will be signed with a nonce the node does not accept: unless another decrypt moves the nonce first, the asset will not be indexed and the indexer nonce will be stuck.",
    fields: ['nodeUri', 'decryptNonce']
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
      "The requested maxJobDuration exceeds the environment's limit and was capped to it.",
    fields: ['requested', 'ceiling']
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
      'getComputeResult() found no result and will not: the node does not know the job, or the job has no such result.',
    fields: ['jobId']
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
  },
  'identity.policy.holder_binding': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): the asset or a service requires the VP policy holder-binding, which refuses every credential whose JWT 'sub' is not the presenter's DID, such as Gaia-X and other VCDM 2.0 vc+jwt credentials with a URL subject.",
    fields: ['where']
  },
  'identity.policy.presentation_definition_vc_jwt': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): the VP policy presentation-definition is combined with a jwt_vc_json (or jwt_vc) request credential. walt.id's generated definition looks for the type at $.vc.type, which VCDM 2.0 vc+jwt credentials do not have, so their holders are all refused.",
    fields: ['where', 'credentialType']
  },
  'identity.policy.no_issuer_trust': {
    level: 'warn',
    component: 'identity',
    description:
      'AssetBuilder.build(): a requested credential type has no per-credential allowed-issuer among the policies walt.id runs for it (the last non-empty list for the type, after the policy server drops repeats of an identical request), so a credential of that type from any issuer, a self-issued one included, is accepted.',
    fields: ['where', 'credentialType']
  },
  'identity.policy.no_vc_signature': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): a credential-gated service's VC policies (asset and service merged) have no signature, so a credential that names a trusted issuer but is signed by anyone passes, unless the policy server's operator adds signature.",
    fields: ['where']
  },
  'identity.policy.no_vp_signature': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): a credential-gated service's VP policies (asset and service merged) have no signature, so nothing is sure to check the presentation's own signature, unless the policy server's operator adds it.",
    fields: ['where']
  },
  'identity.policy.no_minimum_credentials': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): a credential-gated service's VP policies have no minimum-credentials of at least 1, so a presentation holding no credential passes the credential check.",
    fields: ['where']
  },
  'identity.policy.wildcard_allow': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): a credential-gated service lets every address in ('*' in the allow list, as the policy server reads it), so a hand-built presentation of another credential type (the type bypass) opens it to anyone.",
    fields: ['where']
  },
  'identity.policy.unknown_name': {
    level: 'warn',
    component: 'identity',
    description:
      'AssetBuilder.build(): a VC, VP or per-credential policy name is not one walt.id 90e568f knows. A verifier that does not know it fails every presentation; a newer one may.',
    fields: ['where', 'policy', 'credentialType']
  },
  'identity.policy.issuer_not_did': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): a stored per-credential allowed-issuer lists an entry that is not a DID. walt.id compares a credential's iss with it as written, so it trusts only an issuer whose iss is exactly that text.",
    fields: ['where', 'credentialType']
  },
  'identity.policy.weak_schema': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): a per-credential schema checks less than it seems, judged in the JSON Schema dialect walt.id's validator uses (the schema's $schema, or 2020-12 without one): keys that dialect does not define (walt.id ignores them, e.g. draft 7's dependencies without a draft-07 $schema), keys next to $ref before 2019-09 (ignored), no constraint at all, attributes under properties missing from required (a credential without them passes), or a $schema walt.id does not support or an items list under 2020-12 (either fails every presentation).",
    fields: ['where', 'credentialType']
  },
  'identity.policy.format_ignores_type': {
    level: 'warn',
    component: 'identity',
    description:
      "AssetBuilder.build(): per-credential policies on a vc+sd-jwt or mso_mdoc request credential. walt.id's presentation definition for these formats does not ask for the requested type (any vct; fixed mDL fields), so a wallet presenting a credential of another type skips the policies.",
    fields: ['where', 'credentialType']
  },
  'identity.policy.gate_removed': {
    level: 'warn',
    component: 'identity',
    description:
      "setRequestCredentials(list, []) removed the list's SSIpolicy entry with its VC and VP policies: the credential gate is gone. The message says what still decides who gets in: the list's address and access-list entries, or, on a service with none left, the asset's allow list (named when the builder edits the asset's service, otherwise to be checked).",
    fields: ['list']
  },
  'identity.preflight.skipped': {
    level: 'debug',
    component: 'identity',
    description:
      'WaltIdCredentialProvider could not decode a selected credential (not a plain JWT: SD-JWT, JSON-LD, mdoc), so its holder-binding or attribute check before presenting skipped it and the verifier decides. Its raw form goes to the debug channel (wallet topic).',
    fields: ['serviceId', 'credentialId', 'format', 'policy']
  },
  'identity.preflight.schema_skipped': {
    level: 'debug',
    component: 'identity',
    description:
      "WaltIdCredentialProvider did not check a selected credential against the service's per-credential schema policy before presenting: the schema uses a keyword outside the subset nautilus evaluates (type, required, properties, const, enum), so the verifier decides.",
    fields: ['serviceId', 'credentialType', 'keyword']
  }
} as const satisfies Record<string, LogEventSpec>

/** The name of a catalogued event. */
export type LogEventName = keyof typeof LOG_EVENTS

/** Whether `name` is a catalogued event. */
export function isLogEventName(name: unknown): name is LogEventName {
  return typeof name === 'string' && Object.hasOwn(LOG_EVENTS, name)
}
