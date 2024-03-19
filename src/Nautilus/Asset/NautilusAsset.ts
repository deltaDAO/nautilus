import type { NftCreateData } from '@oceanprotocol/lib'
import type { LifecycleStates } from '../../@types'
import type {
  NftCreateDataWithoutOwner,
  PricingConfig
} from '../../@types/Publish'
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
  ddo: NautilusDDO
  nftCreateData: NftCreateDataWithoutOwner
  owner: string
  lifecycleState: LifecycleStates

  constructor(ddo?: NautilusDDO) {
    if (ddo) {
      this.ddo = ddo
    } else {
      this.ddo = new NautilusDDO()
    }

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
