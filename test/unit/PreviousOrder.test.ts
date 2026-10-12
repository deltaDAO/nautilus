/**
 * Reusing a download order the node does not report.
 *
 * ocean-node's access `initialize` returns no `validOrder`, so `access()` looks the
 * account's previous orders up in the datatoken's events and checks each transaction from
 * its receipt the way the node's download check does: the first `OrderReused` followed,
 * the first matching `OrderStarted` taken, its service index, the timeout counted from the
 * `OrderStarted` block, and a `ProviderFee` the node keeps. The chain here is an in-memory
 * store of transactions and their logs.
 */
import type { Config } from '@oceanprotocol/lib'
import {
  getAddress,
  hexlify,
  Interface,
  type Log,
  makeError,
  type Provider,
  type Signer,
  toUtf8Bytes,
  ZeroHash
} from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, OrderCheckError, settleOrder } from '../../src/access/index.js'
import { forgetConfirmedOrders } from '../../src/access/settlement.js'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  ProviderFeeNotAllowedError,
  type ProviderFeeQuote
} from '../../src/utils/paymentLimits.js'
import {
  findPreviousOrder,
  IncompleteOrderLookupError,
  InconsistentRpcAnswerError,
  type PreviousOrderQuery,
  StaleRpcHeadError,
  scanTiming
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
import { captureLog } from '../helpers.js'
import { FAKE } from '../secretScan.js'

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
  // As `getOrderPrice` returns it: a missing fee no longer reads as zero.
  getOrderPrice: vi.fn(async () => ({
    total: '0',
    publishMarketFee: '0',
    consumeMarketFee: '0'
  }))
}))

const CONSUMER = '0x0000000000000000000000000000000000c05e5a'
const OTHER = '0x0000000000000000000000000000000000000bad'
const NOW = 1_800_000_000
const DAY = 86_400
const LATEST = 3_000_000
/** Seconds per block on the in-memory chain. */
const BLOCK_TIME = 2
/** The lookup's first chunk, in blocks, and the time an order must have left. */
const CHUNK = 10_000
const MARGIN = 600
/** Blocks the lookup reads back at most, below the newest confirmed one. */
const DEPTH = 1_000_000

const EVENTS = new Interface([
  'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)',
  'event OrderReused(bytes32 orderTxId, address caller, uint256 timestamp, uint256 number)',
  'event ProviderFee(address indexed providerFeeAddress, address indexed providerFeeToken, uint256 providerFeeAmount, bytes providerData, uint8 v, bytes32 r, bytes32 s, uint256 validUntil)'
])

/** The NFT factory, whose `TokenCreated` proves a datatoken's creation block. */
const FACTORY = '0x00000000000000000000000000000000000000f7'
const CREATION = new Interface([
  'event TokenCreated(address indexed newTokenAddress, address indexed templateAddress, string name, string symbol, uint256 cap, address creator)'
])

const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

/** The block mined `secondsAgo` before `NOW`. */
const blockAt = (secondsAgo: number) =>
  LATEST - Math.floor(secondsAgo / BLOCK_TIME)
const timeOf = (block: number) => NOW - (LATEST - block) * BLOCK_TIME

interface LogFilter {
  address: string
  topics: (string | null)[]
  fromBlock: number
  toBlock: number
}

interface FeeOptions {
  address?: string
  serviceId?: string
  validUntil?: number
}

class Chain {
  logs: Log[] = []
  receipts = new Map<
    string,
    { hash: string; to: string | null; blockNumber: number; logs: Log[] }
  >()

  getLogs = vi.fn(async (filter: LogFilter) =>
    this.logs.filter(
      (log) =>
        log.address.toLowerCase() === filter.address.toLowerCase() &&
        filter.topics.every(
          (topic, i) =>
            topic === null ||
            log.topics[i]?.toLowerCase() === topic.toLowerCase()
        ) &&
        log.blockNumber >= filter.fromBlock &&
        log.blockNumber <= filter.toBlock
    )
  )
  getBlock = vi.fn(async (tag: number | 'latest') => {
    const number = tag === 'latest' ? LATEST : tag
    return { number, timestamp: timeOf(number) }
  })
  getTransactionReceipt = vi.fn(
    async (txId: string) => this.receipts.get(txId.toLowerCase()) ?? null
  )
  /** The block the datatoken was created in: before every block, unless `created()`. */
  createdAt = -1
  getCode = vi.fn(async (_address: string, block: number) =>
    block >= this.createdAt ? '0x6080' : '0x'
  )

  /** The datatoken, created in `block` (`log`: with the factory's `TokenCreated`). */
  created(block: number, log = true) {
    this.createdAt = block
    if (!log) return

    const { data, topics } = CREATION.encodeEventLog('TokenCreated', [
      DATATOKEN_ADDRESS,
      OTHER,
      'Datatoken',
      'DT',
      1n,
      OTHER
    ])
    this.logs.push({
      address: FACTORY,
      data,
      topics,
      blockNumber: block,
      index: this.logs.length,
      transactionHash: tx(999_999)
    } as unknown as Log)
  }

  /**
   * A transaction mined `secondsAgo`, sent to `to` (the datatoken, unless another contract
   * placed it); its events are logged in the order they are added.
   */
  tx(txId: string, secondsAgo: number, to: string | null = DATATOKEN_ADDRESS) {
    const block = blockAt(secondsAgo)
    const receipt = { hash: txId, to, blockNumber: block, logs: [] as Log[] }
    this.receipts.set(txId, receipt)

    const emit = (
      name: string,
      args: unknown[],
      address = DATATOKEN_ADDRESS
    ) => {
      const { data, topics } = EVENTS.encodeEventLog(name, args)
      const log = {
        address,
        data,
        topics,
        blockNumber: block,
        index: this.logs.length,
        transactionHash: txId
      } as unknown as Log

      this.logs.push(log)
      receipt.logs.push(log)
    }

    const events = {
      /** An `OrderStarted`, by the datatoken unless `emitter` says otherwise. */
      started(
        options: {
          consumer?: string
          payer?: string
          serviceIndex?: number
          emitter?: string
        } = {}
      ) {
        emit(
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
          options.emitter
        )
        return events
      },
      reused(orderTxId: string, caller = CONSUMER) {
        emit('OrderReused', [orderTxId, caller, timeOf(block), block])
        return events
      },
      /** The node signs `validUntil` as an absolute time: `now + timeout`. */
      fee(fee: FeeOptions = {}) {
        emit('ProviderFee', [
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
        ])
        return events
      }
    }

    return events
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
      to?: string | null
    } = {}
  ): void {
    const events = this.tx(txId, secondsAgo, options.to)

    if (options.fee !== false) events.fee(options.fee)
    events.started(options)
  }

  /** A `reuseOrder` of `orderTxId` and the fee it paid. */
  reused(
    txId: string,
    orderTxId: string,
    secondsAgo: number,
    fee?: FeeOptions
  ): void {
    this.tx(txId, secondsAgo).reused(orderTxId).fee(fee)
  }
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
    nftFactoryAddress: FACTORY,
    ...overrides
  }
}

/** The order found, without its start time (checked on its own). */
const find = (overrides: Partial<PreviousOrderQuery> = {}) =>
  findPreviousOrder(query(overrides), { now: NOW }).then(withoutStart)

