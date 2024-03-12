import { Asset, Config, ProviderFees } from '@oceanprotocol/lib'
import { Signer } from 'ethers'

export interface ComputeAsset {
  did: string
  serviceId?: string
  userdata?: {
    [key: string]: any
  }
}

export interface ComputeAlgorithm extends ComputeAsset {
  algocustomdata?: {
    [key: string]: any
  }
}

export interface ComputeConfig {
  dataset: ComputeAsset
  algorithm: ComputeAlgorithm
  signer: Signer
  chainConfig: Config
  additionalDatasets?: ComputeAsset[]
}

export interface ComputeStatusConfig {
  jobId: string
  providerUri: string
  signer: Signer
}

export interface ComputeResultConfig extends ComputeStatusConfig {
  resultIndex?: number
}

export interface StopComputeConfig {
  did: string
  jobId: string
  providerUri: string
  signer: Signer
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
