import {
  LoggerInstance,
  ProviderInstance,
  Service,
  UserCustomParameters
} from '@oceanprotocol/lib'
import { AccessConfig } from '../@types/Access'
import {
  AccessDetails,
  AssetWithAccessDetails,
  AssetWithAccessDetailsAndPrice
} from '../@types/Compute'
import { getAsset } from '../utils/aquarius'
import { getAccessDetails } from '../utils/helpers/access-details'
import { getAssetWithPrice } from '../utils/helpers/assets'
import { order } from '../utils/order'
import { initializeProvider } from '../utils/provider'
import { getServiceById, getServiceByName } from '../utils'
import { Signer, providers } from 'ethers'

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

  const assetWithPrice = await getAssetWithPrice(
    assetWithAccessDetails,
    signer,
    config,
    userdata
  )

  LoggerInstance.debug(
    '[access] AssetWithprice:',
    assetWithPrice.orderPriceAndFees
  )

  const accessService = serviceId
    ? getServiceById(asset, serviceId)
    : getServiceByName(asset, 'access')

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

  const initializeData = await initializeProvider(
    assetWithAccessDetails,
    signerAddress,
    accessService,
    fileIndex,
    userdata
  )

  const orderTx = await order({
    signer,
    asset: assetWithAccessDetails,
    orderPriceAndFees: assetWithPrice.orderPriceAndFees,
    accountId: await signer.getAddress(),
    config,
    providerFees: initializeData?.providerFee
  })

  assetWithAccessDetails.accessDetails.validOrderTx = orderTx.hash
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
