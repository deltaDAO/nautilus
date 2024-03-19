import type {
  Asset,
  ConsumerParameter,
  Metadata,
  PublisherTrustedAlgorithm
} from '@oceanprotocol/lib'
import type { NautilusAsset } from '../Nautilus/Asset/NautilusAsset'
import type {
  FileTypes,
  NautilusService,
  ServiceFileType,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService'
import type {
  DatatokenCreateParamsWithoutOwner,
  NftCreateDataWithoutOwner,
  PricingConfig
} from './Publish'

export interface NautilusOptions {
  skipDefaultConfig: boolean
}

export type ServiceBuilderConfig =
  | {
      serviceType: ServiceTypes
      fileType: FileTypes
    }
  | {
      aquariusAsset: Asset
      serviceId: string
    }

export interface IBuilder<T> {
  build: () => T
  reset: () => void
}

export enum CredentialListTypes {
  ALLOW = 'allow',
  DENY = 'deny'
}

export enum LifecycleStates {
  ACTIVE = 0,
  END_OF_LIFE = 1,
  DEPRECATED = 2,
  REVOKED_BY_PUBLISHER = 3,
  ORDERING_DISABLED_TEMPORARILY = 4,
  ASSET_UNLISTED = 5
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
  addAdditionalInformation: (additionalInformation: {
    // biome-ignore lint/suspicious/noExplicitAny: can be any user info
    [key: string]: any
  }) => IAssetBuilder
  setCopyrightHolder: (copyrightHolder: string) => IAssetBuilder
  addTags: (tags: string[]) => IAssetBuilder
  addLinks: (links: string[]) => IAssetBuilder
  setContentLanguage: (language: string) => IAssetBuilder
  addCategories: (categories: string[]) => IAssetBuilder
  addCredentialAddresses: (
    list: CredentialListTypes,
    addresses: string[]
  ) => IAssetBuilder
}

export interface IServiceBuilder<S extends ServiceTypes, F extends FileTypes>
  extends IBuilder<NautilusService<S, F>> {
  setName: (name: string) => IServiceBuilder<S, F>
  setTimeout: (timeout: number) => IServiceBuilder<S, F>
  setDescription: (description: string) => IServiceBuilder<S, F>
  setServiceEndpoint: (endpoint: string) => IServiceBuilder<S, F>
  addFile: (file: ServiceFileType<F>) => IServiceBuilder<S, F>
  addConsumerParameter: (parameter: ConsumerParameter) => IServiceBuilder<S, F>
  addTrustedAlgorithmPublisher: (publisher: string) => IServiceBuilder<S, F>
  addTrustedAlgorithms: (
    algorithms: PublisherTrustedAlgorithm[]
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
