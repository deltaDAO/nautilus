import type { TransactionReceipt } from '@ethersproject/abstract-provider'
import {
  type Asset,
  type Config,
  FixedRateExchange,
  LoggerInstance,
  type Service
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type { AccessDetails } from '../@types'
import { getAccessDetails } from './helpers/access-details'

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

  let accessDetails: AccessDetails
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
