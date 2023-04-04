import {
  DatatokenCreateParams,
  MetadataAlgorithm,
  NftCreateData
} from '@oceanprotocol/lib'
import { IAssetBuilder } from '../../@types/Nautilus'
import {
  DatatokenCreateParamsWithoutOwner,
  MetadataConfig,
  NftCreateDataWithoutOwner,
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

  setNftData(tokenData: NftCreateDataWithoutOwner) {
    this.asset.nftCreateData = tokenData

    return this
  }

  setDatatokenData(tokenData: DatatokenCreateParamsWithoutOwner) {
    this.asset.datatokenCreateParams = tokenData

    return this
  }

  setDatatokenNameAndSymbol(dtName: string, dtSymbol: string) {
    this.asset.datatokenCreateParams = {
      ...this.asset.datatokenCreateParams,
      name: dtName,
      symbol: dtSymbol
    }

    return this
  }

  setOwner(owner: string) {
    this.asset.owner = owner

    return this
  }

  build() {
    // TODO: look for errors / missing input
    return this.asset
  }
}
