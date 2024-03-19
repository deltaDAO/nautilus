import {
  type Config,
  LoggerInstance,
  type ProviderFees,
  UserCustomParameters
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type {
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
  signer: Signer
): Promise<AssetWithAccessDetails[]> {
  const controller = new AbortController()
  LoggerInstance.debug(
    `Retrieving ${identifiers.length} assets from metadata cache ...`
  )

  const signerAddress = await signer.getAddress()

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
        signerAddress
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
  signer: Signer,
  config: Config,
  providerFees: ProviderFees
): Promise<AssetWithAccessDetailsAndPrice> {
  return {
    ...asset,
    orderPriceAndFees: await getOrderPriceAndFees(
      asset,
      signer,
      config,
      providerFees
    )
  }
}
