import { Asset, ProviderFees } from '@oceanprotocol/lib'
import Web3 from 'web3'

export interface ComputeConfigOptions {
  datasetServiceParams?: any
  algorithmServiceParams?: any
  algoCustomData?: any
}

export interface ComputeConfig {
  datasetDid: string
  algorithmDid: string
  web3: Web3
  options?: ComputeConfigOptions
}

export interface ComputeResultConfig {
  jobId: string
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

export interface AssetWithAccessDetails extends Asset {
  accessDetails: AccessDetails
}

export interface OrderPriceAndFees {
  price: string
  publisherMarketOrderFee: string
  consumeMarketOrderFee: string
  providerFee: ProviderFees
  opcFee: string
}
