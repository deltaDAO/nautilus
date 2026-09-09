/**
 * Ordering a service: buying the datatoken and starting (or reusing) the order.
 *
 * Three things changed from v1:
 *
 *   - **Template 4** (confidential EVM / `ERC20Template4`) is handled, alongside 1 and 2.
 *   - Pricing comes from chain reads rather than the subgraph.
 *   - Unsupported combinations throw instead of falling through and returning `undefined`,
 *     which used to surface as `Cannot read properties of undefined (reading 'wait')`
 *     several frames away.
 */
import {
  approve,
  type Config,
  Datatoken,
  Dispenser,
  FixedRateExchange,
  type FreOrderParams,
  LoggerInstance,
  type OrderParams,
  type ProviderFees,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import type { Signer, TransactionReceipt, TransactionResponse } from 'ethers'
import type { ConsumeMarketFee, OrderPrice, PricingInfo } from './pricing.js'

/** Templates that settle the purchase and the order in a single transaction. */
const ATOMIC_ORDER_TEMPLATES = new Set([2, 4])

/**
 * The order-level consume-market fee is always zero here.
 *
 * It is a second, unrelated mechanism: an absolute amount in a token of its own, which the
 * datatoken pulls from the payer during `startOrder`. Nautilus charges the consume market
 * through the exchange's swap fee instead (see `OrderPrice.consumeMarket`), which is the
 * one `getOrderPrice` can quote — so nothing must be set here, or the caller would pay
 * twice for one fee.
 */
const NO_CONSUME_MARKET_FEE = {
  consumeMarketFeeAddress: ZERO_ADDRESS,
  consumeMarketFeeToken: ZERO_ADDRESS,
  consumeMarketFeeAmount: '0'
}

export interface OrderRequest {
  signer: Signer
  config: Config
  pricing: PricingInfo
  price: OrderPrice
  serviceIndex: number
  providerFees: ProviderFees
  /** The account that may consume. For compute, the environment's consumer address. */
  consumer: string
  /** The account paying. Defaults to the signer's address. */
  payer?: string
}

export interface OrderResult {
  transferTxId: string
  reused: boolean
}

/**
 * Reuses an existing order, paying only the new provider fee.
 *
 * Much cheaper than a fresh order: no datatoken is bought, the previous order is simply
 * extended for another provider-fee period.
 */
export async function reuseOrder(params: {
  signer: Signer
  config: Config
  datatokenAddress: string
  validOrderTx: string
  providerFees: ProviderFees
}): Promise<OrderResult> {
  const datatoken = new Datatoken(
    params.signer,
    params.config.chainId,
    params.config
  )

  const response = await datatoken.reuseOrder(
    params.datatokenAddress,
    params.validOrderTx,
    params.providerFees
  )

  const receipt = await confirm('reuseOrder', response)

  return { transferTxId: receipt.hash, reused: true }
}

/** Buys one datatoken and starts an order for the given service. */
export async function order(request: OrderRequest): Promise<OrderResult> {
  const { signer, config, pricing, price, providerFees, serviceIndex } = request
  const payer = request.payer || (await signer.getAddress())

  const datatoken = new Datatoken(signer, config.chainId, config)

  const orderParams: OrderParams = {
    consumer: request.consumer,
    serviceIndex,
    _providerFee: providerFees,
    _consumeMarketFee: NO_CONSUME_MARKET_FEE
  }

  LoggerInstance.debug('[order] ordering', {
    schema: pricing.schema,
    templateId: pricing.templateId,
    datatoken: pricing.datatokenAddress,
    total: price.total
  })

  switch (pricing.schema) {
    case 'fixed':
      return orderFixed({ ...request, payer, datatoken, orderParams })
    case 'free':
      return orderFree({ ...request, payer, datatoken, orderParams })
    default:
      throw new Error(
        `Datatoken ${pricing.datatokenAddress} has neither a fixed-rate exchange nor a dispenser, so it cannot be ordered.`
      )
  }
}

async function orderFixed(
  request: OrderRequest & {
    payer: string
    datatoken: Datatoken
    orderParams: OrderParams
  }
): Promise<OrderResult> {
  const { signer, config, pricing, price, payer, datatoken, orderParams } =
    request

  if (!pricing.exchangeId)
    throw new Error(
      `Datatoken ${pricing.datatokenAddress} advertises fixed-rate pricing but no exchange id could be read from chain.`
    )

  if (!pricing.baseTokenAddress)
    throw new Error(
      `Could not read the base token of fixed-rate exchange ${pricing.exchangeId}.`
    )

  const atomic = ATOMIC_ORDER_TEMPLATES.has(pricing.templateId)

  // The exchange pays its swap fee to whichever address the order names. That address must
  // be the *consume* market's collector — this used to pass the publish market's, which
  // quietly redirected the caller's own cut to the publisher (or, with no publish market,
  // to the zero address).
  const consumeMarket = requireConsumeMarketCollector(price)

  // Template 1 approves the exchange (it buys, then orders separately). Templates 2 and 4
  // approve the datatoken itself, which pulls the funds during the combined call.
  const spender = atomic
    ? pricing.datatokenAddress
    : (config.fixedRateExchangeAddress as string)

  await approveSpend({
    signer,
    config,
    account: payer,
    token: pricing.baseTokenAddress,
    spender,
    amount: price.total,
    decimals: pricing.baseTokenDecimals
  })

  if (atomic) {
    const freParams: FreOrderParams = {
      exchangeContract: config.fixedRateExchangeAddress as string,
      exchangeId: pricing.exchangeId,
      maxBaseTokenAmount: price.total,
      baseTokenAddress: pricing.baseTokenAddress,
      // `??`, not `||`: a 0-decimal base token is unusual but legal, and `|| 18` turned it
      // straight back into 18 — scaling every amount in the order by 1e18.
      baseTokenDecimals: pricing.baseTokenDecimals ?? 18,
      swapMarketFee: consumeMarket.fee,
      marketFeeAddress: consumeMarket.address
    }

    const receipt = await confirm(
      'buyFromFreAndOrder',
      await datatoken.buyFromFreAndOrder(
        pricing.datatokenAddress,
        orderParams,
        freParams
      )
    )

    return { transferTxId: receipt.hash, reused: false }
  }

  const exchange = new FixedRateExchange(
    config.fixedRateExchangeAddress as string,
    signer
  )

  await confirm(
    'buyDatatokens',
    await exchange.buyDatatokens(
      pricing.exchangeId,
      '1',
      price.total,
      consumeMarket.address,
      consumeMarket.fee
    )
  )

  return startOrder(datatoken, pricing.datatokenAddress, orderParams)
}

async function orderFree(
  request: OrderRequest & {
    payer: string
    datatoken: Datatoken
    orderParams: OrderParams
  }
): Promise<OrderResult> {
  const { signer, config, pricing, payer, datatoken, orderParams } = request

  if (!config.dispenserAddress)
    throw new Error(
      'The chain config has no dispenserAddress, so free assets cannot be ordered.'
    )

  if (ATOMIC_ORDER_TEMPLATES.has(pricing.templateId)) {
    const receipt = await confirm(
      'buyFromDispenserAndOrder',
      await datatoken.buyFromDispenserAndOrder(
        pricing.datatokenAddress,
        orderParams,
        config.dispenserAddress
      )
    )

    return { transferTxId: receipt.hash, reused: false }
  }

  const dispenser = new Dispenser(config.dispenserAddress, signer)

  await confirm(
    'dispense',
    await dispenser.dispense(pricing.datatokenAddress, '1', payer)
  )

  return startOrder(datatoken, pricing.datatokenAddress, orderParams)
}

/**
 * The consume-market fee to charge on the swap, refusing one that cannot be routed.
 *
 * `getOrderPrice` already rejects a fee with no collector, so this only bites on a
 * hand-assembled `OrderPrice` — where silently falling back to the zero address would burn
 * the caller's own cut.
 */
function requireConsumeMarketCollector(price: OrderPrice): ConsumeMarketFee {
  const consumeMarket = price.consumeMarket

  if (!consumeMarket) return { address: ZERO_ADDRESS, fee: '0' }

  if (!consumeMarket.address || consumeMarket.address === ZERO_ADDRESS)
    throw new Error(
      'This order carries a consume-market fee with no collector address. Pass the fee to getOrderPrice(), which resolves both halves together.'
    )

  return consumeMarket
}

async function startOrder(
  datatoken: Datatoken,
  datatokenAddress: string,
  orderParams: OrderParams
): Promise<OrderResult> {
  const receipt = await confirm(
    'startOrder',
    await datatoken.startOrder(
      datatokenAddress,
      orderParams.consumer,
      orderParams.serviceIndex,
      orderParams._providerFee,
      orderParams._consumeMarketFee
    )
  )

  return { transferTxId: receipt.hash, reused: false }
}

/** Approves a spend, skipping the call when the amount is zero. */
async function approveSpend(params: {
  signer: Signer
  config: Config
  account: string
  token: string
  spender: string
  /** In human units — ocean.js's `approve` converts to token units internally. */
  amount: string
  decimals?: number
}): Promise<void> {
  if (Number(params.amount) <= 0) return

  // Pass the human-unit amount straight through: `approve` compares it against the
  // existing allowance (also read in human units) and converts via its own
  // `amountToUnits`. Pre-converting to wei here double-converted the amount — a
  // 10^decimals-inflated allowance — and defeated the allowance short-circuit.
  const response = await approve(
    params.signer,
    params.config,
    params.account,
    params.token,
    params.spender,
    params.amount,
    false,
    params.decimals
  )

  // `approve` returns a number when the existing allowance already suffices.
  if (typeof response === 'number') return

  await confirm('approve', response as unknown as TransactionResponse)
}

/**
 * Waits for a transaction and fails loudly if it did not land.
 *
 * ocean.js's `sendPreparedTransaction` swallows send failures and returns `null`, so
 * without this a failed transaction looks like a successful call returning nothing.
 */
async function confirm(
  operation: string,
  response: TransactionResponse | unknown
): Promise<TransactionReceipt> {
  if (!response)
    throw new Error(
      `${operation} was not submitted; the node or RPC rejected it.`
    )

  const tx = response as TransactionResponse

  if (typeof tx.wait !== 'function')
    throw new Error(
      `${operation} did not return a transaction. Got: ${JSON.stringify(response)}`
    )

  const receipt = await tx.wait()

  if (!receipt)
    throw new Error(`${operation} was submitted but never confirmed.`)

  return receipt
}

export { confirm as confirmTransaction }
