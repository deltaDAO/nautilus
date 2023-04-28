import { Config, ConfigHelper, LoggerInstance } from '@oceanprotocol/lib'
import Web3 from 'web3'
import { AccessConfig } from '../@types/Access'
import { ComputeConfig } from '../@types/Compute'
import { AssetConfig } from '../@types/Publish'
import { access } from '../access'
import { compute } from '../compute'
import { publishAsset } from '../publish'
import { NautilusAsset } from './asset/NautilusAsset'

/**
 * Nautilus class
 */
export class Nautilus {
  private web3: Web3
  private config: Config

  private constructor(web3: Web3) {
    this.web3 = web3
  }

  logger = LoggerInstance

  /**
   * Creates a new Nautilus instance
   * @param web3 Web3 instance to use with Nautilus
   * @param config Optional OceanConfig
   * @returns {Nautilus} created instance
   */
  static async create(web3: Web3, config?: Partial<Config>) {
    const instance = new Nautilus(web3)

    await instance.init(config)

    return instance
  }

  // #region private helpers
  private async init(config?: Partial<Config>) {
    await this.loadOceanConfig(config)
  }

  private async loadOceanConfig(config?: Partial<Config>) {
    const chainId = await this.web3.eth.getChainId()

    const oceanConfig = new ConfigHelper().getConfig(chainId)
    if (!oceanConfig)
      LoggerInstance.debug('No default config found for given chainId')

    this.config = {
      ...oceanConfig,
      // overwrite user defined properties
      ...config
    }

    // TODO: improve error message
    if (!this.hasValidConfig()) {
      throw Error('Cannot initialize using the given config & web3.')
    }
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
  // #endregion

  // #region public functions
  async publish(asset: NautilusAsset) {
    return await publishAsset({
      ...asset.getConfig(),
      ...this.getChainConfig()
    })
  }

  async access(accessConfig: Omit<AccessConfig, 'web3' | 'chainConfig'>) {
    return await access({
      ...accessConfig,
      ...this.getChainConfig()
    })
  }

  async compute(computeConfig: Omit<ComputeConfig, 'web3' | 'chainConfig'>) {
    return await compute({
      ...computeConfig,
      ...this.getChainConfig()
    })
  }
  // #endregion
}
