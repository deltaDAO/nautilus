import {
  LoggerInstance,
  ProviderInstance,
  type Service,
  type UserCustomParameters
} from '@oceanprotocol/lib'
import { type Signer, providers } from 'ethers'
import type { AccessConfig } from '../@types/Access'
import type {
  AccessDetails,
  AssetWithAccessDetails,
  AssetWithAccessDetailsAndPrice
} from '../@types/Compute'
import { getServiceById, getServiceByName } from '../utils'
import { getAsset } from '../utils/aquarius'
import { getAccessDetails } from '../utils/helpers/access-details'
import { getAssetWithPrice } from '../utils/helpers/assets'
import { order } from '../utils/order'
import { initializeProvider } from '../utils/provider'

/**
 * @param {AccessConfig} accessConfig Configuration of the access request
 * @returns url of the downloadable file
 */
export async function access(accessConfig: AccessConfig) {
  const {
    assetDid,
    chainConfig: config,
    signer,
    serviceId,
    fileIndex,
    userdata
  } = accessConfig

  const signerAddress = await signer.getAddress()

  const asset = await getAsset(config.metadataCacheUri, assetDid)

  const accessDetails = await getAccessDetails(
    config.subgraphUri,
    asset.datatokens[0].address,
    asset.services[0].timeout,
    signerAddress
  )

  const assetWithAccessDetails: AssetWithAccessDetails = {
    ...asset,
    accessDetails
  }

  LoggerInstance.debug('[access] AccessDetails:', accessDetails)

  const accessService = serviceId
    ? getServiceById(asset, serviceId)
    : getServiceByName(asset, 'access')

  const initializeData = await initializeProvider(
    assetWithAccessDetails,
    signerAddress,
    accessService,
    fileIndex,
    userdata
  )

  const assetWithPrice = await getAssetWithPrice(
    assetWithAccessDetails,
    signer,
    config,
    initializeData.providerFee
  )

  LoggerInstance.debug(
    '[access] AssetWithprice:',
    assetWithPrice.orderPriceAndFees
  )

  if (isOwned(accessDetails)) {
    LoggerInstance.debug(
      `Found valid order for ${asset.id} with datatoken ${accessDetails.datatoken.address}`
    )
    return await getAssetDownloadUrl(
      assetWithPrice,
      signer,
      accessService,
      fileIndex,
      userdata
    )
  }

  const orderTx = await order({
    signer,
    asset: assetWithAccessDetails,
    orderPriceAndFees: assetWithPrice.orderPriceAndFees,
    accountId: await signer.getAddress(),
    config,
    providerFees: initializeData?.providerFee
  })

  const tx = await orderTx.wait()

  assetWithAccessDetails.accessDetails.validOrderTx = tx?.transactionHash
  return await getAssetDownloadUrl(
    assetWithPrice,
    signer,
    accessService,
    fileIndex,
    userdata
  )
}

function isOwned(accessDetails: AccessDetails) {
  // TODO: add asset check (e.g., datatoken address)
  return accessDetails.isOwned && accessDetails.validOrderTx
}

async function getAssetDownloadUrl(
  asset: AssetWithAccessDetailsAndPrice,
  signer: Signer,
  service: Service,
  fileIndex?: number,
  userCustomParameters?: UserCustomParameters
) {
  LoggerInstance.debug(`Requesting download url for asset ${asset.id}`)
  LoggerInstance.debug({ asset, userCustomParameters })

  const downloadUrl: string = await ProviderInstance.getDownloadUrl(
    asset.id,
    service.id,
    fileIndex || 0,
    asset.accessDetails.validOrderTx,
    service.serviceEndpoint,
    signer,
    userCustomParameters
  )

  return downloadUrl
}
