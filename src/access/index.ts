import {
  LoggerInstance,
  ProviderInstance,
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
import { startOrder } from '../utils/order'

/**
 * @param {AccessConfig} accessConfig Configuration of the access request
 * @returns url of the downloadable file
 */
export async function access(accessConfig: AccessConfig) {
  const {
    assetDid,
    chainConfig: config,
    web3,
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
    undefined,
    userdata
  )

  LoggerInstance.debug(
    '[access] AssetWithprice:',
    assetWithPrice.orderPriceAndFees
  )

  if (isOwned(accessDetails)) {
    LoggerInstance.debug(
      `Found valid order for ${asset.id} with datatoken ${accessDetails.datatoken.address}`
    )
    return await downloadAssetFile(assetWithPrice, web3, fileIndex, userdata)
  }

  const orderTx = await startOrder(
    web3,
    assetWithAccessDetails,
    assetWithPrice.orderPriceAndFees,
    web3.defaultAccount,
    config
  )

  assetWithAccessDetails.accessDetails.validOrderTx = orderTx.transactionHash
  return await downloadAssetFile(assetWithPrice, web3, fileIndex, userdata)
}

function isOwned(accessDetails: AccessDetails) {
  // TODO: add asset check (e.g., datatoken address)
  return accessDetails.isOwned && accessDetails.validOrderTx
}

async function downloadAssetFile(
  asset: AssetWithAccessDetailsAndPrice,
  web3: Web3,
  fileIndex?: number,
  userCustomParameters?: UserCustomParameters
) {
  LoggerInstance.debug(`Requesting download url for asset ${asset.id}`)
  LoggerInstance.debug({ asset, userCustomParameters })
  const downloadUrl: string = await ProviderInstance.getDownloadUrl(
    asset.id,
    web3.defaultAccount,
    asset.services[0].id,
    fileIndex || 0,
    asset.accessDetails.validOrderTx,
    asset.services[0].serviceEndpoint,
    web3,
    userCustomParameters
  )

  return downloadUrl
}
