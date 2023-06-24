import {
  Config,
  Credentials,
  DatatokenCreateParams,
  DDO,
  Files,
  FreCreationParams,
  Metadata,
  MetadataAlgorithm,
  NftCreateData,
  Service
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { NautilusConsumerParameter } from '../Nautilus/Asset/ConsumerParameters'
import { NautilusDDO } from '../Nautilus/Asset/NautilusDDO'
import {
  FileTypes,
  NautilusService,
  PricingConfigWithoutOwner,
  ServiceTypes
} from '../Nautilus'

export interface CredentialConfig extends Credentials {}

export type ConsumerParameterType = 'text' | 'number' | 'boolean' | 'select'

export type ConsumerParameterSelectOption = {
  [value: string]: string
}
export interface ConsumerParameter {
  name: string
  type: ConsumerParameterType
  label: string
  required: boolean
  description: string
  default: string
  options?: ConsumerParameterSelectOption[]
}

export type MetadataConfig = Omit<
  Metadata,
  'created' | 'updated' | 'algorithm'
> & {
  algorithm?: MetadataAlgorithm & {
    consumerParameters?: NautilusConsumerParameter[]
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

export interface CreateAssetComfig {
  chainConfig: Config
  web3: Web3
  nftParams: NftCreateData
}

export interface CreateDatatokenConfig {
  chainConfig: Config
  nftAddress: string
  web3: Web3
  pricing: PricingConfig
  datatokenParams: DatatokenCreateParams
}

export interface PublishDDOConfig {
  chainConfig: Config
  web3: Web3
  ddo: DDO
}
