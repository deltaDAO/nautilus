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
import { CreateAssetConfig } from '../@types'
import { getAllPromisesOnArray } from '../utils'
import { Signer } from 'ethers'
import { sign } from 'crypto'

export { LogLevel } from '@oceanprotocol/lib'

/**
 * @class
 * Nautilus class
 */
export class Nautilus {
  private signer: Signer
  private config: Config

  private constructor(signer: Signer) {
    this.signer = signer
  }

  /**
   * Creates a new Nautilus instance
   */
  static async create(
    signer: Signer,
    config?: Partial<Config>
  ): Promise<Nautilus> {
    const instance = new Nautilus(signer)

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
    const chainId = await this.signer.getChainId()

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

  private getChainConfig(): Pick<CreateAssetConfig, 'signer' | 'chainConfig'> {
    if (!this.signer || !this.config)
      throw Error('Web3 and chainConfig are required.')

    return {
      signer: this.signer,
      chainConfig: this.config
    }
  }
  // #endregion

  // #region public functions
  getOceanConfig() {
    return this.config
  }

  async publish(asset: NautilusAsset) {
    const { signer, chainConfig } = this.getChainConfig()

    // --------------------------------------------------
    // 1. Create NFT if needed
    // --------------------------------------------------
    let { nftAddress } = asset.ddo

    if (!nftAddress) {
      const nftCreationResult = await createAsset({
        signer,
        chainConfig,
        nftParams: asset.getNftParams()
      })
      nftAddress = nftCreationResult.nftAddress.toString()
    }

    // --------------------------------------------------
    // 2. Create Datatokens and Pricing for new Services
    // --------------------------------------------------
    const services = await getAllPromisesOnArray(
      asset.ddo.services,
      async (service) => {
        const { datatokenAddress, pricingTransactionReceipt } =
          await createDatatokenAndPricing({
            signer,
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
    const ddo = await asset.ddo.getDDO({
      create: true,
      chainId: chainConfig.chainId,
      nftAddress
    })

    const setMetadataTxReceipt = await publishDDO({
      signer,
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

  // /**
  //  * @param accessConfig configuration object
  //  */
  // async access(accessConfig: Omit<AccessConfig, 'web3' | 'chainConfig'>) {
  //   return await access({
  //     ...accessConfig,
  //     ...this.getChainConfig()
  //   })
  // }

  // async compute(computeConfig: Omit<ComputeConfig, 'web3' | 'chainConfig'>) {
  //   return await compute({
  //     ...computeConfig,
  //     ...this.getChainConfig()
  //   })
  // }

  // async getComputeStatus(
  //   computeStatusConfig: Omit<ComputeStatusConfig, 'web3'>
  // ) {
  //   return await getStatus({
  //     ...computeStatusConfig,
  //     web3: this.web3
  //   })
  // }

  // async getComputeResult(
  //   computeResultConfig: Omit<ComputeResultConfig, 'web3'>
  // ) {
  //   return await retrieveResult({
  //     ...computeResultConfig,
  //     web3: this.web3
  //   })
  // }
  // #endregion
}
