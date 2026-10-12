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
 *
 * The scan is built to be quick on a slow or rate-limited RPC without ever reading "not
 * checked" as "not found": 10,000-block chunks, the newest alone and then up to four in
 * flight, checked strictly newest first; range refusals halve a chunk and accepted reads
 * grow it back (remembered per provider instance and chain, never by URL); rate limits are
 * waited out, not halved; an `OrderReused` flood falls back to the account's indexed
 * `OrderStarted`; the account's unconfirmed orders, a head older than the window and a
 * never-expiring service's unproven creation block all end as errors, not as "not found".
 * Not exported from the package.
 */
import type { Block, Log, Provider, TransactionReceipt } from 'ethers'
import { Interface, toUtf8String, zeroPadValue } from 'ethers'
import { rateLimitOf, retryAfterSeconds } from './rpcErrors.js'

/**
 * Blocks per `eth_getLogs` call at first, and at most. Halved while the RPC refuses the
 * range; doubled again after `GROW_AFTER` reads it accepts in a row. A rate limit is not a
 * range refusal: it is waited out and read again, never halved.
 */
const CHUNK_BLOCKS = 10_000
const GROW_AFTER = 2

/**
 * The smallest chunk remembered for the next lookup on the same provider and chain. A
 * lookup may halve below it; the next one starts here and halves again if it must.
 */
const MIN_REMEMBERED_CHUNK = 500

/** Chunks read in parallel after the first, which is read alone (a reuse is usually there). */
const WAVE = 4

/**
 * Reads of a rate-limited chunk after the first, waiting `Retry-After` (else 1, 2, 4 s),
 * at most `MAX_BACKOFF_MS` each. Then the rate limit is thrown.
 */
const RATE_LIMIT_RETRIES = 3
const MAX_BACKOFF_MS = 8_000

/**
 * The lookup's bounds: blocks back from the newest one, and chunk reads (retries
 * of a refused range included). A lookup that reaches either before the end of the
 * service's timeout, with no order found, throws an `IncompleteOrderLookupError`: an order
 * beyond them cannot be ruled out. `MAX_BLOCKS` is what `MAX_READS` covers at full chunks:
 * about 23 days of 2 s blocks.
 */
const MAX_BLOCKS = 1_000_000
const MAX_READS = 100

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
 * extended: this, or half the timeout when that is less. The node checks the order again
 * when the URL is downloaded, and a reuse does not restart the timeout, so an order close
 * to it is ordered anew instead of extended with a fee for a download that would soon fail.
 */
const MARGIN_SECONDS = 600

const EVENTS = new Interface([
  'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)',
  'event OrderReused(bytes32 orderTxId, address caller, uint256 timestamp, uint256 number)',
  'event ProviderFee(address indexed providerFeeAddress, address indexed providerFeeToken, uint256 providerFeeAmount, bytes providerData, uint8 v, bytes32 r, bytes32 s, uint256 validUntil)'
])

/** The NFT factory's event for each datatoken it deploys (for a data NFT's `createERC20`). */
const CREATION = new Interface([
  'event TokenCreated(address indexed newTokenAddress, address indexed templateAddress, string name, string symbol, uint256 cap, address creator)'
])

const topic = (name: string) => EVENTS.getEvent(name)?.topicHash as string
const ORDER_STARTED = topic('OrderStarted')
const ORDER_REUSED = topic('OrderReused')
const TOKEN_CREATED = CREATION.getEvent('TokenCreated')?.topicHash as string

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
  /**
   * The chain's ERC721 factory (`Config.nftFactoryAddress`), which logs the creation of
   * every datatoken. Without it, the creation block of a datatoken is not looked up.
   */
  nftFactoryAddress?: string
  /**
   * The chain the provider is on. With the provider instance, it keys what the lookup
   * remembers between calls (the chunk size the RPC accepts, a datatoken's creation block).
   */
  chainId?: number
}

