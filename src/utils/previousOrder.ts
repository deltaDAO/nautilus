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
 * flight, checked strictly newest first. A range refusal splits the refused chunk, and
 * every chunk not asked for yet, to a smaller size; the size grows back after reads the
 * RPC accepts, never to a range the RPC refused in this lookup, and is remembered per
 * provider instance and chain, never by URL. Rate limits are waited out within one budget
 * per lookup, not halved. An `OrderReused` read refused for its volume is read again in
 * halves, and only a single block refused that way is read with the account's indexed
 * `OrderStarted` alone. The account's unconfirmed orders, a head older than the window
 * and a never-expiring service's unproven creation block all end as errors, not as "not
 * found". Not exported from the package.
 */
import type { Block, Log, Provider, TransactionReceipt } from 'ethers'
import { Interface, toUtf8String, zeroPadValue } from 'ethers'
import { debug } from '../log/debug.js'
import { rateLimitOf, retryAfterSeconds } from './rpcErrors.js'

/**
 * Blocks per `eth_getLogs` call at first, and at most. Split while the RPC refuses the
 * range (see `chunkSize`); grown again after `GROW_AFTER` full reads it accepts in a row.
 * A rate limit is not a range refusal: it is waited out and read again, never split.
 */
const CHUNK_BLOCKS = 10_000
const GROW_AFTER = 2

/**
 * The smallest chunk remembered for the next lookup on the same provider and chain. A
 * lookup may split below it; the next one starts here and splits again if it must.
 */
const MIN_REMEMBERED_CHUNK = 500

/**
 * How long the smallest range the RPC refused is remembered: lookups within it never ask
 * for a range as wide. After it, the size may grow past it again, one step per lookup.
 */
const REMEMBER_REFUSAL_MS = 3_600_000

/** Chunks read in parallel after the first, which is read alone (a reuse is usually there). */
const WAVE = 4

/**
 * Reads of a rate-limited call after the first, waiting `Retry-After` (else 1, 2, 4 s), at
 * most `MAX_BACKOFF_MS` each, and all of them within `BACKOFF_BUDGET_MS` of the lookup's
 * first wait. Then the rate limit is thrown.
 */
const RATE_LIMIT_RETRIES = 3
const MAX_BACKOFF_MS = 8_000
const BACKOFF_BUDGET_MS = 20_000

/**
 * The lookup's bounds: blocks back from the newest one, chunk reads (an `OrderReused`
 * read again in halves counts as one each), and range refusals. A lookup that reaches
 * one before the end of the service's timeout, with no order found, throws an
 * `IncompleteOrderLookupError`: an order beyond them cannot be ruled out. `MAX_BLOCKS` is
 * about 23 days of 2 s blocks, which 100 full chunks cover; `MAX_READS` leaves room for an
 * RPC that serves 1,000 blocks per call to cover two days.
 */
const MAX_BLOCKS = 1_000_000
const MAX_READS = 150
const MAX_REFUSALS = 20

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
 * Which bound stopped a lookup short: the chunk reads or range refusals (`MAX_READS`,
 * `MAX_REFUSALS`: a slow or narrow RPC), the blocks read back (`MAX_BLOCKS`, a timeout
 * longer than that, or none and a datatoken older than that), the candidates checked
 * (`MAX_CHECKS`), or an order of the account in the newest blocks, not confirmed yet, or
 * one this process placed that the RPC does not show yet (`unconfirmed`).
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
      `The RPC's newest block is ${describeAge(ageHours)} old, older than the order window.`
    )
    this.name = 'StaleRpcHeadError'
    this.ageHours = ageHours
  }
}

function roughHours(hours: number): string {
  if (Number.isNaN(hours)) return 'unknown'
  return Number.isFinite(hours) ? hours.toFixed(1) : 'unlimited'
}

