import { ComputeAlgorithm, ComputeAsset } from '@oceanprotocol/lib'
import { AssetWithAccessDetails } from '../../@types/Compute'

export class NautilusComputeJob {
  dataset: ComputeAsset
  alogirthm: ComputeAlgorithm
  additionalDatasets: ComputeAsset[]
}
