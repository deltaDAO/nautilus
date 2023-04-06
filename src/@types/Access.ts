import { Config, UserCustomParameters } from '@oceanprotocol/lib'
import Web3 from 'web3'

export interface AccessConfig {
  assetDid: string
  web3: Web3
  config: Config
  fileIndex?: number
  userdata?: UserCustomParameters
}