/**
 * An age as people read it: `45 seconds` below two minutes, `12 minutes` below two hours,
 * else `2.5 hours` (whole hours from 10 on). Rounded down: never older than it is.
 */
export function describeAge(hours: number): string {
  if (!Number.isFinite(hours)) return `${hours} hours`
  const seconds = Math.max(0, hours * 3_600)
  if (seconds < 120) return `${Math.floor(seconds)} seconds`
  if (seconds < 7_200) return `${Math.floor(seconds / 60)} minutes`
  return hours >= 10
    ? `${Math.floor(hours)} hours`
    : `${Math.floor(hours * 10) / 10} hours`
}

export interface PreviousOrder {
  /** The `OrderStarted` transaction: the one `reuseOrder` extends. */
  orderTxId: string
  /**
   * The newest transaction the node accepts for a download as it stands, the order or a
   * reuse of it. Absent when none does, and the order needs a `reuseOrder` with a new fee.
   */
  usableTxId?: string
  /** The order's block time (its `OrderStarted`), from which its timeout runs. */
  startedAt: number
}

/** For tests: the clock and the wait between rate-limited reads. */
export interface PreviousOrderOptions {
  /** Chain time now, in seconds. */
  now?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Milliseconds, for the rate-limit budget. */
  clock?: () => number
}

/**
 * The wait between rate-limited reads and the clock of their budget, when the options
 * give none; tests replace them. A wait ends early, and keeps no process alive, once its
 * lookup has returned or thrown.
 */
export const scanTiming = {
  sleep: (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve()
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal?.addEventListener('abort', done, { once: true })
    }),
  clock: (): number => Date.now()
}

/**
 * The account's newest order for the service that both nodes would accept for a download,
 * or `undefined` when there is none within the lookup's bounds.
 *
 * The events are read newest first, in chunks of blocks, from the newest block down to the
 * first block still inside the service's timeout (for a service whose orders never expire,
 * the datatoken's creation block when it can be proven), and no further than `MAX_BLOCKS`,
 * `MAX_READS` and `MAX_REFUSALS`. The first chunk is read alone, in parallel with the
 * reads that place the window's start, and an order it holds is returned without waiting
 * for them; then up to `WAVE` chunks at a time, their candidates checked newest first.
 * Orders are reused only with `CONFIRMATIONS`; at most `MAX_CHECKS` candidates are
 * checked, after which the best extendable order found is returned.
 *
 * A chunk the RPC refuses as too large is read again in pieces of a smaller size (see
 * `chunkSize`). When only the `OrderReused` read is refused for its volume (a flood of
 * reuses, which anyone can send for gas), it is read again in halves, and a single block
 * still refused is read with the account's `OrderStarted` alone. A rate limit on any read
 * is waited out and the read made again, up to `RATE_LIMIT_RETRIES` times within
 * `BACKOFF_BUDGET_MS`, then thrown. Any other error is thrown. Once the lookup returns or
 * throws, the reads still running make no further call and wait no longer.
 *
 * `undefined` means the whole window was read and holds no such order. Otherwise it throws
 * an `IncompleteOrderLookupError` when it stopped before it covered the window with no
 * order found, or when the account has an order in the newest blocks not confirmed yet and
 * none confirmed is usable; a `StaleRpcHeadError` when the RPC's newest block is older
 * than the window; and an `InconsistentRpcAnswerError` when the RPC's answers contradict
 * each other.
 */
export async function findPreviousOrder(
  query: PreviousOrderQuery,
  options: PreviousOrderOptions = {}
): Promise<PreviousOrder | undefined> {
  const reads = session(
    options.sleep ?? scanTiming.sleep,
    options.clock ?? scanTiming.clock
  )

  try {
    return await readOrders(
      query,
      options.now ?? Math.floor(Date.now() / 1000),
      reads
    )
  } finally {
    reads.settle()
  }
}

