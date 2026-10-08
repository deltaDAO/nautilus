/**
 * Finding a previous order on chain, for a node whose `initialize` reports no `validOrder`.
 *
 * ocean-node's access `initialize` answers with a fresh provider fee and no `validOrder`;
 * only its compute `initialize` checks a previous order. This module looks the order up in
 * the datatoken's own events and keeps it only where the node's download check would
 * accept it (ocean-node's `validateOrderTransaction` and `verifyProviderFees`):
 *
 *   - the transaction holds an `OrderStarted` of this datatoken whose consumer or payer is
 *     the account, or an `OrderReused` pointing at such a transaction (the node follows one
 *     `OrderReused` to the order it names, so a reuse always names the `OrderStarted`);
 *   - the order's service index is the service's;
 *   - the order is inside the service's `timeout`, counted from the block of the
 *     `OrderStarted` (a reuse does not restart it; `0` never expires);
 *   - the transaction itself carries a `ProviderFee` signed by the node's fee address, for
 *     this service and datatoken, that has not expired.
 *
 * The node also checks that the datatoken belongs to the asset's data NFT, which holds for
 * every order of the datatoken the asset names.
 *
 * The datatoken keeps no order history it can be asked for, so the events are read with
 * `eth_getLogs`, newest blocks first, in bounded chunks and up to a bounded depth.
 * Not exported from the package.
 */
import type { Provider } from 'ethers'
import { Interface, type Log, toUtf8String } from 'ethers'

/** Blocks per `eth_getLogs` call: within the range limit common RPC providers set. */
export const ORDER_LOOKUP_CHUNK_BLOCKS = 10_000

/** How far back the lookup reads at most, in blocks. */
export const ORDER_LOOKUP_MAX_BLOCKS = 100_000

/**
 * Seconds an order or a fee must still be valid for to be reused. The node checks the
 * order again when the URL is downloaded, so one about to expire is not reused.
 */
export const ORDER_REUSE_MARGIN_SECONDS = 60

/** The three events of the ERC20 templates (1, 2 and 4) the lookup reads. */
const EVENTS = new Interface([
  'event OrderStarted(address indexed consumer, address payer, uint256 amount, uint256 serviceIndex, uint256 timestamp, address indexed publishMarketAddress, uint256 blockNumber)',
  'event OrderReused(bytes32 orderTxId, address caller, uint256 timestamp, uint256 number)',
  'event ProviderFee(address indexed providerFeeAddress, address indexed providerFeeToken, uint256 providerFeeAmount, bytes providerData, uint8 v, bytes32 r, bytes32 s, uint256 validUntil)'
])

const TOPICS = ['OrderStarted', 'OrderReused', 'ProviderFee'].map(
  (name) => EVENTS.getEvent(name)?.topicHash as string
)

export interface PreviousOrderQuery {
  provider: Provider
  datatokenAddress: string
  /** The account the order is for: the node accepts it as the order's consumer or payer. */
  account: string
  serviceIndex: number
  serviceId: string
  /** The service's timeout in seconds; `0` never expires. */
  timeout: number
  /** The node's fee address, the `providerFeeAddress` of the fee it quotes now. */
  providerFeeAddress?: string
}

export interface PreviousOrderOptions {
  /** Seconds since the epoch; defaults to the local clock, which the node uses too. */
  now?: number
  chunkBlocks?: number
  maxBlocks?: number
  marginSeconds?: number
}

export interface PreviousOrder {
  /** The `OrderStarted` transaction: the one `reuseOrder` extends. */
  orderTxId: string
  /**
   * The newest transaction of the order (the order itself or a reuse of it) whose provider
   * fee the node still accepts: a download can use it as it stands. Absent when none does,
   * and the order needs a `reuseOrder` with a new fee first.
   */
  usableTxId?: string
}

/**
 * The account's newest order for the service that the node would still accept, or
 * `undefined` when there is none within the lookup's depth.
 */
