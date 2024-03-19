import type {
  Config,
  ConsumerParameter,
  DDO,
  DatatokenCreateParams,
  Files,
  FreCreationParams,
  Metadata,
  MetadataAlgorithm,
  NftCreateData,
  Service
} from '@oceanprotocol/lib'
import type { Signer, providers } from 'ethers'
import type {
  FileTypes,
  NautilusAsset,
  NautilusService,
  PricingConfigWithoutOwner,
  ServiceTypes
} from '../Nautilus'

export type ConsumerParameterSelectOption = {
  [value: string]: string
}

export type MetadataConfig = Omit<
  Metadata,
  'created' | 'updated' | 'algorithm'
> & {
  algorithm?: MetadataAlgorithm & {
    consumerParameters?: ConsumerParameter[]
  }
}

type PricingType = 'fixed' | 'free'

export interface PricingConfig {
  type: PricingType
  freCreationParams?: FreCreationParams
}

export type DatatokenCreateParamsWithoutOwner = Omit<
  DatatokenCreateParams,
  'paymentCollector' | 'minter'
>

export type NftCreateDataWithoutOwner = Omit<NftCreateData, 'owner'>

export interface TokenParameters {
  nftParams: NftCreateData
  datatokenParams: DatatokenCreateParams
}

export type ServiceConfig = Omit<
  Service,
  'files' | 'id' | 'datatokenAddress'
> & {
  pricing: PricingConfigWithoutOwner
  datatokenCreateParams: DatatokenCreateParamsWithoutOwner
  files: Files['files']
  consumerParameters?: ConsumerParameter[]
}

export type PrePublishDDO = Omit<DDO, 'services'> & {
  services: ServiceConfig[]
}

export interface CreateAssetConfig {
  chainConfig: Config
  signer: Signer
  nftParams: NftCreateData
}

export interface CreateDatatokenConfig {
  chainConfig: Config
  nftAddress: string
  signer: Signer
  pricing: PricingConfig
  datatokenParams: DatatokenCreateParams
}

export interface PublishDDOConfig {
  chainConfig: Config
  signer: Signer
  ddo: DDO
  asset?: NautilusAsset
}

export interface PublishResponse {
  nftAddress: string
  services: {
    service: NautilusService<ServiceTypes, FileTypes>
    datatokenAddress: string
    tx: providers.TransactionReceipt
  }[]
  ddo: DDO
  setMetadataTxReceipt: providers.TransactionReceipt
}

export type TrustedAlgorithmAsset = {
  did: string
  serviceIds?: string[]
}
