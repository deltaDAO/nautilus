import {
  Config,
  Credentials,
  DatatokenCreateParams,
  DDO,
  Files,
  FreCreationParams,
  Metadata,
  NftCreateData,
  Service
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import {
  ConsumerParameterType,
  NautilusConsumerParameter
} from '../nautilus/asset/consumerParameters/consumerParameter'

export interface CredentialConfig extends Credentials {}

export type MetadataConfig = Omit<Metadata, 'created' | 'updated'>

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
  'id' | 'datatokenAddress' | 'files'
> & {
  files: Files['files']
  consumerParameters?: NautilusConsumerParameter<ConsumerParameterType>[]
}

export type PrePublishDDO = Omit<DDO, 'services'> & {
  services: ServiceConfig[]
}

export interface AssetConfig {
  chainConfig: Config
  metadata: MetadataConfig
  services: ServiceConfig[]
  web3: Web3
  pricing: PricingConfig
  tokenParamaters: TokenParameters
}
