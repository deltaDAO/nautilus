/**
 * The checks `access()` and `compute()` run on the resolved asset before anything else:
 * the service exists and has the right type, and `userdata` / `algocustomdata` fit the
 * declared consumer parameters. Every refusal must happen with nothing sent: the node is
 * only asked for the DDO, no policy session is opened, and no order or transaction is
 * touched. A request that passes reaches the policy sessions and the node, with only the
 * checked values.
 */

import { type Config, ProviderInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access } from '../../src/access/index.js'
import { compute, freeCompute } from '../../src/compute/index.js'
import type { AssetV5, ConsumerParameterV5 } from '../../src/ddo/index.js'
import type { PolicySessionResolver } from '../../src/identity/PolicySessionResolver.js'
import { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
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

/** The one environment the node mock offers: paid and free. */
const ENVIRONMENT = {
  id: 'env-1',
  consumerAddress: '0x00000000000000000000000000000000000000c0',
  resources: [{ id: 'cpu', min: 1, max: 4 }],
  fees: {
    [String(CHAIN_ID)]: [
      { feeToken: '0xfee0000000000000000000000000000000000000' }
    ]
  },
  free: { resources: [{ id: 'cpu', min: 1, max: 1 }] },
  maxJobDuration: 3600
}

/**
 * A node client that answers `resolve` from `assets` and records every other call with its
 * arguments. `forEndpoint` and `getComputeEnvironments` answer, so a request that is let
 * through goes on to the policy sessions; every other call throws `PASSED`.
 */
function recordingNode(assets: Record<string, AssetV5>) {
  const calls: string[] = []
  const args: Record<string, unknown[]> = {}

  const client: OceanNodeClient = new Proxy(
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

        return (...callArgs: unknown[]) => {
          calls.push(String(property))
          args[String(property)] = callArgs

          if (property === 'forEndpoint') return client
          if (property === 'getComputeEnvironments')
            return Promise.resolve([ENVIRONMENT])
          throw new Error(PASSED)
        }
      }
    }
  ) as OceanNodeClient

  return { client, calls, args }
}

const sendTransaction = vi.fn()
const signer = {
  getAddress: async () => '0x0000000000000000000000000000000000c05e5a',
  sendTransaction
} as unknown as Signer
const chainConfig = { chainId: CHAIN_ID } as unknown as Config
/** Opens no session; a refused request must never get this far. */
const policySessions = {
  resolve: vi.fn(async () => undefined)
} as unknown as PolicySessionResolver

/** The download fixture with one parameter of each type; `surname` is required. */
function accessAsset(): AssetV5 {
  const asset = getAssetFixture()
  asset.credentialSubject.services[0].consumerParameters =
    getConsumerParameters() as unknown as AssetV5['credentialSubject']['services'][0]['consumerParameters']
  return asset
}

function expectNothingSent(calls: string[]) {
  expect(vi.mocked(policySessions.resolve)).not.toHaveBeenCalled()
  expect(calls).to.deep.equal([])
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
  vi.restoreAllMocks()
})

