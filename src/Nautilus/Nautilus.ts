import {
  Asset,
  Config,
  ConfigHelper,
  LogLevel,
  LoggerInstance,
  Nft
} from '@oceanprotocol/lib'
import { Signer, utils as ethersUtils } from 'ethers'
import {
  AccessConfig,
  ComputeConfig,
  ComputeResultConfig,
  ComputeStatusConfig,
  CreateAssetConfig,
  LifecycleStates,
  PublishResponse,
  StopComputeConfig
} from '../@types'
import {
  createAsset,
  createServiceWithDatatokenAndPricing,
  publishDDO
} from '../publish'
import { getAllPromisesOnArray } from '../utils'
import { NautilusAsset } from './Asset/NautilusAsset'
import { access } from '../access'
import { compute, computeStop, getStatus, retrieveResult } from '../compute'
import { FileTypes, NautilusService, ServiceTypes } from './Asset'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import { resolvePublisherTrustedAlgorithms } from '../utils/helpers/trusted-algorithms'
import { getAsset, getAssets } from '../utils/aquarius'
import { editPrice } from '../utils/contracts'
import { stopComputeJob } from '../utils/provider'

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
    LoggerInstance.debug(
      'Creating new Nautilus instance with signer',
      await signer.getAddress()
    )
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
      ethersUtils.isAddress(this.config.fixedRateExchangeAddress) &&
      ethersUtils.isAddress(this.config.dispenserAddress) &&
      ethersUtils.isAddress(this.config.nftFactoryAddress)
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

  async publish(asset: NautilusAsset): Promise<PublishResponse> {
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
    // 2. resolve publisher trusted algorithm checksums
    // --------------------------------------------------

    await resolvePublisherTrustedAlgorithms(
      asset.ddo.services,
      chainConfig.metadataCacheUri
    )

    // --------------------------------------------------
    // 3. Create Datatokens and Pricing for new Services
    // --------------------------------------------------
    const services = await getAllPromisesOnArray(
      asset.ddo.services,
      async (service) => {
        return createServiceWithDatatokenAndPricing(
          service,
          signer,
          chainConfig,
          nftAddress,
          asset.owner
        )
      }
    )

    // --------------------------------------------------
    // 4. Create the DDO and publish it on NFT
    // --------------------------------------------------
    const ddo = await asset.ddo.getDDO({
      create: true,
      chainId: chainConfig.chainId,
      nftAddress
    })

    const setMetadataTxReceipt = await publishDDO({
      signer,
      chainConfig,
      ddo,
      asset
    })

    return {
      nftAddress,
      services,
      ddo,
      setMetadataTxReceipt
    }
  }

  async edit(asset: NautilusAsset): Promise<PublishResponse> {
    const { signer, chainConfig } = this.getChainConfig()
    const { nftAddress, services: nautilusDDOServices } = asset.ddo

    let services: {
      service: NautilusService<ServiceTypes, FileTypes>
      datatokenAddress: string
      tx: TransactionReceipt
    }[]

    await resolvePublisherTrustedAlgorithms(
      nautilusDDOServices,
      chainConfig.metadataCacheUri
    )

    // This includes fresh published services
    const changedPriceServices = nautilusDDOServices.filter(
      (nautilusService) => nautilusService.pricing
    )

    // TODO check if service prices can be changed via datatoken replacement (currently buggy could be a caching problem)
    if (changedPriceServices.length > 0) {
      services = await getAllPromisesOnArray(
        changedPriceServices,
        async (service) => {
          return createServiceWithDatatokenAndPricing(
            service,
            signer,
            chainConfig,
            nftAddress,
            asset.owner
          )
        }
      )
    }

    const ddo = await asset.ddo.getDDO({
      create: false,
      chainId: chainConfig.chainId,
      nftAddress
    })

    const setMetadataTxReceipt = await publishDDO({
      signer,
      chainConfig,
      ddo,
      asset
    })

    return {
      nftAddress,
      services,
      ddo,
      setMetadataTxReceipt
    }
  }

  async setServicePrice(
    aquaAsset: Asset,
    serviceId: string,
    newPrice: string
  ): Promise<TransactionReceipt> {
    if (typeof newPrice !== 'string' || isNaN(parseFloat(newPrice))) {
      throw new Error('newPrice must be a numeric string')
    }

    return await editPrice(
      aquaAsset,
      serviceId,
      newPrice,
      this.config,
      this.signer
    )
  }

  async getAquariusAssets(dids: string[]): Promise<{ [did: string]: Asset }> {
    try {
      return await getAssets(this.config.metadataCacheUri, dids)
    } catch (error) {
      throw new Error(`getAquariusAssets failed: ${error}`)
    }
  }

  async getAquariusAsset(did: string): Promise<Asset> {
    try {
      return await getAsset(this.config.metadataCacheUri, did)
    } catch (error) {
      throw new Error(`getAquariusAsset failed: ${error}`)
    }
  }

  async setAssetLifecycleState(aquariusAsset: Asset, state: LifecycleStates) {
    const { signer } = this.getChainConfig()
    const address = await signer.getAddress()
    const nft = new Nft(signer)
    const existingNftState = aquariusAsset.nft.state

    if (existingNftState === state) {
      LoggerInstance.warn(
        `[lifecycle] Asset lifecycle state is already ${state} (${LifecycleStates[state]}), action aborted`
      )
      return
    }
    LoggerInstance.debug(
      `[lifecycle] Change asset lifecycle state from ${existingNftState} (${LifecycleStates[existingNftState]}) to ${state} (${LifecycleStates[state]}) `
    )

    const stateTxReceipt = await nft.setMetadataState(
      aquariusAsset.nft.address,
      address,
      state
    )
    const stateTx = await stateTxReceipt.wait()

    return stateTx
  }

  /**
   * @param accessConfig configuration object
   */
  async access(accessConfig: Omit<AccessConfig, 'signer' | 'chainConfig'>) {
    return await access({
      ...accessConfig,
      ...this.getChainConfig()
    })
  }

  async compute(computeConfig: Omit<ComputeConfig, 'signer' | 'chainConfig'>) {
    return await compute({
      ...computeConfig,
      ...this.getChainConfig()
    })
  }

  async getComputeStatus(
    computeStatusConfig: Omit<ComputeStatusConfig, 'signer'>
  ) {
    return await getStatus({
      ...computeStatusConfig,
      signer: this.signer
    })
  }

  async getComputeResult(
    computeResultConfig: Omit<ComputeResultConfig, 'signer'>
  ) {
    return await retrieveResult({
      ...computeResultConfig,
      signer: this.signer
    })
  }

  async computeStop(computeStatusConfig: Omit<StopComputeConfig, 'signer'>) {
    return await computeStop({
      ...computeStatusConfig,
      signer: this.signer
    })
  }
  // #endregion
}
