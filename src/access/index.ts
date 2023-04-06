import {
  LoggerInstance,
  ProviderInstance,
  UserCustomParameters
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { AccessConfig } from '../@types/Access'
import { AccessDetails, AssetWithAccessDetails } from '../@types/Compute'
import { getAccessDetails, getAssetWithPrice, startOrder } from '../compute'
import { getAsset } from '../utils/aquarius'

/**
 * @param {AccessConfig} accessConfig Configuration of the access request
 * @param {string} accessConfig.assetDid The document id of the asset to access
 * @param {Web3} accessConfig.web3 The web3 instance to use to make the access request
 * @param {Config} accessConfig.config The Ocean Configuration needed to make the access requests
 * @param {number} [accessConfig.fileIndex=0] The file index of the asset to be requested.
 * @param {UserCustomParameters} [accessConfig.userdata] Custom userdata that is needed for the access request.
 * @returns
 */
export async function access(accessConfig: AccessConfig) {
  const { assetDid, config, web3, fileIndex, userdata } = accessConfig

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

  if (isOwned(accessDetails)) {
    LoggerInstance.debug(
      `Found valid order for ${asset.id} with datatoken ${accessDetails.datatoken.address}`
    )
    return await downloadAssetFile(
      { ...asset, accessDetails },
      web3,
      fileIndex,
      userdata
    )
  }

  const assetWithPrice = await getAssetWithPrice(
    assetWithAccessDetails,
    web3,
    config
  )

  const orderTx = await startOrder(
    web3,
    assetWithAccessDetails,
    assetWithPrice.orderPriceAndFees,
    web3.defaultAccount,
    config
  )

  assetWithAccessDetails.accessDetails.validOrderTx = orderTx.transactionHash
  return await downloadAssetFile(
    assetWithAccessDetails,
    web3,
    fileIndex,
    userdata
  )
}

function isOwned(accessDetails: AccessDetails) {
  // TODO: add asset check (e.g., datatoken address)
  return accessDetails.isOwned && accessDetails.validOrderTx
}

async function downloadAssetFile(
  asset: AssetWithAccessDetails,
  web3: Web3,
  fileIndex?: number,
  userCustomParameters?: UserCustomParameters
) {
  LoggerInstance.debug(`Requesting download url for asset ${asset.id}`)
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
