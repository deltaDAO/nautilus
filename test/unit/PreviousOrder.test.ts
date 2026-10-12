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
const LATEST = 500_000
/** Seconds per block on the in-memory chain. */
const BLOCK_TIME = 2
/** The lookup's first chunk, in blocks, and the time an order must have left. */
const CHUNK = 2_000
const MARGIN = 600

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
    ...overrides
  }
}

const find = (overrides: Partial<PreviousOrderQuery> = {}) =>
  findPreviousOrder(query(overrides), { now: NOW })

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

/** What `find()` threw (or found). */
const failure = (overrides: Partial<PreviousOrderQuery> = {}) =>
  find(overrides).then(
    (found) => found as unknown as IncompleteOrderLookupError,
    (error: IncompleteOrderLookupError) => error
  )

beforeEach(() => {
  vi.clearAllMocks()
  chain = new Chain()
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

  it('never reuses an order of a service whose timeout is within the margin', async () => {
    chain.started(tx(1), 10)

    expect(await find({ timeout: MARGIN })).to.equal(undefined)
    expect(chain.getLogs).not.toHaveBeenCalled()
  })

  it('treats a missing timeout as never expiring, as the node does', async () => {
    chain.started(tx(1), 150_000)

    for (const timeout of [undefined, Number.NaN])
      expect(await find({ timeout })).to.deep.equal({
        orderTxId: tx(1),
        usableTxId: tx(1)
      })
  })

  it('ignores an order without confirmations, which a reorg may drop', async () => {
    chain.started(tx(1), 2)

    expect(await find()).to.equal(undefined)
    expect(ranges()[0][1]).to.equal(LATEST - 2)
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

  // A receipt that holds another of the account's events of the same transaction but not
  // the one the logs list: the node takes that missing one first, so "no order" bought again.
  it('throws when a receipt lacks one of the order events the logs list', async () => {
    chain.tx(tx(1), 3_600).fee().started().started({ serviceIndex: 1 })
    const read = chain.getTransactionReceipt.getMockImplementation()
    const partial = async (txId: string) => {
      const receipt = (await read?.(txId)) ?? null
      return (
        receipt && {
          ...receipt,
          logs: receipt.logs.filter(
            (log) => EVENTS.parseLog(log)?.args.serviceIndex !== 0n
          )
        }
      )
    }

    // Control: with the whole receipt, the order is found.
    expect(await find()).to.deep.equal({ orderTxId: tx(1), usableTxId: tx(1) })

    chain.getTransactionReceipt.mockImplementation(partial)
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
    for (const [from, to] of ranges()) expect(to - from).to.be.below(CHUNK)

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
        timestamp: number === LATEST - 100_000 + 1 - 2 ? 0 : NOW
      }
    })
    chain.started(tx(1), DAY + 10)
    chain.started(tx(2), 3_600, { fee: { address: OTHER } })

    expect(await find()).to.deep.equal({ orderTxId: tx(2) })
    expect(Math.min(...ranges().map(([from]) => from))).to.be.above(
      blockAt(DAY + 10) - CHUNK
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
    for (const [from, to] of ranges().slice(2))
      expect(to - from).to.be.below(500)
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
    chain.started(tx(1), 2 * 100_000 + 10, { fee: { validUntil: 0 } })

    const thrown = await failure({ timeout: 0 })

    // Orders of the service never expire: one older than the read depth may be in force.
    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({
      windowHours: Number.POSITIVE_INFINITY,
      limit: 'depth'
    })
    expect(thrown.checkedHours).to.be.closeTo(
      ((100_000 + 2) * BLOCK_TIME) / 3_600,
      0.01
    )
    expect(ranges()).to.have.length(100_000 / CHUNK)
  })

  it('reports an incomplete lookup when the timeout reaches past the read depth', async () => {
    const thrown = await failure({ timeout: 7 * DAY })

    expect(thrown).to.be.instanceOf(IncompleteOrderLookupError)
    expect(thrown).to.include({ windowHours: 7 * 24, limit: 'depth' })
    expect(thrown.checkedHours).to.be.closeTo(55.6, 0.1)
  })

  it('finds nothing on a chain shorter than the read depth, for timeout 0', async () => {
    chain.getBlock.mockImplementation(async (tag: number | 'latest') => {
      const number = tag === 'latest' ? 50_000 : tag
      return { number, timestamp: NOW - (50_000 - number) * BLOCK_TIME }
    })

    expect(await find({ timeout: 0 })).to.equal(undefined)
    expect(Math.min(...ranges().map(([from]) => from))).to.equal(0)
  })

  it('throws a rate limit instead of reading the range again in halves', async () => {
    chain.getLogs.mockRejectedValueOnce(rateLimited())
    chain.started(tx(1), 3_600)

    const thrown = await failure()

    // Halving on a 429 ran the reads out and ended in "not found" (then a paid re-order).
    expect(thrown).to.have.property('code', 'SERVER_ERROR')
    expect(ranges()).to.have.length(1)
  })

  it('throws a JSON-RPC -32005 rate limit, and halves a -32005 range refusal', async () => {
    chain.getLogs.mockRejectedValue(
      rpcError(-32005, 'daily request count exceeded, request rate limited')
    )
    expect(await failure()).to.have.property('code', 'UNKNOWN_ERROR')
    expect(ranges()).to.have.length(1)

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
      'Cause: the check covered only the last 55 hours, and orders of this service never expire.'
    )
    expect(thrown.message).to.contain(
      'A retry ends the same way. If this account never bought this service, buying is safe.'
    )
    expect(vi.mocked(order)).not.toHaveBeenCalled()
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
