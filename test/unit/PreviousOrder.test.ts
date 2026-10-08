/**
 * Reusing a download order the node does not report.
 *
 * ocean-node's access `initialize` returns no `validOrder`, so `access()` looks the
 * account's previous order up in the datatoken's events and keeps it only where the node's
 * download check would accept it: consumer or payer, service index, timeout counted from
 * the `OrderStarted` block, and a `ProviderFee` from the node's fee address for this
 * service that has not expired. The chain here is an in-memory log store.
 */
import type { Config } from '@oceanprotocol/lib'
import {
  hexlify,
  Interface,
  type Log,
  type Provider,
  type Signer,
  toUtf8Bytes,
  ZeroHash
} from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, settleOrder } from '../../src/access/index.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  findPreviousOrder,
  type PreviousOrderQuery
} from '../../src/utils/previousOrder.js'
import {
  ASSET_DID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import {
  PROVIDER_FEE_TOKEN,
  PROVIDER_FEE_WALLET,
  signedProviderFee
} from '../fixtures/ProviderFee.js'

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(async () => ({ transferTxId: '0xfresh', reused: false })),
  reuseOrder: vi.fn(async () => ({ transferTxId: '0xreusetx', reused: true }))
}))

vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async (_signer: unknown, datatokenAddress: string) => ({
    schema: 'free',
    templateId: 1,
    datatokenAddress,
    publishMarketFee: {}
  })),
  getOrderPrice: vi.fn(async () => ({ total: '0', consumeMarketFee: '0' }))
}))

const CONSUMER = '0x0000000000000000000000000000000000c05e5a'
const OTHER = '0x0000000000000000000000000000000000000bad'
const NOW = 1_800_000_000
const DAY = 86_400
const LATEST = 500_000
/** Seconds per block on the in-memory chain. */
const BLOCK_TIME = 2

const EVENTS = new Interface([
  'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)',
  'event OrderReused(bytes32 orderTxId, address caller, uint256 timestamp, uint256 number)',
  'event ProviderFee(address indexed providerFeeAddress, address indexed providerFeeToken, uint256 providerFeeAmount, bytes providerData, uint8 v, bytes32 r, bytes32 s, uint256 validUntil)'
])

const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

/** The block mined `secondsAgo` before `NOW`. */
const blockAt = (secondsAgo: number) =>
  LATEST - Math.floor(secondsAgo / BLOCK_TIME)
const timeOf = (block: number) => NOW - (LATEST - block) * BLOCK_TIME

class Chain {
  logs: Log[] = []
  getLogs = vi.fn(
    async (filter: {
      address: string
      topics: string[][]
      fromBlock: number
      toBlock: number
    }) =>
      this.logs.filter(
        (log) =>
          log.address.toLowerCase() === filter.address.toLowerCase() &&
          filter.topics[0].includes(log.topics[0]) &&
          log.blockNumber >= filter.fromBlock &&
          log.blockNumber <= filter.toBlock
      )
  )
  getBlockNumber = vi.fn(async () => LATEST)
  getBlock = vi.fn(async (block: number) => ({ timestamp: timeOf(block) }))

  private emit(
    name: string,
    args: unknown[],
    at: { txId: string; block: number },
    address = DATATOKEN_ADDRESS
  ): void {
    const { data, topics } = EVENTS.encodeEventLog(name, args)

    this.logs.push({
      address,
      data,
      topics,
      blockNumber: at.block,
      index: this.logs.length,
      transactionHash: at.txId,
      removed: false
    } as unknown as Log)
  }

  /** An order and the fee it paid, in one transaction. */
  started(
    txId: string,
    secondsAgo: number,
    options: {
      consumer?: string
      payer?: string
      serviceIndex?: number
      fee?: FeeOptions | false
    } = {}
  ): void {
    const block = blockAt(secondsAgo)
    const at = { txId, block }

    if (options.fee !== false) this.fee(at, secondsAgo, options.fee)

    this.emit(
      'OrderStarted',
      [
        options.consumer ?? CONSUMER,
        options.payer ?? options.consumer ?? CONSUMER,
        10n ** 18n,
        options.serviceIndex ?? 0,
        timeOf(block),
        OTHER,
        block
      ],
      at
    )
  }

  reused(
    txId: string,
    orderTxId: string,
    secondsAgo: number,
    fee?: FeeOptions
  ): void {
    const block = blockAt(secondsAgo)
    const at = { txId, block }

    this.emit('OrderReused', [orderTxId, CONSUMER, timeOf(block), block], at)
    this.fee(at, secondsAgo, fee)
  }

