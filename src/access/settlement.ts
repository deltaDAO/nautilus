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
  LoggerInstance,
  type ProviderFees
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
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
  hasReusableOrder
} from '../utils/pricing.js'
import {
  assertProviderFeeSignature,
  isFeeDue,
  type ProviderFeeLike
} from '../utils/providerFee.js'

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
   * `validOrder`. Without it only the node's `validOrder` is reused.
   */
  service?: { id: string; timeout: number }
} & ProviderFeeLimits

/** What `sendSettlement` will do, decided and checked by `planSettlement`. */
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
 * `service` is given), the provider fee's signature, the payer, the caller's consent to the fee
 * (which may ask `confirmProviderFees`), and, for a fresh order, the pricing read from
 * chain and whether it can be ordered. Throws what `settleOrder` would throw before its
 * first transaction.
 */
export async function planSettlement(
  params: SettleOrderParams
): Promise<SettlementPlan> {
  const { signer, chainConfig, datatokenAddress, serviceIndex, initialized } =
    params
  const limits: ProviderFeeLimits = {
    maxProviderFee: params.maxProviderFee,
    confirmProviderFees: params.confirmProviderFees
  }

  const providerFee = initialized.providerFee as ProviderFeeLike | undefined
  const previous = await reusableOrder(params)

  // An order in force and no new fee needed: reuse the transaction as it stands. Nothing
  // is sent, so no fee is needed.
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

  // An order in force but a new fee period: extend it rather than buying again.
  if (previous) {
    await assertProviderFeesAllowed(
      [quoteProviderFee(providerFees, { datatoken: datatokenAddress })],
      limits
    )

    return {
      kind: 'reuse',
      datatokenAddress,
      request: {
        signer,
        config: chainConfig,
        datatokenAddress,
        validOrderTx: previous.transferTxId,
        providerFees,
        ...limits
      }
    }
  }

  const pricing = await getPricingInfo(signer, datatokenAddress, chainConfig)
  const price = await getOrderPrice(signer, pricing, chainConfig)

  const request: OrderRequest = {
    signer,
    config: chainConfig,
    pricing,
    price,
    serviceIndex,
    providerFees,
    consumer: params.consumer,
    payer: params.payer,
    ...limits
  }

  // Pricing that cannot be ordered, or a fee the caller does not allow, is refused here.
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
 * now. A lookup that fails places a fresh order, as without one.
 */
async function reusableOrder(
  params: SettleOrderParams
): Promise<{ transferTxId: string; feeDue: boolean } | undefined> {
  const { initialized, service } = params

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
  }).catch((error: unknown) => {
    LoggerInstance.warn(
      `[settlement] Could not look up a previous order of ${params.datatokenAddress}, ordering anew: ${error instanceof Error ? error.message : String(error)}`
    )
    return undefined
  })

  if (!previous) return undefined

  LoggerInstance.debug('[settlement] previous order found on chain', previous)

  return previous.usableTxId
    ? { transferTxId: previous.usableTxId, feeDue: false }
    : { transferTxId: previous.orderTxId, feeDue: true }
}

/**
 * Sends what `planSettlement` decided. The fee was allowed when the plan was made, so the
 * order may pay exactly that fee and `confirmProviderFees` is not asked a second time.
 */
export async function sendSettlement(
  plan: SettlementPlan
): Promise<{ transferTxId: string; reused: boolean }> {
  if (plan.kind === 'reused')
    return { transferTxId: plan.transferTxId, reused: true }

  const exactly = {
    maxProviderFee: ceilingFor([
      quoteProviderFee(plan.request.providerFees, {
        datatoken: plan.datatokenAddress
      })
    ]),
    confirmProviderFees: undefined
  }

  if (plan.kind === 'reuse') return reuseOrder({ ...plan.request, ...exactly })

  return order({ ...plan.request, ...exactly })
}

/**
 * Reuses a valid order when the node reports one, or, given `service`, when the account
 * holds one on chain the node would accept: as it stands when no new provider fee is
 * needed, otherwise extended with `reuseOrder`. Without one, places a fresh order.
 *
 * Every path but the first sends the node's provider fee to the datatoken, so it throws a
 * `ProviderFeeSignatureError` before any pricing read or transaction when that fee is
 * missing, incomplete, or carries a signature the datatoken would reject. Those paths also
 * throw for a `payer` other than the signer (see `OrderRequest.payer`), and refuse a
 * non-zero fee `maxProviderFee` / `confirmProviderFees` do not allow with a
 * `ProviderFeeNotAllowedError`, before their first approval.
 */
export async function settleOrder(
  params: SettleOrderParams
): Promise<{ transferTxId: string; reused: boolean }> {
  return sendSettlement(await planSettlement(params))
}