function withoutStart<T extends { startedAt?: number } | undefined>(found: T) {
  if (!found) return found
  const { startedAt: _, ...rest } = found
  return rest
}

/** The block ranges `eth_getLogs` was asked for, newest first, one per round. */
const ranges = () =>
  chain.getLogs.mock.calls
    .filter((_, i) => i % 2 === 0)
    .map(([filter]) => [filter.fromBlock, filter.toBlock])

/**
 * The error ethers throws when the RPC keeps answering HTTP 429: after its own retries it
 * reports a 599 whose status text keeps the 429, and a message ("exceeded maximum retry
 * limit") that reads like a range refusal.
 */
const rateLimited = () =>
  makeError('exceeded maximum retry limit', 'SERVER_ERROR', {
    info: {
      requestUrl: FAKE.rpcUrl,
      responseStatus:
        '599 CLIENT ESCALATED SERVER ERROR (429 Too Many Requests; exceeded maximum retry limit)'
    }
  } as never)

/** A JSON-RPC error answer, as ethers wraps it. */
const rpcError = (code: number, message: string) =>
  Object.assign(
    new Error(
      `could not coalesce error (error={ "code": ${code}, "message": "${message}" })`
    ),
    { code: 'UNKNOWN_ERROR', error: { code, message } }
  )

const REUSED = EVENTS.getEvent('OrderReused')?.topicHash

/** What `find()` threw (or found). */
const failure = (overrides: Partial<PreviousOrderQuery> = {}) =>
  find(overrides).then(
    (found) => found as unknown as IncompleteOrderLookupError,
    (error: IncompleteOrderLookupError) => error
  )

beforeEach(() => {
  vi.clearAllMocks()
  // Each test is a fresh process: no order recorded by an earlier one.
  forgetConfirmedOrders()
  chain = new Chain()
  // No real waits between rate-limited reads.
  vi.spyOn(scanTiming, 'sleep').mockResolvedValue()
})

