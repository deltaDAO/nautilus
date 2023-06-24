import { NftCreateData, ZERO_ADDRESS } from '@oceanprotocol/lib'
import Web3 from 'web3'
import {
  DatatokenCreateParamsWithoutOwner,
  NftCreateDataWithoutOwner,
  PricingConfig
} from '../../@types/Publish'
import { NautilusDDO } from './NautilusDDO'
import { createData } from './constants/nft.constants'

export type PricingConfigWithoutOwner = {
  type: PricingConfig['type']
  freCreationParams?: Omit<PricingConfig['freCreationParams'], 'owner'>
}

/**
 * @internal
 */
export class NautilusAsset {
  ddo: NautilusDDO = new NautilusDDO()
  nftCreateData: NftCreateDataWithoutOwner
  owner: string

  constructor() {
    this.initNftData()
  }

  private initNftData() {
    this.nftCreateData = createData
  }

  getNftParams(): NftCreateData {
    return {
      ...this.nftCreateData,
      owner: this.owner
    }
  }
}
