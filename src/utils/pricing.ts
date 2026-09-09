/**
 * Pricing, derived from chain state.
 *
 * Nautilus v1 read prices from the Ocean subgraph. That is gone: the current `Config` has
 * no `subgraphUri` at all, and ocean.js derives everything from contract reads plus the
 * indexed `indexedMetadata.stats[].prices`. This module does the same, so nautilus no
 * longer depends on urql, graphql or a subgraph deployment.
 */
import {
  type Config,
  Datatoken,
  type FixedPriceExchange,
  FixedRateExchange,
  type PublishingMarketFee,
  unitsToAmount,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import { Decimal } from 'decimal.js'
import type { Signer } from 'ethers'

export type PricingSchema = 'fixed' | 'free' | 'none'

export interface PricingInfo {
  schema: PricingSchema
  /** Datatoken template: 1 (basic), 2 (enterprise) or 4 (confidential EVM). */
  templateId: number
  datatokenAddress: string
  /** The *active* fixed-rate exchange, when `schema` is `'fixed'`. */
  exchangeId?: string
  baseTokenAddress?: string
  baseTokenDecimals?: number
  publishMarketFee: PublishingMarketFee
}

/**
 * Your market's cut of a fixed-rate order, and who collects it.
 *
 * Both halves are required, because an amount on its own has nowhere to go: the exchange
 * pays its swap fee to whichever address the order names, and that used to be the
 * *publish* market's collector — so a consume-market fee was quoted to the caller and then
 * handed to somebody else.
 */
export interface ConsumeMarketFee {
  /** The account that collects the fee. */
  address: string
  /**
   * The cut as a decimal **fraction**, not an amount — `'0.01'` is 1%.
   *
   * This is the unit the exchange works in: it scales the fraction by 1e18 and derives the
   * amount from the swap itself, so an absolute token amount passed here was read as a
   * percentage and meant something else entirely.
   */
  fee: string
}

export interface OrderPrice {
  /**
   * What to approve and spend **in the base token**, the exchange's own fees included.
   *
   * Only the base token: the publish-market fee is charged separately, in a token of its
   * own choosing, and nautilus approves it for you. Adding it in here mixed two currencies
   * into one number — and, because the contract reports it in base units while this is a
   * human-readable amount, mixed two *units* as well.
   */
  total: string
  /** Base-token amount the exchange charges, its own fees included. */
  baseTokenAmount: string
  opcFee: string
  /** The publishing market's cut, in `publishMarketFeeToken` — not in the base token. */
  publishMarketFee: string
  /** What your market collects — the absolute amount the exchange derived from `fee`. */
  consumeMarketFee: string
  /**
   * The consume-market fee this quote was calculated with.
   *
   * Carried on the quote rather than taken as a second argument to `order()`, so the fee
   * that was priced is necessarily the fee that gets charged, to the address it was priced
   * with.
   */
  consumeMarket?: ConsumeMarketFee
}

/**
 * Reads which pricing scheme a datatoken uses.
 *
 * `getFixedRates()` and `getDispensers()` are the authoritative source — a datatoken can
 * have neither, in which case it simply cannot be ordered.
 *
 * `getFixedRates()` is a history rather than a shortlist, so only an *active* exchange
 * counts as fixed-rate pricing; a datatoken whose exchanges are all deactivated falls
 * through to its dispenser.
 */
export async function getPricingInfo(
  signer: Signer,
  datatokenAddress: string,
  config?: Config
): Promise<PricingInfo> {
  const datatoken = new Datatoken(signer, config?.chainId, config)

  const [templateId, fixedRates, dispensers, publishMarketFee] =
    await Promise.all([
      datatoken.getId(datatokenAddress),
      datatoken.getFixedRates(datatokenAddress),
      datatoken.getDispensers(datatokenAddress),
      datatoken.getPublishingMarketFee(datatokenAddress)
    ])

  if (fixedRates?.length) {
    // Without the exchange contract the entries cannot be resolved at all. Report the
    // scheme as read and let `order()` fail on the missing base token, which names the
    // real problem — falling through to 'none' here would blame the datatoken instead.
    if (!config?.fixedRateExchangeAddress)
      return {
        schema: 'fixed',
        templateId: Number(templateId),
        datatokenAddress,
        exchangeId: extractExchangeId(fixedRates[0]),
        publishMarketFee
      }

    const active = await findActiveExchange(signer, config, fixedRates)

    // No *active* exchange is not fixed-rate pricing: fall through, because a dispenser
    // may well be live. Reporting 'fixed' on the strength of a deactivated exchange
    // pointed orders at one that reverts, and hid the dispenser that would have worked.
    if (active)
      return {
        schema: 'fixed',
        templateId: Number(templateId),
        datatokenAddress,
        exchangeId: active.exchangeId,
        baseTokenAddress: active.exchange.baseToken,
        baseTokenDecimals: toDecimals(active.exchange.btDecimals),
        publishMarketFee
      }
  }

  if (dispensers?.length)
    return {
      schema: 'free',
      templateId: Number(templateId),
      datatokenAddress,
      publishMarketFee
    }

  return {
    schema: 'none',
    templateId: Number(templateId),
    datatokenAddress,
    publishMarketFee
  }
}

/**
 * What ordering one datatoken will cost.
 *
 * Free (dispenser) pricing still carries the publish market's fee, so this is not simply
 * zero.
 *
 * @param consumeMarketFee your own market's cut, if you charge one. Only fixed-rate
 * pricing can carry it — see {@link ConsumeMarketFee}.
 */
export async function getOrderPrice(
  signer: Signer,
  pricing: PricingInfo,
  config: Config,
  consumeMarketFee?: ConsumeMarketFee
): Promise<OrderPrice> {
  const publishMarketFee = await readPublishMarketFee(signer, pricing)

  const consumeMarket = validateConsumeMarketFee(pricing, consumeMarketFee)

  if (pricing.schema !== 'fixed' || !pricing.exchangeId)
    return {
      total: '0',
      baseTokenAmount: '0',
      opcFee: '0',
      publishMarketFee,
      consumeMarketFee: '0'
    }

  const exchange = new FixedRateExchange(
    config.fixedRateExchangeAddress as string,
    signer
  )

  const priceAndFees = await exchange.calcBaseInGivenDatatokensOut(
    pricing.exchangeId,
    '1',
    consumeMarket?.fee || '0'
  )

  return {
    // `baseTokenAmount` is what the exchange wants in, fees included — the OPC cut, its
    // own market fee and the consume-market fee are all already inside it. Adding those
    // back on top double-counted them, and adding the consume-market *fraction* to a token
    // amount was not even the same unit.
    total: priceAndFees.baseTokenAmount,
    baseTokenAmount: priceAndFees.baseTokenAmount,
    opcFee: priceAndFees.oceanFeeAmount,
    publishMarketFee,
    consumeMarketFee: priceAndFees.consumeMarketFeeAmount || '0',
    ...(consumeMarket ? { consumeMarket } : {})
  }
}

/**
 * Whether the account already holds a usable order for this service.
 *
 * Answered by the node rather than computed locally: `initialize` returns `validOrder`
 * when a previous order is still inside the service's timeout, which is both cheaper and
 * more accurate than reconstructing it from events.
 */
export function hasReusableOrder(initialize: { validOrder?: string }): boolean {
  return Boolean(initialize?.validOrder)
}

/**
 * The first *active* exchange on the datatoken.
 *
 * `getFixedRates()` is a history, not a shortlist: deactivating an exchange leaves it
 * listed on the datatoken, so entry zero is regularly a dead one.
 */
async function findActiveExchange(
  signer: Signer,
  config: Config,
  rows: unknown[]
): Promise<{ exchangeId: string; exchange: FixedPriceExchange } | undefined> {
  const contract = new FixedRateExchange(
    config.fixedRateExchangeAddress as string,
    signer
  )

  for (const row of rows) {
    const exchangeId = extractExchangeId(row)
    if (!exchangeId) continue

    // One unreadable row must not hide the others: an id this contract does not know
    // throws rather than answering.
    const exchange = await contract
      .getExchange(exchangeId)
      .catch(() => undefined)

    if (exchange?.active) return { exchangeId, exchange }
  }

  return undefined
}

/**
 * The publish-market fee as a human-readable amount of its own token.
 *
 * `getPublishingMarketFee()` hands back the raw `uint256` — base units — while every other
 * amount here is human-readable. Reporting it unconverted made the two indistinguishable,
 * and the one place that then spent it (`approve`, which scales by the token's decimals)
 * inflated it by a further 10^18.
 */
async function readPublishMarketFee(
  signer: Signer,
  pricing: PricingInfo
): Promise<string> {
  const fee = pricing.publishMarketFee
  const amount = fee?.publishMarketFeeAmount

  if (!amount || amount === '0') return '0'

  // Decimals come from the fee's own token, which need not be the exchange's base token.
  return unitsToAmount(signer, fee.publishMarketFeeToken, amount)
}

/**
 * Rejects a consume-market fee this order cannot actually carry.
 *
 * Quoting a fee that nothing charges — or charges to the wrong account — is worse than
 * refusing it, because the caller believes their market is being paid.
 */
function validateConsumeMarketFee(
  pricing: PricingInfo,
  consumeMarketFee?: ConsumeMarketFee
): ConsumeMarketFee | undefined {
  if (!consumeMarketFee || toDecimal(consumeMarketFee.fee).lte(0))
    return undefined

  if (!consumeMarketFee.address || consumeMarketFee.address === ZERO_ADDRESS)
    throw new Error(
      'A consume-market fee needs the address that collects it; a fee paid to the zero address is simply lost.'
    )

  if (pricing.schema !== 'fixed')
    throw new Error(
      `A consume-market fee rides on the fixed-rate swap, and this datatoken is priced '${pricing.schema}' — there is no swap to take it from. Order without the fee, or price the asset with a fixed-rate exchange.`
    )

  if (toDecimal(consumeMarketFee.fee).gte(1))
    throw new Error(
      `A consume-market fee is a fraction of the swap, not an amount: '${consumeMarketFee.fee}' means ${toDecimal(consumeMarketFee.fee).mul(100)}% of it. Pass '0.01' for 1%.`
    )

  return consumeMarketFee
}

/** `btDecimals` arrives as a string or a bigint, and 0 is a legitimate value. */
function toDecimals(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)

  return Number.isFinite(parsed) ? parsed : 18
}

/**
 * `getFixedRates()` returns loosely-typed rows. Depending on the ABI shape the exchange id
 * arrives as a named field, a plain string, or the second tuple element.
 */
function extractExchangeId(row: unknown): string | undefined {
  if (typeof row === 'string') return row

  if (row && typeof row === 'object') {
    const record = row as Record<string, unknown>

    for (const key of ['exchangeId', 'id', '1']) {
      const value = record[key]
      if (typeof value === 'string' && value) return value
    }
  }

  return undefined
}

/** `new Decimal()` throws on unparseable input; a missing price is worth zero, not a crash. */
function toDecimal(value: string): Decimal {
  try {
    return new Decimal(value || 0)
  } catch {
    return new Decimal(0)
  }
}
