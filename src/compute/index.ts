import type { AssetV5 } from '@oceanprotocol/ddo-js'
/**
 * Compute-to-Data, on the C2D v2 model.
 *
 * The shape of a compute job changed substantially from v1:
 *
 *   - **Resources are requested explicitly.** An environment advertises
 *     `resources: [{id: 'cpu', min, max}, ...]` with per-chain pricing, instead of the old
 *     fixed `cpuType`/`gpuType` descriptors.
 *   - **Payment runs through escrow.** `initializeCompute` returns what to lock, and the
 *     escrow contract (the chain's `EnterpriseEscrow`, else its `Escrow`) must be funded
 *     and authorised before the job starts.
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
  LoggerInstance,
  type ProviderComputeInitialize,
  type ProviderComputeInitializeResults
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type {
  ComputeAlgorithmRef,
  ComputeAssetRef,
  ComputeConfig,
  ComputeResult,
  FreeComputeConfig
} from '../@types/Compute.js'
import {
  planSettlement,
  type SettlementPlan,
  sendSettlement
} from '../access/settlement.js'
import {
  getDatatokenForService,
  getMetadata,
  getServiceByType,
  getServiceIndex,
  getServices
} from '../ddo/read.js'
import type { PolicyServerComputePayload } from '../ddo/types.js'
import { PolicySessionResolver } from '../identity/PolicySessionResolver.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import type { KeyedLock } from '../utils/keyedLock.js'
import {
  assertEscrowPaymentAllowed,
  assertProviderFeesAllowed,
  ceilingFor,
  checkEscrowQuote,
  type EscrowPaymentQuote,
  type ProviderFeeQuote,
  quoteProviderFee
} from '../utils/paymentLimits.js'
import {
  initializeWithValidProviderFee,
  providerFeeToSend
} from '../utils/providerFee.js'
import {
  type EscrowPin,
  fundEscrow,
  planEscrow,
  resolveEscrowPin
} from './escrow.js'

export interface ComputeContext {
  node: OceanNodeClient
  signer: Signer
  chainConfig: Config
  /**
   * Opens the policy-server sessions, and caches them. `Nautilus` passes one per
   * instance, holding its `credentials`. Without it, a resolver with no credential provider
   * is used: inputs gated by addresses work, and one that asks for a verifiable
   * presentation is refused before anything is spent.
   */
  policySessions?: PolicySessionResolver
  /**
   * The escrow contract a paid job may fund, chosen by the caller. When set, it is the only
   * one funded. When omitted, the job funds the chain's `EnterpriseEscrow` in Ocean's
   * address data (the file `ADDRESS_FILE` names, else the addresses ocean.js ships), else
   * its `Escrow`; with neither, paid compute is refused. `chainConfig.escrow` is not read: ocean.js's
   * `ConfigHelper` fills it from the `Escrow` entry. `Nautilus` passes its
   * `config.escrow` here when the caller set one.
   */
  escrow?: string
  /**
   * Serialises paid jobs that draw on the same escrow funds and authorisation: every
   * `compute()` given the same lock runs its escrow reads, deposit, authorisation, orders
   * and `computeStart` one job at a time per (chain, payer, payment token, payee), so each
   * job plans its escrow from the chain state the previous one left. `Nautilus` passes one
   * lock per instance. Without it, concurrent jobs from one payer to one environment can
   * overwrite each other's authorisation. Jobs started from other processes or with
   * other locks are not covered.
   */
  escrowLock?: KeyedLock
}

/** One resolved compute input: the asset, the chosen service, and its reference. */
interface ResolvedInput {
  ref: ComputeAssetRef
  asset: AssetV5
  serviceId: string
  isAlgorithm: boolean
}

/**
 * Runs a paid compute job.
 *
 * Each returned job's `jobId` is `<environmentHash>-<jobId>`, the form every job method
 * takes (see `./jobs.ts`).
 */
