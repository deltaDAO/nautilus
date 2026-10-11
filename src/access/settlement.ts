/**
 * Settling the order for one service, in two steps: `planSettlement` runs every check
 * and chain read, and `sendSettlement` sends the transactions.
 *
 * `settleOrder` runs both back to back. `compute()` plans every input first, then funds
 * escrow, then sends the orders, so an input that cannot be ordered is refused before the
 * escrow deposit. `planSettlement` and `sendSettlement` are not exported from the package.
 */
import {
  type Config,
  type ProviderFees,
  unitsToAmount
} from '@oceanprotocol/lib'
import { Decimal } from 'decimal.js'
import { Contract, type Signer } from 'ethers'
import { debugRaw } from '../log/debug.js'
import { type Logger, log } from '../log/logger.js'
import { sanitize } from '../node/messages.js'
import {
  checkOrder,
  type OrderRequest,
  order,
  payingAccount,
  reuseOrder
} from '../utils/order.js'
import {
  assertProviderFeesAllowed,
  ceilingFor,
  type ProviderFeeLimits,
  quoteProviderFee
} from '../utils/paymentLimits.js'
import { findPreviousOrder } from '../utils/previousOrder.js'
import {
  getOrderPrice,
  getPricingInfo,
  hasReusableOrder,
  type OrderPrice,
  type PricingInfo
} from '../utils/pricing.js'
import {
  assertProviderFeeSignature,
  isFeeDue,
  type ProviderFeeLike
} from '../utils/providerFee.js'
import {
  classifyLookupFailure,
  lookupFailedWarning,
  OrderCheckError,
  type OrderCheckPrice,
  type OrderSubject,
  safeName,
  shortHex
} from './orderCheck.js'

export type SettleOrderParams = {
  signer: Signer
  chainConfig: Config
  datatokenAddress: string
  serviceIndex: number
  initialized: { validOrder?: string; providerFee?: unknown }
  consumer: string
  payer?: string
  /**
   * The service, to look up a previous order on chain when the node reports no
   * `validOrder`. Without it only the node's `validOrder` is reused. Its `name` is used in
   * an `OrderCheckError`.
   */
  service?: { id: string; timeout?: number; name?: string }
  /**
   * The asset's DID, named with `service.id` in the fee passed to `confirmProviderFees`
   * and in a `ProviderFeeNotAllowedError`.
   */
  did?: string
  /** The asset's name, used in an `OrderCheckError`. */
  assetName?: string
  /**
   * When the previous-order lookup fails or stops short (an RPC error or an incomplete
   * scan, not "no order found") on a service that costs anything, place a new order anyway,
   * with a warning, instead of throwing an `OrderCheckError`. A new order may pay twice for
   * an order the account already holds. Only `true` opts in. Default `false`. A free
   * service is ordered either way, with a warning.
   */
  orderOnLookupFailure?: boolean
  /** Where this call's log events go. Default: the process-wide logger. */
  logger?: Logger
} & ProviderFeeLimits

/**
 * What `sendSettlement` will do, decided and checked by `planSettlement`. A request is
 * allowed to pay exactly the provider fee the caller consented to, and no other.
 */
export type SettlementPlan =
  /** An order in force and no fee due: nothing to send. */
  | { kind: 'reused'; datatokenAddress: string; transferTxId: string }
  /** An order in force but a new fee period: extend it. */
  | {
      kind: 'reuse'
      datatokenAddress: string
      request: Parameters<typeof reuseOrder>[0]
    }
  /** A fresh order. */
  | { kind: 'order'; datatokenAddress: string; request: OrderRequest }

/**
 * Decides how to settle the order and runs every check of that path, without sending
 * anything: the previous order to reuse (read from chain when the node reports none and
 * `service` is given), the provider fee's signature, the payer, the caller's consent to the
 * fee, and, for a fresh order, the pricing read from chain and whether it can be ordered.
 * Throws what `settleOrder` would throw before its first transaction.
 *
 * Consent (`maxProviderFee`, else `confirmProviderFees`) is asked once, for the fee this
 * path pays: none for an order used as it stands, the fee the node quotes now for an order
 * extended or placed. The plan then allows exactly that fee.
 */
