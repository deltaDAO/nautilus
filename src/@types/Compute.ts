import {
  Asset,
  ComputeAlgorithm,
  ComputeAsset,
  Config,
  ProviderFees
} from '@oceanprotocol/lib'
import Web3 from 'web3'

export interface DidAndServiceId {
  did: string
  serviceId?: string
}
export interface ComputeConfigOptions {
  datasetServiceParams?: ComputeAsset['userdata']
  algorithmServiceParams?: ComputeAlgorithm['userdata']
  algocustomdata?: ComputeAlgorithm['algocustomdata']
}

export interface ComputeConfig {
  datasetDid: DidAndServiceId
  algorithmDid: DidAndServiceId
  web3: Web3
  config: Config
  additionalDatasetDids?: DidAndServiceId[]
  options?: ComputeConfigOptions
}

export interface ComputeResultConfig {
  jobId: string
  web3: Web3
  config: Config
  resultIndex?: number
}

export interface TokenInfo {
  address: string
  name: string
  symbol: string
  decimals?: number
}

export interface AccessDetails {
  type: 'fixed' | 'free' | 'NOT_SUPPORTED'
  price: string
  templateId: number
  addressOrId: string
  baseToken: TokenInfo
  datatoken: TokenInfo
  isPurchasable?: boolean
  isOwned: boolean
  validOrderTx: string
  publisherMarketOrderFee: string
}

export interface OrderPriceAndFees {
  price: string
  publisherMarketOrderFee: string
  consumeMarketOrderFee: string
  providerFee: ProviderFees
  opcFee: string
}

export interface AssetWithAccessDetails extends Asset {
  accessDetails: AccessDetails
}

export interface AssetWithAccessDetailsAndPrice extends AssetWithAccessDetails {
  orderPriceAndFees: OrderPriceAndFees
}