/**
 * Which bound stopped a lookup short: the chunk reads (`MAX_READS`, a slow or narrow
 * RPC), the blocks read back (`MAX_BLOCKS`, a timeout longer than that, or none and a
 * datatoken older than that), the candidates checked (`MAX_CHECKS`), or an order of the
 * account in the newest blocks, not confirmed yet (`unconfirmed`).
 */
export type IncompleteLookupLimit =
  | 'reads'
  | 'depth'
  | 'candidates'
  | 'unconfirmed'

/**
 * Thrown by the lookup when it stopped before it covered the whole order window (the
 * service's timeout), with no order found, so an order in the part it did not read cannot
 * be ruled out; or when the account has an order in the newest blocks that has no
 * confirmations yet. Not finding an order there is not "not found": a paid service is not
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
  /**
   * The bound that stopped it. `reads` and `unconfirmed` can end differently on a retry;
   * `depth` and `candidates` end the same way.
   */
  readonly limit: IncompleteLookupLimit

  constructor(
    checkedHours: number,
    windowHours: number,
    limit: IncompleteLookupLimit = 'reads'
  ) {
    super(
      limit === 'unconfirmed'
        ? `The previous-order lookup found an order of the account in the newest blocks, without ${CONFIRMATIONS} confirmations yet.`
        : `The previous-order lookup stopped at its ${limit} limit, after ${roughHours(checkedHours)} of ${roughHours(windowHours)} hours.`
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

/**
 * Thrown when the RPC's newest block is older than the whole order window: an RPC that
 * lags (or a local clock that is ahead) by more than the service's timeout cannot show an
 * order in force, so its "no order" is no answer. Classified as `rpc-error`. On a chain
 * that mines only on demand (a local anvil), an idle chain looks the same: any
 * transaction mines a fresh block.
 */
export class StaleRpcHeadError extends Error {
  /** How old the RPC's newest block is, in hours, by this computer's clock. */
  readonly ageHours: number

  constructor(ageHours: number) {
    super(
      `The RPC's newest block is ${roughHours(ageHours)} hours old, older than the order window.`
    )
    this.name = 'StaleRpcHeadError'
    this.ageHours = ageHours
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

/** For tests: the clock and the wait between rate-limited reads. */
export interface PreviousOrderOptions {
  now?: number
  sleep?: (ms: number) => Promise<void>
}

/** The wait between rate-limited reads when no `sleep` is given; tests replace it. */
export const scanTiming = {
  sleep: (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The account's newest order for the service that both nodes would accept for a download,
 * or `undefined` when there is none within the lookup's bounds.
 *
 * The events are read newest first, in chunks of blocks, from the newest block down to the
 * first block still inside the service's timeout (for a service whose orders never expire,
 * the datatoken's creation block when it can be proven), and no further than `MAX_BLOCKS`
 * and `MAX_READS`. The first chunk is read alone, in parallel with the reads that place the
 * window's start; then up to `WAVE` chunks at a time, their candidates checked newest
 * first. Orders are reused only with `CONFIRMATIONS`; at most `MAX_CHECKS` candidates are
 * checked, after which the best extendable order found is returned.
 *
 * A chunk the RPC refuses as too large is read again in halves, and the size grows back
 * after reads it accepts. When only the `OrderReused` read is refused (a flood of reuses,
 * which anyone can send for gas), that chunk is read with the account's `OrderStarted`
 * alone. A rate limit is waited out and the chunk read again, up to `RATE_LIMIT_RETRIES`
 * times, then thrown. Any other error is thrown.
 *
 * `undefined` means the whole window was read and holds no such order. Otherwise it throws
 * an `IncompleteOrderLookupError` when it stopped before it covered the window (at
 * `MAX_BLOCKS`, `MAX_READS` or `MAX_CHECKS`) with no order found, or when the account has
 * an order in the newest blocks not confirmed yet and none confirmed is usable; a
 * `StaleRpcHeadError` when the RPC's newest block is older than the window; and an
 * `InconsistentRpcAnswerError` when the RPC's answers contradict each other.
 */
export async function findPreviousOrder(
  query: PreviousOrderQuery,
  options: PreviousOrderOptions = {}
): Promise<PreviousOrder | undefined> {
  const { provider } = query
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const sleep = options.sleep ?? scanTiming.sleep

  // Seconds after its block an order is still reused: the node's `elapsed > timeout`, with
  // the margin. `NaN` (a missing timeout) never compares greater, as at the node.
  const timeout = query.timeout === 0 ? Number.NaN : Number(query.timeout)
  const margin = Number.isNaN(timeout)
    ? MARGIN_SECONDS
    : Math.min(MARGIN_SECONDS, Math.floor(timeout / 2))
  const lifetime = Number.isNaN(timeout)
    ? Number.POSITIVE_INFINITY
    : timeout - margin

  if (lifetime <= 0) return undefined

  // A block mined before `cutoff` holds no order that is still reused.
  const cutoff = now - lifetime
  const head = await provider.getBlock('latest')

  if (!head) throw new InconsistentRpcAnswerError('no newest block')
  // Its whole window is newer than the RPC's newest block: it cannot show an order there.
  if (head.timestamp < cutoff)
    throw new StaleRpcHeadError((now - head.timestamp) / 3600)

  const latest = head.number - CONFIRMATIONS + 1
  const floor = Math.max(0, head.number - MAX_BLOCKS + 1)
  const chunk = chunkSize(provider, query.chainId)
  const read = reader(query, sleep)

  // Where the window starts, and whether `MAX_BLOCKS` cut it, read while the first chunk is.
  const windowing = Number.isFinite(cutoff)
    ? windowStart(provider, head, floor, cutoff)
    : neverExpiring(query, head, floor)

  const check = checker(query, now, lifetime, margin)
  let extendable: { orderTxId: string; timestamp: number } | undefined
  let checks = 0
  let reads = 0
  /**
   * The ranges being read or to be read, newest first, each with its answer once asked.
   * Up to `WAVE` are read at a time (the first alone), and each is checked only once
   * every newer one has been, so the newest order is found first whatever answers first.
   */
  const queue: Chunk[] = []
  /** The newest block not queued yet: the newest of all, to see unconfirmed orders. */
  let next = head.number
  /** Set when the scan reached a block older than the window: all of it was read. */
  let covered = false
  /** Set when `MAX_CHECKS` stopped the scan: the time of the first candidate not checked. */
  let cappedAt: number | undefined
  /** Set when the account has an order without confirmations. */
  let pending = false
  /** Whether a chunk has been read: the first is read alone. */
  let started = false
  let stop = floor
  let window: Window | undefined

  scan: for (;;) {
    // Queue the next ranges down to the window's start, and ask for up to `WAVE` of them.
    while (queue.length < WAVE && next >= stop) {
      const from = Math.max(stop, next - chunk.size + 1)
      queue.push({ from, to: next })
      next = from - 1
    }
    for (const range of queue.slice(0, started ? WAVE : 1))
      if (!range.answer && reads < MAX_READS) {
        reads++
        range.answer = read(range.from, range.to).then(
          (candidates) => ({ candidates }),
          (error: unknown) => ({ error })
        )
      }

    if (!window) {
      window = await windowing
      stop = window.start
      // Ranges wholly before the window hold no order in force.
      while (queue.length > 1 && (queue.at(-1) as Chunk).to < stop) queue.pop()
      next = Math.min(next, (queue.at(-1) as Chunk).from - 1)
    }

    const range = queue[0]
    if (!range?.answer) break

    const answer = await range.answer
    const width = range.to - range.from + 1

    if ('error' in answer) {
      if (width === 1 || !isRangeError(answer.error)) throw answer.error
      chunk.refused(width)
      // Read again in two halves; the answers for older ranges are kept.
      const middle = range.from + Math.floor(width / 2)
      queue.splice(
        0,
        1,
        { from: middle, to: range.to },
        { from: range.from, to: middle - 1 }
      )
      continue
    }

    queue.shift()
    chunk.accepted(width)
    started = true

    for (const candidate of answer.candidates) {
      // An order of the account without confirmations: not reused, and not ignored.
      if (candidate.block > latest) {
        if (candidate.relevant(query.serviceIndex)) pending = true
        continue
      }
      // Every older candidate is older still, and so is the order it names.
      if (candidate.timestamp < cutoff) {
        covered = true
        break scan
      }
      if (checks++ === MAX_CHECKS) {
        cappedAt = candidate.timestamp
        break scan
      }

      const verdict = await check(candidate)

      if (verdict?.usable)
        return { orderTxId: verdict.orderTxId, usableTxId: candidate.txId }

      if (verdict && verdict.timestamp > (extendable?.timestamp ?? -1))
        extendable = verdict
    }
  }

  window ??= await windowing
  /** The newest block not read: the read is complete when it is older than `stop`. */
  const to = queue[0]?.to ?? next

  const windowHours = Number.isFinite(lifetime)
    ? Number(query.timeout) / 3600
    : Number.POSITIVE_INFINITY

  // A newer order may be about to count: extending an older one or buying again would pay.
  if (pending)
    throw new IncompleteOrderLookupError(Number.NaN, windowHours, 'unconfirmed')
  if (extendable) return { orderTxId: extendable.orderTxId }
  if (covered) return undefined

  // Nothing found, but not everything read: "not found" would buy again blind.
  const hoursSince = (timestamp: number | undefined) =>
    timestamp === undefined ? Number.NaN : (now - timestamp) / 3600

  if (cappedAt !== undefined)
    throw new IncompleteOrderLookupError(
      hoursSince(cappedAt),
      windowHours,
      'candidates'
    )
  if (to >= stop)
    throw new IncompleteOrderLookupError(
      to === head.number
        ? hoursSince(head.timestamp)
        : hoursSince(await blockTime(provider, to + 1)),
      windowHours,
      'reads'
    )
  if (window.cut)
    throw new IncompleteOrderLookupError(
      hoursSince(window.time ?? (await blockTime(provider, stop))),
      windowHours,
      'depth'
    )

  return undefined
}

/** A block's time, or `undefined` when it cannot be read: only for the message. */
async function blockTime(
  provider: Provider,
  block: number
): Promise<number | undefined> {
  try {
    return (await provider.getBlock(block))?.timestamp
  } catch {
    return undefined
  }
}

/**
 * The first block to read, and whether a bound rather than the window ended the read:
 * `cut` is set when `start` is inside the window (or its time is unknown) and older blocks
 * exist. `time` is `start`'s time, when read.
 */
interface Window {
  start: number
  cut: boolean
  time?: number
}

/**
 * The first block to read: `floor`, or a later block mined before `cutoff` when `floor` is
 * too. Block times never decrease, so every block before it was mined before `cutoff` as
 * well. The block is estimated between `floor` and `head` from their times, early by a
 * twentieth of the window (and 100 blocks), and checked; when it was mined after `cutoff`
 * (block times vary), once more eight times as early; when that fails too, the whole bound
 * is read.
 */
async function windowStart(
  provider: Provider,
  head: Block,
  floor: number,
  cutoff: number
): Promise<Window> {
  const base = await provider.getBlock(floor)

  if (!base || base.timestamp >= cutoff)
    return { start: floor, cut: floor > 0, time: base?.timestamp }

  const perSecond = (head.number - floor) / (head.timestamp - base.timestamp)
  const linear = floor + Math.floor((cutoff - base.timestamp) * perSecond)
  const early = Math.ceil((head.timestamp - cutoff) * perSecond * 0.05) + 100

  for (const factor of [1, 8]) {
    const estimate = linear - early * factor
    if (estimate <= floor) return { start: floor, cut: false }

    const block = await provider.getBlock(estimate)
    if (block && block.timestamp < cutoff)
      return { start: estimate, cut: false }
  }

  return { start: floor, cut: false }
}

/**
 * The window of a service whose orders never expire: every block since the datatoken was
 * created. On a chain longer than `MAX_BLOCKS`, that is `floor` cut short, unless the
 * datatoken's creation block is proven to lie after `floor` (see `creationBlock`).
 */
async function neverExpiring(
  query: PreviousOrderQuery,
  head: Block,
  floor: number
): Promise<Window> {
  if (floor === 0) return { start: 0, cut: false }

  const created = await creationBlock(query, head, floor)

  return created === undefined
    ? { start: floor, cut: true }
    : { start: created, cut: false }
}

/** Creation blocks proven, per provider instance, by chain and datatoken. */
const creations = new WeakMap<Provider, Map<string, number>>()

/**
 * The block the datatoken was created in, when it is at or after `floor` and can be
 * proven; otherwise `undefined`. No order of the datatoken is older than its creation.
 *
 * Found from the datatoken's code: none at `floor - 1`, then a search for the first block
 * that has it (`WAVE` blocks probed at a time). An RPC that has pruned old state can answer
 * "no code" for a block where the datatoken existed, which would place the creation too
 * late and hide older orders; so the answer counts only when the chain's NFT factory
 * (`nftFactoryAddress`, which deploys every datatoken) logged its `TokenCreated` for it in
 * that very block. Without the factory's address there is no proof. An RPC that cannot read old state
 * at all (an error) gives `undefined`, as does any other failed read, except a rate limit,
 * which is thrown.
 */
async function creationBlock(
  query: PreviousOrderQuery,
  head: Block,
  floor: number
): Promise<number | undefined> {
  const { provider } = query
  const datatoken = query.datatokenAddress.toLowerCase()
  const key = `${query.chainId ?? '?'} ${datatoken}`
  const known = creations.get(provider)?.get(key)
  const factory = query.nftFactoryAddress?.toLowerCase()

  if (known !== undefined) return known >= floor ? known : undefined
  if (!factory) return undefined

  const exists = async (block: number) =>
    !/^0x0*$/i.test(await provider.getCode(datatoken, block))

  try {
    if (await exists(floor - 1)) return undefined

    // The datatoken exists at `hi` and not before `lo`.
    let lo = floor
    let hi = head.number
    if (!(await exists(hi))) return undefined

    while (lo < hi) {
      const step = Math.ceil((hi - lo) / (WAVE + 1))
      const points: number[] = []
      for (let point = lo + step - 1; point < hi; point += step)
        if (points.push(point) === WAVE) break

      const found = await Promise.all(points.map(exists))
      const first = found.indexOf(true)

      if (first === -1) lo = (points.at(-1) as number) + 1
      else {
        hi = points[first]
        if (first > 0) lo = points[first - 1] + 1
      }
    }

    const logs = await provider.getLogs({
      address: factory,
      topics: [TOKEN_CREATED, zeroPadValue(datatoken, 32)],
      fromBlock: hi,
      toBlock: hi
    })

    if (
      !logs.some(
        (log) => log.address.toLowerCase() === factory && log.blockNumber === hi
      )
    )
      return undefined

    const cache = creations.get(provider) ?? new Map<string, number>()
    creations.set(provider, cache.set(key, hi))

    return hi
  } catch (error) {
    if (rateLimitOf(error)) throw error
    return undefined
  }
}

/** Chunk sizes the RPC accepted, per provider instance, by chain. */
const chunks = new WeakMap<Provider, Map<string, number>>()

/**
 * The chunk size of one lookup: the one the RPC last accepted on this provider and chain,
 * else `CHUNK_BLOCKS`. Halved on a range refusal, doubled after `GROW_AFTER` accepted reads
 * in a row (up to `CHUNK_BLOCKS`), and remembered, no smaller than `MIN_REMEMBERED_CHUNK`,
 * only after a read the RPC accepted. Keyed by the provider instance, never by its URL,
 * which can hold an API key.
 */
function chunkSize(provider: Provider, chainId: number | undefined) {
  const key = String(chainId ?? '?')
  const remembered = chunks.get(provider) ?? new Map<string, number>()
  chunks.set(provider, remembered)

  let size = remembered.get(key) ?? CHUNK_BLOCKS
  let streak = 0

  return {
    get size() {
      return size
    },
    /** A read of `used` blocks was refused as too large. */
    refused(used: number) {
      streak = 0
      // Reads asked for before an earlier refusal can be refused too: no smaller than half.
      size = Math.max(1, Math.min(size, Math.floor(used / 2)))
    },
    /** A read of `used` blocks was accepted. */
    accepted(used: number) {
      // A half of a refused range says nothing about the size.
      if (used < size) return
      remembered.set(key, Math.max(MIN_REMEMBERED_CHUNK, size))
      if (++streak >= GROW_AFTER && size < CHUNK_BLOCKS) {
        size = Math.min(CHUNK_BLOCKS, size * 2)
        streak = 0
      }
    }
  }
}

/** A range of blocks of the scan, and its read once asked for. */
interface Chunk {
  from: number
  to: number
  answer?: Promise<{ candidates: Candidate[] } | { error: unknown }>
}

interface Candidate {
  txId: string
  /** The block and block time of the transaction. */
  block: number
  timestamp: number
  /** The account's event the logs list for it, from the datatoken. */
  event: 'OrderStarted' | 'OrderReused'
  /**
   * Whether it can stand for an order of the service: an `OrderStarted` of its service
   * index, or a reuse (by the account) of any order.
   */
  relevant: (serviceIndex: number) => boolean
}

/**
 * Reads the account's `OrderStarted` and `OrderReused` transactions in a range, newest
 * first. A rate-limited call is waited out and made again; an `OrderReused` call refused
 * for its range or volume, while the `OrderStarted` one is answered, leaves the account's
 * `OrderStarted` alone for that range: every order in force has its `OrderStarted` in the
 * window, and that event is indexed by consumer, so no flood of other accounts' events can
 * fill it.
 */
function reader(
  query: PreviousOrderQuery,
  sleep: (ms: number) => Promise<void>
) {
  const account = query.account.toLowerCase()

  const logs = async (filter: Parameters<Provider['getLogs']>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await query.provider.getLogs(filter)
      } catch (error) {
        if (attempt === RATE_LIMIT_RETRIES || !rateLimitOf(error)) throw error
        const asked = retryAfterSeconds(error)
        await sleep(
          Math.min(
            MAX_BACKOFF_MS,
            asked === undefined ? 1_000 * 2 ** attempt : asked * 1_000
          )
        )
      }
    }
  }

  return async (fromBlock: number, toBlock: number): Promise<Candidate[]> => {
    const range = { address: query.datatokenAddress, fromBlock, toBlock }
    const [started, reused] = await Promise.allSettled([
      logs({ ...range, topics: [ORDER_STARTED, zeroPadValue(account, 32)] }),
      logs({ ...range, topics: [ORDER_REUSED] })
    ])

    if (started.status === 'rejected') throw started.reason
    if (reused.status === 'rejected' && !isRangeError(reused.reason))
      throw reused.reason

    const seen = new Set<string>()
    const all = [
      ...started.value,
      ...(reused.status === 'fulfilled' ? reused.value : [])
    ]

    return all.sort(newestFirst).flatMap((log) => {
      const event = decode(log)
      const txId = log.transactionHash.toLowerCase()

      if (!event || event.name === 'ProviderFee' || seen.has(txId)) return []
      if (event.name === 'OrderReused' && event.caller !== account) return []

      seen.add(txId)
      return [
        {
          txId,
          block: log.blockNumber,
          timestamp: event.timestamp,
          event: event.name,
          relevant: (serviceIndex: number) =>
            event.name === 'OrderReused' ||
            event.serviceIndex === BigInt(serviceIndex)
        }
      ]
    })
  }
}

/**
 * Checks a candidate the way the node checks a download's `transferTxId`: the order it
 * stands for, if both nodes accept it with `lifetime` left, and whether the candidate is
 * usable as it stands: sent to the datatoken, with its own provider fee kept by the node.
 */
function checker(
  query: PreviousOrderQuery,
  now: number,
  lifetime: number,
  margin: number
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

    return pending
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
        BigInt(now + margin - minedAt) <= event.validUntil)
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
 * exceeded"): halving on it spends the reads until the window cannot be covered.
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
