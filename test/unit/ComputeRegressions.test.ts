/**
 * Regression tests for `compute()` input resolution and order bookkeeping.
 *
 * Everything below the nautilus surface is stubbed: the node client is a plain object and
 * `settleOrder` is mocked, so these tests exercise exactly the logic that broke —
 * which service an input resolves to, and which order id ends up on which input.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import type {
  ComputeAlgorithm,
  ComputeAsset,
  ComputeEnvironment,
  Config
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputeConfig } from '../../src/@types/Compute.js'
import { compute } from '../../src/compute/index.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import {
  ASSET_DID,
  CHAIN_ID,
  getAlgorithmAssetFixture,
  getComputeAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
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

function createComputeNodeMock(assets: Record<string, AssetV5>) {
  const calls: { computeStart: ComputeStartCall[] } = { computeStart: [] }

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

    // No `payment` in the quote, so `ensureEscrow` skips funding — escrow is not what
    // these tests are about.
    async initializeCompute() {
      return { datasets: [], algorithm: {} }
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
