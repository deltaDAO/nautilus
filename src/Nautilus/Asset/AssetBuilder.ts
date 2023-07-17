import { Credential, Credentials } from '@oceanprotocol/lib'
import { IAssetBuilder } from '../../@types/Nautilus'
import {
  DatatokenCreateParamsWithoutOwner,
  MetadataConfig,
  NftCreateDataWithoutOwner
} from '../../@types/Publish'
import { combineArrays } from '../../utils'
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

  setAlgorithm(algorithm: MetadataConfig['algorithm']) {
    this.asset.metadata.algorithm = algorithm

    return this
  }

  setPricing(pricing: PricingConfigWithoutOwner) {
    this.asset.pricing = pricing

    return this
  }

  addService(service: NautilusService<ServiceTypes, FileTypes>) {
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

  addAdditionalInformation(additionalInformation: { [key: string]: any }) {
    this.asset.metadata.additionalInformation = {
      ...this.asset.metadata.additionalInformation,
      ...additionalInformation
    }

    return this
  }

  setCopyrightHolder(copyrightHolder: string) {
    this.asset.metadata.copyrightHolder = copyrightHolder

    return this
  }

  addTags(tags: string[]) {
    this.asset.metadata.tags = combineArrays(this.asset.metadata.tags, tags)

    return this
  }

  addLinks(links: string[]) {
    this.asset.metadata.links = combineArrays(this.asset.metadata.links, links)

    return this
  }

  // TODO: add check for correct language tag
  // https://www.rfc-editor.org/info/bcp47
  setContentLanguage(language: string) {
    this.asset.metadata.contentLanguage = language

    return this
  }

  addCategories(categories: string[]) {
    this.asset.metadata.categories = combineArrays(
      this.asset.metadata.categories,
      categories
    )

    return this
  }

  addCredentialAddressses(list: keyof Credentials, addresses: string[]) {
    // first get the index of the address credential list
    const addressCredentialIndex = this.asset.credentials[list].findIndex(
      (credential) => credential.type === 'address'
    )

    // get addresses already added to the credential values
    const oldAddresses =
      this.asset.credentials[list][addressCredentialIndex]?.values || []

    // add new values and remove duplicates
    const newAddresses = combineArrays(oldAddresses, addresses)

    // update the existing credential or add a new one for type address
    if (addressCredentialIndex > -1)
      this.asset.credentials[list][addressCredentialIndex].values = newAddresses
    else
      this.asset.credentials[list].push({
        type: 'address',
        values: newAddresses
      })

    return this
  }

  build() {
    // TODO: look for errors / missing input
    return this.asset
  }
}