async function readOrders(
  query: PreviousOrderQuery,
  now: number,
  reads: Session
): Promise<PreviousOrder | undefined> {
  const { provider } = query

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
  const head = await reads.call(() => provider.getBlock('latest'))

  if (!head) throw new InconsistentRpcAnswerError('no newest block')
  // Its whole window is newer than the RPC's newest block: it cannot show an order there.
  if (head.timestamp < cutoff)
    throw new StaleRpcHeadError((now - head.timestamp) / 3600)

  const latest = head.number - CONFIRMATIONS + 1
  const floor = Math.max(0, head.number - MAX_BLOCKS + 1)
  const chunk = chunkSize(provider, query.chainId, reads.clock)
  const read = reader(query, reads)

  // Where the window starts, and whether `MAX_BLOCKS` cut it, read while the first chunk is.
  // Not awaited before the first chunk's candidates: an order there is returned at once.
  const windowing = Number.isFinite(cutoff)
    ? windowStart(provider, reads, head, floor, cutoff)
    : neverExpiring(query, reads, head, floor)
  windowing.catch(() => undefined)

  const check = checker(query, reads, now, lifetime, margin)
  let extendable: { orderTxId: string; timestamp: number } | undefined
  let checks = 0
  let refusals = 0
  /**
   * The ranges asked for or to be asked for, newest first, each with its answer once
   * asked. Up to `WAVE` are in flight (the first alone), at most one of them wider than
   * the RPC has accepted, and each is checked only once every newer one has been, so the
   * newest order is found first whatever answers first.
   */
  let queue: Chunk[] = []
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
  let window: Window | undefined

  /** Asks for the newest ranges not asked yet, queuing new ones down to the window. */
  const fill = () => {
    for (;;) {
      const asked = queue.filter((range) => range.answer)
      const full = asked.length >= (started ? WAVE : 1)

      let range = queue.find((range) => !range.answer)
      if (!range) {
        // Before the window is known, only the first chunk is queued (the rest of the
        // window is, once known).
        if (full || window || queue.length) return
        range = { from: Math.max(floor, next - chunk.size + 1), to: next }
        queue.push(range)
        next = range.from - 1
      }

      // Ranges not asked for yet are joined, and asked for in pieces of the size now,
      // newest first: a size that grew since they were cut applies to them too.
      for (
        let index = queue.indexOf(range) + 1;
        queue[index] &&
        !queue[index].answer &&
        queue[index].to === range.from - 1;
      ) {
        range.from = queue[index].from
        queue.splice(index, 1)
      }
      if (range.to - range.from + 1 > chunk.size) {
        const piece = { from: range.to - chunk.size + 1, to: range.to }
        queue.splice(queue.indexOf(range), 1, piece, {
          from: range.from,
          to: piece.from - 1
        })
        range = piece
      }

      // The newest range is always asked for: it is the one awaited. Others wait for a
      // free place, and a size the RPC has not accepted yet is tried one range at a time.
      const wider = (other: Chunk) => other.to - other.from + 1 > chunk.proven
      if (range !== queue[0] && (full || (wider(range) && asked.some(wider))))
        return

      if (!reads.spend()) return
      range.answer = read(range.from, range.to).then(
        (candidates) => ({ candidates }),
        (error: unknown) => ({ error })
      )
    }
  }

  scan: for (;;) {
    fill()

    const range = queue[0]
    if (!range?.answer) break

    const answer = await range.answer
    const width = range.to - range.from + 1

    if ('error' in answer) {
      // The reads ran out: the range stays first, unread.
      if (answer.error instanceof ReadsSpent) break
      if (width === 1 || !isRangeError(answer.error)) throw answer.error
      if (++refusals > MAX_REFUSALS) break

      chunk.refused(width, isResultsRefusal(answer.error) ? 'results' : 'range')
      // Read again, in pieces of the size when asked for (see `fill`), as is every range
      // not asked for yet; the answers for older ranges are kept.
      queue[0] = { from: range.from, to: range.to }
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
        return {
          orderTxId: verdict.orderTxId,
          usableTxId: candidate.txId,
          startedAt: verdict.timestamp
        }

      if (verdict && verdict.timestamp > (extendable?.timestamp ?? -1))
        extendable = verdict
    }

    if (!window) {
      window = await windowing
      const { start } = window
      // Ranges wholly before the window hold no order in force; one not asked for yet is
      // cut at its start.
      queue = queue.flatMap((other) => {
        if (other.to < start) return []
        if (other.answer || other.from >= start) return [other]
        return [{ from: start, to: other.to }]
      })
      // The rest of the window, asked for in pieces (see `fill`).
      if (next >= start) queue.push({ from: start, to: next })
      next = Math.min(next, start - 1)
    }
  }

  const windowHours = Number.isFinite(lifetime)
    ? Number(query.timeout) / 3600
    : Number.POSITIVE_INFINITY

  // A newer order may be about to count: extending an older one or buying again would pay.
  if (pending)
    throw new IncompleteOrderLookupError(Number.NaN, windowHours, 'unconfirmed')
  if (extendable)
    return {
      orderTxId: extendable.orderTxId,
      startedAt: extendable.timestamp
    }
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

  window ??= await windowing
  /** The newest block not read: the read is complete when it is older than the window. */
  const to = queue[0]?.to ?? next

  if (to >= window.start) {
    // The window's start is placed early: the blocks left may all be older than it.
    const unread =
      to === head.number ? head.timestamp : await blockTime(provider, reads, to)
    if (unread !== undefined && unread < cutoff) return undefined

    throw new IncompleteOrderLookupError(
      to === head.number
        ? hoursSince(head.timestamp)
        : hoursSince(await blockTime(provider, reads, to + 1)),
      windowHours,
      'reads'
    )
  }
  if (window.cut)
    throw new IncompleteOrderLookupError(
      hoursSince(
        window.time ?? (await blockTime(provider, reads, window.start))
      ),
      windowHours,
      'depth'
    )

  return undefined
}

