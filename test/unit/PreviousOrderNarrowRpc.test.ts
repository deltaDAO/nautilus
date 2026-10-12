/**
 * The previous-order lookup on an RPC that serves only narrow `eth_getLogs` ranges.
 *
 * A live run on OP Sepolia (2 s blocks) refused the first purchase of a 24 h service: its
 * RPC answered `eth_getLogs` for about 100 blocks at most, the lookup halved its 2 000-block
 * chunk to 62 blocks and ran out of its 100 rounds after about 3.3 of the 24 hours. These
 * tests run the lookup through a real `JsonRpcProvider` against a local JSON-RPC stub that
 * refuses wider ranges with the error bodies RPCs use, on a chain of 60 000 blocks.
 */
import { createServer, type Server } from 'node:http'
import type { Config } from '@oceanprotocol/lib'
import {
  hexlify,
  Interface,
  JsonRpcProvider,
  Network,
  type Signer,
  toBeHex,
  toUtf8Bytes,
  ZeroHash,
  zeroPadValue
} from 'ethers'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import { OrderCheckError, settleOrder } from '../../src/access/index.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  findPreviousOrder,
  IncompleteOrderLookupError
} from '../../src/utils/previousOrder.js'
import { CHAIN_ID, DATATOKEN_ADDRESS, SERVICE_ID } from '../fixtures/Asset.js'
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
  getOrderPrice: vi.fn(async () => ({
    total: '0',
    publishMarketFee: '0',
    consumeMarketFee: '0'
  }))
}))

const CONSUMER = '0x0000000000000000000000000000000000c05e5a'
const OTHER = '0x0000000000000000000000000000000000000bad'
const DAY = 86_400
/** The newest block of the stub chain, and its seconds per block (OP Sepolia's). */
const HEAD = 60_000
const BLOCK_TIME = 2

const EVENTS = new Interface([
  'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)',
  'event ProviderFee(address indexed providerFeeAddress, address indexed providerFeeToken, uint256 providerFeeAmount, bytes providerData, uint8 v, bytes32 r, bytes32 s, uint256 validUntil)'
])

const providerData = hexlify(
  toUtf8Bytes(
    JSON.stringify({ dt: DATATOKEN_ADDRESS.toLowerCase(), id: SERVICE_ID })
  )
)

/** Range refusals as RPCs word them, by JSON-RPC code. */
const REFUSALS = {
  'block range too large (-32000)': (cap: number) => ({
    code: -32000,
    message: `block range too large, max ${cap} blocks`
  }),
  'query returned more than (-32005)': (cap: number) => ({
    code: -32005,
    message: `query returned more than 10000 results. Try with this block range [0x0, ${toBeHex(cap)}].`
  }),
  'eth_getLogs is limited to a range (-32600)': (cap: number) => ({
    code: -32600,
    message: `eth_getLogs is limited to a ${cap} block range`
  })
} as const

type Refusal = keyof typeof REFUSALS

interface StubLog {
  address: string
  topics: string[]
  data: string
  blockNumber: number
  transactionHash: string
  logIndex: number
}

/** A JSON-RPC server for one chain of `HEAD` blocks, `now` being the head's time. */
class StubRpc {
  server!: Server
  url = ''
  now = 0
  /** Widest `eth_getLogs` range served, in blocks. */
  cap = 100
  refusal: Refusal = 'block range too large (-32000)'
  /** Milliseconds before each answer. */
  latency = 0
  logs: StubLog[] = []
  receipts = new Map<string, { to: string; blockNumber: number }>()
  served = 0
  refused = 0