describe('findPreviousOrder', () => {
  it('finds a valid order whose fee the node keeps, in one round of log reads', async () => {
    chain.started(tx(1), 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    expect(chain.getLogs).toHaveBeenCalledTimes(2)
  })

  it('reads only the account’s orders, and every reuse to filter by caller', async () => {
    chain.started(tx(1), 3_600)
    await find()

    const [[started], [reused]] = chain.getLogs.mock.calls

    expect(started.topics).to.deep.equal([
      EVENTS.getEvent('OrderStarted')?.topicHash,
      `0x${CONSUMER.slice(2).padStart(64, '0')}`
    ])
    expect(reused.topics).to.deep.equal([
      EVENTS.getEvent('OrderReused')?.topicHash
    ])
  })

  it('takes the newest transaction of an order whose fee the node keeps', async () => {
    chain.started(tx(1), 20_000)
    chain.started(tx(2), 10_000)
    chain.reused(tx(3), tx(2), 5_000)
    chain.reused(tx(4), tx(2), 1_000, { serviceId: 'another-service' })

    expect(await find()).to.deep.equal({ orderTxId: tx(2), usableTxId: tx(3) })
  })

  it('follows a reuse in a newer chunk to its order in an older one', async () => {
    chain.started(tx(1), 20_000, { fee: { address: OTHER } })
    chain.reused(tx(2), tx(1), 100)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(2) })
    // Found in the first round: the order is read from its receipt.
    expect(chain.getLogs).toHaveBeenCalledTimes(2)
    expect(chain.getTransactionReceipt).toHaveBeenCalledWith(tx(1))
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

  it('orders anew with less than the margin left, since a reuse does not restart the timeout', async () => {
    chain.started(tx(1), DAY - MARGIN + 10, { fee: { address: OTHER } })

    expect(await find()).to.equal(undefined)

    chain = new Chain()
    chain.started(tx(1), DAY - MARGIN - 10, { fee: { address: OTHER } })

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
  })

  it('reuses an order of a service whose timeout is within the margin while half of it is left', async () => {
    // A fast retry used to buy again: every order of such a service counted as too old.
    chain.started(tx(1), 10)

    expect(await find({ timeout: MARGIN })).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: tx(1)
    })

    chain = new Chain()
    chain.started(tx(1), MARGIN / 2 + 10)

    expect(await find({ timeout: MARGIN })).to.equal(undefined)
  })

  it('treats a missing timeout as never expiring, as the node does', async () => {
    chain.started(tx(1), 150_000)

    for (const timeout of [undefined, Number.NaN])
      expect(await find({ timeout })).to.deep.equal({
        orderTxId: tx(1),
        usableTxId: tx(1)
      })
  })

  it('refuses rather than reuses or ignores an order without confirmations', async () => {
    // A reorg may drop it, so it is not reused; read as "no order", a retry right after a
    // purchase bought again.
    chain.started(tx(1), 2)

    const thrown = await failure()

    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({ limit: 'unconfirmed', windowHours: 24 })
    expect(ranges()[0][1]).to.equal(LATEST)
    expect(chain.getTransactionReceipt).not.toHaveBeenCalled()
  })

  it('refuses an unconfirmed reuse of the account too, but not another service’s order', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    chain.reused(tx(2), tx(1), 2)

    expect(await failure()).to.include({ limit: 'unconfirmed' })

    chain = new Chain()
    chain.started(tx(1), 2, { serviceIndex: 1 })

    expect(await find()).to.equal(undefined)
  })

  it('uses a confirmed order as it stands despite an unconfirmed one', async () => {
    chain.started(tx(1), 3_600)
    chain.started(tx(2), 2)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('refuses another account’s order', async () => {
    chain.started(tx(1), 3_600, { consumer: OTHER })

    expect(await find()).to.equal(undefined)
  })

  it('accepts an order the account only paid for through its own reuse, as the node does', async () => {
    chain.started(tx(1), 3_600, { consumer: OTHER, payer: CONSUMER })
    chain.reused(tx(2), tx(1), 100)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(2) })
  })

  it('ignores another account’s reuse of the order', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    chain.tx(tx(2), 100).reused(tx(1), OTHER).fee()

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
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

  it('refuses a transaction whose first order of the account has another service index', async () => {
    // The node takes the first `OrderStarted` for the account and checks its index only.
    chain.tx(tx(1), 3_600).fee().started({ serviceIndex: 1 }).started()

    expect(await find()).to.equal(undefined)
  })

  it('follows only the first reuse in a transaction, as the node does', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    chain.started(tx(3), 7_200, { serviceIndex: 1 })
    // A reuse of another service's order ahead of the valid one: the node follows it and
    // refuses the download.
    chain.tx(tx(2), 100).reused(tx(3)).reused(tx(1)).fee()

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
  })

  // An RPC answer without what the logs promise (a lagging backend behind a load balancer)
  // is a failed lookup, not "no order": read as one, it bought a valid order again.
  it('throws when the RPC has no receipt for a transaction its logs list', async () => {
    chain.started(tx(1), 3_600)
    chain.getTransactionReceipt.mockResolvedValue(null)

    await expect(find()).rejects.toThrow(InconsistentRpcAnswerError)
  })

  it('throws when a receipt lacks the order event the logs list', async () => {
    chain.started(tx(1), 3_600)
    const read = chain.getTransactionReceipt.getMockImplementation()
    chain.getTransactionReceipt.mockImplementation(async (txId: string) => {
      const receipt = (await read?.(txId)) ?? null
      return receipt && { ...receipt, logs: [] }
    })

    await expect(find()).rejects.toThrow(InconsistentRpcAnswerError)
  })

  it('throws when the RPC has no receipt for the order a reuse of the account names', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    chain.tx(tx(2), 100).reused(tx(9)).reused(tx(1)).fee()

    await expect(find()).rejects.toThrow(InconsistentRpcAnswerError)
  })

  it('throws when the RPC has no newest block', async () => {
    chain.started(tx(1), 3_600)
    chain.getBlock.mockResolvedValue(null as never)

    await expect(find()).rejects.toThrow(InconsistentRpcAnswerError)
  })

  it('refuses a transaction whose first reuse was made by another caller', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    chain.tx(tx(2), 100).reused(tx(1), OTHER).reused(tx(1)).fee()

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
  })

  it('finds nothing without orders, reading back no further than the timeout', async () => {
    expect(await find()).to.equal(undefined)

    // The window's first block is found from two block reads, not one per chunk.
    expect(chain.getBlock).toHaveBeenCalledTimes(3)
    // The first chunk also reads the two unconfirmed blocks above it.
    for (const [from, to] of ranges())
      expect(to - from).to.be.below(to === LATEST ? CHUNK + 2 : CHUNK)

    const oldest = Math.min(...ranges().map(([from]) => from))
    const windowStart = blockAt(DAY - MARGIN)

    expect(oldest).to.be.at.most(windowStart)
    expect(oldest).to.be.at.least(windowStart - 2 * CHUNK)
  })

  it('stops at an order past the timeout when the window cannot be narrowed, keeping a newer one', async () => {
    // Uneven block times: the estimated first block is still inside the window.
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      const number = tag === 'latest' ? LATEST : tag
      return {
        number,
        timestamp: number === LATEST - DEPTH + 1 ? 0 : NOW
      }
    })
    chain.started(tx(1), DAY + 10)
    chain.started(tx(2), 3_600, { fee: { address: OTHER } })

    expect(await find()).to.deep.equal({ orderTxId: tx(2) })
    // Read ahead: at most the chunks already asked for when it was found.
    expect(Math.min(...ranges().map(([from]) => from))).to.be.above(
      blockAt(DAY + 10) - 4 * CHUNK
    )
  })

  it('reads a chunk the RPC refuses again in halves', async () => {
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (filter.toBlock - filter.fromBlock >= 500)
        throw new Error(
          'could not coalesce error (error={ "code": -32005, "message": "block range is too large" })'
        )
      return read?.(filter) ?? []
    })
    chain.started(tx(1), 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    const accepted = chain.getLogs.mock.calls
      .map(([filter]) => filter.toBlock - filter.fromBlock)
      .filter((width) => width < 500)
    expect(accepted.length).to.be.above(0)
  })

  it('throws an error that is not about the range', async () => {
    chain.getLogs.mockRejectedValue(new Error('connection refused'))

    await expect(find()).rejects.toThrow('connection refused')
    expect(chain.getLogs).toHaveBeenCalledTimes(2)
  })

  it('reuses an order of a service with timeout 0 however old, within the read depth', async () => {
    // The node signs such a service's fee with `validUntil` 0.
    chain.started(tx(1), 150_000, { fee: { validUntil: 0 } })

    expect(await find({ timeout: 0 })).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: tx(1)
    })
  })

  it('reports an incomplete lookup at the read depth for timeout 0, not "not found"', async () => {
    chain.started(tx(1), 2 * DEPTH + 10, { fee: { validUntil: 0 } })

    const thrown = await failure({ timeout: 0 })

    // Orders of the service never expire: one older than the read depth may be in force.
    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({
      windowHours: Number.POSITIVE_INFINITY,
      limit: 'depth'
    })
    expect(thrown.checkedHours).to.be.closeTo(
      ((DEPTH - 1) * BLOCK_TIME) / 3_600,
      0.01
    )
    expect(ranges()).to.have.length(DEPTH / CHUNK)
  })

  it('reports an incomplete lookup when the timeout reaches past the read depth', async () => {
    const thrown = await failure({ timeout: 30 * DAY })

    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({ windowHours: 30 * 24, limit: 'depth' })
    expect(thrown.checkedHours).to.be.closeTo(555.6, 0.1)
  })

  it('covers a 7-day timeout, which ran past the old 100,000-block depth', async () => {
    chain.started(tx(1), 6 * DAY, { fee: { address: OTHER } })

    expect(await find({ timeout: 7 * DAY })).to.deep.equal({ orderTxId: tx(1) })
    expect(await find({ timeout: 7 * DAY, account: OTHER })).to.equal(undefined)
  })

  it('finds nothing on a chain shorter than the read depth, for timeout 0', async () => {
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      const number = tag === 'latest' ? 50_000 : tag
      return { number, timestamp: NOW - (50_000 - number) * BLOCK_TIME }
    })

    expect(await find({ timeout: 0 })).to.equal(undefined)
    expect(Math.min(...ranges().map(([from]) => from))).to.equal(0)
  })

  it('waits out a rate limit and reads the same range again, never in halves', async () => {
    chain.getLogs.mockRejectedValueOnce(rateLimited())
    chain.started(tx(1), 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    // Halving on a 429 ran the reads out and ended in "not found" (then a paid re-order).
    const widths = chain.getLogs.mock.calls.map(
      ([filter]) => filter.toBlock - filter.fromBlock
    )
    expect(new Set(widths)).to.deep.equal(new Set([CHUNK - 1]))
    expect(scanTiming.sleep).toHaveBeenCalledOnce()
    expect(vi.mocked(scanTiming.sleep).mock.calls[0][0]).to.equal(1_000)
  })

  it('throws a rate limit that lasts, after three waits that double', async () => {
    chain.getLogs.mockRejectedValue(rateLimited())
    chain.started(tx(1), 3_600)

    expect(await failure()).to.have.property('code', 'SERVER_ERROR')
    // Each of the two reads of the first chunk: four tries.
    expect(chain.getLogs).toHaveBeenCalledTimes(8)
    expect(
      vi.mocked(scanTiming.sleep).mock.calls.map(([ms]) => ms)
    ).to.deep.equal([1_000, 1_000, 2_000, 2_000, 4_000, 4_000])
  })

  it('waits as long as Retry-After asks, at most 8 seconds', async () => {
    const limited = (seconds: string) =>
      Object.assign(new Error('Too Many Requests'), {
        status: 429,
        response: { headers: { 'Retry-After': seconds } }
      })
    chain.getLogs
      .mockRejectedValueOnce(limited('3'))
      .mockRejectedValueOnce(limited('60'))
    chain.started(tx(1), 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    expect(
      vi.mocked(scanTiming.sleep).mock.calls.map(([ms]) => ms)
    ).to.deep.equal([3_000, 8_000])
  })

  it('throws a JSON-RPC -32005 rate limit, and halves a -32005 range refusal', async () => {
    chain.getLogs.mockRejectedValue(
      rpcError(-32005, 'daily request count exceeded, request rate limited')
    )
    expect(await failure()).to.have.property('code', 'UNKNOWN_ERROR')
    expect(
      new Set(chain.getLogs.mock.calls.map(([filter]) => filter.fromBlock))
    ).to.have.property('size', 1)

    chain = new Chain()
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (filter.toBlock - filter.fromBlock >= 500)
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })
    chain.started(tx(1), 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('reports an incomplete lookup when the reads run out before the window ends', async () => {
    // An RPC that serves one block per call: 100 rounds cannot cover a day.
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (filter.toBlock > filter.fromBlock)
        throw rpcError(-32600, 'block range limit exceeded, max 1')
      return read?.(filter) ?? []
    })

    const thrown = await failure()

    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({ windowHours: 24, limit: 'reads' })
    const oldest = Math.min(
      ...chain.getLogs.mock.calls
        .filter(([filter]) => filter.toBlock === filter.fromBlock)
        .map(([filter]) => filter.fromBlock)
    )
    expect(thrown.checkedHours).to.be.closeTo(
      ((LATEST - oldest) * BLOCK_TIME) / 3_600,
      0.01
    )
    expect(thrown.checkedHours).to.be.below(1)
  })

  it('keeps a fee the way the node does: the time since its block against validUntil', async () => {
    // The node compares `now - block.timestamp` to `validUntil`, so a fee it signed with
    // an absolute `validUntil` in the past is still kept.
    chain.started(tx(1), 3_600, { fee: { validUntil: NOW - 1 } })

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('needs a new fee when the time since the fee’s block, with the margin, passes validUntil', async () => {
    chain.started(tx(1), 3_600, { fee: { validUntil: 3_600 + MARGIN - 1 } })

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })

    chain = new Chain()
    chain.started(tx(1), 3_600, { fee: { validUntil: 3_600 + MARGIN } })

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('needs a new fee when the fee was signed by another node', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
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

  it('only extends an order sent through another contract, which upstream ocean-node refuses as it stands', async () => {
    // Upstream reads the datatoken from the transaction's `to`, here the factory's
    // `startMultipleTokenOrder`.
    chain.started(tx(1), 3_600, { to: OTHER, payer: OTHER })

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
  })

  it('uses a reuse sent to the datatoken of an order sent through another contract', async () => {
    chain.started(tx(1), 3_600, { to: OTHER, fee: false })
    chain.reused(tx(2), tx(1), 100)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(2) })
  })

  it('only extends an order whose reuse was sent through another contract', async () => {
    chain.started(tx(1), 3_600, { fee: { address: OTHER } })
    chain.tx(tx(2), 100, OTHER).reused(tx(1)).fee()

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
  })

  it('reads the transaction’s `to` in any case, and none (a contract creation) as not the datatoken', async () => {
    chain.started(tx(1), 3_600, { to: DATATOKEN_ADDRESS.toLowerCase() })
    expect((await find())?.usableTxId).to.equal(tx(1))

    chain = new Chain()
    chain.started(tx(1), 3_600, { to: null })
    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
  })

  it('refuses an order behind a look-alike OrderStarted from another contract, which upstream ocean-node takes first', async () => {
    chain
      .tx(tx(1), 3_600)
      .fee()
      .started({ emitter: OTHER, serviceIndex: 1 })
      .started()

    expect(await find()).to.equal(undefined)

    chain = new Chain()
    chain
      .tx(tx(1), 3_600, OTHER)
      .started({ emitter: OTHER, serviceIndex: 1 })
      .started()
    chain.reused(tx(2), tx(1), 100)

    expect(await find()).to.equal(undefined)
  })

  it('takes the first OrderStarted for the account, past another contract’s for someone else', async () => {
    chain
      .tx(tx(1), 3_600)
      .fee()
      .started({ emitter: OTHER, consumer: OTHER, payer: OTHER })
      .started()

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('checks at most 50 candidates, and reports the lookup incomplete with none found', async () => {
    // Orders anyone can place for the account, none usable or extendable; each costs one
    // receipt read. An older order past the cap may still be in force.
    for (let n = 1; n <= 80; n++)
      chain.started(tx(n), 100 + n * BLOCK_TIME, { serviceIndex: 1 })

    const thrown = await failure()
    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({ windowHours: 24, limit: 'candidates' })
    expect(chain.getTransactionReceipt).toHaveBeenCalledTimes(50)
    expect(chain.getTransactionReceipt).toHaveBeenCalledWith(tx(50))
    expect(chain.getTransactionReceipt).not.toHaveBeenCalledWith(tx(51))
  })

  it('extends the best order found before the cap', async () => {
    // Newer than half the spam: found mid-scan, kept when the cap stops it.
    for (let n = 2; n <= 61; n++)
      chain.started(tx(n), 100 + n * BLOCK_TIME, { serviceIndex: 1 })
    chain.started(tx(1), 100 + 30 * BLOCK_TIME + 1, { fee: { address: OTHER } })

    expect(await find()).to.deep.equal({ orderTxId: tx(1) })
    expect(chain.getTransactionReceipt).toHaveBeenCalledTimes(50)
  })
})

describe('findPreviousOrder reads fast and keeps reading', () => {
  /** A read that answers after `ms`, counting the reads in flight. */
  function timed(ms: (filter: LogFilter) => number = () => 1) {
    const read = chain.getLogs.getMockImplementation()
    const flight = { now: 0, max: 0, starts: [] as number[] }

    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      flight.starts.push(flight.now)
      flight.max = Math.max(flight.max, ++flight.now)
      await new Promise((resolve) => setTimeout(resolve, ms(filter)))
      flight.now--
      return read?.(filter) ?? []
    })

    return flight
  }

  it('reads the first chunk alone, then at most four chunks at a time', async () => {
    const flight = timed()

    expect(await find()).to.equal(undefined)
    // Two reads per chunk: one for the account's orders, one for the reuses.
    expect(flight.starts.slice(0, 2)).to.deep.equal([0, 1])
    expect(flight.starts[2]).to.equal(0)
    expect(flight.max).to.equal(4 * 2)
    // A day of 2 s blocks: 5 chunks, in two rounds instead of five.
    expect(ranges()).to.have.length(5)
  })

  it('returns the newest order of a wave, whichever chunk answers first', async () => {
    chain.started(tx(1), 2 * CHUNK * BLOCK_TIME + 100)
    chain.started(tx(2), 4 * CHUNK * BLOCK_TIME + 100)
    // Older chunks answer sooner.
    timed((filter) => Math.max(1, (filter.toBlock - LATEST + 50_000) / 2_000))

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('reads a chunk of a wave again after a rate limit, and still returns the newest order', async () => {
    chain.started(tx(1), 2 * CHUNK * BLOCK_TIME + 100)
    chain.started(tx(2), 3 * CHUNK * BLOCK_TIME + 100)
    const newer = blockAt(2 * CHUNK * BLOCK_TIME + 100)
    const read = chain.getLogs.getMockImplementation()
    let limited = false
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (!limited && filter.fromBlock <= newer && filter.toBlock >= newer) {
        limited = true
        throw rateLimited()
      }
      return read?.(filter) ?? []
    })

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    expect(limited).to.equal(true)
    expect(scanTiming.sleep).toHaveBeenCalledOnce()
  })

  it('does not shrink the chunk for a rate limit, in this lookup or the next', async () => {
    chain.getLogs.mockRejectedValueOnce(rateLimited())
    await find()
    chain.getLogs.mockClear()

    await find()

    expect(ranges()[0]).to.deep.equal([LATEST - CHUNK + 1, LATEST])
  })

  it('remembers the chunk the RPC accepted for the next lookup on the same provider', async () => {
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (filter.toBlock - filter.fromBlock >= 2_000)
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })

    await find()
    chain.getLogs.mockClear()
    await find()

    // 10,000 halved to 1,250 and accepted, then grown: the widest accepted read (the
    // last, cut at the window's start, may be wider) is remembered, below the refusal.
    const [from, to] = ranges()[0]
    expect(to - from + 1).to.be.within(1_250, 1_999)
    // A width refused once in this lookup was not tried again.
    expect(
      chain.getLogs.mock.calls.filter(
        ([filter]) =>
          filter.toBlock - filter.fromBlock >= 2_000 &&
          filter.toBlock - filter.fromBlock < CHUNK - 1
      ).length
    ).to.be.at.most(2 * 3)

    // Another provider instance starts afresh.
    const other = new Chain()
    await findPreviousOrder(query({ provider: other as unknown as Provider }), {
      now: NOW
    })
    const [[first]] = other.getLogs.mock.calls
    expect(first.toBlock - first.fromBlock + 1).to.equal(CHUNK)
  })

  it('remembers no less than 500 blocks', async () => {
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (filter.toBlock - filter.fromBlock >= 200)
        throw rpcError(-32600, 'block range too large')
      return read?.(filter) ?? []
    })

    await find({ timeout: 2 * 3_600 })
    chain.getLogs.mockClear()
    await find({ timeout: 2 * 3_600 })

    const [[first]] = chain.getLogs.mock.calls
    expect(first.toBlock - first.fromBlock + 1).to.equal(500)
  })

  it('grows the chunk back after reads the RPC accepts', async () => {
    // A flood of events in the newest 100 blocks only.
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (
        filter.toBlock > LATEST - 100 &&
        filter.toBlock - filter.fromBlock >= 600
      )
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })

    expect(await find()).to.equal(undefined)

    // The last range is cut at the window's start.
    const widths = ranges()
      .slice(0, -1)
      .map(([from, to]) => to - from + 1)
    expect(Math.min(...widths)).to.be.below(600)
    // A refusal for the number of results is no ceiling: past the flood, the size
    // grows back well beyond the refused width.
    const smallest = widths.indexOf(Math.min(...widths))
    expect(Math.max(...widths.slice(smallest))).to.be.above(4_000)
    // Halving for good would take ~145 reads for a day; growing back takes ~30.
    expect(widths.length).to.be.below(32)
  })

  it('reads the reuses alone in smaller pieces where a flood of them is refused, not the account’s orders', async () => {
    // Anyone can call `reuseOrder` for gas; `OrderReused` is not indexed, so a flood fills
    // the RPC's results cap, and halving both reads ran the reads out ("incomplete" for
    // every consumer).
    chain.started(tx(1), 20 * 3_600)
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (
        filter.topics[0] === REUSED &&
        filter.toBlock - filter.fromBlock >= 2_500
      )
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    // The account's orders are read in full chunks; only the last range, cut at the
    // window's start, is shorter.
    const started = chain.getLogs.mock.calls
      .map(([filter]) => filter)
      .filter((filter) => filter.topics[0] !== REUSED)
    for (const { fromBlock, toBlock } of started.slice(0, -1))
      expect(toBlock - fromBlock + 1).to.equal(CHUNK)
    // The reuses in pieces of about 2,500 once refused (a few wider reads tried as the
    // width grows back), without a refused read per chunk.
    const refused = chain.getLogs.mock.calls.filter(
      ([filter]) =>
        filter.topics[0] === REUSED &&
        filter.toBlock - filter.fromBlock >= 2_500
    )
    expect(refused.length).to.be.at.most(4)
  })

  it('still halves when the account’s own OrderStarted read is refused', async () => {
    chain.started(tx(1), 3_600)
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (filter.toBlock - filter.fromBlock >= 5_000)
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
  })

  it('reads the latest block once, and the window start alongside the first chunk', async () => {
    const order: string[] = []
    const block = chain.getBlock.getMockImplementation()
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      order.push(`block ${tag === 'latest' ? tag : 'n'}`)
      return block?.(tag) as never
    })
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      order.push('logs')
      return read?.(filter) ?? []
    })

    await find()

    expect(order.slice(0, 4)).to.deep.equal([
      'block latest',
      'block n',
      'logs',
      'logs'
    ])
  })
})

