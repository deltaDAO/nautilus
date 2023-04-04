import { ZERO_ADDRESS } from '@oceanprotocol/lib'
import {
  AssetConfig,
  MetadataConfig,
  PricingConfig,
  ServiceConfig,
  TokenParameters
} from '../../@types/Publish'

/* @internal */
export class NautilusAsset {
  metadata: MetadataConfig
  services: ServiceConfig[] = []
  pricing: PricingConfig
  tokenParamaters: TokenParameters = {
    nftParams: undefined,
    datatokenParams: undefined
  }

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
    this.tokenParamaters.nftParams = {
      name: 'Dataservice NFT',
      symbol: 'DNFT',
      templateIndex: 1,
      tokenURI: '',
      transferable: false,
      owner: ZERO_ADDRESS
    }
  }

  private initDatatokenData() {
    this.tokenParamaters.datatokenParams = {
      name: 'Datatoken',
      symbol: 'DT',
      templateIndex: 2, // TODO: decide on default (1 or 2)
      cap: '100000',
      feeAmount: '0',
      paymentCollector: ZERO_ADDRESS,
      minter: ZERO_ADDRESS,
      mpFeeAddress: ZERO_ADDRESS,
      feeToken: ZERO_ADDRESS
    }
  }

  getConfig(): Omit<AssetConfig, 'web3' | 'chainConfig'> {
    if (
      !this.metadata ||
      this.services.length < 1 ||
      !this.pricing ||
      !this.tokenParamaters.datatokenParams ||
      !this.tokenParamaters.nftParams
    )
      throw new Error(
        'Metadata, Services, Pricing and TokenParameters are required.'
      )

    return {
      metadata: this.metadata,
      services: this.services,
      pricing: this.pricing,
      tokenParamaters: this.tokenParamaters
    }
  }
}
