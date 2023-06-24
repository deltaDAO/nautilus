import { Metadata, PublisherTrustedAlgorithm } from '@oceanprotocol/lib'
import { NautilusAsset } from '../Nautilus/Asset/NautilusAsset'
import {
  ConsumerParameterType,
  DatatokenCreateParamsWithoutOwner,
  NftCreateDataWithoutOwner,
  PricingConfig,
  ServiceConfig
} from './Publish'
import {
  FileTypes,
  NautilusService,
  ServiceFileType,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService'
import { NautilusConsumerParameter } from '../Nautilus/Asset/ConsumerParameters'

export interface NautilusOptions {
  skipDefaultConfig: boolean
}

export interface IBuilder<T> {
  build: () => T
  reset: () => void
}

export interface IAssetBuilder extends IBuilder<NautilusAsset> {
  setType: (type: Metadata['type']) => IAssetBuilder
  setName: (name: Metadata['name']) => IAssetBuilder
  setDescription: (description: Metadata['description']) => IAssetBuilder
  setLicense: (license: Metadata['license']) => IAssetBuilder
  setAuthor: (author: Metadata['author']) => IAssetBuilder
  addService: (
    service: NautilusService<ServiceTypes, FileTypes>
  ) => IAssetBuilder
  setNftData: (nftCreateData: NftCreateDataWithoutOwner) => IAssetBuilder
  setAlgorithm: (algorithm: Metadata['algorithm']) => IAssetBuilder
  setOwner: (owner: string) => IAssetBuilder
  addAdditionalInformation: (addtionalInformation: {
    [key: string]: any
  }) => IAssetBuilder
}

export interface IServiceBuilder<S extends ServiceTypes, F extends FileTypes>
  extends IBuilder<NautilusService<S, F>> {
  setName: (name: string) => IServiceBuilder<S, F>
  setTimeout: (timeout: number) => IServiceBuilder<S, F>
  setDescription: (description: string) => IServiceBuilder<S, F>
  setServiceEndpoint: (endpoint: string) => IServiceBuilder<S, F>
  addFile: (file: ServiceFileType<F>) => IServiceBuilder<S, F>
  addConsumerParameter: (
    parameter: NautilusConsumerParameter
  ) => IServiceBuilder<S, F>
  addTrustedAlgorithmPublisher: (publisher: string) => IServiceBuilder<S, F>
  addTrustedAlgorithm: (
    algorithm: PublisherTrustedAlgorithm
  ) => IServiceBuilder<S, F>
  allowRawAlgorithms: (allow?: boolean) => IServiceBuilder<S, F>
  allowAlgorithmNetworkAccess: (allow?: boolean) => IServiceBuilder<S, F>
  setPricing: (pricing: PricingConfig) => IServiceBuilder<S, F>
  setDatatokenData: (
    datatokenCreateData: DatatokenCreateParamsWithoutOwner
  ) => IServiceBuilder<S, F>
  setDatatokenNameAndSymbol: (
    dtName: string,
    dtSymbol: string
  ) => IServiceBuilder<S, F>
}
