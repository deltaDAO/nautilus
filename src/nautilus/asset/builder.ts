import {
  DatatokenCreateParams,
  MetadataAlgorithm,
  NftCreateData
} from '@oceanprotocol/lib'
import { IAssetBuilder } from '../../@types/Nautilus'
import {
  MetadataConfig,
  PricingConfig,
  ServiceConfig
} from '../../@types/Publish'
import { NautilusAsset } from './asset'

export class AssetBuilder implements IAssetBuilder {
  private asset: NautilusAsset = new NautilusAsset()

  reset() {
    this.asset = new NautilusAsset()
  }

  setType(type: MetadataConfig['type']) {
    this.asset.metadata.type = type

    return this
  }

  setName(name: string) {
    this.asset.metadata.name = name

    return this
  }

  setDescription(description: string) {
    this.asset.metadata.description = description

    return this
  }

  setLicense(license: string) {
    this.asset.metadata.license = license

    return this
  }

  setAuthor(author: string) {
    this.asset.metadata.author = author

    return this
  }

  setAlgorithm(algorithm: MetadataAlgorithm) {
    this.asset.metadata.algorithm = algorithm

    return this
  }

  setPricing(pricing: PricingConfig) {
    this.asset.pricing = pricing

    return this
  }

  addService(service: ServiceConfig) {
    this.asset.services.push(service)

    return this
  }

  setNftData(tokenData: NftCreateData) {
    this.asset.tokenParamaters.nftParams = tokenData

    return this
  }

  setDatatokenData(tokenData: DatatokenCreateParams) {
    this.asset.tokenParamaters.datatokenParams = tokenData

    return this
  }

  build() {
    // TODO: look for errors / missing input
    return this.asset
  }
}
