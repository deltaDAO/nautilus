/**
 * Finding a previous order on chain, for a node whose `initialize` reports no `validOrder`.
 *
 * ocean-node's access `initialize` answers with a fresh provider fee and no `validOrder`;
 * only its compute `initialize` checks a previous order. This module looks the account's
 * orders up in the datatoken's events and checks each candidate transaction the way the
 * node checks the `transferTxId` of a download (`validateOrderTransaction` and
 * `verifyProviderFees`), from the transaction receipts. ocean-node 4.2.0 and
 * OceanProtocolEnterprise ocean-node 4.2.2 check it differently, and a candidate counts
 * only when both would accept it, so `access()` never skips a payment the node then
 * refuses:
 *
 *   - 4.2.0 reads the datatoken from the given transaction's `to`, before following a
 *     reuse; 4.2.2 does not read `to`. A candidate is used as it stands only when its
 *     transaction was sent to the datatoken itself; one sent through another contract (the
 *     factory's `startMultipleTokenOrder`, a contract wallet, a relayer) is only extended,
 *     with a `reuseOrder` nautilus sends to the datatoken;
 *   - when the transaction holds an `OrderReused`, the node follows the first one in log
 *     order, from any contract, to the transaction it names; nautilus also requires that
 *     reuse's `caller` to be the account;
 *   - in that transaction, 4.2.0 takes the first `OrderStarted`, from any contract, whose
 *     consumer or payer is the account, 4.2.2 the first such one this datatoken emitted.
 *     The order counts only when that first one is this datatoken's, and the node rejects
 *     it when its service index is not the service's;
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

/** Blocks per `eth_getLogs` call at first, halved while the RPC refuses the range. */
const CHUNK_BLOCKS = 2_000

/**
 * The lookup's bounds: blocks back from the newest confirmed one, and rounds of
 * `eth_getLogs` calls (one round per chunk, retries included). An order beyond them is not
 * found, and `access()` places a new one.
 */
const MAX_BLOCKS = 100_000
const MAX_READS = 100

/**
 * Candidates checked at most, each costing up to two receipt reads: anyone can emit orders
 * naming the account, so the lookup gives up after this many and `access()` uses the best
 * one found, or places a new order.
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
 * The account's newest order for the service that the node would accept for a download,
 * or `undefined` when there is none within the lookup's bounds.
 *
 * The events are read newest first, in chunks of blocks, from the newest block with
 * `CONFIRMATIONS` down to the first block still inside the service's timeout, and no
 * further than `MAX_BLOCKS` and `MAX_READS`. A chunk the RPC refuses as too large is read
 * again in halves; any other error is thrown.
 */
export async function findPreviousOrder(
  query: PreviousOrderQuery,
  options: { now?: number } = {}
): Promise<PreviousOrder | undefined> {
  const { provider } = query
  const now = options.now ?? Math.floor(Date.now() / 1000)

  // Seconds after its block an order is still reused: the node's `elapsed > timeout`, with
  // the margin. `NaN` (a missing timeout) never compares greater, as at the node.
  const timeout = query.timeout === 0 ? Number.NaN : Number(query.timeout)
  const lifetime = Number.isNaN(timeout)
    ? Number.POSITIVE_INFINITY
    : timeout - MARGIN_SECONDS

  if (lifetime <= 0) return undefined

  // A block mined before `cutoff` holds no order that is still reused.
  const cutoff = now - lifetime
  const head = await provider.getBlock('latest')

  if (!head || head.timestamp < cutoff) return undefined

  const latest = head.number - CONFIRMATIONS + 1
  const floor = Math.max(0, latest - MAX_BLOCKS + 1)
  const stop = Number.isFinite(cutoff)
    ? await windowStart(provider, head, floor, cutoff)
    : floor

  const check = checker(query, now, lifetime)
  let extendable: { orderTxId: string; timestamp: number } | undefined
  let chunk = CHUNK_BLOCKS
  let checks = 0

  scan: for (
    let to = latest, reads = 0;
    to >= stop && reads < MAX_READS;
    reads++
  ) {
    const from = Math.max(stop, to - chunk + 1)
    let candidates: Candidate[]

    try {
      candidates = await readCandidates(query, from, to)
    } catch (error) {
      if (chunk === 1 || !isRangeError(error)) throw error
      chunk = Math.floor(chunk / 2)
      continue
    }

    for (const candidate of candidates) {
      // Every older candidate is older still, and so is the order it names.
      if (candidate.timestamp < cutoff || checks++ === MAX_CHECKS) break scan

      const verdict = await check(candidate)

      if (verdict?.feeAccepted)
        return { orderTxId: verdict.orderTxId, usableTxId: candidate.txId }

      if (verdict && verdict.timestamp > (extendable?.timestamp ?? -1))
        extendable = verdict
    }

    to = from - 1
  }

  return extendable && { orderTxId: extendable.orderTxId }
}

