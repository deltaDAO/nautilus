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

  private requestedLifecycleState?: AssetState
  private lifecycleStateRequested = false

  /**
   * The lifecycle state to write: one set with `setLifecycleState()` (or assigned here), or
   * the indexed state of the asset an `AssetBuilder` was constructed with.
   */
  get lifecycleState(): AssetState | undefined {
    return this.requestedLifecycleState
  }

  set lifecycleState(state: AssetState | undefined) {
    this.requestedLifecycleState = state
    this.lifecycleStateRequested = state !== undefined
  }

  /**
   * Whether `lifecycleState` was set explicitly rather than taken over from the indexed
   * DDO. `edit()` writes an inherited state as the NFT has it on chain at the time of the
   * write, so a fetched copy that predates a `setAssetLifecycleState()` does not undo it.
   */
  get hasRequestedLifecycleState(): boolean {
    return this.lifecycleStateRequested
  }

  /**
   * Takes over the state of the asset being edited, without counting as a request.
   *
   * @internal used by `AssetBuilder`.
   */
  inheritLifecycleState(state: AssetState | undefined): void {
    this.requestedLifecycleState = state
    this.lifecycleStateRequested = false
  }

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
