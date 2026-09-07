import type { AssetV5, ServiceV5 } from '@oceanprotocol/ddo-js'
/**
 * Compute-to-Data, on the C2D v2 model.
 *
 * The shape of a compute job changed substantially from v1:
 *
 *   - **Resources are requested explicitly.** An environment advertises
 *     `resources: [{id: 'cpu', min, max}, ...]` with per-chain pricing, instead of the old
 *     fixed `cpuType`/`gpuType` descriptors.
 *   - **Payment runs through escrow.** `initializeCompute` returns what to lock, and the
 *     `Escrow` contract must be funded and authorised before the job starts.
 *   - **All datasets go in one array.** v1 passed `dataset` plus `additionalDatasets`.
 *   - **Free compute exists.** `freeComputeStart` needs no order, no escrow, no token.
 *   - **Output is `{remoteStorage, encryption}`.** The old hardcoded
 *     `publishAlgorithmLog`/`publishOutput` flags are gone.
 */
import {
  type ComputeAlgorithm,
  type ComputeAsset,
  type ComputeEnvironment,
  type ComputeJob,
  type ComputeResourceRequest,
  type Config,
  EscrowContract,
  LoggerInstance,
  type ProviderComputeInitialize,
  type ProviderComputeInitializeResults,
  unitsToAmount
} from '@oceanprotocol/lib'
import { getAddress, type Signer } from 'ethers'
import type {
  ComputeAlgorithmRef,
  ComputeAssetRef,
  ComputeConfig,
  ComputeResult,
  FreeComputeConfig
} from '../@types/Compute.js'
import { settleOrder } from '../access/index.js'
import {
  getCredentials,
  getDatatokenForService,
  getMetadata,
  getService,
  getServiceByType,
  getServiceCredentials,
  getServiceIndex,
  supportsSsi
} from '../ddo/read.js'
import type { PolicyServerComputePayload } from '../ddo/types.js'
import type { CredentialProvider } from '../identity/CredentialProvider.js'
import {
  assertPolicySatisfied,
  shouldResolveCredentials
} from '../identity/policy.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'

export interface ComputeContext {
  node: OceanNodeClient
  signer: Signer
  chainConfig: Config
  credentials?: CredentialProvider
}

/** One resolved compute input: the asset, the chosen service, and its reference. */
interface ResolvedInput {
  ref: ComputeAssetRef
  asset: AssetV5
  serviceId: string
  isAlgorithm: boolean
}

/** Runs a paid compute job. */
/**
 * The node reports a started job as `<environmentHash>-<jobId>` but reports the
 * same job as a bare id everywhere else — `getComputeStatus`, `getComputeLogs`
 * and `stopCompute` all expect and return the short form. Normalise on the way
 * out so every nautilus API speaks one dialect; the qualified form is rebuilt
 * internally where the node insists on it (see `getComputeResult`).
 */
function normaliseJobIds(jobs: ComputeJob[]): ComputeJob[] {
  return jobs.map((job) => {
    // `environment` is present at runtime but absent from ocean.js's ComputeJob.
    const { environment } = job as ComputeJob & { environment?: string }
    const [environmentHash] = (environment ?? '').split('-')

    if (!environmentHash || !job.jobId?.startsWith(`${environmentHash}-`))
      return job

    return { ...job, jobId: job.jobId.slice(environmentHash.length + 1) }
  })
}

