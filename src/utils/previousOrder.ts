/**
 * Finding a previous order on chain, for a node whose `initialize` reports no `validOrder`.
 *
 * ocean-node's access `initialize` answers with a fresh provider fee and no `validOrder`;
 * only its compute `initialize` checks a previous order. This module looks the account's
 * orders up in the datatoken's events and checks each candidate transaction the way the
 * node checks the `transferTxId` of a download (`validateOrderTransaction` and
 * `verifyProviderFees`), from the transaction receipts. Upstream ocean-node (4.2.0) and
 * OceanProtocolEnterprise ocean-node (4.2) check it differently, and a candidate counts
 * only when both would accept it, so `access()` never skips a payment the node then
 * refuses:
 *
 *   - upstream reads the datatoken from the given transaction's `to`, before following a
 *     reuse; enterprise does not read `to`. A candidate is used as it stands only when its
 *     transaction was sent to the datatoken itself; one sent through another contract (the
 *     factory's `startMultipleTokenOrder`, a contract wallet, a relayer) is only extended,
 *     with a `reuseOrder` nautilus sends to the datatoken;
 *   - when the transaction holds an `OrderReused`, the node follows the first one in log
 *     order, from any contract, to the transaction it names; nautilus also requires that
 *     reuse's `caller` to be the account;
 *   - in that transaction, upstream takes the first `OrderStarted`, from any contract,
 *     whose consumer or payer is the account, enterprise the first such one this datatoken
 *     emitted. The order counts only when that first one is this datatoken's, and the node
 *     rejects it when its service index is not the service's;
 *   - the order is inside the service's `timeout`, counted from the block of the
 *     `OrderStarted` (a reuse does not restart it). `0` never expires, and neither does a
 *     timeout that is not a number (missing), since the node's `elapsed > timeout` is then
 *     false;
 *   - the transaction itself carries a `ProviderFee`, from any contract, from the node's fee
 *     address for this service and datatoken, that the node keeps: `validUntil` is `0`, or
 *     `now - block.timestamp <= validUntil` with the block of that transaction. The node
 *     compares an elapsed time to `validUntil`, which it signs as an absolute time
 *     (`now + timeout`), so a fee it signed for a service with a timeout effectively never
 *     expires; this mirrors what the node accepts, not what `validUntil` means.
 *
 * The node also checks that the datatoken belongs to the asset's data NFT, which holds for
 * every order of the datatoken the asset names.
 *
 * Block times are read from the events' `timestamp`, which the datatoken sets to
 * `block.timestamp`: the lookup reads only this datatoken's logs, so they are its own.
 *
 * Candidates are the datatoken's `OrderStarted` events whose indexed `consumer` is the
 * account (the way nautilus orders), and its `OrderReused` events whose `caller` is the
 * account (`OrderReused` has no indexed field, so every account's are read and filtered).
 * Not exported from the package.
 */
import type { Block, Log, Provider, TransactionReceipt } from 'ethers'
import { Interface, toUtf8String, zeroPadValue } from 'ethers'
import { rateLimitOf } from './rpcErrors.js'

/**
 * Blocks per `eth_getLogs` call: the first size, then each narrower one in turn while the
 * RPC refuses the range. The size that worked is kept for the rest of the scan. A rate
 * limit is not a range refusal: it is thrown, not narrowed.
 */
const CHUNKS = [2_000, 1_000, 500, 200, 100, 50, 20, 10, 5, 2, 1]
const CHUNK_BLOCKS = CHUNKS[0] as number

/**
 * The lookup's bounds: blocks back from the newest confirmed one; rounds of `eth_getLogs`
 * calls the RPC answered, enough to read the blocks at `MIN_CHUNK_BLOCKS` per round and at
 * least `MIN_READS`; and time, from the start of the lookup, which bounds every wait for the
 * RPC too (`timeBound`), so a call it does not answer in time ends the lookup at the limit
 * rather than when the answer comes. A refused range is not a round:
 * it only narrows the chunk, at most once per size. A lookup that reaches a bound before the
 * end of the service's timeout, with no order found, throws an `IncompleteOrderLookupError`:
 * an order beyond it cannot be ruled out. An RPC that serves fewer than `MIN_CHUNK_BLOCKS`
 * blocks per call may run out of rounds.
 */