describe('findPreviousOrder for a service whose orders never expire', () => {
  const created = LATEST - 400_000

  it('reads back to the datatoken’s creation, proven, instead of stopping at the read depth', async () => {
    chain.created(created)

    expect(await find({ timeout: 0 })).to.equal(undefined)
    expect(Math.min(...ranges().map(([from]) => from))).to.equal(created)
  })

  it('finds an order older than the read depth would allow when the datatoken is younger', async () => {
    chain.created(created)
    chain.started(tx(1), (LATEST - created - 5) * BLOCK_TIME, {
      fee: { validUntil: 0 }
    })

    expect(await find({ timeout: 0 })).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: tx(1)
    })
  })

  it('remembers the creation block for the provider', async () => {
    chain.created(created)
    await find({ timeout: 0 })
    chain.getCode.mockClear()

    await find({ timeout: 0 })

    expect(chain.getCode).not.toHaveBeenCalled()
  })

  it('stops at the read depth when the creation is not proven by the factory’s event', async () => {
    chain.created(created, false)

    expect(await failure({ timeout: 0 })).to.include({ limit: 'depth' })
  })

  it('takes no TokenCreated from another contract as proof, nor proves without the factory', async () => {
    chain.created(created)
    chain.logs = chain.logs.map((log) => ({ ...log, address: OTHER }) as Log)

    expect(await failure({ timeout: 0 })).to.include({ limit: 'depth' })

    chain = new Chain()
    chain.created(created)
    expect(
      await failure({ timeout: 0, nftFactoryAddress: undefined })
    ).to.include({ limit: 'depth' })
    expect(chain.getCode).not.toHaveBeenCalled()
  })

  it('stops at the read depth when the RPC has pruned old state and answers "no code"', async () => {
    // A pruned RPC that answers "no code" for old blocks would place the creation late.
    chain.created(created)
    chain.getCode.mockImplementation(async (_address: string, block: number) =>
      block >= LATEST - 128 ? '0x6080' : '0x'
    )

    expect(await failure({ timeout: 0 })).to.include({ limit: 'depth' })
  })

  it('stops at the read depth when the RPC cannot read old state', async () => {
    chain.created(created)
    chain.getCode.mockRejectedValue(rpcError(-32000, 'missing trie node'))

    expect(await failure({ timeout: 0 })).to.include({ limit: 'depth' })
  })

  it('stops at the read depth for a datatoken older than it', async () => {
    chain.created(LATEST - DEPTH - 10)

    expect(await failure({ timeout: 0 })).to.include({ limit: 'depth' })
    expect(chain.getCode).toHaveBeenCalledOnce()
  })

  it('throws a rate limit of the creation search', async () => {
    chain.created(created)
    chain.getCode.mockRejectedValue(rateLimited())

    expect(await failure({ timeout: 0 })).to.have.property(
      'code',
      'SERVER_ERROR'
    )
  })
})

