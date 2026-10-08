/**
 * Regression tests for `compute()` input resolution and order bookkeeping.
 *
 * Everything below the nautilus surface is stubbed: the node client is a plain object and
 * `settleOrder` is mocked, so these tests exercise exactly the logic that broke —
 * which service an input resolves to, and which order id ends up on which input.
 */

import {
  type ComputeAlgorithm,
  type ComputeAsset,
  type ComputeEnvironment,
  type Config,
  EscrowContract
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputeConfig } from '../../src/@types/Compute.js'
import { settleOrder } from '../../src/access/index.js'
import { compute } from '../../src/compute/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { ProviderFeeSignatureError } from '../../src/utils/providerFee.js'
import {
  ASSET_DID,
  CHAIN_ID,
  getAlgorithmAssetFixture,
  getComputeAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import {
  poisonedProviderFee,
  signedProviderFee
} from '../fixtures/ProviderFee.js'
import { expectThrowsAsync } from '../helpers.js'

// Ordering runs against the chain; stub it so each order returns a tx id derived from the
// datatoken, which lets the tests tell apart orders for different services of one asset.
vi.mock('../../src/access/index.js', () => ({
  settleOrder: vi.fn(
    async ({ datatokenAddress }: { datatokenAddress: string }) => ({
      transferTxId: `tx-${datatokenAddress}`
    })
  )
}))

// Escrow runs against the chain too; stub the contract so a test can see whether it was
// funded or authorised at all.
const escrow = {
  verifyFundsForEscrowPayment: vi.fn(async () => ({ isValid: true })),
  deposit: vi.fn(),
  authorize: vi.fn()
}

vi.mock('@oceanprotocol/lib', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  EscrowContract: vi.fn(function (this: void) {
    return escrow
  }),
  unitsToAmount: vi.fn(async () => '1')
}))

/** An escrow quote, as `initializeCompute` returns it for a paid job. */
const PAYMENT = {
  escrowAddress: '0x00000000000000000000000000000000000e5c40',
  payee: '0x00000000000000000000000000000000000000c0',
  chainId: CHAIN_ID,
  minLockSeconds: 3600,
  token: '0xfee0000000000000000000000000000000000000',
  amount: '1000000000000000000'
}

function expectNoEscrow() {
  expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
  expect(escrow.verifyFundsForEscrowPayment).not.toHaveBeenCalled()
  expect(escrow.deposit).not.toHaveBeenCalled()
  expect(escrow.authorize).not.toHaveBeenCalled()
}

const ALGO_DID = 'did:ope:algorithm'
const ALGO_SERVICE_ID = 'algorithm-access-service'
const ALGO_DATATOKEN = '0x1111111111111111111111111111111111111111'
const SECOND_SERVICE_ID = 'second-service'
const SECOND_DATATOKEN = '0x2222222222222222222222222222222222222222'

/** An algorithm published the common way: with only an `access` service. */
function accessOnlyAlgorithm(): AssetV5 {
  const asset = getAlgorithmAssetFixture()
  asset.id = ALGO_DID
  asset.credentialSubject.id = ALGO_DID

  const service = asset.credentialSubject.services[0]
  service.id = ALGO_SERVICE_ID
  service.type = 'access'
  service.datatokenAddress = ALGO_DATATOKEN
  delete service.compute

  return asset
}

function environmentFixture(): ComputeEnvironment {
  return {
    id: 'env-1',
    consumerAddress: '0x00000000000000000000000000000000000000c0',
    resources: [{ id: 'cpu', min: 1, max: 4 }],
    fees: {
      [String(CHAIN_ID)]: [
        { feeToken: '0xfee0000000000000000000000000000000000000' }
      ]
    },
    maxJobDuration: 3600
  } as unknown as ComputeEnvironment
}

interface ComputeStartCall {
  datasets: ComputeAsset[]
  algorithm: ComputeAlgorithm
}

/**
 * An `initializeCompute` answer with a good provider fee for every service of every asset,
 * and for the algorithm: each input that is ordered needs one.
 */
function goodFeesFor(assets: Record<string, AssetV5>) {
  const providerFee = signedProviderFee()

  return {
    datasets: Object.values(assets).flatMap((asset) =>
      asset.credentialSubject.services.map((service) => ({
        datatoken: service.datatokenAddress,
        providerFee
      }))
    ),
    algorithm: { providerFee }
  }
}

