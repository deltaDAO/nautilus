import {
  Asset,
  Config,
  FixedRateExchange,
  LoggerInstance,
  Service
} from '@oceanprotocol/lib'
import { Signer } from 'ethers'
import { getAccessDetails } from './helpers/access-details'
import { TransactionReceipt } from '@ethersproject/abstract-provider'

export async function editPrice(
  aquariusAsset: Asset,
  serviceId: string,
  newPrice: string,
  chainConfig: Config,
  signer: Signer
): Promise<TransactionReceipt> {
  if (!aquariusAsset) {
    throw new Error('[editPrice] Aquarius asset is undefined')
  }

  if (!aquariusAsset.services || aquariusAsset.services.length === 0) {
    throw new Error('[editPrice] Aquarius asset has no services')
  }

  // Find the specific service by its id
  const service: Service | undefined = aquariusAsset.services.find(
    (service) => service.id === serviceId
  )

  if (!service) {
    throw new Error(
      '[editPrice] No matching service found for provided serviceId'
    )
  }

  const fixedRateInstance = new FixedRateExchange(
    chainConfig.fixedRateExchangeAddress,
    signer
  )

  let accessDetails
  try {
    accessDetails = await getAccessDetails(
      chainConfig.subgraphUri,
      service.datatokenAddress
    )
  } catch (error) {
    LoggerInstance.error(
      `[editPrice] Error fetching access details: ${error.message}`
    )
    throw error
  }

  let txReceipt: TransactionReceipt
  try {
    const tx = await fixedRateInstance.setRate(
      accessDetails.addressOrId,
      newPrice
    )

    // Wait for the transaction to be confirmed
    txReceipt = await tx.wait()
  } catch (error) {
    LoggerInstance.error(
      `[editPrice] Error setting new price (setRate): ${error.message}`
    )
    throw error
  }

  return txReceipt
}
