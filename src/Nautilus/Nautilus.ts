import {
  Config,
  ConfigHelper,
  LogLevel,
  LoggerInstance
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { AccessConfig } from '../@types/Access'
import {
  ComputeConfig,
  ComputeResultConfig,
  ComputeStatusConfig
} from '../@types/Compute'
import { access } from '../access'
import { compute, getStatus, retrieveResult } from '../compute'
import { createAsset, createDatatokenAndPricing, publishDDO } from '../publish'
import { NautilusAsset } from './Asset/NautilusAsset'
import { CreateAssetComfig } from '../@types'
import { getAllPromisesOnArray } from '../utils'

export { LogLevel } from '@oceanprotocol/lib'

/**
 * @class
 * Nautilus class
 */
export class Nautilus {
  private web3: Web3
  private config: Config

  private constructor(web3: Web3) {
    this.web3 = web3
  }

  /**
   * Creates a new Nautilus instance
   */
  static async create(web3: Web3, config?: Partial<Config>): Promise<Nautilus> {
    const instance = new Nautilus(web3)

    await instance.init(config)

    return instance
  }

  /**
   * Set the log level for Nautilus
   * ocean.js LoggerInstance is used for logging
   */
  static setLogLevel(level: LogLevel) {
    LoggerInstance.setLevel(level)
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
      LoggerInstance.error({
        config: this.config
      })
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

  private getChainConfig(): Pick<CreateAssetComfig, 'web3' | 'chainConfig'> {
    if (!this.web3 || !this.config)
      throw Error('Web3 and chainConfig are required.')

    return {
      web3: this.web3,
      chainConfig: this.config
    }
  }
  // #endregion

  // #region public functions
  getOceanConfig() {
    return this.config
  }

  async publish(asset: NautilusAsset) {
    const { web3, chainConfig } = this.getChainConfig()

    // --------------------------------------------------
    // 1. Create NFT
    // --------------------------------------------------
    const { nftAddress } = await createAsset({
      web3,
      chainConfig,
      nftParams: asset.getNftParams()
    })

    // --------------------------------------------------
    // 2. Create Datatokens and Pricing for all Services
    // --------------------------------------------------
    const services = await getAllPromisesOnArray(
      asset.ddo.services,
      async (service) => {
        const { datatokenAddress, pricingTransactionReceipt } =
          await createDatatokenAndPricing({
            web3,
            chainConfig,
            nftAddress,
            pricing: {
              ...service.pricing,
              freCreationParams: {
                ...service.pricing.freCreationParams,
                owner: asset.owner
              }
            },
            datatokenParams: {
              ...service.datatokenCreateParams,
              minter: asset.owner,
              paymentCollector: asset.owner
            }
          })

        service.datatokenAddress = datatokenAddress

        return { service, datatokenAddress, pricingTransactionReceipt }
      }
    )

    // --------------------------------------------------
    // 3. Create the DDO and publish it on NFT
    // --------------------------------------------------
    const ddo = await asset.ddo.getDDO(true, chainConfig.chainId, nftAddress)

    const setMetadataTxReceipt = await publishDDO({
      web3,
      chainConfig,
      ddo
    })

    return {
      nftAddress,
      services,
      ddo,
      setMetadataTxReceipt
    }
  }

  /**
   * @param accessConfig configuration object
   */
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

  async getComputeStatus(
    computeStatusConfig: Omit<ComputeStatusConfig, 'web3'>
  ) {
    return await getStatus({
      ...computeStatusConfig,
      web3: this.web3
    })
  }

  async getComputeResult(
    computeResultConfig: Omit<ComputeResultConfig, 'web3'>
  ) {
    return await retrieveResult({
      ...computeResultConfig,
      web3: this.web3
    })
  }
  // #endregion
}