  async start() {
    this.server = createServer((incoming, outgoing) => {
      let body = ''
      incoming.on('data', (chunk) => {
        body += chunk
      })
      incoming.on('end', async () => {
        const payload = JSON.parse(body)
        if (this.latency)
          await new Promise((resolve) => setTimeout(resolve, this.latency))
        const answers = (Array.isArray(payload) ? payload : [payload]).map(
          (message: { id: number; method: string; params: unknown[] }) => ({
            jsonrpc: '2.0',
            id: message.id,
            ...this.answer(message.method, message.params)
          })
        )
        outgoing.setHeader('content-type', 'application/json')
        outgoing.end(
          JSON.stringify(Array.isArray(payload) ? answers : answers[0])
        )
      })
    })
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', () => resolve())
    )
    const { port } = this.server.address() as { port: number }
    this.url = `http://127.0.0.1:${port}/`
  }

  stop() {
    return new Promise((resolve) => this.server.close(resolve))
  }

  reset(cap: number, refusal: Refusal = 'block range too large (-32000)') {
    this.now = Math.floor(Date.now() / 1000)
    this.cap = cap
    this.refusal = refusal
    this.latency = 0
    this.logs = []
    this.receipts.clear()
    this.served = 0
    this.refused = 0
  }

  timeOf(block: number) {
    return this.now - (HEAD - block) * BLOCK_TIME
  }

  /** A transaction to the datatoken, `secondsAgo`: an order of the account and its fee. */
  order(txId: string, secondsAgo: number) {
    const block = HEAD - Math.floor(secondsAgo / BLOCK_TIME)
    this.receipts.set(txId, { to: DATATOKEN_ADDRESS, blockNumber: block })
    const emit = (name: string, args: unknown[]) => {
      const { data, topics } = EVENTS.encodeEventLog(name, args)
      this.logs.push({
        address: DATATOKEN_ADDRESS.toLowerCase(),
        topics,
        data,
        blockNumber: block,
        transactionHash: txId,
        logIndex: this.logs.length
      })
    }
    emit('ProviderFee', [
      PROVIDER_FEE_WALLET.address,
      PROVIDER_FEE_TOKEN,
      0,
      providerData,
      27,
      ZeroHash,
      ZeroHash,
      this.timeOf(block) + DAY
    ])
    emit('OrderStarted', [
      CONSUMER,
      CONSUMER,
      10n ** 18n,
      0,
      this.timeOf(block),
      OTHER,
      block
    ])
  }

  private answer(method: string, params: unknown[]) {
    switch (method) {
      case 'eth_chainId':
        return { result: toBeHex(CHAIN_ID) }
      case 'eth_blockNumber':
        return { result: toBeHex(HEAD) }
      case 'eth_getBlockByNumber': {
        const tag = params[0] as string
        const number = tag === 'latest' ? HEAD : Number(tag)
        return number > HEAD ? { result: null } : { result: this.block(number) }
      }
      case 'eth_getLogs': {
        const filter = params[0] as {
          address: string
          topics: (string | null)[]
          fromBlock: string
          toBlock: string
        }
        const from = Number(filter.fromBlock)
        const to = Number(filter.toBlock)
        if (to - from + 1 > this.cap) {
          this.refused++
          return { error: REFUSALS[this.refusal](this.cap) }
        }
        this.served++
        return {
          result: this.logs
            .filter(
              (log) =>
                log.address === filter.address.toLowerCase() &&
                log.blockNumber >= from &&
                log.blockNumber <= to &&
                filter.topics.every(
                  (topic, i) =>
                    topic === null || log.topics[i] === topic.toLowerCase()
                )
            )
            .map((log) => this.log(log))
        }
      }
      case 'eth_getTransactionReceipt': {
        const txId = params[0] as string
        const receipt = this.receipts.get(txId)
        if (!receipt) return { result: null }
        return {
          result: {
            transactionHash: txId,
            transactionIndex: '0x0',
            blockHash: this.hash(receipt.blockNumber),
            blockNumber: toBeHex(receipt.blockNumber),
            from: CONSUMER,
            to: receipt.to,
            contractAddress: null,
            cumulativeGasUsed: '0x5208',
            gasUsed: '0x5208',
            effectiveGasPrice: '0x1',
            logsBloom: `0x${'0'.repeat(512)}`,
            status: '0x1',
            type: '0x2',
            logs: this.logs
              .filter((log) => log.transactionHash === txId)
              .map((log) => this.log(log))
          }
        }
      }
      default:
        return { error: { code: -32601, message: `no ${method}` } }
    }
  }

  private hash(block: number) {
    return zeroPadValue(toBeHex(block + 1), 32)
  }

  private block(number: number) {
    return {
      hash: this.hash(number),
      parentHash: this.hash(number - 1),
      number: toBeHex(number),
      timestamp: toBeHex(this.timeOf(number)),
      nonce: '0x0000000000000000',
      difficulty: '0x0',
      gasLimit: '0x1c9c380',
      gasUsed: '0x0',
      miner: OTHER,
      extraData: '0x',
      baseFeePerGas: '0x1',
      transactions: []
    }
  }

  private log(log: StubLog) {
    return {
      address: log.address,
      topics: log.topics,
      data: log.data,
      blockNumber: toBeHex(log.blockNumber),
      blockHash: this.hash(log.blockNumber),
      transactionHash: log.transactionHash,
      transactionIndex: '0x0',
      logIndex: toBeHex(log.logIndex),
      removed: false
    }
  }
}

const rpc = new StubRpc()
let provider: JsonRpcProvider

const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

const query = (timeout = DAY) => ({
  provider,
  datatokenAddress: DATATOKEN_ADDRESS,
  account: CONSUMER,
  serviceIndex: 0,
  serviceId: SERVICE_ID,
  timeout,
  providerFeeAddress: PROVIDER_FEE_WALLET.address
})