function createComputeNodeMock(
  assets: Record<string, AssetV5>,
  initializeAnswers: unknown[] = [goodFeesFor(assets)]
) {
  const calls: { computeStart: ComputeStartCall[]; initializeCompute: number } =
    { computeStart: [], initializeCompute: 0 }

  const client = {
    nodeUri: 'https://node.test.invalid',

    async resolve(did: string) {
      const asset = assets[did]
      if (!asset) throw new Error(`node mock has no asset for ${did}`)
      return asset
    },

    async getComputeEnvironments() {
      return [environmentFixture()]
    },

    // Without a `payment` in the quote `ensureEscrow` skips funding; the fee tests below
    // add one, to see that escrow is not touched.
    async initializeCompute() {
      calls.initializeCompute++
      return initializeAnswers.length > 1
        ? initializeAnswers.shift()
        : initializeAnswers[0]
    },

    async computeStart(params: ComputeStartCall) {
      calls.computeStart.push(params)
      return [{ jobId: 'job-1' }]
    }
  } as unknown as OceanNodeClient

  return { client, calls }
}

const signer = { getAddress: async () => '0xConsumer' } as unknown as Signer
const chainConfig = { chainId: CHAIN_ID } as unknown as Config

function computeContext(client: OceanNodeClient) {
  return { node: client, signer, chainConfig }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('compute() algorithm service resolution', () => {
  it('resolves an algorithm that only has an access service', async () => {
    // v1 ordered `algorithm.services[0]` regardless of type, so access-only algorithms
    // are common in the wild; requiring a 'compute' service on them broke every one.
    const { client, calls } = createComputeNodeMock({
      [ASSET_DID]: getComputeAssetFixture(),
      [ALGO_DID]: accessOnlyAlgorithm()
    })

    const config: ComputeConfig = {
      dataset: { did: ASSET_DID },
      algorithm: { did: ALGO_DID }
    }

    const result = await compute(config, computeContext(client))

    expect(calls.computeStart[0].algorithm.serviceId).to.equal(ALGO_SERVICE_ID)
    expect(result.orders).to.have.property(`${ALGO_DID}#${ALGO_SERVICE_ID}`)
  })

  it('accepts an explicitly selected non-compute algorithm service', async () => {
    const { client, calls } = createComputeNodeMock({
      [ASSET_DID]: getComputeAssetFixture(),
      [ALGO_DID]: accessOnlyAlgorithm()
    })

    await compute(
      {
        dataset: { did: ASSET_DID },
        algorithm: { did: ALGO_DID, serviceId: ALGO_SERVICE_ID }
      },
      computeContext(client)
    )

    expect(calls.computeStart[0].algorithm.serviceId).to.equal(ALGO_SERVICE_ID)
  })

  it('prefers the compute service when the algorithm has one', async () => {
    const algorithm = accessOnlyAlgorithm()
    algorithm.credentialSubject.services.push({
      ...algorithm.credentialSubject.services[0],
      id: SECOND_SERVICE_ID,
      type: 'compute',
      datatokenAddress: SECOND_DATATOKEN
    })

    const { client, calls } = createComputeNodeMock({
      [ASSET_DID]: getComputeAssetFixture(),
      [ALGO_DID]: algorithm
    })

    await compute(
      { dataset: { did: ASSET_DID }, algorithm: { did: ALGO_DID } },
      computeContext(client)
    )

    expect(calls.computeStart[0].algorithm.serviceId).to.equal(
      SECOND_SERVICE_ID
    )
  })

  it('still requires a compute service on datasets', async () => {
    // The looser algorithm rule must not leak into datasets: an access-service dataset
    // is rejected by the node deep inside the job, after the orders were placed.
    const dataset = getComputeAssetFixture()
    dataset.credentialSubject.services[0].type = 'access'

    const { client } = createComputeNodeMock({
      [ASSET_DID]: dataset,
      [ALGO_DID]: accessOnlyAlgorithm()
    })

    await expectThrowsAsync(
      () =>
        compute(
          { dataset: { did: ASSET_DID }, algorithm: { did: ALGO_DID } },
          computeContext(client)
        ),
      new RegExp(`Asset ${ASSET_DID} has no 'compute' service`)
    )
  })
})

describe('compute() order bookkeeping', () => {
  it('keeps one order per (did, serviceId) when two inputs share a DID', async () => {
    // The asset doubles as dataset (compute service) and algorithm (access service). A
    // DID-only key let the second order overwrite the first, so computeStart got the
    // algorithm's tx id on the dataset — a paid order silently dropped.
    const asset = getAlgorithmAssetFixture()
    asset.credentialSubject.services.push({
      ...asset.credentialSubject.services[0],
      id: SECOND_SERVICE_ID,
      type: 'access',
      datatokenAddress: SECOND_DATATOKEN,
      compute: undefined
    })

    const { client, calls } = createComputeNodeMock({ [ASSET_DID]: asset })

    const result = await compute(
      {
        dataset: { did: ASSET_DID, serviceId: SERVICE_ID },
        algorithm: { did: ASSET_DID, serviceId: SECOND_SERVICE_ID }
      },
      computeContext(client)
    )

    // Both paid orders survive, each under its own key.
    expect(result.orders).to.deep.equal({
      [`${ASSET_DID}#${SERVICE_ID}`]: `tx-${asset.credentialSubject.services[0].datatokenAddress}`,
      [`${ASSET_DID}#${SECOND_SERVICE_ID}`]: `tx-${SECOND_DATATOKEN}`
    })

    // And each input carries its *own* tx id into computeStart.
    const [start] = calls.computeStart
    expect(start.datasets[0].transferTxId).to.equal(
      `tx-${asset.credentialSubject.services[0].datatokenAddress}`
    )
    expect(start.algorithm.transferTxId).to.equal(`tx-${SECOND_DATATOKEN}`)
  })
})

describe('compute() provider-fee signature pre-check', () => {
  const config: ComputeConfig = {
    dataset: { did: ASSET_DID },
    algorithm: { did: ALGO_DID }
  }
  const assets = () => ({
    [ASSET_DID]: getComputeAssetFixture(),
    [ALGO_DID]: accessOnlyAlgorithm()
  })
  const datasetDatatoken = () =>
    getComputeAssetFixture().credentialSubject.services[0].datatokenAddress

  /** Runs `compute()` to completion under fake timers, returning what it threw. */
  async function run(client: OceanNodeClient) {
    vi.useFakeTimers()
    try {
      const running = compute(config, computeContext(client)).catch(
        (caught) => caught
      )
      await vi.advanceTimersByTimeAsync(5_000)
      return await running
    } finally {
      vi.useRealTimers()
    }
  }

  it('refuses a bad fee at once, before escrow and orders, without asking again', async () => {
    // A compute fee's validUntil does not change between requests, so asking again would
    // return the same fee: the node is asked once, and nothing may be spent.
    const { client, calls } = createComputeNodeMock(assets(), [
      {
        datasets: [
          { datatoken: datasetDatatoken(), providerFee: signedProviderFee() }
        ],
        algorithm: { providerFee: poisonedProviderFee() },
        payment: PAYMENT
      }
    ])

    const thrown = await run(client)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/signature check.*not asked again/s)
    expect(thrown.attempts).to.equal(1)
    expect(calls.initializeCompute).to.equal(1)
    expectNoEscrow()
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
    expect(calls.computeStart).to.have.length(0)
  })

  it('refuses an input the node sent no fee for, before escrow', async () => {
    // The algorithm will be ordered, and an order needs a fee: without one the escrow
    // deposit would be made and the order would then fail.
    const { client, calls } = createComputeNodeMock(assets(), [
      {
        datasets: [
          { datatoken: datasetDatatoken(), providerFee: signedProviderFee() }
        ],
        algorithm: {},
        payment: PAYMENT
      }
    ])

    const thrown = await run(client)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/there is no provider fee/)
    expect(calls.initializeCompute).to.equal(1)
    expectNoEscrow()
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
  })

  it('refuses a dataset the answer has no result for, before escrow', async () => {
    const { client } = createComputeNodeMock(assets(), [
      {
        datasets: [],
        algorithm: { providerFee: signedProviderFee() },
        payment: PAYMENT
      }
    ])

    expect(await run(client)).to.be.instanceOf(ProviderFeeSignatureError)
    expectNoEscrow()
  })

  it('needs no fee for an order the node reports reusable as it stands', async () => {
    const { client, calls } = createComputeNodeMock(assets(), [
      {
        datasets: [
          { datatoken: datasetDatatoken(), providerFee: signedProviderFee() }
        ],
        algorithm: { validOrder: '0xexisting' }
      }
    ])

    expect(await run(client)).not.to.be.instanceOf(Error)
    expect(calls.computeStart).to.have.length(1)
  })

  it('funds escrow and orders when every fee is good', async () => {
    // The positive control for the refusals above: the stubbed escrow does see a quote.
    const { client, calls } = createComputeNodeMock(assets(), [
      { ...goodFeesFor(assets()), payment: PAYMENT }
    ])

    expect(await run(client)).not.to.be.instanceOf(Error)
    expect(calls.initializeCompute).to.equal(1)
    expect(escrow.verifyFundsForEscrowPayment).toHaveBeenCalledOnce()
    expect(vi.mocked(settleOrder)).toHaveBeenCalledTimes(2)
    expect(calls.computeStart).to.have.length(1)
  })
})
