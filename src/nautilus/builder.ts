import { Config } from '@oceanprotocol/lib'
import Web3 from 'web3'
import { INautilusBuilder } from '../@types/Nautilus'
import { Nautilus } from './nautilus'

/* @internal */
export class NautilusBuilder implements INautilusBuilder {
  private nautilus: Nautilus

  setConfig(config: Config) {
    this.nautilus.config = config

    return this
  }

  setWeb3(web3: Web3) {
    this.nautilus.web3 = web3

    return this
  }

  reset() {
    this.nautilus = new Nautilus()
  }
}
