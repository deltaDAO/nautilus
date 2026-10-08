import type {
  ComputeEnvironment,
  ComputeJob,
  ComputeOutput,
  ComputeResourceRequest,
  NodeComputeJob,
  ProviderComputeInitializeResults
} from '@oceanprotocol/lib'
import type {
  EscrowPaymentLimits,
  ProviderFeeLimits
} from '../utils/paymentLimits.js'

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
  /**
   * Defaults to the asset's `compute` service if it has one, else its first service —
   * algorithms are routinely published with only an `access` service.
   */
  serviceId?: string
  algocustomdata?: Record<string, unknown>
  /** Environment variables passed into the algorithm container. */
  envs?: Record<string, string>
}

/** Compute resources to request. Ids come from `ComputeEnvironment.resources`. */
export type ComputeResources = ComputeResourceRequest[]

/**
 * Configuration for {@link Nautilus.compute}.
 *
 * `maxProviderFee` / `confirmProviderFees` decide whether the inputs' provider fees may be
 * paid, and `maxEscrowPayment` / `confirmEscrowPayment` how much the job may lock in
 * escrow. Without them (here or in `Nautilus.create`), a non-zero fee or payment is
 * refused before anything is spent. Setting either option of a pair here, even to
 * `undefined`, replaces both `Nautilus.create` defaults of that pair.
 */
export interface ComputeConfig extends ProviderFeeLimits, EscrowPaymentLimits {
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
   * Resources to request, sent exactly as given. When left out, every resource the
   * environment lists (for a free job, its `free` list) is requested at its minimum, raised
   * to `1` for `cpu`, `ram` and `disk` within its maximum, so a job does not run without a
   * CPU or memory limit by default.
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
}

/**
 * Free compute. No order, no escrow, no payment token — but the environment must expose a
 * `free` configuration, and its access list may restrict who can use it.
 */
export type FreeComputeConfig = Omit<
  ComputeConfig,
  | 'paymentToken'
  | 'maxJobDuration'
  | keyof ProviderFeeLimits
  | keyof EscrowPaymentLimits
>

export interface ComputeStatusConfig {
  /**
   * The job's `<environmentHash>-<jobId>` id, as `compute()` and `freeCompute()` return
   * it. A bare id is refused.
   */
  jobId: string
  /** Defaults to the node the Nautilus instance is configured with. */
  nodeUri?: string
  agreementId?: string
}

export interface ComputeResultConfig extends ComputeStatusConfig {
  /**
   * The `index` of the result to read, from the job's `results`. Defaults to its `output`
   * result, the job's `outputs.tar`.
   */
  resultIndex?: number
}

export interface StopComputeConfig extends ComputeStatusConfig {
  /** Accepted for symmetry with v1; the node identifies the job by id alone. */
  did?: string
}

/** What `compute()` returns: the jobs plus what it had to pay to start them. */
export interface ComputeResult {
  jobs: NodeComputeJob[]
  environment: ComputeEnvironment
  initializeResults: ProviderComputeInitializeResults
  /**
   * Order transactions created or reused, keyed by `<did>#<serviceId>`.
   *
   * The service id is part of the key because one asset can back two inputs — an
   * algorithm doubling as a dataset, or a DID listed twice with different services —
   * and each service is ordered separately.
   */
  orders: Record<string, string>
}

export type { ComputeEnvironment, ComputeJob, ComputeOutput, NodeComputeJob }
