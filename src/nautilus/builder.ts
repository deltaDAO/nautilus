import { Config, ConfigHelper, LoggerInstance } from '@oceanprotocol/lib'
import Web3 from 'web3'
import { INautilusBuilder } from '../@types/Nautilus'
import { Nautilus } from './nautilus'

export class NautilusBuilder implements INautilusBuilder {
  private nautilus: Nautilus = new Nautilus()

  setConfig(chainId: number, config?: Config, infuraProjectId?: string) {
    if (config) this.nautilus.config = { ...config, chainId }
    else {
      this.nautilus.config = new ConfigHelper().getConfig(
        chainId,
        infuraProjectId
      )
    }

    LoggerInstance.debug('Setting chain config', config)

    return this
  }

  setWeb3(web3: Web3) {
    this.nautilus.web3 = web3

    LoggerInstance.debug('Setting Web3', web3.currentProvider)

    return this
  }

  reset() {
    this.nautilus = new Nautilus()
  }

  build() {
    return this.nautilus
  }
}