export async function planSettlement(
  params: SettleOrderParams,
  /** The public call the plan is made for, as an `OrderCheckError` names it. */
  operation = 'settleOrder()'
): Promise<SettlementPlan> {
  const { signer, chainConfig, datatokenAddress, serviceIndex, initialized } =
    params

  const providerFee = initialized.providerFee as ProviderFeeLike | undefined
  // The pricing of a new order, read once: by a failed lookup to tell whether a new order
  // costs anything, and for the order itself.
  const quote = once(async () => {
    const pricing = await getPricingInfo(signer, datatokenAddress, chainConfig)
    const price = await getOrderPrice(signer, pricing, chainConfig)
    return { pricing, price }
  })
  const previous = await reusableOrder(params, quote, operation)

  // An order in force and no new fee needed: reuse the transaction as it stands. Nothing
  // is sent, so no fee is checked or asked for, whatever the node quoted.
  if (previous && !previous.feeDue)
    return {
      kind: 'reused',
      datatokenAddress,
      transferTxId: previous.transferTxId
    }

  // Both remaining paths send the fee to the datatoken, which checks it first: refuse
  // one it would reject here, once. `order()` and `reuseOrder()` check again for their
  // direct callers, and approve what the fee pulls together with the rest of the order.
  assertProviderFeeSignature(providerFee)

  // Checked above: every field is present.
  const providerFees = providerFee as unknown as ProviderFees

  // The signer pays on both paths; `order()` checks again for its direct callers.
  await payingAccount(signer, params.payer)

  // The node chose this fee: pay it only within what the caller allowed, asked here once.
  const fee = quoteProviderFee(providerFees, {
    datatoken: datatokenAddress,
    did: params.did,
    serviceId: params.service?.id
  })

  await assertProviderFeesAllowed([fee], {
    maxProviderFee: params.maxProviderFee,
    confirmProviderFees: params.confirmProviderFees
  })

  // From here on exactly that fee may be paid, and `confirmProviderFees` is not asked
  // again: `order()` and `reuseOrder()` refuse any other.
  const allowed: ProviderFeeLimits = {
    maxProviderFee: ceilingFor([fee]),
    confirmProviderFees: undefined
  }

  // An order in force but a new fee period: extend it rather than buying again.
  if (previous)
    return {
      kind: 'reuse',
      datatokenAddress,
      request: {
        signer,
        config: chainConfig,
        datatokenAddress,
        validOrderTx: previous.transferTxId,
        providerFees,
        ...allowed
      }
    }

  const { pricing, price } = await quote()

  const request: OrderRequest = {
    signer,
    config: chainConfig,
    pricing,
    price,
    serviceIndex,
    providerFees,
    consumer: params.consumer,
    payer: params.payer,
    logger: params.logger,
    ...allowed
  }

  // Pricing that cannot be ordered is refused here.
  await checkOrder(request)

  return { kind: 'order', datatokenAddress, request }
}

/**
 * The order to reuse, if any, and whether it needs a new provider fee first.
 *
 * The node's `validOrder` when it reports one: it needs the fee the node quotes when that
 * fee is non-zero. Otherwise, given the service, the account's newest order on chain that
 * the node would accept at download (see `findPreviousOrder`): as it stands when one of
 * its transactions carries a fee the node still accepts, or extended with the fee quoted
 * now.
 *
 * A lookup that fails or stops short (not one that finds nothing) throws an
 * `OrderCheckError` when a new order costs anything, unless `orderOnLookupFailure` is
 * `true`; otherwise it places a fresh order, with a warning.
 */
