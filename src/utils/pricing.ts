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
  FixedRateExchange,
  type PublishingMarketFee
} from '@oceanprotocol/lib'
import { Decimal } from 'decimal.js'
import type { Signer } from 'ethers'

export type PricingSchema = 'fixed' | 'free' | 'none'

export interface PricingInfo {
  schema: PricingSchema
  /** Datatoken template: 1 (basic), 2 (enterprise) or 4 (confidential EVM). */
  templateId: number
  datatokenAddress: string
  /** Fixed-rate exchange id, when `schema` is `'fixed'`. */
  exchangeId?: string
  baseTokenAddress?: string
  baseTokenDecimals?: number
  publishMarketFee: PublishingMarketFee
}

export interface OrderPrice {
  /** Total to approve and spend, including publish-market and consume-market fees. */
  total: string
  /** Base-token amount the exchange itself charges. */
  baseTokenAmount: string
  opcFee: string
  publishMarketFee: string
  consumeMarketFee: string
}

/**
 * Reads which pricing scheme a datatoken uses.
 *
 * `getFixedRates()` and `getDispensers()` are the authoritative source — a datatoken can
 * have neither, in which case it simply cannot be ordered.
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
    const exchangeId = extractExchangeId(fixedRates[0])
    const exchange = exchangeId
      ? await new FixedRateExchange(
          config?.fixedRateExchangeAddress as string,
          signer
        ).getExchange(exchangeId)
      : undefined

    return {
      schema: 'fixed',
      templateId: Number(templateId),
      datatokenAddress,
      exchangeId,
      baseTokenAddress: exchange?.baseToken,
      baseTokenDecimals: exchange?.btDecimals
        ? Number.parseInt(String(exchange.btDecimals), 10)
        : 18,
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
 * Free (dispenser) pricing still carries market fees, so this is not simply zero.
 */
export async function getOrderPrice(
  signer: Signer,
  pricing: PricingInfo,
  config: Config,
  consumeMarketFeeAmount = '0'
): Promise<OrderPrice> {
  const publishMarketFee =
    pricing.publishMarketFee?.publishMarketFeeAmount || '0'

  if (pricing.schema !== 'fixed' || !pricing.exchangeId)
    return {
      total: sum(['0', publishMarketFee, consumeMarketFeeAmount]),
      baseTokenAmount: '0',
      opcFee: '0',
      publishMarketFee,
      consumeMarketFee: consumeMarketFeeAmount
    }

  const exchange = new FixedRateExchange(
    config.fixedRateExchangeAddress as string,
    signer
  )

  const priceAndFees = await exchange.calcBaseInGivenDatatokensOut(
    pricing.exchangeId,
    '1',
    consumeMarketFeeAmount
  )

  return {
    total: sum([
      priceAndFees.baseTokenAmount,
      publishMarketFee,
      consumeMarketFeeAmount
    ]),
    baseTokenAmount: priceAndFees.baseTokenAmount,
    opcFee: priceAndFees.oceanFeeAmount,
    publishMarketFee,
    consumeMarketFee: consumeMarketFeeAmount
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

/**
 * Sums decimal strings without ever going through `Number`.
 *
 * Token amounts routinely carry 18 decimals, which is well past the 15 significant digits
 * a double can hold — converting first silently rounded the operands, so the total came
 * out low and the approval it sized could be short of the order.
 */
function sum(values: string[]): string {
  return values
    .reduce((total, value) => total.add(toDecimal(value)), new Decimal(0))
    .toString()
}

/** `new Decimal()` throws on unparseable input; a missing price is worth zero, not a crash. */
function toDecimal(value: string): Decimal {
  try {
    return new Decimal(value || 0)
  } catch {
    return new Decimal(0)
  }
}