const MAX_BLOCKS = 100_000
const MIN_CHUNK_BLOCKS = 100
const MIN_READS = 100
const TIME_LIMIT_MS = 300_000

/**
 * Candidates checked at most, each costing up to two receipt reads: anyone can place an
 * order with the account as consumer, and one of a free (dispenser) datatoken costs next to
 * nothing, so the lookup gives up after this many and `access()` extends the best one found.
 * With none found, it throws an `IncompleteOrderLookupError`.
 */
const MAX_CHECKS = 50

/** Blocks an order's block needs on top of it, itself included, before it is reused. */
const CONFIRMATIONS = 3

/**
 * Seconds of the service's timeout an order must have left to be reused, as it stands or
 * extended. The node checks the order again when the URL is downloaded, and a reuse does
 * not restart the timeout, so an order close to it is ordered anew instead of extended
 * with a fee for a download that would soon fail. A service whose timeout is this short
 * or shorter is ordered anew every time.
 */
const MARGIN_SECONDS = 600

const EVENTS = new Interface([
  'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)',
  'event OrderReused(bytes32 orderTxId, address caller, uint256 timestamp, uint256 number)',
  'event ProviderFee(address indexed providerFeeAddress, address indexed providerFeeToken, uint256 providerFeeAmount, bytes providerData, uint8 v, bytes32 r, bytes32 s, uint256 validUntil)'
])

const topic = (name: string) => EVENTS.getEvent(name)?.topicHash as string
const ORDER_STARTED = topic('OrderStarted')
const ORDER_REUSED = topic('OrderReused')

export interface PreviousOrderQuery {
  provider: Provider
  datatokenAddress: string
  /** The account the order is for. */
  account: string
  serviceIndex: number
  serviceId: string
  /** The service's timeout in seconds; `0` and a missing one never expire. */
  timeout?: number
  /** The node's fee address, the `providerFeeAddress` of the fee it quotes now. */
  providerFeeAddress?: string
}

/**
 * Which bound stopped a lookup short: the rounds of reads or their time (a slow or narrow
 * RPC), the blocks read back (`MAX_BLOCKS`, a timeout longer than that, or none), or the
 * candidates checked (`MAX_CHECKS`).
 */
export type IncompleteLookupLimit = 'reads' | 'depth' | 'candidates'

/**
 * Thrown by the lookup when it stopped before it covered the whole order window (the
 * service's timeout), with no order found, so an order in the part it did not read cannot
 * be ruled out. Not finding an order there is not "not found": a paid service is not
 * ordered again (see `OrderCheckError`, reason `incomplete`).
 */
export class IncompleteOrderLookupError extends Error {
  /** Hours back from now the lookup did read; `NaN` when that block's time is unknown. */
  readonly checkedHours: number
  /**
   * Hours back from now an order would still be in force: the service's timeout, infinite
   * when its orders never expire.
   */
  readonly windowHours: number
  /** The bound that stopped it. Only `reads` can end differently on a retry. */
  readonly limit: IncompleteLookupLimit

  constructor(
    checkedHours: number,
    windowHours: number,
    limit: IncompleteLookupLimit = 'reads'
  ) {
    super(
      `The previous-order lookup stopped at its ${limit} limit, after ${roughHours(checkedHours)} of ${roughHours(windowHours)} hours.`
    )
    this.name = 'IncompleteOrderLookupError'
    this.checkedHours = checkedHours
    this.windowHours = windowHours
    this.limit = limit
  }
}

/**
 * Thrown when an RPC answer lacks what the lookup needs: no newest block, no receipt for a
 * transaction the RPC's own logs list (or for the order a reuse of the account names), or
 * a receipt without the event the logs list. A load-balanced RPC whose backends lag each
 * other answers so for a recent order. Read as "no order", it would buy again; it is a
 * failed lookup instead (see `OrderCheckError`, reason `rpc-error`).
 */
export class InconsistentRpcAnswerError extends Error {
  /** What was missing, in plain words: `no receipt for an order its logs list`. */
  readonly missing: string

  constructor(missing: string) {
    super(`The RPC's answer to the previous-order lookup had ${missing}.`)
    this.name = 'InconsistentRpcAnswerError'
    this.missing = missing
  }
}

/** The longest delay `setTimeout` takes: 2^31 - 1 milliseconds. */
const MAX_TIMER_MS = 2_147_483_647

