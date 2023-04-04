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

export interface CredentialConfig extends Credentials {}

export type MetadataConfig = Omit<Metadata, 'created' | 'updated'>

type PricingType = 'fixed' | 'free'

export interface PricingConfig {
  type: PricingType
  freCreationParams?: FreCreationParams
}

export interface TokenParameters {
  nftParams: NftCreateData
  datatokenParams: DatatokenCreateParams
}

export type ServiceConfig = Omit<
  Service,
  'id' | 'datatokenAddress' | 'files'
> & {
  files: Files['files']
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
