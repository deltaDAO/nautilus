import {
  Config,
  DatatokenCreateParams,
  DDO,
  Files,
  FreCreationParams,
  Metadata,
  MetadataAlgorithm,
  NftCreateData,
  Service
} from '@oceanprotocol/lib'
import { Signer } from 'ethers'
import { PricingConfigWithoutOwner } from '../Nautilus'
import { NautilusConsumerParameter } from '../Nautilus/Asset/ConsumerParameters'

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
}
