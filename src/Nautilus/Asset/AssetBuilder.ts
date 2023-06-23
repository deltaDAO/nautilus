import { IAssetBuilder } from '../../@types/Nautilus'
import {
  DatatokenCreateParamsWithoutOwner,
  MetadataConfig,
  NftCreateDataWithoutOwner
} from '../../@types/Publish'
import { NautilusAsset, PricingConfigWithoutOwner } from './NautilusAsset'
import {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService'

export class AssetBuilder implements IAssetBuilder {
  private asset: NautilusAsset = new NautilusAsset()

  reset() {
    this.asset = new NautilusAsset()
  }

  setType(type: MetadataConfig['type']) {
    this.asset.ddo.metadata.type = type

    return this
  }

  setName(name: string) {
    this.asset.ddo.metadata.name = name

    return this
  }

  setDescription(description: string) {
    this.asset.ddo.metadata.description = description

    return this
  }

  setLicense(license: string) {
    this.asset.ddo.metadata.license = license

    return this
  }

  setAuthor(author: string) {
    this.asset.ddo.metadata.author = author

    return this
  }

  setAlgorithm(algorithm: MetadataConfig['algorithm']) {
    this.asset.ddo.metadata.algorithm = algorithm

    return this
  }

  setPricing(pricing: PricingConfigWithoutOwner) {
    this.asset.pricing = pricing

    return this
  }

  addService(service: NautilusService<ServiceTypes, FileTypes>) {
    this.asset.ddo.services.push(service)

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

  addAdditionalInformation(addtionalInformation: { [key: string]: any }) {
    this.asset.ddo.metadata.additionalInformation = {
      ...this.asset.ddo.metadata.additionalInformation,
      addtionalInformation
    }

    return this
  }

  build() {
    // TODO: look for errors / missing input
    return this.asset
  }
}
