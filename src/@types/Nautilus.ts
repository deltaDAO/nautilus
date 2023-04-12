import { Config, Metadata } from '@oceanprotocol/lib'
import { NautilusAsset } from '../nautilus/asset/asset'
import {
  DatatokenCreateParamsWithoutOwner,
  NftCreateDataWithoutOwner,
  PricingConfig,
  ServiceConfig
} from './Publish'

// TODO: check if all required configs are covered
export type NautilusConfig = Omit<Config, 'chainId'>

export interface NautilusOptions {
  skipDefaultConfig: boolean
}

export interface IBuilder<T> {
  build: () => T
  reset: () => void
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
  addAdditionalInformation: (addtionalInformation: {
    [key: string]: any
  }) => IAssetBuilder
}