/** `settleOrder` for a paid service with a 24 h timeout: the fee quoted costs 30. */
function settle() {
  const signer = {
    getAddress: async () => CONSUMER,
    provider
  } as unknown as Signer

  return settleOrder({
    signer,
    chainConfig: {
      chainId: CHAIN_ID,
      dispenserAddress: '0x0000000000000000000000000000000000d15e45'
    } as unknown as Config,
    datatokenAddress: DATATOKEN_ADDRESS,
    serviceIndex: 0,
    initialized: {
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '30' })
    },
    consumer: CONSUMER,
    service: { id: SERVICE_ID, timeout: DAY },
    maxProviderFee: { token: PROVIDER_FEE_TOKEN, amount: 10n ** 30n }
  })
}

/** Blocks a 24 h window spans at 2 s blocks. */
const DAY_BLOCKS = DAY / BLOCK_TIME

beforeAll(() => rpc.start())
afterAll(() => rpc.stop())

beforeEach(() => {
  vi.clearAllMocks()
  rpc.reset(100)
  provider = new JsonRpcProvider(rpc.url, Network.from(CHAIN_ID), {
    staticNetwork: true,
    batchStallTime: 0
  })
})

afterEach(() => provider.destroy())

describe('the previous-order lookup on an RPC that serves 100 blocks per eth_getLogs', () => {
  for (const refusal of Object.keys(REFUSALS) as Refusal[])
    it(`covers a 24 h window with no order: ${refusal}`, async () => {
      rpc.reset(100, refusal)

      expect(await findPreviousOrder(query())).to.equal(undefined)
      // Every block of the window was read.
      expect(rpc.served / 2).to.be.at.least(Math.ceil(DAY_BLOCKS / 100))
    }, 60_000)

  it('finds an order 20 hours old and buys nothing', async () => {
    rpc.order(tx(1), 20 * 3_600)

    expect(await findPreviousOrder(query())).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: tx(1)
    })
    expect(await settle()).to.deep.equal({ transferTxId: tx(1), reused: true })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  }, 60_000)

  it('orders when the whole window holds no order', async () => {
    expect(await settle()).to.deep.equal({
      transferTxId: '0xfresh',
      reused: false
    })
    expect(vi.mocked(order)).toHaveBeenCalledTimes(1)
  }, 60_000)

  it('reads 43 200 blocks in about 432 rounds, keeping the chunk that worked', async () => {
    rpc.latency = 5
    const started = Date.now()

    expect(await findPreviousOrder(query())).to.equal(undefined)

    const elapsed = Date.now() - started
    // Two `eth_getLogs` per round; 2 000, 1 000, 500 and 200 blocks refused once each.
    const rounds = rpc.served / 2
    expect(rounds).to.be.at.least(DAY_BLOCKS / 100)
    // The window starts up to one chunk of 2 000 blocks before the cutoff.
    expect(rounds).to.be.at.most((DAY_BLOCKS + 2_000) / 100 + 1)
    expect(rpc.refused / 2).to.equal(4)
    // One answer per round at 5 ms each, sequential: seconds, not minutes.
    expect(elapsed).to.be.at.least(rounds * rpc.latency)
    expect(elapsed).to.be.below(30_000)
  }, 60_000)
})

describe('the previous-order lookup on narrower or slower RPCs', () => {
  it('covers the window on an RPC that serves 2 000 blocks (control)', async () => {
    rpc.reset(2_000)

    expect(await findPreviousOrder(query())).to.equal(undefined)
    expect(rpc.refused).to.equal(0)
  })

  it('still stops before paying on an RPC that serves fewer than 100 blocks', async () => {
    rpc.reset(50)

    const lookup = await findPreviousOrder(query()).catch((error) => error)
    expect(lookup).to.be.instanceOf(IncompleteOrderLookupError)
    expect(lookup).to.include({ windowHours: 24, limit: 'reads' })
    // Its reads, sized for 100 blocks each, cover about half the window at 50.
    expect(lookup.checkedHours).to.be.within(10, 24)

    const thrown = await settle().catch((caught) => caught)
    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown).to.include({ reason: 'incomplete', windowHours: 24 })
    expect(thrown.message).to.contain('Nothing was ordered or paid')
    expect(thrown.message).to.contain('Use another RPC, or retry.')
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  }, 60_000)

  it('ends a lookup on a slow RPC at its time limit, as incomplete', async () => {
    rpc.latency = 20
    const started = Date.now()

    const thrown = await findPreviousOrder(query(), {
      timeLimit: 500
    }).catch((error) => error)

    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({ windowHours: 24, limit: 'reads' })
    expect(thrown.checkedHours).to.be.below(1)
    expect(Date.now() - started).to.be.below(1_500)
  }, 60_000)
})
