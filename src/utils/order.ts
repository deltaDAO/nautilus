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
  allowanceWei,
  approve,
  approveWei,
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
import { Decimal } from 'decimal.js'
import {
  formatUnits,
  type Signer,
  type TransactionReceipt,
  type TransactionResponse
} from 'ethers'
import {
  assertProviderFeesAllowed,
  type ProviderFeeLimits,
  quoteProviderFee
} from './paymentLimits.js'
import type { ConsumeMarketFee, OrderPrice, PricingInfo } from './pricing.js'
import {
  assertProviderFeeSignature,
  chargedProviderFee
} from './providerFee.js'

/** Enough precision for any uint256 amount at any decimals, so no amount is rounded. */
const UnitsDecimal = Decimal.clone({ precision: 160 })

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

/**
 * `maxProviderFee` / `confirmProviderFees` decide whether the node's provider fee may be
 * paid: without either, a non-zero fee is refused with a `ProviderFeeNotAllowedError`.
 */
export interface OrderRequest extends ProviderFeeLimits {
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
 *
 * Approves the datatoken to pull the provider fee, unless a standing allowance covers it.
 * Throws a `ProviderFeeSignatureError`, before sending anything, for a missing or
 * incomplete fee, or one whose signature the datatoken would reject, and a
 * `ProviderFeeNotAllowedError` for a non-zero fee `maxProviderFee` /
 * `confirmProviderFees` do not allow.
 */
export async function reuseOrder(
  params: {
    signer: Signer
    config: Config
    datatokenAddress: string
    validOrderTx: string
    providerFees: ProviderFees
  } & ProviderFeeLimits
): Promise<OrderResult> {
  // The datatoken checks the fee's signature on chain; a fee it would reject is refused
  // here, before the approval and the transaction.
  assertProviderFeeSignature(params.providerFees)

  // The node chose this fee: pay it only within what the caller allowed.
  await assertProviderFeesAllowed(
    [
      quoteProviderFee(params.providerFees, {
        datatoken: params.datatokenAddress
      })
    ],
    params
  )

  // `_checkProviderFee` pulls the fee with `transferFrom`, and ocean.js's `reuseOrder`
  // approves nothing, so without this any non-zero provider fee reverts.
  const providerFee = chargedProviderFee(params.providerFees)

  if (providerFee)
    await approveFeeWei({
      signer: params.signer,
      config: params.config,
      token: providerFee.token,
      spender: params.datatokenAddress,
      amount: providerFee.amount.toString(),
      what: 'provider fee'
    })

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

/**
 * Buys one datatoken and starts an order for the given service.
 *
 * Approves everything the order pulls from the payer (the purchase, the publish-market fee
 * and the provider fee) with one allowance per token and spender, skipping any a standing
 * allowance already covers.
 *
 * Throws before any approval or purchase for a missing or incomplete provider fee, one
 * whose signature the datatoken would reject (a `ProviderFeeSignatureError`), a non-zero
 * fee `maxProviderFee` / `confirmProviderFees` do not allow (a
 * `ProviderFeeNotAllowedError`), or pricing that cannot be ordered.
 */
export async function order(request: OrderRequest): Promise<OrderResult> {
  const { signer, config, pricing, price, providerFees, serviceIndex } = request

  // 1. Everything that can be checked without spending, first: a fee the datatoken would
  //    reject, a fee the caller did not allow, or pricing that cannot be ordered,
  //    otherwise surfaces after the buy.
  assertProviderFeeSignature(providerFees)

  await assertProviderFeesAllowed(
    [
      quoteProviderFee(providerFees, {
        datatoken: pricing.datatokenAddress
      })
    ],
    request
  )

  const route = routeOf(request)
  const allowances = allowancesFor(request, route)

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

  // 2. One approval per (token, spender), covering every amount it pulls.
  for (const allowance of allowances)
    await approveAllowance({ signer, config, payer, pricing, price, allowance })

  // 3. The purchase and the order.
  return route.schema === 'fixed'
    ? orderFixed({ ...request, route, datatoken, orderParams })
    : orderFree({ ...request, route, payer, datatoken, orderParams })
}

/** How an order is placed, once its pricing has been checked. */
type OrderRoute =
  | {
      schema: 'fixed'
      /** Templates 2 and 4: buy and order in one call, the datatoken pulling the funds. */
      atomic: boolean
      exchangeAddress: string
      exchangeId: string
      baseTokenAddress: string
      consumeMarket: ConsumeMarketFee
    }
  | { schema: 'free'; atomic: boolean; dispenserAddress: string }

/** Checks that the pricing can be ordered at all, before anything is approved. */
function routeOf(request: OrderRequest): OrderRoute {
  const { config, pricing, price } = request
  const atomic = ATOMIC_ORDER_TEMPLATES.has(pricing.templateId)

  switch (pricing.schema) {
    case 'fixed': {
      if (!pricing.exchangeId)
        throw new Error(
          `Datatoken ${pricing.datatokenAddress} advertises fixed-rate pricing but no exchange id could be read from chain.`
        )

      if (!pricing.baseTokenAddress)
        throw new Error(
          `Could not read the base token of fixed-rate exchange ${pricing.exchangeId}.`
        )

      if (!config.fixedRateExchangeAddress)
        throw new Error(
          'The chain config has no fixedRateExchangeAddress, so fixed-rate assets cannot be ordered.'
        )

      return {
        schema: 'fixed',
        atomic,
        exchangeAddress: config.fixedRateExchangeAddress,
        exchangeId: pricing.exchangeId,
        baseTokenAddress: pricing.baseTokenAddress,
        // The exchange pays its swap fee to whichever address the order names. That
        // address must be the *consume* market's collector — this used to pass the
        // publish market's, which quietly redirected the caller's own cut to the publisher
        // (or, with no publish market, to the zero address).
        consumeMarket: requireConsumeMarketCollector(price)
      }
    }
    case 'free':
      if (!config.dispenserAddress)
        throw new Error(
          'The chain config has no dispenserAddress, so free assets cannot be ordered.'
        )

      return {
        schema: 'free',
        atomic,
        dispenserAddress: config.dispenserAddress
      }
    default:
      throw new Error(
        `Datatoken ${pricing.datatokenAddress} has neither a fixed-rate exchange nor a dispenser, so it cannot be ordered.`
      )
  }
}

/** One amount the order pulls from the payer. */
interface Spend {
  token: string
  spender: string
  /** In the token's own units. */
  amount: bigint
  /** Named in a failed approval's error. */
  what: string
  /** The purchase itself, quoted in human units as `price.total`. */
  swap?: boolean
}

/** The allowance one (token, spender) pair needs: the sum of what it pulls. */
interface Allowance {
  token: string
  spender: string
  amount: bigint
  spends: Spend[]
}

/**
 * Every allowance the order needs, one per (token, spender).
 *
 * An ERC20 approval replaces the previous one rather than adding to it, so two amounts
 * pulled by the same spender in the same token need one allowance for their sum. Approved
 * one after the other, only the last would be left, and the order would revert on the
 * shortfall (after the purchase, on template 1). The pairs:
 *
 *   - the purchase, in the base token: to the exchange on template 1 (it buys, then orders
 *     separately), to the datatoken on templates 2 and 4 (it pulls the funds during the
 *     combined call);
 *   - the publish-market fee, in its own token, to the datatoken;
 *   - the provider fee, in its own token, to the datatoken.
 */
function allowancesFor(request: OrderRequest, route: OrderRoute): Allowance[] {
  const { config, pricing, price, providerFees } = request
  const spends: Spend[] = []

  if (route.schema === 'fixed')
    spends.push({
      token: route.baseTokenAddress,
      spender: route.atomic
        ? pricing.datatokenAddress
        : (config.fixedRateExchangeAddress as string),
      amount: toUnits(price.total, pricing.baseTokenDecimals ?? 18),
      what: 'purchase',
      swap: true
    })

  // Free is not free of fees: the datatoken charges its publish-market fee on a dispenser
  // order exactly as on a paid one.
  const publishMarketFee = publishMarketFeeOf(pricing)

  if (publishMarketFee)
    spends.push({
      token: publishMarketFee.token,
      spender: pricing.datatokenAddress,
      amount: BigInt(publishMarketFee.amount),
      what: 'publish-market fee'
    })

  // `_checkProviderFee` pulls the fee with `transferFrom` during the order, and ocean.js's
  // order calls approve nothing.
  const providerFee = chargedProviderFee(providerFees)

  if (providerFee)
    spends.push({
      token: providerFee.token,
      spender: pricing.datatokenAddress,
      amount: providerFee.amount,
      what: 'provider fee'
    })

  const byPair = new Map<string, Allowance>()

  for (const spend of spends) {
    if (spend.amount <= 0n) continue

    const key = `${spend.token.toLowerCase()} ${spend.spender.toLowerCase()}`
    const allowance = byPair.get(key)

    if (allowance) {
      allowance.amount += spend.amount
      allowance.spends.push(spend)
    } else
      byPair.set(key, {
        token: spend.token,
        spender: spend.spender,
        amount: spend.amount,
        spends: [spend]
      })
  }

  return [...byPair.values()]
}

/**
 * Approves one allowance, unless a standing allowance already covers it.
 *
 * The pair that carries the purchase goes through ocean.js's `approve`, in human units, as
 * the purchase always has; a pair that carries fees alone goes through `approveWei`.
 */
async function approveAllowance(params: {
  signer: Signer
  config: Config
  payer: string
  pricing: PricingInfo
  price: OrderPrice
  allowance: Allowance
}): Promise<void> {
  const { signer, config, payer, pricing, price, allowance } = params
  const swap = allowance.spends.find((spend) => spend.swap)

  if (swap)
    return approveSpend({
      signer,
      config,
      account: payer,
      token: allowance.token,
      spender: allowance.spender,
      // The quote as it came, when nothing rides on it.
      amount:
        allowance.spends.length === 1
          ? price.total
          : fromUnits(allowance.amount, pricing.baseTokenDecimals ?? 18),
      decimals: pricing.baseTokenDecimals
    })

  return approveFeeWei({
    signer,
    config,
    token: allowance.token,
    spender: allowance.spender,
    amount: allowance.amount.toString(),
    what: allowance.spends.map((spend) => spend.what).join(' and ')
  })
}

async function orderFixed(
  request: OrderRequest & {
    route: Extract<OrderRoute, { schema: 'fixed' }>
    datatoken: Datatoken
    orderParams: OrderParams
  }
): Promise<OrderResult> {
  const { signer, pricing, price, route, datatoken, orderParams } = request

  if (route.atomic) {
    const freParams: FreOrderParams = {
      exchangeContract: route.exchangeAddress,
      exchangeId: route.exchangeId,
      maxBaseTokenAmount: price.total,
      baseTokenAddress: route.baseTokenAddress,
      // `??`, not `||`: a 0-decimal base token is unusual but legal, and `|| 18` turned it
      // straight back into 18 — scaling every amount in the order by 1e18.
      baseTokenDecimals: pricing.baseTokenDecimals ?? 18,
      swapMarketFee: route.consumeMarket.fee,
      marketFeeAddress: route.consumeMarket.address
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

  const exchange = new FixedRateExchange(route.exchangeAddress, signer)

  await confirm(
    'buyDatatokens',
    await exchange.buyDatatokens(
      route.exchangeId,
      '1',
      price.total,
      route.consumeMarket.address,
      route.consumeMarket.fee
    )
  )

  return startOrder(datatoken, pricing.datatokenAddress, orderParams)
}

async function orderFree(
  request: OrderRequest & {
    route: Extract<OrderRoute, { schema: 'free' }>
    payer: string
    datatoken: Datatoken
    orderParams: OrderParams
  }
): Promise<OrderResult> {
  const { signer, pricing, route, payer, datatoken, orderParams } = request

  if (route.atomic) {
    const receipt = await confirm(
      'buyFromDispenserAndOrder',
      await datatoken.buyFromDispenserAndOrder(
        pricing.datatokenAddress,
        orderParams,
        route.dispenserAddress
      )
    )

    return { transferTxId: receipt.hash, reused: false }
  }

  const dispenser = new Dispenser(route.dispenserAddress, signer)

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

/**
 * Approves a fee whose amount is already in the token's own units.
 *
 * `approveWei` rather than `approve`: the latter expects human units and would scale the
 * amount by the token's decimals a second time. Used for the provider fee and the
 * publish-market fee, which are pulled the same way — `transferFrom(payer)` inside the
 * order, by the datatoken. Where both are in one token, `order()` passes their sum: an
 * approval replaces the previous one.
 */
export async function approveFeeWei(params: {
  signer: Signer
  config: Config
  token: string
  spender: string
  /** In the token's own units, as the contract or the node reported it. */
  amount: string
  /** Named in the error, so a failed approval says which fee it was. */
  what: string
}): Promise<void> {
  const { signer, config, token, spender, amount } = params
  const account = await signer.getAddress()

  // A standing allowance that covers the fee needs no transaction.
  const standing = await allowanceWei(signer, token, account, spender)

  if (BigInt(standing) >= BigInt(amount)) return

  const response = await approveWei(
    signer,
    config,
    account,
    token,
    spender,
    amount,
    // Force: the allowance was already checked above, with >= where ocean.js uses a
    // strict >, so an allowance exactly equal to the fee is not re-approved.
    true
  )

  // ocean.js waits for the approval itself but swallows a failed send and returns null;
  // surface that here rather than letting the order revert on a missing allowance.
  if (!response)
    throw new Error(
      `Could not approve the ${params.what} of ${amount} wei on token ${token} for ${spender}.`
    )
}

/**
 * The publish-market fee the datatoken charges on every order, if it charges one.
 *
 * Stored on the datatoken, and pulled by it from the payer during `startOrder` — so it
 * needs an allowance to the *datatoken*, in its own token, exactly like the provider fee.
 * Neither nautilus nor ocean.js's own `orderAsset` ever approved it: upstream instead adds
 * the raw amount to the base-token approval, which only works when the fee happens to be
 * charged in the base token, and silently mixes wei into a human-unit total.
 */
function publishMarketFeeOf(
  pricing: PricingInfo
): { token: string; address: string; amount: string } | undefined {
  const fee = pricing.publishMarketFee

  if (!fee?.publishMarketFeeAmount) return undefined
  if (BigInt(fee.publishMarketFeeAmount) <= 0n) return undefined

  // The contract skips the transfer unless all three are set, so nothing to approve.
  if (
    !fee.publishMarketFeeToken ||
    fee.publishMarketFeeToken === ZERO_ADDRESS ||
    !fee.publishMarketFeeAddress ||
    fee.publishMarketFeeAddress === ZERO_ADDRESS
  )
    return undefined

  return {
    token: fee.publishMarketFeeToken,
    address: fee.publishMarketFeeAddress,
    amount: fee.publishMarketFeeAmount
  }
}

/** A human-unit amount in the token's own units, rounded up to the token's precision. */
function toUnits(amount: string, decimals: number): bigint {
  if (!amount) return 0n

  let parsed: Decimal | undefined
  try {
    parsed = new UnitsDecimal(amount)
  } catch {
    parsed = undefined
  }

  if (!parsed?.isFinite())
    throw new Error(`The order's total '${amount}' is not a number.`)

  return BigInt(
    parsed.mul(new UnitsDecimal(10).pow(decimals)).ceil().toFixed(0)
  )
}

/** The token's own units as a human-unit decimal string, exactly. */
function fromUnits(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals).replace(/\.0$/, '')
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
 * without this a failed transaction looks like a successful call returning nothing. It
 * awaits the receipt inside the same `try`, so `null` can also mean the transaction was
 * broadcast and then reverted or timed out.
 */
async function confirm(
  operation: string,
  response: TransactionResponse | unknown
): Promise<TransactionReceipt> {
  if (!response)
    throw new Error(
      `${operation} failed: ocean.js returned no transaction. The wallet or RPC rejected it, or it was sent and then reverted or timed out; ocean.js does not say which, so check the account's latest transactions before retrying.`
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