describe('findPreviousOrder on an RPC that caps eth_getLogs', () => {
  /** An RPC that refuses a range wider than `cap`, counting requests in flight. */
  function capped(cap: number) {
    const read = chain.getLogs.getMockImplementation()
    const flight = { now: 0, max: 0 }
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      flight.max = Math.max(flight.max, ++flight.now)
      await new Promise((resolve) => setTimeout(resolve, 1))
      flight.now--
      if (filter.toBlock - filter.fromBlock + 1 > cap)
        throw rpcError(-32005, `block range too large, max ${cap} blocks`)
      return read?.(filter) ?? []
    })
    return flight
  }

  for (const cap of [1_000, 2_000])
    for (const hours of [24, 48])
      it(`covers a ${hours} h service on an RPC that serves ${cap} blocks per call`, async () => {
        // Ranges were queued at the size before a refusal, split one step per read, and
        // grown back above the cap: two thirds of the reads were refusals, and the reads
        // ran out ("incomplete": every paid purchase refused).
        const flight = capped(cap)
        chain.started(tx(1), (hours - 1) * 3_600, { fee: { address: OTHER } })

        expect(await find({ timeout: hours * 3_600 })).to.deep.equal({
          orderTxId: tx(1)
        })
        // Up to four chunks in flight, two requests each, also while splitting.
        expect(flight.max).to.be.at.most(8)
        // No width the RPC refused in this lookup is asked for again.
        const refused = chain.getLogs.mock.calls.filter(
          ([filter]) => filter.toBlock - filter.fromBlock + 1 > cap
        )
        expect(refused.length).to.be.at.most(2 * 6)
      })

  it('remembers the refused width for the next lookup, and splits nothing already accepted', async () => {
    capped(1_000)
    await find()
    chain.getLogs.mockClear()

    await find()

    const widths = chain.getLogs.mock.calls.map(
      ([filter]) => filter.toBlock - filter.fromBlock + 1
    )
    expect(Math.max(...widths)).to.be.at.most(1_000)
  })

  it('keeps at most four chunks in flight after a range is split', async () => {
    // A split range took two places in the queue: five chunks, ten requests, in flight.
    const read = chain.getLogs.getMockImplementation()
    const flight = { now: 0, max: 0 }
    let refusals = 0
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      flight.max = Math.max(flight.max, ++flight.now)
      await new Promise((resolve) => setTimeout(resolve, 1))
      flight.now--
      // The second wave's newest range is refused once.
      if (filter.toBlock === LATEST - CHUNK && refusals++ < 2)
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })

    expect(await find({ timeout: 3 * DAY })).to.equal(undefined)
    expect(flight.max).to.be.at.most(8)
  })
})

