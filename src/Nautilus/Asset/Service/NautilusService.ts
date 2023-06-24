import {
  Arweave,
  GraphqlQuery,
  Ipfs,
  LoggerInstance,
  ProviderInstance,
  Service,
  ServiceComputeOptions,
  Smartcontract,
  UrlFile,
  getHash
} from '@oceanprotocol/lib'
import {
  DatatokenCreateParamsWithoutOwner,
  ServiceConfig
} from '../../../@types/Publish'
import { getEncryptedFiles, getFileInfo } from '../../../utils/provider'
import { NautilusConsumerParameter } from '../ConsumerParameters'
import { PricingConfigWithoutOwner } from '../NautilusAsset'
import { params as DatatokenConstantParams } from '../constants/datatoken.constants'
import Web3 from 'web3'

export {
  Arweave,
  GraphqlQuery,
  Ipfs,
  Smartcontract,
  UrlFile
} from '@oceanprotocol/lib'

export enum FileTypes {
  URL = 'url',
  GRAPHQL = 'graphql',
  ARWEAVE = 'arweave',
  IPFS = 'ipfs',
  SMARTCONTRACT = 'smartcontract'
}

export enum ServiceTypes {
  ACCESS = 'access',
  COMPUTE = 'compute'
}

export type ServiceFileType<FileType extends FileTypes> =
  FileType extends FileTypes.GRAPHQL
    ? GraphqlQuery
    : FileType extends FileTypes.ARWEAVE
    ? Arweave
    : FileType extends FileTypes.SMARTCONTRACT
    ? Smartcontract
    : FileType extends FileTypes.IPFS
    ? Ipfs
    : UrlFile

export type ConsumerParameterSelectOption = {
  [value: string]: string
}

/**
 * @internal
 */
export class NautilusService<
  ServiceType extends ServiceTypes,
  FileType extends FileTypes
> {
  type: ServiceType
  serviceEndpoint: string
  timeout: number
  files: ServiceFileType<FileType>[] = []

  pricing: PricingConfigWithoutOwner
  datatokenCreateParams: DatatokenCreateParamsWithoutOwner

  name?: string
  description?: string

  compute?: ServiceComputeOptions

  consumerParameters?: NautilusConsumerParameter[] = []
  additionalInformation?: { [key: string]: any } = {}

  id?: string
  datatokenAddress?: string

  constructor() {
    this.initDatatokenData()
    this.initPricing()
  }

  private initPricing() {
    this.pricing = {
      type: 'free'
    }
  }

  private initDatatokenData() {
    this.datatokenCreateParams = DatatokenConstantParams
  }

  async getOceanService(
    chainId: number,
    nftAddress: string,
    dtAddress?: string
  ): Promise<Service> {
    const datatokenAddress = dtAddress || this.datatokenAddress

    if (!datatokenAddress) throw new Error('Datatoken address is required!')

    const assetURL = {
      datatokenAddress,
      nftAddress,
      files: this.files
    }

    const encryptedFiles = await getEncryptedFiles(
      assetURL,
      chainId,
      this.serviceEndpoint
    )

    const oceanService: Service = {
      id: getHash(encryptedFiles), // do this first to not overwrite an id on edit
      datatokenAddress,
      ...this, // would overwrite id if one already exists
      files: encryptedFiles
    }

    return oceanService
  }

  // TODO: config transformation
  async getConfig(): Promise<ServiceConfig> {
    // validate provider
    if (!(await ProviderInstance.isValidProvider(this.serviceEndpoint)))
      throw new Error('Provided serviceEndpoint is not a valid Ocean Provider')

    // validate files
    for (const file of this.files) {
      const fileInfo = await getFileInfo(file, this.serviceEndpoint)
      if (fileInfo.some((info) => !info.valid))
        throw new Error('Provided files could not be validated')
    }

    // validate pricing
    if (!this.hasValidPricing()) {
      LoggerInstance.error('Invalid pricing scheme:', this.pricing)
      throw new Error('Pricing Scheme could not be validated.')
    }

    return {
      ...this,
      files: this.files as ServiceConfig['files'],
      consumerParameters: this.consumerParameters?.map((param) =>
        param.getConfig()
      )
    }
  }

  private hasValidPricing() {
    return (
      ['free', 'fixed'].includes(this.pricing?.type) &&
      (this.pricing?.type === 'fixed'
        ? Web3.utils.isAddress(
            this.pricing.freCreationParams?.baseTokenAddress
          ) &&
          this.pricing.freCreationParams?.baseTokenDecimals > 0 &&
          this.pricing.freCreationParams?.datatokenDecimals > 0 &&
          Number(this.pricing.freCreationParams?.fixedRate) > 0 &&
          Web3.utils.isAddress(
            this.pricing.freCreationParams?.fixedRateAddress
          ) &&
          this.pricing.freCreationParams?.marketFee?.length > 0 &&
          Web3.utils.isAddress(
            this.pricing.freCreationParams?.marketFeeCollector
          )
        : true)
    )
  }
}
