import {
  AssetBuilderConfig,
  CredentialListTypes,
  IAssetBuilder,
  LifecycleStates
} from '../../@types/Nautilus'
import { MetadataConfig, NftCreateDataWithoutOwner } from '../../@types/Publish'
import { combineArrays } from '../../utils'
import { NautilusAsset } from './NautilusAsset'
import {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService'

export class AssetBuilder implements IAssetBuilder {
  private asset: NautilusAsset

  constructor(config?: AssetBuilderConfig) {
    if (
      (!config?.nautilusDDO && config?.aquariusAsset) ||
      (config?.nautilusDDO && !config?.aquariusAsset)
    ) {
      throw new Error('Invalid AssetBuilder cunstructor parameter combination')
    }
    if (config?.nautilusDDO && config?.aquariusAsset) {
      this.asset = new NautilusAsset(config.nautilusDDO)
      this.asset.owner = config.aquariusAsset.nft.owner
      this.asset.lifecycleState = config.aquariusAsset.nft.state
    } else {
      this.asset = new NautilusAsset()
    }
  }

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

  addService(service: NautilusService<ServiceTypes, FileTypes>) {
    this.asset.ddo.services.push(service)

    return this
  }

  removeService(serviceId: string) {
    this.asset.ddo.removeServices.push(serviceId)

    return this
  }

  setNftData(tokenData: NftCreateDataWithoutOwner) {
    this.asset.nftCreateData = tokenData

    return this
  }

  setLifecycleState(state: LifecycleStates) {
    this.asset.lifecycleState = state

    return this
  }

  setOwner(owner: string) {
    this.asset.owner = owner

    return this
  }

  addAdditionalInformation(additionalInformation: { [key: string]: any }) {
    this.asset.ddo.metadata.additionalInformation = {
      ...this.asset.ddo.metadata.additionalInformation,
      ...additionalInformation
    }

    return this
  }

  setCopyrightHolder(copyrightHolder: string) {
    this.asset.ddo.metadata.copyrightHolder = copyrightHolder

    return this
  }

  addTags(tags: string[]) {
    this.asset.ddo.metadata.tags = combineArrays(
      this.asset.ddo.metadata.tags || [],
      tags
    )

    return this
  }

  addLinks(links: string[]) {
    this.asset.ddo.metadata.links = combineArrays(
      this.asset.ddo.metadata.links || [],
      links
    )

    return this
  }

  // TODO: add check for correct language tag
  // https://www.rfc-editor.org/info/bcp47
  setContentLanguage(language: string) {
    this.asset.ddo.metadata.contentLanguage = language

    return this
  }

  addCategories(categories: string[]) {
    this.asset.ddo.metadata.categories = combineArrays(
      this.asset.ddo.metadata.categories || [],
      categories
    )

    return this
  }

  addCredentialAddresses(list: CredentialListTypes, addresses: string[]) {
    // first get the index of the address credential list
    const addressCredentialIndex = this.asset.ddo.credentials[list].findIndex(
      (credential) => credential.type === 'address'
    )

    // get addresses already added to the credential values
    const oldAddresses =
      this.asset.ddo.credentials[list][addressCredentialIndex]?.values || []

    // add new values and remove duplicates
    const newAddresses = combineArrays(oldAddresses, addresses)

    // update the existing credential or add a new one for type address
    if (addressCredentialIndex > -1)
      this.asset.ddo.credentials[list][addressCredentialIndex].values =
        newAddresses
    else
      this.asset.ddo.credentials[list].push({
        type: 'address',
        values: newAddresses
      })

    return this
  }

  removeCredentialAddresses(list: CredentialListTypes, addresses: string[]) {
    // first get the index of the address credential list
    const addressCredentialIndex = this.asset.ddo.credentials[list].findIndex(
      (credential) => credential.type === 'address'
    )

    if (addressCredentialIndex === -1) return this

    // get addresses already added to the credential values
    const oldAddresses =
      this.asset.ddo.credentials[list][addressCredentialIndex]?.values

    const newAddresses = oldAddresses.filter(
      (address) => !addresses.includes(address)
    )

    if (newAddresses.length > 0) {
      this.asset.ddo.credentials[list][addressCredentialIndex].values =
        newAddresses
    } else {
      this.asset.ddo.credentials[list].splice(addressCredentialIndex, 1)
    }

    return this
  }

  build() {
    // TODO: look for errors / missing input
    return this.asset
  }
}
