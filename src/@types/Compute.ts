import type {
  ComputeEnvironment,
  ComputeJob,
  ComputeOutput,
  ComputeResourceRequest,
  ProviderComputeInitializeResults
} from '@oceanprotocol/lib'

/**
 * A reference to a published asset to compute on.
 *
 * Named `…Ref` to keep it distinct from ocean.js's own `ComputeAsset`, which is the
 * wire-level `{documentId, serviceId, transferTxId}` shape. Nautilus v1 had two different
 * types with the same name in scope, which was a standing source of confusion.
 */
export interface ComputeAssetRef {
  did: string
  /** Defaults to the asset's first `compute` service. */
  serviceId?: string
  userdata?: Record<string, unknown>
}

export interface ComputeAlgorithmRef extends ComputeAssetRef {
  algocustomdata?: Record<string, unknown>
  /** Environment variables passed into the algorithm container. */
  envs?: Record<string, string>
}

/** Compute resources to request. Ids come from `ComputeEnvironment.resources`. */
export type ComputeResources = ComputeResourceRequest[]

export interface ComputeConfig {
  dataset: ComputeAssetRef
  algorithm: ComputeAlgorithmRef
  additionalDatasets?: ComputeAssetRef[]
  /**
   * The environment to run in. Pass an id, or omit to use the node's first environment.
   * Prefer selecting explicitly — `getComputeEnvironments()` lists them with their
   * resources, limits and per-chain fees.
   */
  computeEnv?: string
  /**
   * Resources to request. Defaults to each resource's `min` (or 1) as advertised by the
   * environment.
   */
  resources?: ComputeResources
  /** Job duration in seconds. Capped to the environment's `maxJobDuration`. */
  maxJobDuration?: number
  /** Payment token. Must be one the environment prices for this chain. */
  paymentToken?: string
  /** Where results go. C2D v2 replaced the old publish-log flags with this. */
  output?: ComputeOutput
  /** Store results in an ocean-node bucket instead. Mutually exclusive with `output`. */
  outputBucketId?: string
  /** Extra addresses allowed to read the results. */
  additionalViewers?: string[]
  metadata?: Record<string, string | number | boolean>
  /** Seconds to wait in the queue when resources are unavailable. */
  queueMaxWaitTime?: number
  skipCredentials?: boolean
}

/**
 * Free compute. No order, no escrow, no payment token — but the environment must expose a
 * `free` configuration, and its access list may restrict who can use it.
 */
export type FreeComputeConfig = Omit<
  ComputeConfig,
  'paymentToken' | 'maxJobDuration'
>

export interface ComputeStatusConfig {
  jobId: string
  /** Defaults to the node the Nautilus instance is configured with. */
  nodeUri?: string
  agreementId?: string
}

export interface ComputeResultConfig extends ComputeStatusConfig {
  /** Defaults to the first `output` result. */
  resultIndex?: number
}

export interface StopComputeConfig extends ComputeStatusConfig {
  /** Accepted for symmetry with v1; the node identifies the job by id alone. */
  did?: string
}

/** What `compute()` returns: the jobs plus what it had to pay to start them. */
export interface ComputeResult {
  jobs: ComputeJob[]
  environment: ComputeEnvironment
  initializeResults: ProviderComputeInitializeResults
  /** Order transactions created or reused, keyed by DID. */
  orders: Record<string, string>
}

export type { ComputeEnvironment, ComputeJob, ComputeOutput }
