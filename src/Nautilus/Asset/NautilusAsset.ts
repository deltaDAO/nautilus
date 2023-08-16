import { Credentials, NftCreateData } from '@oceanprotocol/lib'
import { NftCreateDataWithoutOwner, PricingConfig } from '../../@types/Publish'
import { NautilusDDO } from './NautilusDDO'
import { nftInitialCreateData } from './constants/nft.constants'

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
  credentials: Credentials = {
    allow: [],
    deny: []
  }

  constructor() {
    this.initNftData()
  }

  private initNftData() {
    this.nftCreateData = nftInitialCreateData
  }

  getNftParams(): NftCreateData {
    return {
      ...this.nftCreateData,
      owner: this.owner
    }
  }
}