/** Rejects a wait for the RPC that the lookup's time limit ended (`timeBound`). */
class TimeLimitReached extends Error {}

/** A wait for the RPC, bounded by the lookup's time limit (`timeBound`). */
type Bound = <T>(pending: Promise<T>) => Promise<T>

/**
 * `pending`, or a `TimeLimitReached` rejection once `deadline` (a `Date.now()` time) has
 * passed: the RPC call is not cancelled, its answer is only no longer waited for, and its
 * failure is ignored then.
 */
function timeBound(deadline: number): Bound {
  return <T>(pending: Promise<T>) => {
    pending.catch(() => undefined)
    const left = deadline - Date.now()
    if (left <= 0) return Promise.reject(new TimeLimitReached())

    let timer: ReturnType<typeof setTimeout> | undefined
    const reached = new Promise<never>((_resolve, reject) => {
      // A longer delay than `setTimeout` takes (about 24.8 days) would fire at once.
      timer = setTimeout(
        () => reject(new TimeLimitReached()),
        Math.min(left, MAX_TIMER_MS)
      )
    })
    return Promise.race([pending, reached]).finally(() => clearTimeout(timer))
  }
}

function roughHours(hours: number): string {
  if (Number.isNaN(hours)) return 'unknown'
  return Number.isFinite(hours) ? hours.toFixed(1) : 'unlimited'
}

export interface PreviousOrder {
  /** The `OrderStarted` transaction: the one `reuseOrder` extends. */
  orderTxId: string
  /**
   * The newest transaction the node accepts for a download as it stands, the order or a
   * reuse of it. Absent when none does, and the order needs a `reuseOrder` with a new fee.
   */
  usableTxId?: string
}

/**
 * The account's newest order for the service that both nodes would accept for a download,
 * or `undefined` when there is none within the lookup's bounds.
 *
 * The events are read newest first, in chunks of blocks, from the newest block with
 * `CONFIRMATIONS` down to the first block still inside the service's timeout, and no
 * further than `MAX_BLOCKS`, the rounds of reads and `options.timeLimit` (milliseconds,
 * `TIME_LIMIT_MS` by default, which also bounds each wait for the RPC); at most `MAX_CHECKS` candidates are checked, after which the
 * best extendable order found is returned. A chunk the RPC refuses as too large is read
 * again with the next narrower size; any other error is thrown, a rate limit included.
 *
 * `undefined` means the whole window was read and holds no such order. A lookup that
 * stopped before it covered the window (at a bound) with no order found throws an
 * `IncompleteOrderLookupError` instead.
 */
