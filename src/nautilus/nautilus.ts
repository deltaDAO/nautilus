import { Config } from '@oceanprotocol/lib'
import Web3 from 'web3'
import { AssetConfig } from '../@types/Publish'
import { publishAsset } from '../publish'
import { NautilusAsset } from './asset/asset'

/* @internal */
export class Nautilus {
  config: Config
  web3: Web3

  getChainConfig(): Pick<AssetConfig, 'web3' | 'chainConfig'> {
    if (!this.web3 || !this.config)
      throw Error('Web3 and chainConfig are required.')

    return {
      web3: this.web3,
      chainConfig: this.config
    }
  }

  async publish(asset: NautilusAsset) {
    const config: AssetConfig = {
      ...asset.getConfig(),
      ...this.getChainConfig()
    }
    return await publishAsset(config)
  }
}
