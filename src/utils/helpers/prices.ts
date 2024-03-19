import {
  type Config,
  FixedRateExchange,
  type PriceAndFees,
  type ProviderFees,
  ProviderInstance,
  UserCustomParameters
} from '@oceanprotocol/lib'
import Decimal from 'decimal.js'
import type { Signer } from 'ethers'
import type {
  AccessDetails,
  AssetWithAccessDetails,
  OrderPriceAndFees
} from '../../@types'

/**
 * This is used to calculate the price to buy one datatoken from a fixed rate exchange. You need to pass either a web3 object or a chainId. If you pass a chainId a dummy web3 object will be created
 */
export async function getFixedBuyPrice(
  accessDetails: AccessDetails,
  config: Config,
  signer: Signer
): Promise<PriceAndFees> {
  const fixed = new FixedRateExchange(config.fixedRateExchangeAddress, signer)
  const estimatedPrice = await fixed.calcBaseInGivenDatatokensOut(
    accessDetails.addressOrId,
    '1',
    '0'
  )
  return estimatedPrice
}

export async function getOrderPriceAndFees(
  asset: AssetWithAccessDetails,
  signer: Signer,
  config: Config,
  providerFees: ProviderFees
): Promise<OrderPriceAndFees> {
  const orderPriceAndFees = {
    price: '0',
    publisherMarketOrderFee: asset.accessDetails.publisherMarketOrderFee,
    consumeMarketOrderFee: '0',
    providerFee: {
      providerFeeAmount: '0'
    },
    opcFee: '0'
  } as OrderPriceAndFees

  orderPriceAndFees.providerFee = providerFees

  // fetch price and swap fees
  if (asset?.accessDetails?.type === 'fixed') {
    const fixed = await getFixedBuyPrice(asset?.accessDetails, config, signer)
    orderPriceAndFees.price = fixed.baseTokenAmount
    orderPriceAndFees.opcFee = fixed.oceanFeeAmount
  }

  // calculate full price, we assume that all the values are in ocean, otherwise this will be incorrect
  orderPriceAndFees.price = new Decimal(+orderPriceAndFees.price || 0)
    .add(new Decimal(+orderPriceAndFees?.consumeMarketOrderFee || 0))
    .add(new Decimal(+orderPriceAndFees?.publisherMarketOrderFee || 0))
    .toString()

  return orderPriceAndFees
}
