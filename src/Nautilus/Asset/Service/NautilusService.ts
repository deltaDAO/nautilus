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
import {
  getEncryptedFiles,
  getFileInfo,
  isValidProvider
} from '../../../utils/provider'
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

  compute: ServiceComputeOptions = {
    allowNetworkAccess: false,
    allowRawAlgorithm: false,
    publisherTrustedAlgorithmPublishers: [],
    publisherTrustedAlgorithms: []
  }

  consumerParameters?: NautilusConsumerParameter[]
  additionalInformation?: { [key: string]: any }

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
    if (!(await this.hasValidServiceEndpoint()))
      throw new Error('serviceEndpoint is not a valid Ocean Provider')

    if (!(await this.hasValidFiles()))
      throw new Error('Some of the provided files could not be validated')

    const datatokenAddress = dtAddress || this.datatokenAddress
    if (!datatokenAddress) throw new Error('datatokenAddress is required')

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

    // remove nautilus utility properties from this instance
    const {
      datatokenCreateParams,
      pricing,
      files,
      // we also remove compute, only adding it back for ServiceTypes.COMPUTE type services
      compute,
      ...oceanServiceProperties
    } = this

    const oceanService: Service = {
      id: getHash(encryptedFiles), // do this first to not overwrite an id on edit
      datatokenAddress,
      // this will overwrite the id if given and add all valid ocean service properties defined on this instance
      ...oceanServiceProperties,
      files: encryptedFiles
    }

    if (this.type === ServiceTypes.COMPUTE) oceanService.compute = this.compute

    return oceanService
  }

  async hasValidServiceEndpoint(): Promise<boolean> {
    return await isValidProvider(this.serviceEndpoint)
  }

  async hasValidFiles(): Promise<boolean> {
    for (const file of this.files) {
      const fileInfo = await getFileInfo(file, this.serviceEndpoint)
      if (fileInfo.some((info) => !info.valid)) return false
    }

    return true
  }
}