export async function findPreviousOrder(
  query: PreviousOrderQuery,
  options: { now?: number; timeLimit?: number } = {}
): Promise<PreviousOrder | undefined> {
  const { provider } = query
  const bound = timeBound(Date.now() + (options.timeLimit ?? TIME_LIMIT_MS))
  const now = options.now ?? Math.floor(Date.now() / 1000)

  // Seconds after its block an order is still reused: the node's `elapsed > timeout`, with
  // the margin. `NaN` (a missing timeout) never compares greater, as at the node.
  const timeout = query.timeout === 0 ? Number.NaN : Number(query.timeout)
  const lifetime = Number.isNaN(timeout)
    ? Number.POSITIVE_INFINITY
    : timeout - MARGIN_SECONDS

  if (lifetime <= 0) return undefined

  const windowHours = Number.isFinite(lifetime)
    ? Number(query.timeout) / 3600
    : Number.POSITIVE_INFINITY
  // A block mined before `cutoff` holds no order that is still reused.
  const cutoff = now - lifetime
  let head: Block | null
  let window: { start: number; cut: boolean; time?: number }
  let floor = 0
  const latestOf = (newest: Block) => newest.number - CONFIRMATIONS + 1

  try {
    head = await bound(provider.getBlock('latest'))

    if (!head) throw new InconsistentRpcAnswerError('no newest block')
    if (head.timestamp < cutoff) return undefined

    floor = Math.max(0, latestOf(head) - MAX_BLOCKS + 1)
    // Where the window starts, and whether `MAX_BLOCKS` cut it: a service whose orders
    // never expire has no start, and older orders than the floor may be in force.
    window = Number.isFinite(cutoff)
      ? await windowStart(provider, bound, head, floor, cutoff)
      : { start: floor, cut: floor > 0 }
  } catch (error) {
    // The time limit ended the lookup before it read any block.
    if (error instanceof TimeLimitReached)
      throw new IncompleteOrderLookupError(0, windowHours, 'reads')
    throw error
  }

  const latest = latestOf(head)
  const stop = window.start
  const check = checker(query, bound, now, lifetime)
  let extendable: { orderTxId: string; timestamp: number } | undefined
  let chunk = CHUNK_BLOCKS
  let checks = 0
  let to = latest
  let reads = 0
  const maxReads = Math.max(
    MIN_READS,
    Math.ceil((latest - stop + 1) / MIN_CHUNK_BLOCKS)
  )
  /** Set when the scan reached a block older than the window: all of it was read. */
  let covered = false
  /** Set when `MAX_CHECKS` stopped the scan: the time of the first candidate not checked. */
  let cappedAt: number | undefined

  scan: while (to >= stop && reads < maxReads) {
    const from = Math.max(stop, to - chunk + 1)
    let candidates: Candidate[]

    try {
      candidates = await readCandidates(query, bound, from, to)
    } catch (error) {
      if (error instanceof TimeLimitReached) break
      const narrower = CHUNKS.find((size) => size < chunk)
      if (narrower === undefined || !isRangeError(error)) throw error
      chunk = narrower
      continue
    }
    reads++

    for (const candidate of candidates) {
      // Every older candidate is older still, and so is the order it names.
      if (candidate.timestamp < cutoff) {
        covered = true
        break scan
      }
      if (checks++ === MAX_CHECKS) {
        cappedAt = candidate.timestamp
        break scan
      }

      let verdict: Awaited<ReturnType<typeof check>>
      try {
        verdict = await check(candidate)
      } catch (error) {
        // This chunk was not checked to its end: the scan stops inside it.
        if (error instanceof TimeLimitReached) break scan
        throw error
      }

      if (verdict?.usable)
        return { orderTxId: verdict.orderTxId, usableTxId: candidate.txId }

      if (verdict && verdict.timestamp > (extendable?.timestamp ?? -1))
        extendable = verdict
    }

    to = from - 1
  }

  if (extendable) return { orderTxId: extendable.orderTxId }
  if (covered) return undefined

  // Nothing found, but not everything read: "not found" would buy again blind.
  const hoursSince = (timestamp: number | undefined) =>
    timestamp === undefined ? Number.NaN : (now - timestamp) / 3600
  // A block's time from the average block time between `floor` and the head, for when
  // the time limit ended the lookup and the block cannot be read any more.
  const { time: floorTime } = window
  const estimatedTime = (block: number) =>
    floorTime === undefined || head.number === floor
      ? undefined
      : head.timestamp -
        ((head.number - block) * (head.timestamp - floorTime)) /
          (head.number - floor)

  if (cappedAt !== undefined)
    throw new IncompleteOrderLookupError(
      hoursSince(cappedAt),
      windowHours,
      'candidates'
    )
  if (to >= stop)
    throw new IncompleteOrderLookupError(
      to === latest
        ? hoursSince(head.timestamp)
        : hoursSince(
            (await blockTime(provider, bound, to + 1)) ?? estimatedTime(to + 1)
          ),
      windowHours,
      'reads'
    )
  if (window.cut)
    throw new IncompleteOrderLookupError(
      hoursSince(window.time ?? (await blockTime(provider, bound, stop))),
      windowHours,
      'depth'
    )

  return undefined
}

/**
 * A block's time, or `undefined` when it cannot be read, also once the time limit is up:
 * only for the message.
 */
async function blockTime(
  provider: Provider,
  bound: Bound,
  block: number
): Promise<number | undefined> {
  try {
    return (await bound(provider.getBlock(block)))?.timestamp
  } catch {
    return undefined
  }
}

/**
 * The first block to read: `floor`, or a later block mined before `cutoff` when `floor` is
 * too. Block times never decrease, so every block before it was mined before `cutoff` as
 * well. The block is estimated between `floor` and `head`, a chunk early, and checked; when
 * the estimate is wrong the whole bound is read.
 *
 * `cut` is set when `floor` is inside the window (or its time is unknown) and older blocks
 * exist: the bound, not the timeout, ends the read. `time` is `floor`'s time, when read.
 */
