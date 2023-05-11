import {
  LoggerInstance,
  ProviderInstance,
  Service,
  UserCustomParameters
} from '@oceanprotocol/lib'
import Web3 from 'web3'
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

/**
 * @param {AccessConfig} accessConfig Configuration of the access request
 * @returns url of the downloadable file
 */
export async function access(accessConfig: AccessConfig) {
  const {
    assetDid,
    chainConfig: config,
    web3,
    serviceId,
    fileIndex,
    userdata
  } = accessConfig

  const asset = await getAsset(config.metadataCacheUri, assetDid)

  const accessDetails = await getAccessDetails(
    config.subgraphUri,
    asset.datatokens[0].address,
    asset.services[0].timeout,
    web3.defaultAccount
  )

  const assetWithAccessDetails: AssetWithAccessDetails = {
    ...asset,
    accessDetails
  }

  LoggerInstance.debug('[access] AccessDetails:', accessDetails)

  const assetWithPrice = await getAssetWithPrice(
    assetWithAccessDetails,
    web3,
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
    return await downloadAssetFile(
      assetWithPrice,
      web3,
      accessService,
      fileIndex,
      userdata
    )
  }

  const initializeData = await initializeProvider(
    assetWithAccessDetails,
    web3.defaultAccount,
    accessService,
    fileIndex,
    userdata
  )

  const orderTx = await order(
    web3,
    assetWithAccessDetails,
    assetWithPrice.orderPriceAndFees,
    web3.defaultAccount,
    config,
    initializeData?.providerFee
  )

  assetWithAccessDetails.accessDetails.validOrderTx = orderTx.transactionHash
  return await downloadAssetFile(
    assetWithPrice,
    web3,
    accessService,
    fileIndex,
    userdata
  )
}

function isOwned(accessDetails: AccessDetails) {
  // TODO: add asset check (e.g., datatoken address)
  return accessDetails.isOwned && accessDetails.validOrderTx
}

async function downloadAssetFile(
  asset: AssetWithAccessDetailsAndPrice,
  web3: Web3,
  service: Service,
  fileIndex?: number,
  userCustomParameters?: UserCustomParameters
) {
  LoggerInstance.debug(`Requesting download url for asset ${asset.id}`)
  LoggerInstance.debug({ asset, userCustomParameters })

  const downloadUrl: string = await ProviderInstance.getDownloadUrl(
    asset.id,
    web3.defaultAccount,
    service.id,
    fileIndex || 0,
    asset.accessDetails.validOrderTx,
    service.serviceEndpoint,
    web3,
    userCustomParameters
  )

  return downloadUrl
}
