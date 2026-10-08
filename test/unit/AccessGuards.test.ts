/**
 * The checks `access()` and `compute()` run on the resolved asset before anything else:
 * the service exists and has the right type, and `userdata` / `algocustomdata` fit the
 * declared consumer parameters. Every refusal must happen with nothing sent: the node is
 * only asked for the DDO, and no credential, order or transaction is touched.
 */

import type { Config } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access } from '../../src/access/index.js'
import { compute, freeCompute } from '../../src/compute/index.js'
import type { AssetV5, ConsumerParameterV5 } from '../../src/ddo/index.js'
import type { CredentialProvider } from '../../src/identity/CredentialProvider.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { ConsumerParameterError } from '../../src/utils/consumerParameters.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  ASSET_DID,
  CHAIN_ID,
  getAlgorithmAssetFixture,
  getAssetFixture,
  getComputeAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { getConsumerParameters } from '../fixtures/ConsumerParameters.js'

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(),
  reuseOrder: vi.fn()
}))

/** Thrown by the first node call after `resolve`, to show a check let the call through. */
const PASSED = 'passed the pre-order checks'

const ALGO_DID = 'did:ope:algorithm'

/**
 * A node client that answers `resolve` from `assets` and records every other call, which
 * throws `PASSED`.
 */
function recordingNode(assets: Record<string, AssetV5>) {
  const calls: string[] = []

  const client = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') return undefined
        if (property === 'nodeUri') return 'https://node.test.invalid'
        if (property === 'resolve')
          return async (did: string) => {
            const asset = assets[did]
            if (!asset) throw new Error(`node mock has no asset for ${did}`)
            return asset
          }

        return () => {
          calls.push(String(property))
          throw new Error(PASSED)
        }
      }
    }
  ) as OceanNodeClient

  return { client, calls }
}

const sendTransaction = vi.fn()
const signer = {
  getAddress: async () => '0x0000000000000000000000000000000000c05e5a',
  sendTransaction
} as unknown as Signer
const chainConfig = { chainId: CHAIN_ID } as unknown as Config
const credentials = {
  resolve: vi.fn()
} as unknown as CredentialProvider

/** The download fixture with one parameter of each type; `surname` is required. */
function accessAsset(): AssetV5 {
  const asset = getAssetFixture()
  asset.credentialSubject.services[0].consumerParameters =
    getConsumerParameters() as unknown as AssetV5['credentialSubject']['services'][0]['consumerParameters']
  return asset
}

function expectNothingSent(calls: string[]) {
  expect(calls).to.deep.equal([])
  expect(vi.mocked(credentials.resolve)).not.toHaveBeenCalled()
  expect(vi.mocked(order)).not.toHaveBeenCalled()
  expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  expect(sendTransaction).not.toHaveBeenCalled()
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }

  throw new Error('expected the call to reject, but it resolved')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('access() pre-order checks', () => {
  function accessWith(
    asset: AssetV5,
    config: Partial<Parameters<typeof access>[0]> = {}
  ) {
    const { client, calls } = recordingNode({ [asset.id]: asset })
    const accessing = access(
      { assetDid: asset.id, ...config },
      { node: client, signer, chainConfig, credentials }
    )

    return { accessing, calls }
  }

  it('refuses userdata of the wrong type with nothing sent', async () => {
    const { accessing, calls } = accessWith(accessAsset(), {
      userdata: { surname: 'Doe', age: 'not-a-number' }
    })

    const error = await rejection(accessing)

    expect(error).to.be.instanceOf(ConsumerParameterError)
    expect((error as ConsumerParameterError).issues).to.deep.include({
      parameter: 'age',
      reason: 'wrong-type',
      message: `'age' must be a finite number, got the string "not-a-number"`
    })
    expectNothingSent(calls)
  })

  it('refuses a missing required parameter with nothing sent', async () => {
    const { accessing, calls } = accessWith(accessAsset())

    const error = await rejection(accessing)

    expect(error).to.be.instanceOf(ConsumerParameterError)
    expect(error.message).to.match(/'surname' is required/)
    expectNothingSent(calls)
  })

  it('refuses a select value outside its options with nothing sent', async () => {
    const { accessing, calls } = accessWith(accessAsset(), {
      userdata: { surname: 'Doe', region: 'asia' }
    })

    expect(await rejection(accessing)).to.be.instanceOf(ConsumerParameterError)
    expectNothingSent(calls)
  })

  it('refuses an undeclared key with nothing sent', async () => {
    const { accessing, calls } = accessWith(accessAsset(), {
      userdata: { surname: 'Doe', row: 5 }
    })

    const error = await rejection(accessing)

    expect(error).to.be.instanceOf(ConsumerParameterError)
    expect(error.message).to.match(/'row' is not a declared parameter/)
    expectNothingSent(calls)
  })

  it('lets fitting userdata through to the node', async () => {
    const { accessing, calls } = accessWith(accessAsset(), {
      userdata: { surname: 'Doe', age: 3, consent: false, region: 'us' }
    })

    expect((await rejection(accessing)).message).to.equal(PASSED)
    expect(calls).to.deep.equal(['forEndpoint'])
  })

  it('lets any userdata through for a service that declares no parameters', async () => {
    const { accessing } = accessWith(getAssetFixture(), {
      userdata: { anything: 'goes' }
    })

    expect((await rejection(accessing)).message).to.equal(PASSED)
  })

  it('refuses a compute service, pointing to compute(), with nothing sent', async () => {
    const { accessing, calls } = accessWith(getComputeAssetFixture(), {
      serviceId: SERVICE_ID
    })

    const error = await rejection(accessing)

    expect(error.message).to.equal(
      `Service ${SERVICE_ID} of ${ASSET_DID} is a 'compute' service; access() downloads from an 'access' service only. Run a job on it with compute() or freeCompute() instead.`
    )
    expectNothingSent(calls)
  })

  it('points to compute() when the asset has only a compute service', async () => {
    const { accessing, calls } = accessWith(getComputeAssetFixture())

    expect((await rejection(accessing)).message).to.equal(
      `Asset ${ASSET_DID} has no 'access' service to download from. It offers a 'compute' service. Run a job on it with compute() or freeCompute() instead.`
    )
    expectNothingSent(calls)
  })

  it('refuses a service id the asset does not have, with nothing sent', async () => {
    const { accessing, calls } = accessWith(accessAsset(), {
      serviceId: 'no-such-service'
    })

    expect((await rejection(accessing)).message).to.equal(
      `Asset ${ASSET_DID} has no service with id no-such-service.`
    )
    expectNothingSent(calls)
  })
})