export async function compute(
  config: ComputeConfig,
  context: ComputeContext
): Promise<ComputeResult> {
  const { node, signer, chainConfig, credentials } = context
  const consumerAddress = await signer.getAddress()

  const inputs = await resolveInputs(node, config)
  const environment = await selectEnvironment(node, config.computeEnv)

  const paymentToken = resolvePaymentToken(
    environment,
    chainConfig.chainId,
    config.paymentToken
  )
  const resources = resolveResources(environment, config.resources)
  const maxJobDuration = resolveMaxJobDuration(
    environment,
    config.maxJobDuration
  )

  // 1. Satisfy every policy before any order is placed. Any failure aborts the whole job
  //    with nothing spent — the ordering here is the whole point.
  const policyServer = await resolvePolicies(
    inputs,
    consumerAddress,
    credentials,
    config.skipCredentials
  )

  const validUntil = Math.floor(Date.now() / 1000) + maxJobDuration

  const datasets = inputs
    .filter((input) => !input.isAlgorithm)
    .map(toComputeAsset)
  const algorithm = toComputeAlgorithm(
    inputs.find((input) => input.isAlgorithm) as ResolvedInput,
    config.algorithm
  )

  // 2. Ask the node what the job costs and which orders can be reused.
  const initializeResults = await node.initializeCompute({
    datasets,
    algorithm,
    computeEnv: environment.id,
    paymentToken,
    validUntil,
    resources,
    consumerAddress,
    policyServer,
    output: config.output,
    queueMaxWaitTime: config.queueMaxWaitTime
  })

  // 3. Fund and authorise escrow for the amount the node quoted.
  await ensureEscrow(signer, environment, initializeResults, paymentToken)

  // 4. Order every input that needs one, and record the transfer ids.
  const orders = await placeOrders({
    inputs,
    initializeResults,
    signer,
    chainConfig,
    consumer: environment.consumerAddress
  })

  for (const dataset of datasets)
    dataset.transferTxId = orders[dataset.documentId] || dataset.transferTxId
  if (algorithm.documentId)
    algorithm.transferTxId =
      orders[algorithm.documentId] || algorithm.transferTxId

  // 5. Start the job.
  const jobs = await node.computeStart({
    computeEnv: environment.id,
    datasets,
    algorithm,
    maxJobDuration,
    paymentToken,
    resources,
    metadata: config.metadata,
    additionalViewers: config.additionalViewers,
    output: config.output,
    policyServer,
    queueMaxWaitTime: config.queueMaxWaitTime,
    outputBucketId: config.outputBucketId
  })

  LoggerInstance.debug(
    '[compute] started',
    jobs.map((job) => job.jobId)
  )

  return {
    jobs: normaliseJobIds(jobs),
    environment,
    initializeResults,
    orders
  }
}

/**
 * Runs a free compute job.
 *
 * No orders, no escrow, no payment token — but the environment must expose a `free`
 * configuration, and its access list may still restrict who may use it.
 */
export async function freeCompute(
  config: FreeComputeConfig,
  context: ComputeContext
): Promise<Omit<ComputeResult, 'initializeResults' | 'orders'>> {
  const { node, signer, credentials } = context
  const consumerAddress = await signer.getAddress()

  const inputs = await resolveInputs(node, config)
  const environment = await selectEnvironment(node, config.computeEnv)

  if (!environment.free)
    throw new Error(
      `Compute environment ${environment.id} does not offer free jobs. Use compute() instead, or pick an environment whose 'free' options are set.`
    )

  const policyServer = await resolvePolicies(
    inputs,
    consumerAddress,
    credentials,
    config.skipCredentials
  )

  const jobs = await node.freeComputeStart({
    computeEnv: environment.id,
    datasets: inputs.filter((input) => !input.isAlgorithm).map(toComputeAsset),
    algorithm: toComputeAlgorithm(
      inputs.find((input) => input.isAlgorithm) as ResolvedInput,
      config.algorithm
    ),
    resources: resolveResources(environment, config.resources, true),
    metadata: config.metadata,
    additionalViewers: config.additionalViewers,
    output: config.output,
    policyServer,
    queueMaxWaitTime: config.queueMaxWaitTime,
    outputBucketId: config.outputBucketId
  })

  return { jobs: normaliseJobIds(jobs), environment }
}

// #region inputs

async function resolveInputs(
  node: OceanNodeClient,
  config: Pick<ComputeConfig, 'dataset' | 'algorithm' | 'additionalDatasets'>
): Promise<ResolvedInput[]> {
  const refs: { ref: ComputeAssetRef; isAlgorithm: boolean }[] = [
    { ref: config.dataset, isAlgorithm: false },
    ...(config.additionalDatasets || []).map((ref) => ({
      ref,
      isAlgorithm: false
    })),
    { ref: config.algorithm, isAlgorithm: true }
  ]

  return Promise.all(
    refs.map(async ({ ref, isAlgorithm }) => {
      const asset = await node.resolve(ref.did)

      // An explicit id must still name a *compute* service. Only checking that the asset
      // has one somewhere let an `access` service through, which the node then rejected
      // deep inside the job — long after the orders were placed.
      const service = ref.serviceId
        ? findServiceById(asset, ref.serviceId)
        : getServiceByType(asset, 'compute')

      if (!service)
        throw new Error(
          ref.serviceId
            ? `Asset ${ref.did} has no service with id ${ref.serviceId}.`
            : `Asset ${ref.did} has no 'compute' service.`
        )

      if (service.type !== 'compute')
        throw new Error(
          `Service ${ref.serviceId} of ${ref.did} is a '${service.type}' service; compute jobs need a 'compute' service.`
        )

      return { ref, asset, serviceId: service.id, isAlgorithm }
    })
  )
}