  private fee(
    at: { txId: string; block: number },
    secondsAgo: number,
    fee: FeeOptions = {}
  ): void {
    this.emit(
      'ProviderFee',
      [
        fee.address ?? PROVIDER_FEE_WALLET.address,
        PROVIDER_FEE_TOKEN,
        0,
        hexlify(
          toUtf8Bytes(
            JSON.stringify({
              dt: DATATOKEN_ADDRESS.toLowerCase(),
              id: fee.serviceId ?? SERVICE_ID
            })
          )
        ),
        27,
        ZeroHash,
        ZeroHash,
        fee.validUntil ?? NOW - secondsAgo + DAY
      ],
      at
    )
  }
}

interface FeeOptions {
  address?: string
  serviceId?: string
  validUntil?: number
}

let chain: Chain

function query(
  overrides: Partial<PreviousOrderQuery> = {}
): PreviousOrderQuery {
  return {
    provider: chain as unknown as Provider,
    datatokenAddress: DATATOKEN_ADDRESS,
    account: CONSUMER,
    serviceIndex: 0,
    serviceId: SERVICE_ID,
    timeout: DAY,
    providerFeeAddress: PROVIDER_FEE_WALLET.address,
    ...overrides
  }
}

const find = (overrides: Partial<PreviousOrderQuery> = {}) =>
  findPreviousOrder(query(overrides), { now: NOW })

beforeEach(() => {
  vi.clearAllMocks()
  chain = new Chain()
})

describe('findPreviousOrder', () => {
  it('finds a valid order whose fee the node still accepts, in one log read', async () => {
    chain.started(tx(1), 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    expect(chain.getLogs).toHaveBeenCalledOnce()
    expect(chain.getBlock).not.toHaveBeenCalled()
  })

  it('takes the newest order and the newest reuse of it with an accepted fee', async () => {
    chain.started(tx(1), 20_000)
    chain.started(tx(2), 10_000)
    chain.reused(tx(3), tx(2), 5_000)
    chain.reused(tx(4), tx(2), 1_000, { serviceId: 'another-service' })

    expect(await find()).to.deep.equal({ orderTxId: tx(2), usableTxId: tx(3) })
  })

  it('refuses an order past the service timeout', async () => {
    chain.started(tx(1), DAY + 10)

    expect(await find()).to.equal(undefined)
  })

  it('counts the timeout from the order, not from a later reuse', async () => {
    chain.started(tx(1), DAY + 10)
    chain.reused(tx(2), tx(1), 100)

    expect(await find()).to.equal(undefined)
  })

  it('refuses an order about to expire, since the URL is downloaded later', async () => {
    chain.started(tx(1), DAY - 30)

    expect(await find()).to.equal(undefined)
  })

  it('refuses another account’s order', async () => {
    chain.started(tx(1), 3_600, { consumer: OTHER })

    expect(await find()).to.equal(undefined)
  })

  it('accepts an order the account paid for, as the node does', async () => {
    chain.started(tx(1), 3_600, { consumer: OTHER, payer: CONSUMER })

    expect((await find())?.orderTxId).to.equal(tx(1))
  })

  it('refuses an order for another service index', async () => {
    chain.started(tx(1), 3_600, { serviceIndex: 1 })

    expect(await find()).to.equal(undefined)
  })

  it('skips an order for another service to reach an older one for this one', async () => {
    chain.started(tx(1), 7_200)
    chain.started(tx(2), 3_600, { serviceIndex: 1 })

    expect((await find())?.orderTxId).to.equal(tx(1))
  })

  it('finds nothing without orders, reading back no further than the timeout', async () => {
    expect(await find()).to.equal(undefined)

    // 86 400 s at 2 s a block is 43 200 blocks: five 10 000-block reads.
    expect(chain.getLogs).toHaveBeenCalledTimes(5)
    for (const [filter] of chain.getLogs.mock.calls)
      expect(filter.toBlock - filter.fromBlock).to.be.below(10_000)
  })

  it('reuses an order of a service with timeout 0 however old, within the read depth', async () => {
    // The node signs such a service's fee with `validUntil` 0.
    chain.started(tx(1), 150_000, { fee: { validUntil: 0 } })

    expect(await find({ timeout: 0 })).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: tx(1)
    })
  })

  it('stops at the read depth for timeout 0', async () => {
    chain.started(tx(1), 2 * 100_000 + 10, { fee: { validUntil: 0 } })

    expect(await find({ timeout: 0 })).to.equal(undefined)
    expect(chain.getLogs).toHaveBeenCalledTimes(10)
    expect(chain.getBlock).not.toHaveBeenCalled()
  })

  it('needs a new fee when the node no longer accepts the order’s', async () => {
    chain.started(tx(1), 3_600, { fee: { validUntil: NOW - 1 } })
    chain.started(tx(2), 3_000, {
      serviceIndex: 1,
      fee: { address: OTHER }
    })

    expect(await find()).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: undefined
    })
  })

  it('needs a new fee when the fee was signed by another node', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })

    expect(await find()).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: undefined
    })
  })

  it('accepts a fee that never expires', async () => {
    chain.started(tx(1), 3_600, { fee: { validUntil: 0 } })

    expect((await find())?.usableTxId).to.equal(tx(1))
  })

  it('ignores another datatoken’s orders', async () => {
    chain.started(tx(1), 3_600)
    for (const log of chain.logs) (log as { address: string }).address = OTHER

    expect(await find()).to.equal(undefined)
  })
})

