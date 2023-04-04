import {
  DatatokenCreateParams,
  MetadataAlgorithm,
  NftCreateData
} from '@oceanprotocol/lib'
import { NautilusPublisher } from '.'
import { IPublisherBuilder } from '../../@types/Nautilus'
import { PricingConfig, ServiceConfig } from '../../@types/Publish'
import { NautilusBuilder } from '../builder'

export class NautilusPublisherBuilder
  extends NautilusBuilder
  implements IPublisherBuilder
{
  private nautilusPublisher: NautilusPublisher

  reset() {
    this.nautilusPublisher = new NautilusPublisher()
  }

  setType(type: 'algorithm' | 'dataset') {
    this.nautilusPublisher.metadata.type = type

    return this
  }

  setName(name: string) {
    this.nautilusPublisher.metadata.name = name

    return this
  }

  setDescription(description: string) {
    this.nautilusPublisher.metadata.description = description

    return this
  }

  setLicense(license: string) {
    this.nautilusPublisher.metadata.license = license

    return this
  }

  setAuthor(author: string) {
    this.nautilusPublisher.metadata.author = author

    return this
  }

  setAlgorithm(algorithm: MetadataAlgorithm) {
    this.nautilusPublisher.metadata.algorithm = algorithm

    return this
  }

  setPricing(pricing: PricingConfig) {
    this.nautilusPublisher.pricing = pricing

    return this
  }

  addService(service: ServiceConfig) {
    this.nautilusPublisher.services.push(service)

    return this
  }

  setNftData(tokenData: NftCreateData) {
    this.nautilusPublisher.tokenParamaters.nftParams = tokenData

    return this
  }

  setDatatokenData(tokenData: DatatokenCreateParams) {
    this.nautilusPublisher.tokenParamaters.datatokenParams = tokenData

    return this
  }
}
