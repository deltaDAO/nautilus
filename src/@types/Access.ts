import type { Config, UserCustomParameters } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'

/**
 * The config type for {@link index.access} requests
 */
export interface AccessConfig {
  assetDid: string
  signer: Signer
  chainConfig: Config
  serviceId?: string
  fileIndex?: number
  userdata?: UserCustomParameters
}