/**
 * The reads of one lookup: each RPC call through `call`, which waits a rate limit out
 * within the lookup's budget, and the count of chunk reads (`spend`). Once `settle`d, no
 * call is made and every wait ends.
 */
interface Session {
  call<T>(read: () => Promise<T>): Promise<T>
  /** Counts one chunk read; `false` once `MAX_READS` are spent. */
  spend(): boolean
  settle(): void
  clock: () => number
}

/** Thrown into a read that would start after its lookup returned or threw. */
class LookupSettled extends Error {
  constructor() {
    super('The previous-order lookup has ended.')
    this.name = 'LookupSettled'
  }
}

/** Thrown by a read that needs more chunk reads than `MAX_READS` leaves. */
class ReadsSpent extends Error {
  constructor() {
    super('The previous-order lookup spent its reads.')
    this.name = 'ReadsSpent'
  }
}

function session(
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  clock: () => number
): Session {
  const settled = new AbortController()
  let firstWait: number | undefined
  let reads = 0

  return {
    clock,
    async call<T>(read: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        if (settled.signal.aborted) throw new LookupSettled()
        try {
          return await read()
        } catch (error) {
          if (attempt === RATE_LIMIT_RETRIES || !rateLimitOf(error)) throw error

          const asked = retryAfterSeconds(error)
          const wait = Math.min(
            MAX_BACKOFF_MS,
            asked === undefined ? 1_000 * 2 ** attempt : asked * 1_000
          )
          const now = clock()
          firstWait ??= now
          // One budget for every wait of the lookup: past it, the rate limit is thrown.
          if (now - firstWait + wait > BACKOFF_BUDGET_MS) throw error

          await sleep(wait, settled.signal)
        }
      }
    },
    spend() {
      if (reads >= MAX_READS) return false
      reads++
      return true
    },
    settle() {
      settled.abort()
    }
  }
}

