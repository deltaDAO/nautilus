/**
 * Settling the order for one service, in two steps: `planSettlement` runs every check
 * and chain read, and `sendSettlement` sends the transactions.
 *
 * `settleOrder` runs both back to back. `compute()` plans every input first, then funds
 * escrow, then sends the orders, so an input that cannot be ordered is refused before the
 * escrow deposit. `planSettlement` and `sendSettlement` are not exported from the package.
 */
import type { Config, ProviderFees } from '@oceanprotocol/lib'
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
 * anything: the provider fee's signature, the payer, the caller's consent to the fee
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

  // Nothing to pay and an order already in force: reuse the transaction as it stands.
  // Nothing is sent, so no fee is needed.
  if (hasReusableOrder(initialized) && !isFeeDue(providerFee))
    return {
      kind: 'reused',
      datatokenAddress,
      transferTxId: initialized.validOrder as string
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
  if (hasReusableOrder(initialized)) {
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
        validOrderTx: initialized.validOrder as string,
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
 * Reuses a valid order when the node says one exists and no new provider fee is due;
 * otherwise extends it, or places a fresh order.
 *
 * Every path but the first sends the node's provider fee to the datatoken, so it throws a
 * `ProviderFeeSignatureError` before any chain read or transaction when that fee is
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
