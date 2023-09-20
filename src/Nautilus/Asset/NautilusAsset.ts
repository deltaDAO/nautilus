import { Nft, NftCreateData } from '@oceanprotocol/lib'
import { NftCreateDataWithoutOwner, PricingConfig } from '../../@types/Publish'
import { NautilusDDO } from './NautilusDDO'
import { nftInitialCreateData } from './constants/nft.constants'
import { LifecycleStates } from '../../@types'
import { Signer } from 'ethers'

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

  public static async setLifecycleState(
    signer: Signer,
    nftAddress: string,
    publisherAccount: string,
    state: LifecycleStates
  ) {
    const nft = new Nft(signer)

    const stateTxReceipt = await nft.setMetadataState(
      nftAddress,
      publisherAccount,
      state
    )
    const stateTx = await stateTxReceipt.wait()

    return stateTx
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