describe('findPreviousOrder and a flood of reuses', () => {
  const REUSE_CAP = 2_500

  /** An RPC whose `OrderReused` reads fail for ranges wider than `cap` with `error`. */
  function flooded(
    cap: number,
    error = () => rpcError(-32005, 'query returned more than 10000 results')
  ) {
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (
        filter.topics[0] === REUSED &&
        filter.toBlock - filter.fromBlock + 1 > cap
      )
        throw error()
      return read?.(filter) ?? []
    })
  }

  it('finds the account’s own reuse of an order it holds only as payer, where the reuse read is refused', async () => {
    // The `OrderStarted`-only fallback hid it: "not found", and a second payment.
    chain.started(tx(1), 10 * 3_600, {
      consumer: OTHER,
      payer: CONSUMER,
      fee: { address: OTHER }
    })
    chain.reused(tx(2), tx(1), 3_600)
    flooded(REUSE_CAP)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(2) })
  })

  it('reads a block whose reuses are refused even alone with the account’s orders, and says so on the debug channel', async () => {
    const events: DebugEvent[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    setDebug({
      level: 'sensitive',
      topics: ['order'],
      sink: (e) => events.push(e)
    })
    const flood = blockAt(5 * 3_600)
    const read = chain.getLogs.getMockImplementation()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (
        filter.topics[0] === REUSED &&
        filter.fromBlock <= flood &&
        filter.toBlock >= flood
      )
        throw rpcError(-32005, 'query returned more than 10000 results')
      return read?.(filter) ?? []
    })
    chain.started(tx(1), 20 * 3_600)

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    const fallbacks = events.filter((event) =>
      event.message.includes('refused the OrderReused read of one block')
    )
    expect(fallbacks).to.have.length(1)
    expect(fallbacks[0].data).to.deep.include({ block: flood })
  })

  it('does not drop the reuses for a timeout of the reuse read', async () => {
    // "query timeout exceeded" read as a volume refusal: a transient timeout switched the
    // range to the account's orders alone, hiding a reuse of an order it paid for.
    chain.started(tx(1), 10 * 3_600, {
      consumer: OTHER,
      payer: CONSUMER,
      fee: { address: OTHER }
    })
    chain.reused(tx(2), tx(1), 3_600)
    flooded(0, () => rpcError(-32000, 'query timeout exceeded'))

    const thrown = await failure()

    expect(thrown).to.be.instanceOf(Error)
    expect(thrown.message).to.contain('query timeout exceeded')
  })
})

describe('findPreviousOrder and rate limits', () => {
  /** A clock the waits move on, so the budget is spent without real waits. */
  function virtualClock() {
    let now = 0
    vi.spyOn(scanTiming, 'clock').mockImplementation(() => now)
    vi.mocked(scanTiming.sleep).mockImplementation(async (ms: number) => {
      now += ms
    })
    return () => now
  }

  it('gives up after one back-off budget for the whole lookup, not minutes of waits', async () => {
    // Every request answered 429 three times, then served: 192 waits, about 3 minutes, on
    // a 7-day service.
    const clock = virtualClock()
    const read = chain.getLogs.getMockImplementation()
    const tries = new Map<string, number>()
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      const key = JSON.stringify(filter)
      const count = (tries.get(key) ?? 0) + 1
      tries.set(key, count)
      if (count <= 3) throw rateLimited()
      return read?.(filter) ?? []
    })

    const thrown = await failure({ timeout: 7 * DAY })

    expect(thrown).to.have.property('code', 'SERVER_ERROR')
    expect(clock()).to.be.at.most(20_000)
    expect(vi.mocked(scanTiming.sleep).mock.calls.length).to.be.below(20)
  })

  it('waits out a rate limit on the newest block, the window’s start, a receipt and the code', async () => {
    // Only `eth_getLogs` was waited out: one 429 elsewhere failed the lookup.
    chain.started(tx(1), 3_600)
    chain.created(LATEST - 400_000)
    const block = chain.getBlock.getMockImplementation()
    chain.getTransactionReceipt.mockRejectedValueOnce(rateLimited())
    chain.getCode.mockRejectedValueOnce(rateLimited())
    let latestRead = false
    let windowRead = false
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      if (tag === 'latest' ? !latestRead : !windowRead) {
        if (tag === 'latest') latestRead = true
        else windowRead = true
        throw rateLimited()
      }
      return block?.(tag) as never
    })

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    // The creation search's first `getCode`, rate-limited once, read again.
    expect(await find({ timeout: 0, account: OTHER })).to.equal(undefined)
    expect(chain.getCode.mock.calls.length).to.be.at.least(2)
    expect(windowRead).to.equal(true)
    expect(vi.mocked(scanTiming.sleep).mock.calls.length).to.be.at.least(4)
  })

  it('makes no further call, and waits no longer, once the lookup has returned', async () => {
    chain.started(tx(1), 3_600)
    // The window's start keeps being rate-limited while the first chunk has the order.
    const block = chain.getBlock.getMockImplementation()
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      if (tag !== 'latest') throw rateLimited()
      return block?.(tag) as never
    })
    const waits: AbortSignal[] = []
    vi.mocked(scanTiming.sleep).mockImplementation(
      (_ms: number, signal?: AbortSignal) =>
        new Promise((resolve) => {
          if (signal) waits.push(signal)
          signal?.addEventListener('abort', () => resolve())
        })
    )

    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })
    const calls = chain.getBlock.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(waits.length).to.be.above(0)
    expect(waits.every((signal) => signal.aborted)).to.equal(true)
    expect(chain.getBlock.mock.calls.length).to.equal(calls)
  })

  it('waits for nothing on the default sleep once its lookup has ended', async () => {
    // The real wait, not the suite's stub.
    vi.mocked(scanTiming.sleep).mockRestore()
    const ended = new AbortController()
    const started = Date.now()
    const waiting = scanTiming.sleep(60_000, ended.signal)
    ended.abort()
    await waiting
    expect(Date.now() - started).to.be.below(1_000)
  })
})