async function reusableOrder(
  params: SettleOrderParams,
  quote: () => Promise<Quote>,
  operation: string
): Promise<{ transferTxId: string; feeDue: boolean } | undefined> {
  const { initialized, service } = params
  const logger = params.logger ?? log

  if (hasReusableOrder(initialized))
    return {
      transferTxId: initialized.validOrder as string,
      feeDue: isFeeDue(initialized.providerFee as ProviderFeeLike | undefined)
    }

  const provider = params.signer.provider

  if (!service || !provider) return undefined

  const providerFee = initialized.providerFee as ProviderFeeLike | undefined

  const previous = await findPreviousOrder({
    provider,
    datatokenAddress: params.datatokenAddress,
    account: params.consumer,
    serviceIndex: params.serviceIndex,
    serviceId: service.id,
    timeout: service.timeout,
    providerFeeAddress:
      providerFee?.providerFeeAddress === undefined
        ? undefined
        : String(providerFee.providerFeeAddress)
  }).catch((error: unknown) => onLookupFailure(params, error, quote, operation))

  if (!previous) return undefined

  logger.emit(
    'access.order.previous_found',
    'Found a previous order on chain.',
    () => ({
      did: params.did,
      orderTxId: previous.orderTxId,
      usableTxId: previous.usableTxId
    })
  )

  return previous.usableTxId
    ? { transferTxId: previous.usableTxId, feeDue: false }
    : { transferTxId: previous.orderTxId, feeDue: true }
}

type Quote = { pricing: PricingInfo; price: OrderPrice }

/**
 * The previous-order lookup failed: refuse to buy a service that costs anything, unless
 * the caller opted in (with `true`, nothing else), before anything is sent; otherwise warn
 * and order anew. When the pricing cannot be read either (the same failing RPC), nothing
 * can be bought: the service counts as paid and the refusal names no price, whatever the
 * opt-in, so the pricing read's raw error (with its RPC URL) never reaches the caller.
 */
async function onLookupFailure(
  params: SettleOrderParams,
  error: unknown,
  quote: () => Promise<Quote>,
  operation: string
): Promise<undefined> {
  const logger = params.logger ?? log
  const failure = classifyLookupFailure(error)
  // A throw while the costs are put together counts as an unreadable price too.
  const costs = await quote()
    .then(({ pricing, price }) => costsOfNewOrder(params, pricing, price))
    .catch((priceError: unknown) => {
      debugRaw('order', 'price read error before redaction', priceError)
      return undefined
    })

  const subject: OrderSubject = {
    did: params.did,
    serviceId: params.service?.id ?? '',
    serviceName: params.service?.name,
    assetName: params.assetName,
    consumer: params.consumer
  }

  if (!costs || (costs.length && params.orderOnLookupFailure !== true))
    throw new OrderCheckError(subject, costs, failure, operation)

  logger.emit(
    'access.order.lookup_failed',
    lookupFailedWarning(subject, failure, costs),
    {
      did: params.did,
      datatokenAddress: params.datatokenAddress,
      serviceId: params.service?.id,
      reason: failure.reason,
      free: !costs.length,
      error: failure.cause.message
    }
  )

  return undefined
}

/**
 * What a new order pays besides gas, each part in its own token, as `order()` pays it: the
 * datatoken's price in its base token (exchange fees included), the publish-market fee and
 * the provider fee quoted now, those that are not zero. Empty when it costs nothing.
 */