function findServiceById(asset: AssetV5, serviceId: string) {
  return asset.credentialSubject?.services?.find(
    (service) => service.id === serviceId
  )
}

function toComputeAsset(input: ResolvedInput): ComputeAsset {
  return {
    documentId: input.asset.id,
    serviceId: input.serviceId,
    ...(input.ref.userdata ? { userdata: input.ref.userdata } : {})
  }
}

function toComputeAlgorithm(
  input: ResolvedInput,
  ref: ComputeAlgorithmRef
): ComputeAlgorithm {
  /**
   * `meta` carries the container spec, and the node needs it in the request
   * itself — `getAlgorithmImage()` reads `algorithm.meta.container` and does
   * not fall back to the published DDO, so omitting this fails the job before
   * it starts with "Unable to extract docker image null from algoritm".
   */
  const { algorithm } = getMetadata(input.asset)

  return {
    documentId: input.asset.id,
    serviceId: input.serviceId,
    ...(algorithm ? { meta: algorithm } : {}),
    ...(ref.userdata ? { userdata: ref.userdata } : {}),
    ...(ref.algocustomdata ? { algocustomdata: ref.algocustomdata } : {}),
    ...(ref.envs ? { envs: ref.envs } : {})
  }
}

// #endregion

// #region environment

/**
 * Picks the compute environment.
 *
 * v1 silently took `[0]`. Here an explicit id is honoured and, when omitted, the first is
 * used but the choice is logged — call `nautilus.getComputeEnvironments()` to choose
 * deliberately, since resources, limits and fees differ between them.
 */
export async function selectEnvironment(
  node: OceanNodeClient,
  computeEnv?: string
): Promise<ComputeEnvironment> {
  const environments = await node.getComputeEnvironments()

  if (!environments.length)
    throw new Error(`Node ${node.nodeUri} advertises no compute environments.`)

  if (!computeEnv) {
    LoggerInstance.debug(
      `[compute] no environment given, using '${environments[0].id}' of ${environments.length}`
    )
    return environments[0]
  }

  const environment = environments.find(
    (candidate) => candidate.id === computeEnv
  )

  if (!environment)
    throw new Error(
      `No compute environment '${computeEnv}' on ${node.nodeUri}. Available: ${environments
        .map((candidate) => candidate.id)
        .join(', ')}`
    )

  return environment
}

/**
 * Resolves the payment token.
 *
 * `ComputeEnvironment.fees` is keyed by chain id, so a token is only usable if the
 * environment prices it for the chain the job is paid on.
 */
function resolvePaymentToken(
  environment: ComputeEnvironment,
  chainId: number,
  requested?: string
): string {
  const fees = environment.fees?.[String(chainId)] || []

  if (!fees.length)
    throw new Error(
      `Compute environment ${environment.id} publishes no fees for chain ${chainId}, so paid jobs cannot be priced.`
    )

  if (!requested) return fees[0].feeToken

  const match = fees.find(
    (fee) => fee.feeToken.toLowerCase() === requested.toLowerCase()
  )

  if (!match)
    throw new Error(
      `Compute environment ${environment.id} does not accept ${requested} on chain ${chainId}. Accepted: ${fees
        .map((fee) => fee.feeToken)
        .join(', ')}`
    )

  return match.feeToken
}

/** Defaults each resource to the environment's declared minimum, or 1. */
function resolveResources(
  environment: ComputeEnvironment,
  requested?: ComputeResourceRequest[],
  free = false
): ComputeResourceRequest[] {
  if (requested?.length) return requested

  const available =
    (free ? environment.free?.resources : environment.resources) || []

  return available.map((resource) => ({
    id: resource.id,
    amount: resource.min ?? 1
  }))
}

function resolveMaxJobDuration(
  environment: ComputeEnvironment,
  requested?: number
): number {
  const ceiling = environment.maxJobDuration

  if (!requested) return ceiling || 3600

  if (ceiling && requested > ceiling) {
    LoggerInstance.warn(
      `[compute] requested maxJobDuration ${requested}s exceeds the environment limit ${ceiling}s; capping.`
    )
    return ceiling
  }

  return requested
}

// #endregion

// #region policies