describe('access() pre-order checks', () => {
  function accessWith(
    asset: AssetV5,
    config: Partial<Parameters<typeof access>[0]> = {}
  ) {
    const { client, calls, args } = recordingNode({ [asset.id]: asset })
    const accessing = access(
      { assetDid: asset.id, ...config },
      { node: client, signer, chainConfig, policySessions }
    )

    return { accessing, calls, args }
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
      message: `'age' must be a finite number, got a string of 12 characters`
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

  it('refuses any value for a select that declares no options, with nothing sent', async () => {
    const asset = accessAsset()
    const [, , , region] = asset.credentialSubject.services[0]
      .consumerParameters as ConsumerParameterV5[]
    region.options = []

    const { accessing, calls } = accessWith(asset, {
      userdata: { surname: 'Doe', region: 'eu' }
    })

    const error = await rejection(accessing)

    expect(error).to.be.instanceOf(ConsumerParameterError)
    expect((error as ConsumerParameterError).issues).to.deep.equal([
      {
        parameter: 'region',
        reason: 'invalid-declaration',
        message: `'region' is declared as a select without any usable options, so no value can be accepted until the asset's declaration is fixed`
      }
    ])
    expectNothingSent(calls)
  })

  it('lets fitting userdata through to the policy session and the node', async () => {
    const userdata = { surname: 'Doe', age: 3, consent: false, region: 'us' }
    const { accessing, calls, args } = accessWith(accessAsset(), { userdata })

    expect((await rejection(accessing)).message).to.equal(PASSED)
    expect(calls).to.deep.equal(['forEndpoint', 'initialize'])
    expect(vi.mocked(policySessions.resolve)).toHaveBeenCalledOnce()
    expect(args.initialize[2]).to.deep.include({ userdata })
  })

  it('sends userdata without the keys set to null or undefined', async () => {
    const userdata = { surname: 'Doe', age: null, consent: undefined }
    const { accessing, args } = accessWith(accessAsset(), { userdata })

    expect((await rejection(accessing)).message).to.equal(PASSED)
    const sent = (args.initialize[2] as { userdata: object }).userdata
    expect(sent).to.deep.equal({ surname: 'Doe' })
    expect(sent).not.to.have.property('age')
    expect(sent).not.to.have.property('consent')
    // The caller's object is left as it was.
    expect(userdata).to.have.property('age', null)
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
    const { client, calls, args } = recordingNode({
      [ASSET_DID]: datasetAsset(),
      [ALGO_DID]: algorithm
    })
    const running = start(config, {
      node: client,
      signer,
      chainConfig,
      policySessions,
      escrow: '0x00000000000000000000000000000000000e5c40'
    })

    return { running, calls, args }
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

  it('lets fitting values through to the policy sessions and the node', async () => {
    const { running, calls, args } = run({
      dataset: { did: ASSET_DID, userdata: { age: 1 } },
      algorithm: { did: ALGO_DID, algocustomdata: { age: 2 } }
    })

    expect((await rejection(running)).message).to.equal(PASSED)
    expect(calls).to.deep.equal(['getComputeEnvironments', 'initializeCompute'])
    expect(vi.mocked(policySessions.resolve)).toHaveBeenCalledTimes(2)

    const [request] = args.initializeCompute as [
      {
        datasets: { userdata?: object }[]
        algorithm: { algocustomdata?: object }
      }
    ]
    expect(request.datasets[0].userdata).to.deep.equal({ age: 1 })
    expect(request.algorithm.algocustomdata).to.deep.equal({ age: 2 })
  })

  for (const start of [compute, freeCompute])
    it(`${start.name}() sends userdata and algocustomdata without null or undefined keys`, async () => {
      const { running, args } = run(
        {
          dataset: { did: ASSET_DID, userdata: { age: null } },
          algorithm: {
            did: ALGO_DID,
            userdata: { anything: 'goes', dropped: undefined },
            algocustomdata: { age: null }
          }
        },
        (() => {
          const algorithm = algorithmAsset()
          algorithm.credentialSubject.services[0].consumerParameters = []
          return algorithm
        })(),
        start
      )

      expect((await rejection(running)).message).to.equal(PASSED)

      const [request] = (args.initializeCompute ?? args.freeComputeStart) as [
        {
          datasets: { userdata?: object }[]
          algorithm: { userdata?: object; algocustomdata?: object }
        }
      ]
      expect(request.datasets[0].userdata).to.deep.equal({})
      expect(request.algorithm.userdata).to.deep.equal({ anything: 'goes' })
      expect(request.algorithm.algocustomdata).to.deep.equal({})
    })
})

describe('access() download URL', () => {
  const NODE = 'https://node.test.invalid'
  const CONSUMER = '0x0000000000000000000000000000000000c05e5a'

  /**
   * A real `OceanNodeClient` with a pre-computed signature, so ocean.js builds the URL
   * itself without asking the node for a nonce. Only `resolve` and `initialize` are
   * stubbed: the node offers a reusable, fee-free order, so nothing is sent on chain.
   */
  async function downloadUrl(userdata: Record<string, unknown>) {
    const asset = getAssetFixture()
    asset.credentialSubject.services[0].consumerParameters = [
      { name: 'query', type: 'text', label: 'Query', required: true },
      { name: 'rows', type: 'number', label: 'Rows', required: false }
    ] as unknown as AssetV5['credentialSubject']['services'][0]['consumerParameters']

    const node = new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: { consumerAddress: CONSUMER, nonce: '7', signature: '0x5167' }
    })
    vi.spyOn(node, 'resolve').mockResolvedValue(asset)
    vi.spyOn(ProviderInstance, 'initialize').mockResolvedValue({
      datatoken: asset.credentialSubject.services[0].datatokenAddress,
      validOrder: '0xexisting',
      providerFee: { providerFeeAmount: '0' }
    } as never)

    const { url } = await access(
      { assetDid: asset.id, userdata },
      { node, signer, chainConfig, policySessions }
    )

    return url
  }

  it('encodes userdata as one query component, for values holding & # + = and 1e21', async () => {
    const userdata = { query: 'a&b=c#d+e f', rows: 1e21 }

    const url = await downloadUrl(userdata)

    expect(url).to.equal(
      `${NODE}/api/services/download?fileIndex=0&documentId=${ASSET_DID}&transferTxId=0xexisting&serviceId=${SERVICE_ID}&consumerAddress=${CONSUMER}&nonce=7&signature=0x5167` +
        '&userdata=%7B%22query%22%3A%22a%26b%3Dc%23d%2Be%20f%22%2C%22rows%22%3A1e%2B21%7D'
    )
    // The node reads it back as it was sent.
    const sent = new URL(url).searchParams.get('userdata')
    expect(JSON.parse(sent as string)).to.deep.equal(userdata)
  })

  it('appends only the cleaned userdata', async () => {
    const url = await downloadUrl({ query: 'x', rows: null })

    expect(url.endsWith('&userdata=%7B%22query%22%3A%22x%22%7D')).to.equal(true)
  })

  it('hands userdata to ocean.js as an object over P2P', async () => {
    const download = vi
      .spyOn(ProviderInstance, 'getDownloadUrl')
      .mockResolvedValue({ data: new ArrayBuffer(0), filename: 'file0' })
    const node = new OceanNodeClient({
      nodeUri: '16Uiu2HAmQU8YmsACkFjkaFqEECLN3Csu6JgoU3hw9EsPmk7i9TFL',
      chainId: CHAIN_ID,
      auth: { consumerAddress: CONSUMER, nonce: '7', signature: '0x5167' }
    })
    const userdata = { query: 'a&b' }

    await node.getDownloadUrl(ASSET_DID, SERVICE_ID, '0xorder', { userdata })

    expect(download.mock.calls[0][7]).to.equal(userdata)
  })
})