async function windowStart(
  provider: Provider,
  bound: Bound,
  head: Block,
  floor: number,
  cutoff: number
): Promise<{ start: number; cut: boolean; time?: number }> {
  const base = await bound(provider.getBlock(floor))

  if (!base || base.timestamp >= cutoff)
    return { start: floor, cut: floor > 0, time: base?.timestamp }

  const estimate =
    floor +
    Math.floor(
      ((cutoff - base.timestamp) / (head.timestamp - base.timestamp)) *
        (head.number - floor)
    ) -
    CHUNK_BLOCKS

  if (estimate <= floor)
    return { start: floor, cut: false, time: base.timestamp }

  const block = await bound(provider.getBlock(estimate))

  return {
    start: block && block.timestamp < cutoff ? estimate : floor,
    cut: false,
    time: base.timestamp
  }
}

interface Candidate {
  txId: string
  /** The block time of the transaction. */
  timestamp: number
  /** The account's event the logs list for it, from the datatoken. */
  event: 'OrderStarted' | 'OrderReused'
}

/** The account's `OrderStarted` and `OrderReused` transactions in the range, newest first. */
async function readCandidates(
  query: PreviousOrderQuery,
  bound: Bound,
  fromBlock: number,
  toBlock: number
): Promise<Candidate[]> {
  const account = query.account.toLowerCase()
  const range = { address: query.datatokenAddress, fromBlock, toBlock }
  const [started, reused] = await bound(
    Promise.all([
      query.provider.getLogs({
        ...range,
        topics: [ORDER_STARTED, zeroPadValue(account, 32)]
      }),
      query.provider.getLogs({ ...range, topics: [ORDER_REUSED] })
    ])
  )

  const seen = new Set<string>()

  return [...started, ...reused].sort(newestFirst).flatMap((log) => {
    const event = decode(log)
    const txId = log.transactionHash.toLowerCase()

    if (!event || event.name === 'ProviderFee' || seen.has(txId)) return []
    if (event.name === 'OrderReused' && event.caller !== account) return []

    seen.add(txId)
    return [{ txId, timestamp: event.timestamp, event: event.name }]
  })
}

/**
 * Checks a candidate the way the node checks a download's `transferTxId`: the order it
 * stands for, if both nodes accept it with `lifetime` left, and whether the candidate is
 * usable as it stands: sent to the datatoken, with its own provider fee kept by the node.
 */
function checker(
  query: PreviousOrderQuery,
  bound: Bound,
  now: number,
  lifetime: number
) {
  const datatoken = query.datatokenAddress.toLowerCase()
  const account = query.account.toLowerCase()
  const feeAddress = query.providerFeeAddress?.toLowerCase()
  const receipts = new Map<string, Promise<TransactionReceipt | null>>()

  const receipt = (txId: string) => {
    let pending = receipts.get(txId)

    if (!pending) {
      pending = query.provider.getTransactionReceipt(txId)
      receipts.set(txId, pending)
    }

    return bound(pending)
  }

  const feeAccepted = (event: Event | undefined, minedAt: number) => {
    if (
      event?.name !== 'ProviderFee' ||
      event.providerFeeAddress !== feeAddress
    )
      return false

    let data: { id?: unknown; dt?: unknown }
    try {
      data = JSON.parse(toUtf8String(event.providerData))
    } catch {
      return false
    }

    return (
      data?.id === query.serviceId &&
      typeof data.dt === 'string' &&
      data.dt.toLowerCase() === datatoken &&
      (event.validUntil === 0n ||
        BigInt(now + MARGIN_SECONDS - minedAt) <= event.validUntil)
    )
  }

  return async (
    candidate: Candidate
  ): Promise<
    { orderTxId: string; timestamp: number; usable: boolean } | undefined
  > => {
    const mined = await receipt(candidate.txId)

    // The RPC's logs list the transaction, so it is mined, with the account's event in it:
    // an answer without them is the RPC's (a lagging backend), not "no order".
    if (!mined)
      throw new InconsistentRpcAnswerError(
        'no receipt for an order transaction its logs list'
      )
    if (!lists(mined, candidate, datatoken, account))
      throw new InconsistentRpcAnswerError(
        'a receipt without the order event its logs list'
      )

    // Upstream ocean-node reads the datatoken from here; a `reuseOrder` nautilus sends passes.
    const direct = mined.to?.toLowerCase() === datatoken

    let ordered: TransactionReceipt | null = mined
    const reused = first(mined, 'OrderReused')

    if (reused) {
      if (reused.event.caller !== account) return undefined
      ordered = await receipt(reused.event.orderTxId)
      if (!ordered)
        throw new InconsistentRpcAnswerError(
          'no receipt for the order a reuse of the account names'
        )
    }

    // The first one from any contract, as upstream takes it: enterprise takes the first one
    // this datatoken emitted, the same one only when it comes first.
    const started = first(
      ordered,
      'OrderStarted',
      (event) => event.consumer === account || event.payer === account
    )

    if (
      !started ||
      started.log.address.toLowerCase() !== datatoken ||
      started.event.serviceIndex !== BigInt(query.serviceIndex)
    )
      return undefined
    if (now - started.event.timestamp > lifetime) return undefined

    return {
      orderTxId: ordered.hash.toLowerCase(),
      timestamp: started.event.timestamp,
      usable:
        direct &&
        mined.logs.some((log) => feeAccepted(decode(log), candidate.timestamp))
    }
  }
}

