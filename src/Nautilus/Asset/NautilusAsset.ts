import { ZERO_ADDRESS } from '@oceanprotocol/lib'
import Web3 from 'web3'
import {
  AssetConfig,
  DatatokenCreateParamsWithoutOwner,
  MetadataConfig,
  NftCreateDataWithoutOwner,
  PricingConfig
} from '../../@types/Publish'
import { params } from './constants/datatoken.constants'
import { createData } from './constants/nft.constants'
import { FileTypes, NautilusService, ServiceTypes } from './Service'

export type PricingConfigWithoutOwner = {
  type: PricingConfig['type']
  freCreationParams?: Omit<PricingConfig['freCreationParams'], 'owner'>
}

/* @internal */
export class NautilusAsset {
  metadata: MetadataConfig
  services: NautilusService<ServiceTypes, FileTypes>[] = []
  pricing: PricingConfigWithoutOwner
  nftCreateData: NftCreateDataWithoutOwner
  datatokenCreateParams: DatatokenCreateParamsWithoutOwner
  owner: string

  constructor() {
    this.initMetadata()
    this.initPricing()
    this.initNftData()
    this.initDatatokenData()
  }

  private initMetadata() {
    this.metadata = {
      type: 'dataset',
      name: '',
      description: '',
      author: '',
      license: 'MIT'
    }
  }

  private initPricing() {
    this.pricing = {
      type: 'free'
    }
  }

  private initNftData() {
    this.nftCreateData = createData
  }

  private initDatatokenData() {
    this.datatokenCreateParams = params
  }

  async getConfig(): Promise<Omit<AssetConfig, 'web3' | 'chainConfig'>> {
    if (this.services?.length < 1)
      throw new Error('At least one service needs to be defined.')

    if (!this.hasValidPricing()) throw new Error('Pricing Schema is invalid.')

    if (
      !this.owner ||
      this.owner === ZERO_ADDRESS ||
      !Web3.utils.isAddress(this.owner)
    )
      throw new Error('Owner needs to be a valid address')

    const services = await Promise.all(
      this.services.map((service) => service.getConfig())
    )

    return {
      metadata: {
        ...this.metadata,
        algorithm: this.metadata.algorithm
          ? {
              ...this.metadata.algorithm,
              consumerParameters:
                this.metadata.algorithm?.consumerParameters?.map((param) =>
                  param.getConfig()
                )
            }
          : undefined
      },
      services,
      pricing: {
        ...this.pricing,
        freCreationParams: {
          ...this.pricing.freCreationParams,
          owner: this.owner
        }
      },
      tokenParamaters: {
        nftParams: {
          ...this.nftCreateData,
          owner: this.owner
        },
        datatokenParams: {
          ...this.datatokenCreateParams,
          minter: this.owner,
          paymentCollector: this.owner
        }
      }
    }
  }

  private hasValidPricing() {
    return (
      ['free', 'fixed'].includes(this.pricing?.type) &&
      (this.pricing?.type === 'fixed'
        ? Web3.utils.isAddress(
            this.pricing.freCreationParams?.baseTokenAddress
          ) &&
          this.pricing.freCreationParams?.baseTokenDecimals > 0 &&
          this.pricing.freCreationParams?.datatokenDecimals > 0 &&
          Number(this.pricing.freCreationParams?.fixedRate) > 0 &&
          Web3.utils.isAddress(
            this.pricing.freCreationParams?.fixedRateAddress
          ) &&
          this.pricing.freCreationParams?.marketFee?.length > 0 &&
          Web3.utils.isAddress(
            this.pricing.freCreationParams?.marketFeeCollector
          )
        : true)
    )
  }
}