/**
 * Resolves one policy payload per (asset, service) pair.
 *
 * The policy server receives the whole array on each per-asset check and selects the entry
 * matching `documentId` + `serviceId`, so both must be tagged on every element.
 *
 * Unlike the ocean-cli, a v4 asset in the batch does not disable SSI for the v5 assets
 * alongside it — each input is gated on its own version.
 */
async function resolvePolicies(
  inputs: ResolvedInput[],
  consumerAddress: string,
  credentials?: CredentialProvider,
  skip?: boolean
): Promise<PolicyServerComputePayload[] | undefined> {
  const payloads: PolicyServerComputePayload[] = []

  for (const input of inputs) {
    if (!supportsSsi(input.asset)) continue

    const resolved = shouldResolveCredentials(credentials, skip)
      ? await (credentials as CredentialProvider).resolve({
          asset: input.asset,
          serviceId: input.serviceId,
          consumerAddress
        })
      : null

    if (resolved) {
      payloads.push({
        ...resolved,
        documentId: input.asset.id,
        serviceId: input.serviceId
      })
      continue
    }

    // A gated input with no session fails the whole job here, before any order or escrow
    // deposit. A compute job orders every input, so paying for all of them and then being
    // refused on one is the most expensive version of this mistake.
    assertPolicySatisfied({
      did: input.asset.id,
      serviceId: input.serviceId,
      assetCredentials: getCredentials(input.asset),
      serviceCredentials: getServiceCredentials(
        getService(input.asset, input.serviceId) as ServiceV5
      ),
      resolved,
      skipped: skip
    })
  }

  return payloads.length ? payloads : undefined
}

// #endregion

// #region payment

/**
 * Makes sure escrow can cover the job.
 *
 * `verifyFundsForEscrowPayment` both checks and tops up: it deposits if the balance is
 * short and authorises the environment's consumer address to draw the quoted amount.
 */
async function ensureEscrow(
  signer: Signer,
  environment: ComputeEnvironment,
  results: ProviderComputeInitializeResults,
  paymentToken: string
): Promise<void> {
  const payment = results.payment

  if (!payment?.escrowAddress) {
    LoggerInstance.debug(
      '[compute] node quoted no escrow payment; skipping funding'
    )
    return
  }

  const escrow = new EscrowContract(getAddress(payment.escrowAddress), signer)

  const amount = await unitsToAmount(
    signer,
    paymentToken,
    String(payment.amount)
  )

  const validation = await escrow.verifyFundsForEscrowPayment(
    paymentToken,
    environment.consumerAddress,
    amount,
    String(payment.amount),
    String(payment.minLockSeconds),
    '10'
  )

  if (validation && validation.isValid === false)
    throw new Error(
      `Escrow cannot cover this compute job: ${validation.message}. Deposit ${amount} of ${paymentToken} and authorise ${environment.consumerAddress}.`
    )
}

/**
 * Orders every input that needs one.
 *
 * The consumer is the compute environment's address, not the caller's: the environment is
 * what actually reads the data.
 */
async function placeOrders(params: {
  inputs: ResolvedInput[]
  initializeResults: ProviderComputeInitializeResults
  signer: Signer
  chainConfig: Config
  consumer: string
}): Promise<Record<string, string>> {
  const { inputs, initializeResults, signer, chainConfig, consumer } = params
  const orders: Record<string, string> = {}

  for (const input of inputs) {
    const datatokenAddress = getDatatokenForService(
      input.asset,
      input.serviceId
    )

    if (!datatokenAddress)
      throw new Error(
        `Could not determine the datatoken for service ${input.serviceId} of ${input.asset.id}.`
      )

    const initialized = matchInitializeResult(
      initializeResults,
      input,
      datatokenAddress
    )

    const { transferTxId } = await settleOrder({
      signer,
      chainConfig,
      datatokenAddress,
      serviceIndex: getServiceIndex(input.asset, input.serviceId),
      initialized,
      consumer
    })

    orders[input.asset.id] = transferTxId
  }

  return orders
}

/** The node returns results positionally for datasets and separately for the algorithm. */
function matchInitializeResult(
  results: ProviderComputeInitializeResults,
  input: ResolvedInput,
  datatokenAddress: string
): ProviderComputeInitialize {
  if (input.isAlgorithm) return results.algorithm || {}

  const match = (results.datasets || []).find(
    (result) =>
      result.datatoken?.toLowerCase() === datatokenAddress.toLowerCase()
  )

  return match || {}
}

// #endregion

export type { ComputeEnvironment, ComputeJob }
