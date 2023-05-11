import {
  Config,
  LoggerInstance,
  ProviderFees,
  UserCustomParameters
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import {
  AssetWithAccessDetails,
  AssetWithAccessDetailsAndPrice,
  ComputeAsset
} from '../../@types'
import { getAsset } from '../aquarius'
import { getAccessDetails } from './access-details'
import { getOrderPriceAndFees } from './prices'

export async function getAssetsWithAccessDetails(
  identifiers: ComputeAsset[],
  config: Config,
  web3: Web3
): Promise<AssetWithAccessDetails[]> {
  const controller = new AbortController()
  LoggerInstance.debug(
    `Retrieving ${identifiers.length} assets from metadata cache ...`
  )

  const assets = await Promise.all(
    identifiers.map((asset) =>
      getAsset(config.metadataCacheUri, asset.did, controller.signal)
    )
  )

  LoggerInstance.debug(
    `Retrieve access details for ${identifiers.length} assets from subgraph ...`
  )
  const assetAccessDetails = await Promise.all(
    assets.map((asset, i) => {
      const serviceIndex = Math.max(
        asset.services.findIndex(
          (service) => service.id === identifiers[i].serviceId
        ),
        0
      )

      return getAccessDetails(
        config.subgraphUri,
        asset.datatokens[serviceIndex].address,
        asset.services[serviceIndex].timeout,
        web3.defaultAccount
      )
    })
  )

  return assets.map((asset, i) => ({
    ...asset,
    accessDetails: assetAccessDetails[i]
  }))
}

export async function getAssetWithPrice(
  asset: AssetWithAccessDetails,
  web3: Web3,
  config: Config,
  userCustomParameters?: UserCustomParameters
): Promise<AssetWithAccessDetailsAndPrice> {
  return {
    ...asset,
    orderPriceAndFees: await getOrderPriceAndFees(asset, web3, config)
  }
}