describe('compute() consumer parameters', () => {
  const numberParameter = getConsumerParameters()[1] // age: number, optional

  function datasetAsset(): AssetV5 {
    const asset = getComputeAssetFixture()
    asset.credentialSubject.services[0].consumerParameters = [
      numberParameter
    ] as unknown as AssetV5['credentialSubject']['services'][0]['consumerParameters']
    return asset
  }

  function algorithmAsset(
    parameters: ConsumerParameterV5[] = [numberParameter]
  ): AssetV5 {
    const asset = getAlgorithmAssetFixture()
    asset.id = ALGO_DID
    asset.credentialSubject.id = ALGO_DID
    Object.assign(
      asset.credentialSubject.metadata.algorithm as object,
      parameters.length ? { consumerParameters: parameters } : {}
    )
    return asset
  }

  function run(
    config: Pick<Parameters<typeof compute>[0], 'dataset' | 'algorithm'>,
    algorithm = algorithmAsset(),
    start: typeof compute | typeof freeCompute = compute
  ) {
    const { client, calls } = recordingNode({
      [ASSET_DID]: datasetAsset(),
      [ALGO_DID]: algorithm
    })
    const running = start(config, {
      node: client,
      signer,
      chainConfig,
      credentials,
      escrow: '0x00000000000000000000000000000000000e5c40'
    })

    return { running, calls }
  }

  it("refuses a dataset's userdata of the wrong type with nothing sent", async () => {
    const { running, calls } = run({
      dataset: { did: ASSET_DID, userdata: { age: 'x' } },
      algorithm: { did: ALGO_DID }
    })

    const error = await rejection(running)

    expect(error).to.be.instanceOf(ConsumerParameterError)
    expect(error).to.include({
      did: ASSET_DID,
      serviceId: SERVICE_ID,
      field: 'userdata'
    })
    expectNothingSent(calls)
  })

  it("checks algocustomdata against the algorithm's metadata parameters", async () => {
    const { running, calls } = run({
      dataset: { did: ASSET_DID },
      algorithm: { did: ALGO_DID, algocustomdata: { age: true } }
    })

    const error = await rejection(running)

    expect(error).to.be.instanceOf(ConsumerParameterError)
    expect(error).to.include({ did: ALGO_DID, field: 'algocustomdata' })
    expectNothingSent(calls)
  })

  it('reads algorithm parameters nested under the container too', async () => {
    const algorithm = algorithmAsset([])
    Object.assign(
      (algorithm.credentialSubject.metadata.algorithm as { container: object })
        .container,
      { consumerParameters: [{ ...numberParameter, required: true }] }
    )

    const { running, calls } = run(
      { dataset: { did: ASSET_DID }, algorithm: { did: ALGO_DID } },
      algorithm
    )

    expect((await rejection(running)).message).to.match(/'age' is required/)
    expectNothingSent(calls)
  })

  it("checks the algorithm's userdata against its service", async () => {
    const algorithm = algorithmAsset([])
    algorithm.credentialSubject.services[0].consumerParameters = [
      numberParameter
    ] as unknown as AssetV5['credentialSubject']['services'][0]['consumerParameters']

    const { running, calls } = run(
      {
        dataset: { did: ASSET_DID },
        algorithm: { did: ALGO_DID, userdata: { epochs: 3 } }
      },
      algorithm
    )

    const error = await rejection(running)

    expect(error).to.include({ did: ALGO_DID, field: 'userdata' })
    expect(error.message).to.match(/'epochs' is not a declared parameter/)
    expectNothingSent(calls)
  })

  it('applies to freeCompute() as well', async () => {
    const { running, calls } = run(
      {
        dataset: { did: ASSET_DID, userdata: { age: 'x' } },
        algorithm: { did: ALGO_DID }
      },
      algorithmAsset(),
      freeCompute
    )

    expect(await rejection(running)).to.be.instanceOf(ConsumerParameterError)
    expectNothingSent(calls)
  })

  it('lets fitting values through to the node', async () => {
    const { running, calls } = run({
      dataset: { did: ASSET_DID, userdata: { age: 1 } },
      algorithm: { did: ALGO_DID, algocustomdata: { age: 2 } }
    })

    expect((await rejection(running)).message).to.equal(PASSED)
    expect(calls).to.deep.equal(['getComputeEnvironments'])
  })
})