/** A block's time, or `undefined` when it cannot be read: only for the message. */
async function blockTime(
  provider: Provider,
  reads: Session,
  block: number
): Promise<number | undefined> {
  try {
    return (await reads.call(() => provider.getBlock(block)))?.timestamp
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
  reads: Session,
  head: Block,
  floor: number,
  cutoff: number
): Promise<Window> {
  const base = await reads.call(() => provider.getBlock(floor))

  if (!base || base.timestamp >= cutoff)
    return { start: floor, cut: floor > 0, time: base?.timestamp }

  const perSecond = (head.number - floor) / (head.timestamp - base.timestamp)
  const linear = floor + Math.floor((cutoff - base.timestamp) * perSecond)
  const early = Math.ceil((head.timestamp - cutoff) * perSecond * 0.05) + 100

  for (const factor of [1, 8]) {
    const estimate = linear - early * factor
    if (estimate <= floor) return { start: floor, cut: false }

    const block = await reads.call(() => provider.getBlock(estimate))
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
  reads: Session,
  head: Block,
  floor: number
): Promise<Window> {
  if (floor === 0) return { start: 0, cut: false }

  const created = await creationBlock(query, reads, head, floor)

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
 * at all (an error) gives `undefined`, as does any other failed read, except a rate limit
 * that outlasts its waits, which is thrown.
 */
async function creationBlock(
  query: PreviousOrderQuery,
  reads: Session,
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
    !/^0x0*$/i.test(await reads.call(() => provider.getCode(datatoken, block)))

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

    const logs = await reads.call(() =>
      provider.getLogs({
        address: factory,
        topics: [TOKEN_CREATED, zeroPadValue(datatoken, 32)],
        fromBlock: hi,
        toBlock: hi
      })
    )

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

/** What the lookup remembers of an RPC's chunk sizes, per provider instance, by chain. */
interface ChunkMemory {
  /** A size the RPC accepted, at least `MIN_REMEMBERED_CHUNK`. */
  size: number
  /** The smallest range it refused for its width, and until when that is kept. */
  refused?: number
  until?: number
}

const chunks = new WeakMap<Provider, Map<string, ChunkMemory>>()

/**
 * The chunk size of one lookup: the one the RPC last accepted on this provider and chain,
 * else `CHUNK_BLOCKS`.
 *
 * A refused read sets the size to the widest one accepted in this lookup when that is
 * narrower, else to half the refused width. A refusal for the range's width (a block-range
 * cap) is a ceiling: no read as wide is asked for again in this lookup, nor, for
 * `REMEMBER_REFUSAL_MS`, in the next ones. A refusal for the number of results depends on
 * the blocks read (a flood of events in some of them) and is no ceiling, unless it refused
 * a size grown past the widest accepted one: that size is not tried again in this lookup.
 * After `GROW_AFTER` full reads in a row the size grows: doubled, or halfway to the
 * ceiling, and not by less than an eighth. `proven` is the widest read accepted (in this
 * lookup, or the remembered size); the scan tries a wider one alone. The size is
 * remembered after each accepted read. Keyed by the provider instance, never by its URL,
 * which can hold an API key.
 */
function chunkSize(
  provider: Provider,
  chainId: number | undefined,
  clock: () => number
) {
  const key = String(chainId ?? '?')
  const remembered = chunks.get(provider) ?? new Map<string, ChunkMemory>()
  chunks.set(provider, remembered)

  const memory = remembered.get(key)
  let size = memory?.size ?? CHUNK_BLOCKS
  let proven = memory?.size ?? 0
  /** The smallest width refused for the range, kept for the next lookups. */
  let rangeCeiling =
    memory?.refused !== undefined && (memory.until ?? 0) > clock()
      ? memory.refused
      : Number.POSITIVE_INFINITY
  let until = memory?.until
  /** The smallest width not to ask for again in this lookup. */
  let ceiling = rangeCeiling
  let streak = 0

  const remember = () =>
    remembered.set(key, {
      size: Math.max(MIN_REMEMBERED_CHUNK, Math.min(size, proven)),
      ...(Number.isFinite(rangeCeiling) ? { refused: rangeCeiling, until } : {})
    })

  return {
    get size() {
      return size
    },
    get proven() {
      return proven
    },
    /** A read of `used` blocks was refused, for its width or for its results. */
    refused(used: number, kind: 'range' | 'results') {
      streak = 0
      if (kind === 'range' && used < rangeCeiling) {
        rangeCeiling = used
        until = clock() + REMEMBER_REFUSAL_MS
      }
      // A size grown past what was accepted, refused even for its results: not again.
      if (kind === 'range' || (proven > 0 && used > proven))
        ceiling = Math.min(ceiling, used)
      if (used <= proven) proven = 0
      size = Math.max(
        1,
        Math.min(size, proven > 0 ? proven : Math.floor(used / 2))
      )
    },
    /** A read of `used` blocks was accepted. */
    accepted(used: number) {
      proven = Math.max(proven, used)
      remember()
      // A piece narrower than the size says nothing about a wider one.
      if (used < size || ++streak < GROW_AFTER) return
      streak = 0

      const limit = Math.min(CHUNK_BLOCKS, ceiling - 1)
      const target = Math.min(
        limit,
        Number.isFinite(ceiling) ? Math.floor((size + ceiling) / 2) : size * 2
      )
      if (target - size >= Math.ceil(size / 8)) size = target
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
 * The width of the `OrderReused` reads of one lookup: unbounded (a chunk's own) until one
 * is refused for its volume. A refused read sets it to the widest one accepted when that
 * is narrower, else to half the refused width, and no read as wide is asked for again;
 * after an accepted one it grows halfway to that, or doubles, and not by less than an
 * eighth. A refusal of a single block is about that block's events, not the width: it
 * lifts the ceiling, so the width grows back from one block.
 */
function reuseWidths() {
  let now = Number.POSITIVE_INFINITY
  let widest = 0
  let ceiling = Number.POSITIVE_INFINITY

  return {
    get now() {
      return now
    },
    refused(used: number) {
      if (used === 1) {
        ceiling = Number.POSITIVE_INFINITY
        now = 1
        return
      }
      ceiling = Math.min(ceiling, used)
      now = widest > 0 && widest < used ? widest : Math.floor(used / 2)
    },
    accepted(used: number) {
      widest = Math.max(widest, used)
      if (used < now) return
      const target = Number.isFinite(ceiling)
        ? Math.floor((used + ceiling) / 2)
        : Math.min(CHUNK_BLOCKS, used * 2)
      if (target - used >= Math.max(1, Math.ceil(used / 8))) now = target
    }
  }
}

/**
 * Reads the account's `OrderStarted` and `OrderReused` transactions in a range, newest
 * first. A rate-limited call is waited out and made again (see `Session`).
 *
 * An `OrderReused` call refused for its range or volume, while the `OrderStarted` one is
 * answered, is made again alone in pieces (see `reuseWidths`), each counted as a chunk
 * read; later ranges of the lookup read their reuses in pieces of that width from the
 * start. A single block still refused leaves the account's `OrderStarted` alone
 * for that block: every order in force has its `OrderStarted` in the window, and that
 * event is indexed by consumer, so no flood of other accounts' events can fill it (but an
 * order the account holds only as the payer of another consumer's order, and reused in
 * that block, is not seen). A refusal that names a timeout is no volume refusal: it is
 * thrown, and the scan splits the whole chunk.
 */
function reader(query: PreviousOrderQuery, reads: Session) {
  const account = query.account.toLowerCase()
  const address = query.datatokenAddress
  const width = reuseWidths()

  const logs = (filter: Parameters<Provider['getLogs']>[0]) =>
    reads.call(() => query.provider.getLogs(filter))
  const reuses = (fromBlock: number, toBlock: number) =>
    logs({ address, fromBlock, toBlock, topics: [ORDER_REUSED] })

  /** A block whose `OrderReused` read is refused even alone: no reuse is seen there. */
  const startedAlone = (block: number) =>
    debug(
      'sensitive',
      'order',
      "previous-order lookup: the RPC refused the OrderReused read of one block; the account's OrderStarted is read alone there",
      { datatoken: address, block }
    )

  /** The `OrderReused` logs of a range, in pieces of at most `width.now` blocks. */
  const reusesInPieces = async (from: number, to: number): Promise<Log[]> => {
    const found: Log[] = []

    for (let top = to; top >= from; ) {
      const bottom = Math.max(from, top - width.now + 1)
      if (!reads.spend()) throw new ReadsSpent()

      try {
        found.push(...(await reuses(bottom, top)))
        width.accepted(top - bottom + 1)
        top = bottom - 1
      } catch (error) {
        if (!isVolumeRefusal(error)) throw error
        width.refused(top - bottom + 1)
        if (bottom === top) {
          startedAlone(top)
          top = bottom - 1
        }
      }
    }

    return found
  }

  return async (fromBlock: number, toBlock: number): Promise<Candidate[]> => {
    const range = { address, fromBlock, toBlock }
    const whole = toBlock - fromBlock + 1 <= width.now
    const [started, reused] = await Promise.allSettled([
      logs({ ...range, topics: [ORDER_STARTED, zeroPadValue(account, 32)] }),
      whole ? reuses(fromBlock, toBlock) : Promise.resolve(undefined)
    ])

    if (started.status === 'rejected') throw started.reason

    let reusesFound: Log[]
    if (reused.status === 'fulfilled' && reused.value) {
      reusesFound = reused.value
      width.accepted(toBlock - fromBlock + 1)
    } else if (reused.status === 'fulfilled')
      reusesFound = await reusesInPieces(fromBlock, toBlock)
    else if (!isVolumeRefusal(reused.reason)) throw reused.reason
    else {
      width.refused(toBlock - fromBlock + 1)
      if (fromBlock === toBlock) {
        startedAlone(fromBlock)
        reusesFound = []
      } else reusesFound = await reusesInPieces(fromBlock, toBlock)
    }

    const seen = new Set<string>()
    const all = [...started.value, ...reusesFound]

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
  reads: Session,
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
      pending = reads.call(() => query.provider.getTransactionReceipt(txId))
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
 * exceeded"): splitting on it spends the reads until the window cannot be covered.
 */
function isRangeError(error: unknown): boolean {
  if (rateLimitOf(error)) return false
  return /range|limit|exceed|too (many|large|wide|big)|more than/i.test(
    errorText(error)
  )
}

/**
 * Whether a refusal is for the number of results (or the size of the answer), which
 * depends on the events in the range, rather than for the range's width.
 */
function isResultsRefusal(error: unknown): boolean {
  return /results|response (size|too)|too many (logs|events)|more than \d+ (logs|events)/i.test(
    errorText(error)
  )
}

/**
 * A refusal of the range or of its volume, which a narrower read can pass. One that names
 * a timeout ("query timeout exceeded") may be transient: it is no reason to read an
 * `OrderReused` range with the account's `OrderStarted` alone.
 */
function isVolumeRefusal(error: unknown): boolean {
  return isRangeError(error) && !/time(d)?[\s-]?out/i.test(errorText(error))
}

function errorText(error: unknown): string {
  const { message, info } = (error ?? {}) as {
    message?: unknown
    info?: { error?: { message?: unknown } }
  }
  return `${message} ${info?.error?.message}`
}

function newestFirst(a: Log, b: Log): number {
  return b.blockNumber - a.blockNumber || b.index - a.index
}
