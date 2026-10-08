/**
 * What `completePublish()` reads about a datatoken it reuses that already has pricing, and
 * how it compares that with the service's pricing config. Not exported from the package.
 *
 * `completePublish()` never changes existing pricing, so a datatoken priced differently
 * from its service (another rate, free instead of fixed, a previous owner's exchange) would
 * go live as it is. It is refused instead, before any transaction.
 */
import {
  type Config,
  Datatoken,
  Dispenser,
  FixedRateExchange,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import { getAddress, isAddress, parseUnits, type Signer } from 'ethers'
import type { PricingConfigWithoutOwner } from '../@types/Publish.js'
import type { PricingInfo } from '../utils/pricing.js'

/** A reused datatoken's pricing as read from chain, in human units. */
export type ExistingPricing =
  | {
      schema: 'fixed'
      exchangeId: string
      exchangeOwner: string
      baseToken: string
      /** The rate, read with 18 decimals as the exchange stores it. */
      fixedRate: string
      marketFee: string
      marketFeeCollector: string
      allowedSwapper: string
      withMint: boolean
      paymentCollector: string
    }
  | {
      schema: 'free'
      active: boolean
      owner: string
      maxTokens: string
      maxBalance: string
      allowedSwapper: string
      isMinter: boolean
      paymentCollector: string
    }

/**
 * Reads the exchange or dispenser of a datatoken `getPricingInfo()` found priced, and its
 * payment collector. Only chain reads.
 */
export async function readExistingPricing(params: {
  signer: Signer
  chainConfig: Config
  datatokenAddress: string
  info: PricingInfo
}): Promise<ExistingPricing> {
  const { signer, chainConfig, datatokenAddress, info } = params

  if (info.schema === 'none')
    throw new Error(`Datatoken ${datatokenAddress} has no pricing to read.`)

  const paymentCollector = await new Datatoken(
    signer,
    chainConfig.chainId,
    chainConfig
  ).getPaymentCollector(datatokenAddress)

  if (info.schema === 'fixed') {
    if (!info.exchangeId)
      throw new Error(
        `Datatoken ${datatokenAddress} lists a fixed-rate exchange whose id could not be read.`
      )

    const exchange = new FixedRateExchange(
      chainConfig.fixedRateExchangeAddress as string,
      signer,
      chainConfig.chainId,
      chainConfig
    )
    const [details, fees] = await Promise.all([
      exchange.getExchange(info.exchangeId),
      exchange.getFeesInfo(info.exchangeId)
    ])

    return {
      schema: 'fixed',
      exchangeId: info.exchangeId,
      exchangeOwner: details.exchangeOwner,
      baseToken: details.baseToken,
      fixedRate: details.fixedRate,
      marketFee: fees.marketFee,
      marketFeeCollector: fees.marketFeeCollector,
      allowedSwapper: details.allowedSwapper,
      withMint: Boolean(details.withMint),
      paymentCollector
    }
  }

  const status = await new Dispenser(
    chainConfig.dispenserAddress as string,
    signer,
    chainConfig.chainId,
    chainConfig
  ).status(datatokenAddress)

  return {
    schema: 'free',
    active: Boolean(status.active),
    owner: status.owner,
    maxTokens: status.maxTokens,
    maxBalance: status.maxBalance,
    allowedSwapper: status.allowedSwapper,
    isMinter: Boolean(status.isMinter),
    paymentCollector
  }
}

/**
 * How an existing datatoken's pricing differs from what `publish()` would have created for
 * the service, one entry per difference. Empty when they match, or when the service has
 * no pricing config to compare with.
 *
 * `owner` is the publisher. A dispenser created together with the NFT is owned by the
 * ERC721 factory, which deploys it, so `nftFactoryAddress` counts as the owner there.
 */
export function pricingMismatches(params: {
  pricing: PricingConfigWithoutOwner | undefined
  existing: ExistingPricing
  owner: string
  nftFactoryAddress: string
}): string[] {
  const { pricing, existing, owner, nftFactoryAddress } = params

  if (!pricing) return []

  if (pricing.type !== existing.schema)
    return [`it is priced '${existing.schema}', the service '${pricing.type}'`]

  const mismatches: string[] = []
  const differs = (what: string, actual: unknown, expected: unknown) =>
    mismatches.push(
      `${what} is ${String(actual)}, the service wants ${String(expected)}`
    )

  if (!sameAddress(existing.paymentCollector, owner))
    differs('the payment collector', existing.paymentCollector, owner)

  if (existing.schema === 'fixed') {
    const expected = pricing.freCreationParams

    if (!expected)
      return [
        ...mismatches,
        "the service's fixed pricing has no freCreationParams"
      ]

    // Both publish paths scale the rate and the market fee with the datatoken's decimals;
    // the exchange reports them with 18.
    const decimals = expected.datatokenDecimals ?? 18

    if (!sameAddress(existing.exchangeOwner, owner))
      differs('the exchange owner', existing.exchangeOwner, owner)
    if (!sameAddress(existing.baseToken, expected.baseTokenAddress))
      differs('the base token', existing.baseToken, expected.baseTokenAddress)
    if (!sameUnits(existing.fixedRate, 18, expected.fixedRate, decimals))
      differs('the rate', existing.fixedRate, expected.fixedRate)
    if (!sameUnits(existing.marketFee, 18, expected.marketFee, decimals))
      differs('the market fee', existing.marketFee, expected.marketFee)
    if (!sameAddress(existing.marketFeeCollector, expected.marketFeeCollector))
      differs(
        'the market fee collector',
        existing.marketFeeCollector,
        expected.marketFeeCollector
      )

    const allowed = expected.allowedConsumer || ZERO_ADDRESS
    if (!sameAddress(existing.allowedSwapper, allowed))
      differs('the allowed consumer', existing.allowedSwapper, allowed)

    const withMint = expected.withMint !== false
    if (existing.withMint !== withMint)
      differs('withMint', existing.withMint, withMint)

    return mismatches
  }

  // The defaults both publish paths create a dispenser with.
  const expected = {
    maxTokens: '1',
    maxBalance: '100000000',
    withMint: true,
    allowedSwapper: ZERO_ADDRESS,
    ...pricing.dispenserParams
  }

  if (!existing.active) mismatches.push('the dispenser is not active')
  if (
    !sameAddress(existing.owner, owner) &&
    !sameAddress(existing.owner, nftFactoryAddress)
  )
    differs('the dispenser owner', existing.owner, owner)
  if (!sameUnits(existing.maxTokens, 18, String(expected.maxTokens), 18))
    differs('maxTokens', existing.maxTokens, expected.maxTokens)
  if (!sameUnits(existing.maxBalance, 18, String(expected.maxBalance), 18))
    differs('maxBalance', existing.maxBalance, expected.maxBalance)
  if (!sameAddress(existing.allowedSwapper, expected.allowedSwapper))
    differs(
      'the allowed swapper',
      existing.allowedSwapper,
      expected.allowedSwapper
    )
  if (expected.withMint && !existing.isMinter)
    mismatches.push('the dispenser cannot mint, the service wants withMint')

  return mismatches
}

function sameAddress(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (isAddress(a) && isAddress(b)) return getAddress(a) === getAddress(b)

  return a.toLowerCase() === b.toLowerCase()
}

/** Whether two human amounts are the same number of base units. Unparseable never is. */
function sameUnits(
  a: unknown,
  aDecimals: number,
  b: unknown,
  bDecimals: number
): boolean {
  try {
    return (
      parseUnits(String(a), Number(aDecimals)) ===
      parseUnits(String(b), Number(bDecimals))
    )
  } catch {
    return false
  }
}