describe('findPreviousOrder for a never-expiring service, an order in the newest chunk', () => {
  it('returns the order without waiting for the creation search', async () => {
    // The search ran first: about 35 getCode calls, ~13 s on OP, before the order was
    // returned.
    chain.created(LATEST - 400_000)
    chain.started(tx(1), 3_600, { fee: { validUntil: 0 } })
    let release = () => undefined as unknown
    const code = chain.getCode.getMockImplementation()
    chain.getCode.mockImplementation(async (address: string, block: number) => {
      await new Promise((resolve) => {
        release = () => resolve(undefined)
      })
      return code?.(address, block) as never
    })

    expect(await find({ timeout: 0 })).to.deep.equal({
      orderTxId: tx(1),
      usableTxId: tx(1)
    })
    expect(chain.getCode).toHaveBeenCalledOnce()
    release()
  })
})

describe('findPreviousOrder and a lagging RPC', () => {
  it('throws when the RPC’s newest block is older than the order window', async () => {
    // A head 27.7 h old for a 24 h service: no order in force can show, so "not found"
    // would buy again.
    chain.started(tx(1), 3_600)
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      const number = tag === 'latest' ? LATEST : tag
      return { number, timestamp: timeOf(number) - 99_720 }
    })

    const thrown = await failure()

    expect(thrown).to.be.instanceOf(StaleRpcHeadError)
    expect(thrown).to.have.property('ageHours').closeTo(27.7, 0.01)
    expect(chain.getLogs).not.toHaveBeenCalled()
  })
})