export async function compute(
  config: ComputeConfig,
  context: ComputeContext
): Promise<ComputeResult> {
  const { node, signer, chainConfig } = context
  // Resolved first, so a malformed explicit escrow fails before any node call.
  const escrowPin = resolveEscrowPin(chainConfig.chainId, context.escrow)
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

  // 1. Open every input's policy session, the algorithm's included, before any escrow,
  //    approval or order. Any refusal aborts the whole job with nothing spent — the
  //    ordering here is the whole point. The node checks the same sessions at
  //    `initializeCompute` and at `computeStart`, so both get this one array.
  const policyServer = await resolvePolicies(
    node,
    inputs,
    consumerAddress,
    context.policySessions
  )

  const validUntil = Math.floor(Date.now() / 1000) + maxJobDuration

  const datasets = inputs
    .filter((input) => !input.isAlgorithm)
    .map(toComputeAsset)
  const algorithm = toComputeAlgorithm(
    inputs.find((input) => input.isAlgorithm) as ResolvedInput,
    config.algorithm
  )

  // Read before anything is asked or spent: an input without a datatoken cannot be
  // ordered.
  const datatokens = inputs.map(datatokenFor)

  // 2. Ask the node what the job costs and which orders can be reused. The provider fee
  //    of every input that will be ordered is checked here, before escrow or any order,
  //    the way the datatoken verifies it, so an order is never sent with a fee it would
  //    reject, or with none. A compute fee is the same on every request, so a bad one is
  //    refused at once rather than requested again.
  const initializeResults = await initializeWithValidProviderFee(
    () =>
      node.initializeCompute({
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
      }),
    (results) =>
      inputs.map((input, index) =>
        providerFeeToSend(
          matchInitializeResult(results, input, datatokens[index])
        )
      ),
    { attempts: 1 }
  )

  // 3. The node chose the provider fees and the escrow payment: check both against what
  //    the caller allowed, and the escrow contract against the pinned one, before the
  //    first approval, deposit or order.
  const fees = inputs.map((input, index) =>
    quoteProviderFee(
      providerFeeToSend(
        matchInitializeResult(initializeResults, input, datatokens[index])
      ),
      {
        datatoken: datatokens[index],
        did: input.asset.id,
        serviceId: input.serviceId
      }
    )
  )

  await assertProviderFeesAllowed(fees, config)

  const escrowQuote = await checkEscrowPayment({
    chainConfig,
    escrowPin,
    environment,
    initializeResults,
    paymentToken,
    config
  })

  // 4. Plan every order: read each input's pricing and refuse one that cannot be ordered,
  //    still before anything is sent. Each is allowed to pay exactly its fee approved
  //    above.
  const settlements = await planOrders({
    inputs,
    fees,
    initializeResults,
    signer,
    chainConfig,
    consumer: environment.consumerAddress
  })

  // 5-7. Fund escrow, order, start. One job at a time per payer, token and payee within
  //      the lock's holder, so each job plans its escrow from the chain state the previous
  //      job's lock left, not from a snapshot another job is about to change.
  const run = async () => {
    // 5. Fund and authorise escrow for exactly the amount the node quoted.
    if (escrowQuote)
      await fundEscrow(
        signer,
        chainConfig,
        await planEscrow(signer, chainConfig, escrowQuote)
      )

    // 6. Send every order, and record the transfer ids.
    const orders = await sendOrders(settlements)

    for (const dataset of datasets)
      dataset.transferTxId =
        orders[orderKey(dataset.documentId, dataset.serviceId)] ||
        dataset.transferTxId
    if (algorithm.documentId && algorithm.serviceId)
      algorithm.transferTxId =
        orders[orderKey(algorithm.documentId, algorithm.serviceId)] ||
        algorithm.transferTxId

    // 7. Start the job. The node locks the job's payment in escrow before it answers.
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

    return { orders, jobs }
  }

  const { orders, jobs } =
    escrowQuote && context.escrowLock
      ? await context.escrowLock(await escrowLockKey(signer, escrowQuote), run)
      : await run()

  LoggerInstance.debug(
    '[compute] started',
    jobs.map((job) => job.jobId)
  )

  return {
    jobs,
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
  const { node, signer } = context
  const consumerAddress = await signer.getAddress()

  const inputs = await resolveInputs(node, config)
  const environment = await selectEnvironment(node, config.computeEnv)

  if (!environment.free)
    throw new Error(
      `Compute environment ${environment.id} does not offer free jobs. Use compute() instead, or pick an environment whose 'free' options are set.`
    )

  const policyServer = await resolvePolicies(
    node,
    inputs,
    consumerAddress,
    context.policySessions
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

  return { jobs, environment }
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

      // A dataset must name a *compute* service. Only checking that the asset has one
      // somewhere let an `access` service through, which the node then rejected deep
      // inside the job — long after the orders were placed. Algorithms are different:
      // they are routinely published with only an `access` service (v1 ordered
      // `services[0]` regardless of type, and the node accepts it), so the algorithm
      // prefers a compute service but falls back to the first one.
      const service = ref.serviceId
        ? findServiceById(asset, ref.serviceId)
        : isAlgorithm
          ? getServiceByType(asset, 'compute') || getServices(asset)[0]
          : getServiceByType(asset, 'compute')

      if (!service)
        throw new Error(
          ref.serviceId
            ? `Asset ${ref.did} has no service with id ${ref.serviceId}.`
            : isAlgorithm
              ? `Asset ${ref.did} has no services.`
              : `Asset ${ref.did} has no 'compute' service.`
        )

      if (!isAlgorithm && service.type !== 'compute')
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

/**
 * Resources every environment has, and that a job gets no limit on when it requests `0` of
 * them: ocean-node sets a container's CPU and memory limits only for an amount above `0`.
 */
const BASELINE_RESOURCES = ['cpu', 'ram', 'disk']

/**
 * The resources a job requests: the caller's, and for every other resource the
 * environment lists (for a free job, its `free` list), a default.
 *
 * The default is the resource's minimum, raised to `1` for `cpu`, `ram` and `disk` within
 * its maximum: a node fills a resource left out with its minimum, which is often `0`, so a
 * job would otherwise run without a memory limit. Other resources, such as GPUs, default to
 * their minimum.
 */
function resolveResources(
  environment: ComputeEnvironment,
  requested: ComputeResourceRequest[] = [],
  free = false
): ComputeResourceRequest[] {
  const advertised = free
    ? (environment.free?.resources ?? [])
    : (environment.resources ?? [])

  const defaults = advertised
    .filter((resource) => !requested.some((entry) => entry.id === resource.id))
    .map((resource) => {
      // A free resource without its own bounds has the environment's.
      const paid = environment.resources?.find(
        (candidate) => candidate.id === resource.id
      )
      const min = resource.min ?? paid?.min ?? 0
      const max = resource.max ?? paid?.max ?? min
      const floor = BASELINE_RESOURCES.includes(resource.id) ? 1 : 0

      return {
        id: resource.id,
        amount: Math.max(min, Math.min(floor, max))
      }
    })

  return [...requested, ...defaults]
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
 * Opens one policy session per input, datasets and algorithm alike, each for its own
 * (asset, service) on the node running the job: that node checks every input.
 *
 * The policy server receives the whole array on each per-input check and selects the entry
 * matching `documentId` + `serviceId`, so both are tagged on every element, and an input
 * never borrows another input's session. One input after the other: `initiate` is a signed
 * command, and the node accepts each nonce once.
 */
async function resolvePolicies(
  node: OceanNodeClient,
  inputs: ResolvedInput[],
  consumerAddress: string,
  policySessions: PolicySessionResolver = new PolicySessionResolver()
): Promise<PolicyServerComputePayload[] | undefined> {
  const payloads: PolicyServerComputePayload[] = []

  for (const input of inputs) {
    const session = await policySessions.resolve({
      node,
      asset: input.asset,
      serviceId: input.serviceId,
      consumerAddress
    })

    if (session)
      payloads.push({
        ...session,
        documentId: input.asset.id,
        serviceId: input.serviceId
      })
  }

  return payloads.length ? payloads : undefined
}

// #endregion

// #region payment

/**
 * Checks the node's escrow quote and the caller's consent to it, without reading the chain
 * or sending anything. `undefined` when the node quoted no payment, or a payment of zero.
 *
 * The escrow contract must be the pinned one (`resolveEscrowPin`: the caller's explicit
 * choice, else the chain's `EnterpriseEscrow` in Ocean's address data, else its `Escrow`),
 * and the chain, token and payee the job's own; the amount must be within
 * `maxEscrowPayment` or confirmed by `confirmEscrowPayment`. Each refusal is an
 * `EscrowPaymentNotAllowedError`.
 */
async function checkEscrowPayment(params: {
  chainConfig: Config
  escrowPin: EscrowPin
  environment: ComputeEnvironment
  initializeResults: ProviderComputeInitializeResults
  paymentToken: string
  config: ComputeConfig
}): Promise<EscrowPaymentQuote | undefined> {
  const { chainConfig, escrowPin, environment, paymentToken, config } = params
  const payment = params.initializeResults.payment

  if (!payment) {
    LoggerInstance.debug(
      '[compute] node quoted no escrow payment; skipping funding'
    )
    return undefined
  }

  const quote = checkEscrowQuote(payment, {
    pin: escrowPin,
    chainId: chainConfig.chainId,
    token: paymentToken,
    payee: environment.consumerAddress
  })

  if (!quote) {
    LoggerInstance.debug('[compute] node quoted a zero escrow payment')
    return undefined
  }

  await assertEscrowPaymentAllowed(quote, config, payment)

  return quote
}

/** The `escrowLock` key: one escrow balance and authorisation on one chain. */
async function escrowLockKey(
  signer: Signer,
  quote: EscrowPaymentQuote
): Promise<string> {
  const payer = await signer.getAddress()

  return [quote.chainId, payer, quote.token, quote.payee]
    .map((part) => String(part).toLowerCase())
    .join(':')
}

/**
 * Plans the order of every input that needs one, without sending anything: each input's
 * pricing is read and checked, so one that cannot be ordered is refused before escrow is
 * funded or any order is sent.
 *
 * The consumer is the compute environment's address, not the caller's: the environment is
 * what actually reads the data.
 */
async function planOrders(params: {
  inputs: ResolvedInput[]
  /** Each input's approved provider fee, by position; `undefined` for none. */
  fees: (ProviderFeeQuote | undefined)[]
  initializeResults: ProviderComputeInitializeResults
  signer: Signer
  chainConfig: Config
  consumer: string
}): Promise<{ key: string; plan: SettlementPlan }[]> {
  const { inputs, fees, initializeResults, signer, chainConfig, consumer } =
    params
  const settlements: { key: string; plan: SettlementPlan }[] = []

  for (const [index, input] of inputs.entries()) {
    const datatokenAddress = datatokenFor(input)

    const initialized = matchInitializeResult(
      initializeResults,
      input,
      datatokenAddress
    )

    const plan = await planSettlement({
      signer,
      chainConfig,
      datatokenAddress,
      serviceIndex: getServiceIndex(input.asset, input.serviceId),
      initialized,
      consumer,
      maxProviderFee: ceilingFor([fees[index]])
    })

    settlements.push({ key: orderKey(input.asset.id, input.serviceId), plan })
  }

  return settlements
}

/** Sends the planned orders, one after the other, and returns the transfer ids. */
async function sendOrders(
  settlements: { key: string; plan: SettlementPlan }[]
): Promise<Record<string, string>> {
  const orders: Record<string, string> = {}

  for (const { key, plan } of settlements) {
    const { transferTxId } = await sendSettlement(plan)

    // Keyed by DID *and* service: one asset can back two inputs (the algorithm doubling
    // as a dataset, or a DID listed twice with different services), and a DID-only key
    // made the last order overwrite the first — computeStart then failed on a mismatched
    // transferTxId even though both orders were paid.
    orders[key] = transferTxId
  }

  return orders
}

/** The datatoken an input is ordered with. */
function datatokenFor(input: ResolvedInput): string {
  const datatokenAddress = getDatatokenForService(input.asset, input.serviceId)

  if (!datatokenAddress)
    throw new Error(
      `Could not determine the datatoken for service ${input.serviceId} of ${input.asset.id}.`
    )

  return datatokenAddress
}

/** The key of one order in `ComputeResult.orders`: a DID URL naming the exact service. */
function orderKey(did: string, serviceId: string): string {
  return `${did}#${serviceId}`
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
