import {
  Config,
  DatatokenCreateParams,
  Metadata,
  NftCreateData
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { PricingConfig, ServiceConfig } from './Publish'

export interface INautilusBuilder {
  setConfig: (config: Config) => INautilusBuilder
  setWeb3: (web3: Web3) => INautilusBuilder
  reset: () => void
}

export interface IPublisherBuilder extends INautilusBuilder {
  setType: (type: Metadata['type']) => IPublisherBuilder
  setName: (name: Metadata['name']) => IPublisherBuilder
  setDescription: (description: Metadata['description']) => IPublisherBuilder
  setLicense: (license: Metadata['license']) => IPublisherBuilder
  setAuthor: (author: Metadata['author']) => IPublisherBuilder
  setAlgorithm: (algorithm: Metadata['algorithm']) => IPublisherBuilder
  setPricing: (pricing: PricingConfig) => IPublisherBuilder
  addService: (service: ServiceConfig) => IPublisherBuilder
  setNftData: (tokenData: NftCreateData) => IPublisherBuilder
  setDatatokenData: (tokenData: DatatokenCreateParams) => IPublisherBuilder
}
