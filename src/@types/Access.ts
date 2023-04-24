import { Config, UserCustomParameters } from '@oceanprotocol/lib'
import Web3 from 'web3'

/**
 * The config type for {@link index.access} requests
 */
export interface AccessConfig {
  assetDid: string
  web3: Web3
  chainConfig: Config
  fileIndex?: number
  userdata?: UserCustomParameters
}