async function costsOfNewOrder(
  params: SettleOrderParams,
  pricing: PricingInfo,
  price: OrderPrice
): Promise<OrderCheckPrice[]> {
  const { signer } = params
  const costs: OrderCheckPrice[] = []

  if (notZero(price.total))
    costs.push({
      amount: price.total,
      symbol: await symbolOf(signer, pricing.baseTokenAddress)
    })

  if (notZero(price.publishMarketFee))
    costs.push({
      amount: price.publishMarketFee,
      symbol: await symbolOf(
        signer,
        pricing.publishMarketFee?.publishMarketFeeToken
      )
    })

  // The node's fee, not checked yet (`settleOrder()` checks it after this): its text is
  // sanitised and bounded before it goes into the message.
  const fee = params.initialized.providerFee as ProviderFeeLike | undefined
  if (isFeeDue(fee) && fee?.providerFeeToken !== undefined) {
    const token = String(fee.providerFeeToken)
    const units = String(fee.providerFeeAmount)
    const amount = await unitsToAmount(signer, token, units).catch(
      () => `${sanitize(units, MAX_UNITS_LENGTH, 'order')} base units`
    )
    costs.push({ amount, symbol: await symbolOf(signer, token) })
  }

  return costs
}

/** How much of a fee amount the node quoted goes into a message, in base units. */
const MAX_UNITS_LENGTH = 40

/**
 * Whether an amount is not provably zero: one that cannot be read (`NaN`, not a number,
 * empty or missing) counts as a cost, so a malformed price never makes a paid service look
 * free.
 */
function notZero(amount: string | undefined): boolean {
  try {
    return !new Decimal(amount ?? Number.NaN).isZero()
  } catch {
    return true
  }
}

/** The token's symbol, or its shortened address when it cannot be read. */
async function symbolOf(
  signer: Signer,
  token: string | undefined
): Promise<string> {
  if (!token) return 'tokens'
  try {
    const symbol: unknown = await new Contract(
      token,
      ['function symbol() view returns (string)'],
      signer
    ).symbol()
    if (typeof symbol === 'string' && symbol.trim()) return safeName(symbol, 20)
  } catch {
    // The symbol is only for the message: the address names the token as well.
  }
  // The token can be the node's (its fee, unchecked here): sanitised and bounded.
  return `tokens of ${sanitize(shortHex(token), 42, 'order')}`
}

/** `read`, called at most once; every call gets its result. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined
  return () => {
    result ??= read()
    return result
  }
}

/**
 * Sends what `planSettlement` decided. Each request allows exactly the fee the caller
 * consented to when the plan was made, so `confirmProviderFees` is not asked a second time
 * and no other fee can be paid.
 */
export async function sendSettlement(
  plan: SettlementPlan
): Promise<{ transferTxId: string; reused: boolean }> {
  if (plan.kind === 'reused')
    return { transferTxId: plan.transferTxId, reused: true }

  if (plan.kind === 'reuse') return reuseOrder(plan.request)

  return order(plan.request)
}

/**
 * Reuses a valid order when the node reports one, or, given `service`, when the account
 * holds one on chain the node would accept: as it stands when no new provider fee is
 * needed, otherwise extended with `reuseOrder`. Without one, places a fresh order.
 *
 * Every path but the first sends the node's provider fee to the datatoken, so it throws a
 * `ProviderFeeSignatureError` before any transaction (and before any pricing read, unless
 * the lookup on chain failed and the pricing was read to tell whether a new order costs
 * anything) when that fee is missing, incomplete, or carries a signature the datatoken
 * would reject. Those paths also
 * throw for a `payer` other than the signer (see `OrderRequest.payer`), and refuse a
 * non-zero fee `maxProviderFee` / `confirmProviderFees` do not allow with a
 * `ProviderFeeNotAllowedError`, before their first approval. An order used as it stands
 * pays no fee, so neither is consulted.
 *
 * When the lookup on chain fails or stops short (an RPC error or an incomplete scan, not
 * "no order found") and a new order costs anything, it throws an `OrderCheckError` before
 * anything is sent, unless `orderOnLookupFailure` is `true`. That error is thrown before the
 * fee checks above, so it wins over them: retrying is what to do first either way.
 */
export async function settleOrder(
  params: SettleOrderParams
): Promise<{ transferTxId: string; reused: boolean }> {
  return sendSettlement(await planSettlement(params))
}