/** Whether the receipt holds the candidate's event: the account's, from the datatoken. */
function lists(
  receipt: TransactionReceipt,
  candidate: Candidate,
  datatoken: string,
  account: string
): boolean {
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== datatoken) return false
    const event = decode(log)
    if (event?.name === 'OrderStarted')
      return candidate.event === 'OrderStarted' && event.consumer === account
    if (event?.name === 'OrderReused')
      return candidate.event === 'OrderReused' && event.caller === account
    return false
  })
}

type Event =
  | {
      name: 'OrderStarted'
      consumer: string
      payer: string
      serviceIndex: bigint
      timestamp: number
    }
  | {
      name: 'OrderReused'
      orderTxId: string
      caller: string
      timestamp: number
    }
  | {
      name: 'ProviderFee'
      providerFeeAddress: string
      providerData: string
      validUntil: bigint
    }

/** The first event `name` in the receipt, in log order, that `match` accepts, with its log. */
function first<N extends Event['name']>(
  receipt: TransactionReceipt,
  name: N,
  match: (event: Extract<Event, { name: N }>) => boolean = () => true
): { event: Extract<Event, { name: N }>; log: Log } | undefined {
  for (const log of receipt.logs) {
    const event = decode(log)

    if (event?.name === name && match(event as Extract<Event, { name: N }>))
      return { event: event as Extract<Event, { name: N }>, log }
  }

  return undefined
}

/** The event a log holds, read with the template's ABI as the node reads it. */
function decode(log: Pick<Log, 'topics' | 'data'>): Event | undefined {
  let parsed: ReturnType<Interface['parseLog']>
  try {
    parsed = EVENTS.parseLog(log)
  } catch {
    return undefined
  }

  const args = parsed?.args

  switch (parsed?.name) {
    case 'OrderStarted':
      return {
        name: 'OrderStarted',
        consumer: String(args?.consumer).toLowerCase(),
        payer: String(args?.payer).toLowerCase(),
        serviceIndex: BigInt(args?.serviceIndex),
        timestamp: Number(args?.timestamp)
      }
    case 'OrderReused':
      return {
        name: 'OrderReused',
        orderTxId: String(args?.orderTxId).toLowerCase(),
        caller: String(args?.caller).toLowerCase(),
        timestamp: Number(args?.timestamp)
      }
    case 'ProviderFee':
      return {
        name: 'ProviderFee',
        providerFeeAddress: String(args?.providerFeeAddress).toLowerCase(),
        providerData: String(args?.providerData),
        validUntil: BigInt(args?.validUntil)
      }
    default:
      return undefined
  }
}

/**
 * Whether an RPC refused `eth_getLogs` for its range or its number of results. A rate limit
 * is not one, though its text often reads like one ("exceeded maximum retry limit", "limit
 * exceeded"): narrowing on it spends the reads until the window cannot be covered.
 */
function isRangeError(error: unknown): boolean {
  if (rateLimitOf(error)) return false

  const { message, info } = (error ?? {}) as {
    message?: unknown
    info?: { error?: { message?: unknown } }
  }

  return /range|limit|exceed|too (many|large|wide|big)|more than/i.test(
    `${message} ${info?.error?.message}`
  )
}

function newestFirst(a: Log, b: Log): number {
  return b.blockNumber - a.blockNumber || b.index - a.index
}