describe('settleOrder with an order on chain', () => {
  const chainConfig = {
    chainId: 32456,
    dispenserAddress: '0x0000000000000000000000000000000000d15e45'
  } as unknown as Config

  const providerData = hexlify(
    toUtf8Bytes(
      JSON.stringify({ dt: DATATOKEN_ADDRESS.toLowerCase(), id: SERVICE_ID })
    )
  )

  function settle(
    initialized: { validOrder?: string; providerFee?: unknown },
    service: { id: string; timeout: number } | null = {
      id: SERVICE_ID,
      timeout: DAY
    }
  ) {
    const signer = {
      getAddress: async () => CONSUMER,
      provider: chain
    } as unknown as Signer

    return settleOrder({
      signer,
      chainConfig,
      datatokenAddress: DATATOKEN_ADDRESS,
      serviceIndex: 0,
      initialized,
      consumer: CONSUMER,
      service: service ?? undefined,
      maxProviderFee: { token: PROVIDER_FEE_TOKEN, amount: 10n ** 30n }
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW * 1000, toFake: ['Date'] })
    return () => vi.useRealTimers()
  })

  it('uses the order as it stands, sending nothing, even with a fee quoted', async () => {
    chain.started(tx(1), 3_600)

    const result = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '30' })
    })

    expect(result).to.deep.equal({ transferTxId: tx(1), reused: true })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('extends the order with the fee quoted now when the node no longer accepts its fee', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    const providerFee = signedProviderFee({
      providerData,
      providerFeeAmount: '0'
    })

    const result = await settle({ providerFee })

    expect(result).to.deep.equal({ transferTxId: '0xreusetx', reused: true })
    expect(vi.mocked(reuseOrder)).toHaveBeenCalledOnce()
    expect(vi.mocked(reuseOrder).mock.calls[0][0]).to.include({
      validOrderTx: tx(1),
      providerFees: providerFee
    })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('orders anew when there is no order to reuse', async () => {
    chain.started(tx(1), DAY + 10)

    const result = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '0' })
    })

    expect(result).to.deep.equal({ transferTxId: '0xfresh', reused: false })
  })

  it('orders anew when the lookup fails', async () => {
    chain.getLogs.mockRejectedValueOnce(new Error('block range too large'))

    const result = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '0' })
    })

    expect(result.reused).to.equal(false)
  })

  it('follows the node’s validOrder without reading the chain', async () => {
    chain.started(tx(1), 3_600)

    const result = await settle({
      validOrder: '0xnode',
      providerFee: { providerFeeAmount: '0' }
    })

    expect(result).to.deep.equal({ transferTxId: '0xnode', reused: true })
    expect(chain.getLogs).not.toHaveBeenCalled()
  })

  it('reads nothing without the service', async () => {
    chain.started(tx(1), 3_600)

    await settle(
      {
        providerFee: signedProviderFee({ providerData, providerFeeAmount: '0' })
      },
      null
    )

    expect(chain.getLogs).not.toHaveBeenCalled()
    expect(vi.mocked(order)).toHaveBeenCalledOnce()
  })
})

describe('access with an order on chain', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW * 1000, toFake: ['Date'] })
    return () => vi.useRealTimers()
  })

  it('reports the reused order', async () => {
    chain.started(tx(1), 3_600)

    const asset = getAssetFixture()
    const providerFee = signedProviderFee({
      providerData: hexlify(
        toUtf8Bytes(
          JSON.stringify({
            dt: DATATOKEN_ADDRESS.toLowerCase(),
            id: SERVICE_ID
          })
        )
      ),
      providerFeeAmount: '0'
    })

    const node = {
      nodeUri: 'https://node.test.invalid',
      forEndpoint() {
        return node
      },
      resolve: async () => asset,
      hasPolicyServer: async () => false,
      initialize: async () => ({ datatoken: DATATOKEN_ADDRESS, providerFee }),
      getDownloadUrl: vi.fn(async () => 'https://node.test.invalid/download')
    } as unknown as OceanNodeClient

    const signer = {
      getAddress: async () => CONSUMER,
      provider: chain
    } as unknown as Signer

    const result = await access(
      { assetDid: ASSET_DID },
      {
        node,
        signer,
        chainConfig: { chainId: 32456 } as unknown as Config
      }
    )

    expect(result).to.include({ transferTxId: tx(1), reusedOrder: true })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })
})