export async function findPreviousOrder(
  query: PreviousOrderQuery,
  options: PreviousOrderOptions = {}
): Promise<PreviousOrder | undefined> {
  const { provider, timeout } = query
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const chunk = options.chunkBlocks ?? ORDER_LOOKUP_CHUNK_BLOCKS
  const margin = options.marginSeconds ?? ORDER_REUSE_MARGIN_SECONDS

  if (!Number.isFinite(timeout) || timeout < 0) return undefined
  // Too short a timeout to download within: never reused.
  if (timeout !== 0 && timeout <= margin) return undefined

  const latest = await provider.getBlockNumber()
  const floor = Math.max(
    0,
    latest - (options.maxBlocks ?? ORDER_LOOKUP_MAX_BLOCKS) + 1
  )

  const datatoken = query.datatokenAddress.toLowerCase()
  const account = query.account.toLowerCase()
  const feeAddress = query.providerFeeAddress?.toLowerCase()

  // Collected from newer chunks, so they are complete by the time their order is found.
  const reusesOf = new Map<string, string[]>()
  const feesIn = new Map<string, ProviderFeeEvent[]>()

  for (let to = latest; to >= floor; ) {
    const from = Math.max(floor, to - chunk + 1)
    const events = (
      await provider.getLogs({
        address: query.datatokenAddress,
        topics: [TOPICS],
        fromBlock: from,
        toBlock: to
      })
    )
      .filter((log) => !log.removed && log.address.toLowerCase() === datatoken)
      .sort(newestFirst)
      .flatMap((log) => parse(log))

    // Fees and reuses first: a fee may be logged before or after its order.
    for (const event of events) {
      if (event.name === 'ProviderFee') push(feesIn, event.txId, event)
      else if (event.name === 'OrderReused')
        push(reusesOf, event.orderTxId, event.txId)
    }

    for (const event of events) {
      if (event.name !== 'OrderStarted') continue
      if (event.consumer !== account && event.payer !== account) continue
      if (event.serviceIndex !== BigInt(query.serviceIndex)) continue

      // The newest matching order. Every older one started earlier, so if this one has
      // expired they all have.
      if (timeout !== 0 && now - event.timestamp > timeout - margin)
        return undefined

      const usableTxId = [...(reusesOf.get(event.txId) ?? []), event.txId].find(
        (txId) =>
          feesIn
            .get(txId)
            ?.some((fee) =>
              feeAccepted(fee, { feeAddress, datatoken, query, now, margin })
            )
      )

      return { orderTxId: event.txId, usableTxId }
    }

    if (from === floor) break

    // Nothing in this chunk: stop once it reaches back past the timeout.
    if (timeout !== 0) {
      const block = await provider.getBlock(from)

      if (block && now - block.timestamp > timeout) break
    }

    to = from - 1
  }

  return undefined
}

type OrderEvent =
  | {
      name: 'OrderStarted'
      txId: string
      consumer: string
      payer: string
      serviceIndex: bigint
      timestamp: number
    }
  | { name: 'OrderReused'; txId: string; orderTxId: string }
  | ProviderFeeEvent

interface ProviderFeeEvent {
  name: 'ProviderFee'
  txId: string
  providerFeeAddress: string
  providerData: string
  validUntil: bigint
}

function parse(log: Log): OrderEvent[] {
  let parsed: ReturnType<Interface['parseLog']>
  try {
    parsed = EVENTS.parseLog(log)
  } catch {
    return []
  }

  if (!parsed) return []

  const txId = log.transactionHash.toLowerCase()
  const args = parsed.args

  switch (parsed.name) {
    case 'OrderStarted':
      return [
        {
          name: 'OrderStarted',
          txId,
          consumer: String(args.consumer).toLowerCase(),
          payer: String(args.payer).toLowerCase(),
          serviceIndex: BigInt(args.serviceIndex),
          timestamp: Number(args.timestamp)
        }
      ]
    case 'OrderReused':
      return [
        {
          name: 'OrderReused',
          txId,
          orderTxId: String(args.orderTxId).toLowerCase()
        }
      ]
    case 'ProviderFee':
      return [
        {
          name: 'ProviderFee',
          txId,
          providerFeeAddress: String(args.providerFeeAddress).toLowerCase(),
          providerData: String(args.providerData),
          validUntil: BigInt(args.validUntil)
        }
      ]
    default:
      return []
  }
}

/**
 * Whether the node accepts this fee for the service: signed by its fee address, for this
 * service and datatoken, and not expired (`validUntil` `0` never expires).
 */
function feeAccepted(
  fee: ProviderFeeEvent,
  context: {
    feeAddress?: string
    datatoken: string
    query: PreviousOrderQuery
    now: number
    margin: number
  }
): boolean {
  if (!context.feeAddress || fee.providerFeeAddress !== context.feeAddress)
    return false

  let data: { id?: unknown; dt?: unknown }
  try {
    data = JSON.parse(toUtf8String(fee.providerData))
  } catch {
    return false
  }

  if (data?.id !== context.query.serviceId) return false
  if (String(data.dt ?? '').toLowerCase() !== context.datatoken) return false

  return (
    fee.validUntil === 0n ||
    fee.validUntil - BigInt(context.now) >= BigInt(context.margin)
  )
}

function newestFirst(a: Log, b: Log): number {
  return b.blockNumber - a.blockNumber || b.index - a.index
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)

  if (list) list.push(value)
  else map.set(key, [value])
}
