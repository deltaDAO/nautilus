/**
 * Direct contract operations that sit outside the publish/access/compute flows.
 */
import {
  type Config,
  FixedRateExchange,
  LoggerInstance,
  Nft
} from '@oceanprotocol/lib'
import type { Signer, TransactionReceipt } from 'ethers'
import { getDatatokenForService, getService } from '../ddo/read.js'
import { confirmTransaction } from './order.js'
import { getPricingInfo } from './pricing.js'

/**
 * Changes the price of a fixed-rate service.
 *
 * The exchange id is read from chain rather than the subgraph. Only fixed-rate services can
 * be repriced — a dispenser has no rate to set.
 */
export async function editPrice(params: {
  asset: unknown
  serviceId: string
  newPrice: string
  chainConfig: Config
  signer: Signer
}): Promise<TransactionReceipt> {
  const { asset, serviceId, newPrice, chainConfig, signer } = params

  if (!getService(asset, serviceId))
    throw new Error(`The asset has no service with id ${serviceId}.`)

  const datatokenAddress = getDatatokenForService(asset, serviceId)

  if (!datatokenAddress)
    throw new Error(
      `Could not determine the datatoken for service ${serviceId}.`
    )

  const pricing = await getPricingInfo(signer, datatokenAddress, chainConfig)

  if (pricing.schema !== 'fixed' || !pricing.exchangeId)
    throw new Error(
      `Service ${serviceId} is not priced by a fixed-rate exchange (it is '${pricing.schema}'), so its rate cannot be set.`
    )

  LoggerInstance.debug('[editPrice] setting rate', {
    exchangeId: pricing.exchangeId,
    newPrice
  })

  const exchange = new FixedRateExchange(
    chainConfig.fixedRateExchangeAddress as string,
    signer
  )

  return confirmTransaction(
    'setRate',
    await exchange.setRate(pricing.exchangeId, newPrice)
  )
}

/** Sets the NFT's metadata state, which is what marks an asset retired or unlisted. */
export async function setMetadataState(params: {
  nftAddress: string
  state: number
  chainConfig: Config
  signer: Signer
}): Promise<TransactionReceipt> {
  const { nftAddress, state, chainConfig, signer } = params

  const nft = new Nft(signer, chainConfig.chainId, chainConfig)

  return confirmTransaction(
    'setMetadataState',
    await nft.setMetadataState(nftAddress, await signer.getAddress(), state)
  )
}
