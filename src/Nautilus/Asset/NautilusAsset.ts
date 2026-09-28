import type { NftCreateData } from '@oceanprotocol/lib'
import type { AssetState } from '../../@types/Nautilus.js'
import type { NftCreateDataWithoutOwner } from '../../@types/Publish.js'
import { nftInitialCreateData } from './constants/nft.constants.js'
import { NautilusDDO } from './NautilusDDO.js'

/**
 * A built asset: the DDO state, the NFT parameters, and who owns it.
 *
 * @internal produced by `AssetBuilder.build()` and consumed by `nautilus.publish()`.
 */
export class NautilusAsset {
  ddo: NautilusDDO
  nftCreateData: NftCreateDataWithoutOwner
  owner?: string
  lifecycleState?: AssetState

  constructor(ddo?: NautilusDDO) {
    this.ddo = ddo || new NautilusDDO()

    // Spread, do not alias. v1 assigned the shared module-level default object by
    // reference, so setNftTokenName() mutated the default for the whole process and the
    // next asset built in the same run inherited the previous asset's name.
    this.nftCreateData = { ...nftInitialCreateData }
  }

  getNftParams(owner?: string): NftCreateData {
    const resolved = owner || this.owner

    if (!resolved)
      throw new Error(
        'The asset has no owner. Call setOwner(), or publish with a signer whose address should own it.'
      )

    return { ...this.nftCreateData, owner: resolved }
  }
}