describe('settleOrder with an order on chain', () => {
  const chainConfig = {
    chainId: 32456,
    dispenserAddress: '0x0000000000000000000000000000000000d15e45',
    nftFactoryAddress: FACTORY
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

  it('extends an order sent through another contract instead of using it as it stands', async () => {
    chain.started(tx(1), 3_600, { to: OTHER, payer: OTHER })
    const providerFee = signedProviderFee({
      providerData,
      providerFeeAmount: '0'
    })

    const result = await settle({ providerFee })

    expect(result).to.deep.equal({ transferTxId: '0xreusetx', reused: true })
    expect(vi.mocked(reuseOrder).mock.calls[0][0]).to.include({
      validOrderTx: tx(1)
    })
  })

  it('orders anew when there is no order to reuse', async () => {
    chain.started(tx(1), DAY + 10)

    const result = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '0' })
    })

    expect(result).to.deep.equal({ transferTxId: '0xfresh', reused: false })
  })

  it('orders a free service anew when the lookup fails, and warns', async () => {
    const log = captureLog()
    chain.getLogs.mockRejectedValueOnce(
      new Error(`connection refused (requestUrl="${FAKE.rpcUrl}")`)
    )

    const result = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '0' })
    })

    expect(result.reused).to.equal(false)
    const [warning] = log.named('access.order.lookup_failed')
    expect(warning.level).to.equal('warn')
    expect(warning.msg).to.match(
      /Could not check whether .* already holds an order .*: the RPC did not answer\. A new order will be placed\. The service is free: this costs only gas\./
    )
    expect(warning.fields).to.include({ reason: 'unreachable', free: true })
    expect(warning.fields.error).to.match(/connection refused/)
    expect(JSON.stringify(warning)).not.to.contain(FAKE.rpcPathToken)
  })

  it('does not order when the lookup fails and a provider fee is due, naming settleOrder()', async () => {
    chain.getLogs.mockRejectedValueOnce(
      new Error(`connection refused (requestUrl="${FAKE.rpcUrl}")`)
    )

    const thrown = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '30' })
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown).to.include({ reason: 'unreachable', retryable: true })
    expect(thrown.message).to.match(/^settleOrder\(\) stopped before paying/)
    expect(thrown.message).not.to.contain(FAKE.rpcPathToken)
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('does not order a paid service when the RPC rate-limits the scan', async () => {
    // The account holds a valid order. Ten rounds of 429s used to halve the range down to
    // one block, so the reads ran out before reaching it: "not found", and a second order.
    chain.started(tx(1), 3_600)
    const read = chain.getLogs.getMockImplementation()
    let calls = 0
    chain.getLogs.mockImplementation(async (filter: LogFilter) => {
      if (calls++ < 20) throw rateLimited()
      return read?.(filter) ?? []
    })

    const thrown = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '30' })
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown.reason).to.equal('rate-limited')
    expect(thrown.message).to.contain(
      'Cause: the RPC rate-limited the check (HTTP 429).'
    )
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  // Probes of round-2 security review M1: a valid order on chain, a paid service, and an
  // RPC answer without what its logs promise. Each used to be "not found": a second order.
  for (const [name, lag] of [
    [
      'has no receipt for the order its logs list',
      () => chain.getTransactionReceipt.mockResolvedValue(null)
    ],
    [
      'returns the order’s receipt without its events',
      () => {
        const read = chain.getTransactionReceipt.getMockImplementation()
        chain.getTransactionReceipt.mockImplementation(async (txId: string) => {
          const receipt = (await read?.(txId)) ?? null
          return receipt && { ...receipt, logs: [] }
        })
      }
    ],
    [
      'has no newest block',
      () => chain.getBlock.mockResolvedValue(null as never)
    ]
  ] as const)
    it(`does not order a paid service when the RPC ${name}`, async () => {
      chain.started(tx(1), 3_600)
      lag()

      const thrown = await settle({
        providerFee: signedProviderFee({
          providerData,
          providerFeeAmount: '30'
        })
      }).catch((caught) => caught)

      expect(thrown).to.be.instanceOf(OrderCheckError)
      expect(thrown.reason).to.equal('rpc-error')
      expect(thrown.message).to.contain(
        "Cause: the RPC's answer lacked data the check needs ("
      )
      expect(thrown.message).to.contain('Retry in a minute or use another RPC.')
      expect(vi.mocked(order)).not.toHaveBeenCalled()
      expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
    })

  it('does not order a paid service whose orders never expire, past the read depth', async () => {
    const thrown = await settle(
      {
        providerFee: signedProviderFee({
          providerData,
          providerFeeAmount: '30'
        })
      },
      { id: SERVICE_ID, timeout: 0 }
    ).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown).to.include({
      reason: 'incomplete',
      windowHours: Number.POSITIVE_INFINITY
    })
    expect(thrown.message).to.contain(
      'Cause: the check covered only the last 555 hours, and orders of this service never expire.'
    )
    expect(thrown.message).to.contain(
      'A retry ends the same way. If this account never bought this service, buying is safe.'
    )
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('does not buy again right after a purchase whose order has no confirmations yet', async () => {
    // A fast retry (a download error a few seconds after paying) used to pay twice.
    chain.started(tx(1), 2)

    const thrown = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '30' })
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown).to.include({ reason: 'incomplete', limit: 'unconfirmed' })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('does not buy again through an RPC whose newest block is older than the order window', async () => {
    chain.started(tx(1), 3_600)
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      const number = tag === 'latest' ? LATEST : tag
      return { number, timestamp: timeOf(number) - 2 * DAY }
    })

    const thrown = await settle({
      providerFee: signedProviderFee({ providerData, providerFeeAmount: '30' })
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown.reason).to.equal('rpc-error')
    expect(thrown.message).to.contain(
      "Cause: the RPC's newest block is 48 hours old"
    )
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('buys a never-expiring service on a long chain without the opt-in once its creation is proven', async () => {
    chain.created(LATEST - 400_000)

    const result = await settle(
      {
        providerFee: signedProviderFee({
          providerData,
          providerFeeAmount: '30'
        })
      },
      { id: SERVICE_ID, timeout: 0 }
    )

    expect(result).to.deep.equal({ transferTxId: '0xfresh', reused: false })
    expect(vi.mocked(order)).toHaveBeenCalledOnce()
  })

  describe('right after a purchase, through an RPC a block or more behind', () => {
    // The order just confirmed (block LATEST) is not in what a lagging backend serves: the
    // lookup reads "not found", and a fast retry (a failed download) paid again.
    const paid = () =>
      settle({
        providerFee: signedProviderFee({
          providerData,
          providerFeeAmount: '30'
        })
      })

    async function purchased() {
      expect(await paid()).to.deep.equal({
        transferTxId: '0xfresh',
        reused: false
      })
      chain.started(tx(1), 0)
    }

    const lags: [string, () => void][] = [
      ...[1, 2, 3, 10].map(
        (behind) =>
          [
            `its newest block ${behind} behind`,
            () => {
              const read = chain.getBlock.getMockImplementation()
              chain.getBlock.mockImplementation(
                async (tag: number | 'latest') =>
                  read?.(tag === 'latest' ? LATEST - behind : tag) as never
              )
            }
          ] as [string, () => void]
      ),
      [
        'its logs 1 block behind its newest block',
        () => {
          const read = chain.getLogs.getMockImplementation()
          chain.getLogs.mockImplementation(async (filter: LogFilter) =>
            read
              ? read({
                  ...filter,
                  toBlock: Math.min(filter.toBlock, LATEST - 1)
                })
              : []
          )
        }
      ]
    ]

    for (const [name, lag] of lags)
      it(`does not buy again with ${name}`, async () => {
        await purchased()
        lag()

        const thrown = await paid().catch((caught) => caught)

        expect(thrown).to.be.instanceOf(OrderCheckError)
        expect(thrown).to.include({
          reason: 'incomplete',
          limit: 'unconfirmed'
        })
        expect(vi.mocked(order)).toHaveBeenCalledOnce()
      })

    it('reuses the order once the RPC shows it with its confirmations', async () => {
      await purchased()
      vi.useFakeTimers({ now: (NOW + 6) * 1000, toFake: ['Date'] })
      chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
        const number = tag === 'latest' ? LATEST + 3 : tag
        return { number, timestamp: timeOf(number) }
      })

      expect(await paid()).to.deep.equal({ transferTxId: tx(1), reused: true })
      expect(vi.mocked(order)).toHaveBeenCalledOnce()
    })

    it('still buys again from a new process that has no record of it (documented)', async () => {
      await purchased()
      chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
        const number = tag === 'latest' ? LATEST - 1 : tag
        return { number, timestamp: timeOf(number) }
      })
      forgetConfirmedOrders()

      await paid()

      expect(vi.mocked(order)).toHaveBeenCalledTimes(2)
    })
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

  /** `access()` against a node quoting a fee of `amount`, with no `validOrder`. */
  function download(amount: string, limits: object = {}) {
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
      providerFeeAmount: amount
    })

    const node = {
      nodeUri: 'https://node.test.invalid',
      forEndpoint() {
        return node
      },
      resolve: async () => asset,
      policySessionAddress: (address: string) => address,
      hasPolicyServer: async () => false,
      initialize: async () => ({ datatoken: DATATOKEN_ADDRESS, providerFee }),
      getDownloadUrl: vi.fn(async () => 'https://node.test.invalid/download')
    }

    const signer = {
      getAddress: async () => CONSUMER,
      provider: chain
    } as unknown as Signer

    const result = access(
      { assetDid: ASSET_DID, ...limits },
      {
        node: node as unknown as OceanNodeClient,
        signer,
        chainConfig: { chainId: 32456 } as unknown as Config
      }
    )

    return { result, node }
  }

  it('reports the reused order', async () => {
    chain.started(tx(1), 3_600)

    const result = await download('0').result

    expect(result).to.include({ transferTxId: tx(1), reusedOrder: true })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('asks no consent for a quoted fee it does not pay, using the order as it stands', async () => {
    chain.started(tx(1), 3_600)

    // No ceiling and no callback: a fee that were paid would be refused.
    const result = await download('30').result

    expect(result).to.include({ transferTxId: tx(1), reusedOrder: true })

    const confirm = vi.fn((_fees: ProviderFeeQuote[]) => false)
    await download('30', { confirmProviderFees: confirm }).result

    expect(confirm).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('asks for the quoted fee when the order’s fee expired, and pays exactly it', async () => {
    chain.started(tx(1), 3_600, { fee: { validUntil: 60 } })
    const confirm = vi.fn((_fees: ProviderFeeQuote[]) => true)

    const result = await download('30', { confirmProviderFees: confirm }).result

    expect(result).to.include({ transferTxId: '0xreusetx', reusedOrder: true })
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).to.deep.equal([
      {
        token: getAddress(PROVIDER_FEE_TOKEN),
        amount: 30n,
        collector: PROVIDER_FEE_WALLET.address,
        datatoken: DATATOKEN_ADDRESS,
        did: ASSET_DID,
        serviceId: SERVICE_ID
      }
    ])
    expect(vi.mocked(reuseOrder)).toHaveBeenCalledOnce()
    expect(vi.mocked(reuseOrder).mock.calls[0][0]).to.deep.include({
      validOrderTx: tx(1),
      maxProviderFee: [{ token: getAddress(PROVIDER_FEE_TOKEN), amount: 30n }],
      confirmProviderFees: undefined
    })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('refuses the fee a declined callback did not allow, before any transaction', async () => {
    chain.started(tx(1), 3_600, { fee: { validUntil: 60 } })

    const { result, node } = download('30', {
      confirmProviderFees: () => false
    })
    const thrown = await result.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(thrown.reason).to.equal('declined')
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(node.getDownloadUrl).not.toHaveBeenCalled()
  })
})
