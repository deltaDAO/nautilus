import { Config, ConfigHelper, LoggerInstance } from '@oceanprotocol/lib'
import Web3 from 'web3'
import { NautilusConfig } from '../@types/Nautilus'
import { AssetConfig } from '../@types/Publish'
import { publishAsset } from '../publish'
import { NautilusAsset } from './asset/asset'
import { AccessConfig } from '../@types/Access'
import { access } from '../access'

export class Nautilus {
  private web3: Web3
  private chainId: number
  private config: Config

  constructor(web3: Web3, chainId: number, config?: NautilusConfig) {
    this.web3 = web3
    this.chainId = chainId

    this.config = { ...this.loadOceanConfig(), chainId }

    if (config) this.config = { ...this.config, ...config }

    LoggerInstance.debug(this.config)
    if (!this.hasValidConfig()) {
      throw Error(
        'Could not initialize. No default config found for given chainId.'
      )
    }
  }

  logger = LoggerInstance

  private loadOceanConfig() {
    return new ConfigHelper().getConfig(this.chainId)
  }

  // TODO: check if additional props are required
  private hasValidConfig() {
    return (
      this.config.chainId > 0 &&
      this.config.metadataCacheUri?.length > 0 &&
      this.config.providerUri?.length > 0 &&
      this.config.nodeUri?.length > 0 &&
      this.config.subgraphUri?.length > 0 &&
      Web3.utils.isAddress(this.config.fixedRateExchangeAddress) &&
      Web3.utils.isAddress(this.config.dispenserAddress) &&
      Web3.utils.isAddress(this.config.nftFactoryAddress)
    )
  }

  private getChainConfig(): Pick<AssetConfig, 'web3' | 'chainConfig'> {
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

  async access(accessConfig: Omit<AccessConfig, 'web3' | 'chainConfig'>) {
    return await access({
      ...accessConfig,
      ...this.getChainConfig()
    })
  }
}
