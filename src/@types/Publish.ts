import {
  Credentials,
  DatatokenCreateParams,
  FreCreationParams,
  Metadata,
  NftCreateData,
  Service
} from '@oceanprotocol/lib'
import Web3 from 'web3'

export interface CredentialConfig extends Credentials {}

export interface MetadataConfig extends Omit<Metadata, 'created' | 'updated'> {}

// TODO consider type MetadataConfig = Omit<Metadata, "created" | "updated">;

type PricingType = 'fixed' | 'free'

interface PricingConfig {
  type: PricingType
  freCreationParams?: FreCreationParams
}

interface TokenParameters {
  nftParams: NftCreateData
  datatokenParams: DatatokenCreateParams
}

export interface AssetConfig {
  chainConfig: any // TODO create interface chain + provider + aquarius
  metadata: MetadataConfig
  services: Service[]
  web3: Web3
  pricing: PricingConfig
  tokenParamaters: TokenParameters
  servicesFiles: any[] // TODO use right type
}
