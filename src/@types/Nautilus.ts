import {
  Config,
  DatatokenCreateParams,
  Metadata,
  NftCreateData
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { NautilusAsset } from '../nautilus/asset/asset'
import { Nautilus } from '../nautilus/nautilus'
import {
  DatatokenCreateParamsWithoutOwner,
  NftCreateDataWithoutOwner,
  PricingConfig,
  ServiceConfig
} from './Publish'

export interface IBuilder<T> {
  build: () => T
  reset: () => void
}
export interface INautilusBuilder extends IBuilder<Nautilus> {
  setConfig: (chainId: number, config?: Config) => INautilusBuilder
  setWeb3: (web3: Web3) => INautilusBuilder
}

export interface IAssetBuilder extends IBuilder<NautilusAsset> {
  setType: (type: Metadata['type']) => IAssetBuilder
  setName: (name: Metadata['name']) => IAssetBuilder
  setDescription: (description: Metadata['description']) => IAssetBuilder
  setLicense: (license: Metadata['license']) => IAssetBuilder
  setAuthor: (author: Metadata['author']) => IAssetBuilder
  setPricing: (pricing: PricingConfig) => IAssetBuilder
  addService: (service: ServiceConfig) => IAssetBuilder
  setNftData: (nftCreateData: NftCreateDataWithoutOwner) => IAssetBuilder
  setDatatokenData: (
    datatokenCreateData: DatatokenCreateParamsWithoutOwner
  ) => IAssetBuilder
  setAlgorithm: (algorithm: Metadata['algorithm']) => IAssetBuilder
  setOwner: (owner: string) => IAssetBuilder
  setDatatokenNameAndSymbol: (dtName: string, dtSymbol: string) => IAssetBuilder
}