/**
 * The first block to read: `floor`, or a later block mined before `cutoff` when `floor` is
 * too. Block times never decrease, so every block before it was mined before `cutoff` as
 * well. The block is estimated between `floor` and `head`, a chunk early, and checked; when
 * the estimate is wrong the whole bound is read.
 */
async function windowStart(
  provider: Provider,
  head: Block,
  floor: number,
  cutoff: number
): Promise<number> {
  const base = await provider.getBlock(floor)

  if (!base || base.timestamp >= cutoff) return floor

  const estimate =
    floor +
    Math.floor(
      ((cutoff - base.timestamp) / (head.timestamp - base.timestamp)) *
        (head.number - floor)
    ) -
    CHUNK_BLOCKS

  if (estimate <= floor) return floor

  const block = await provider.getBlock(estimate)

  return block && block.timestamp < cutoff ? estimate : floor
}

interface Candidate {
  txId: string
  /** The block time of the transaction. */
  timestamp: number
}

/** The account's `OrderStarted` and `OrderReused` transactions in the range, newest first. */
async function readCandidates(
  query: PreviousOrderQuery,
  fromBlock: number,
  toBlock: number
): Promise<Candidate[]> {
  const account = query.account.toLowerCase()
  const range = { address: query.datatokenAddress, fromBlock, toBlock }
  const [started, reused] = await Promise.all([
    query.provider.getLogs({
      ...range,
      topics: [ORDER_STARTED, zeroPadValue(account, 32)]
    }),
    query.provider.getLogs({ ...range, topics: [ORDER_REUSED] })
  ])

  const seen = new Set<string>()

  return [...started, ...reused].sort(newestFirst).flatMap((log) => {
    const event = decode(log)
    const txId = log.transactionHash.toLowerCase()

    if (!event || event.name === 'ProviderFee' || seen.has(txId)) return []
    if (event.name === 'OrderReused' && event.caller !== account) return []

    seen.add(txId)
    return [{ txId, timestamp: event.timestamp }]
  })
}

/**
 * Checks a candidate the way the node checks a download's `transferTxId`: the order it
 * stands for, if the node accepts it with `lifetime` left, and whether the node keeps the
 * candidate's own provider fee.
 */
function checker(query: PreviousOrderQuery, now: number, lifetime: number) {
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
        BigInt(now + MARGIN_SECONDS - minedAt) <= event.validUntil)
    )
  }

  return async (
    candidate: Candidate
  ): Promise<
    { orderTxId: string; timestamp: number; feeAccepted: boolean } | undefined
  > => {
    const mined = await receipt(candidate.txId)

    if (!mined) return undefined

    // ocean-node 4.2.0 reads the datatoken from here; a `reuseOrder` nautilus sends passes.
    const direct = mined.to?.toLowerCase() === datatoken

    let ordered: TransactionReceipt | null = mined
    const reused = first(mined, 'OrderReused')

    if (reused) {
      if (reused.event.caller !== account) return undefined
      ordered = await receipt(reused.event.orderTxId)
      if (!ordered) return undefined
    }

    // The first one from any contract, as 4.2.0 takes it: 4.2.2 takes the first one this
    // datatoken emitted, the same one only when it comes first.
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
      feeAccepted:
        direct &&
        mined.logs.some((log) => feeAccepted(decode(log), candidate.timestamp))
    }
  }
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

/** Whether an RPC refused `eth_getLogs` for its range or its number of results. */
function isRangeError(error: unknown): boolean {
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
