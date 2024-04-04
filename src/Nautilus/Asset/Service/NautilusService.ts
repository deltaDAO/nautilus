import {
  type Arweave,
  type ConsumerParameter,
  type GraphqlQuery,
  type Ipfs,
  type Service,
  type ServiceComputeOptions,
  type Smartcontract,
  type UrlFile,
  getHash
} from '@oceanprotocol/lib'
import type {
  DatatokenCreateParamsWithoutOwner,
  TrustedAlgorithmAsset
} from '../../../@types/Publish'
import {
  getEncryptedFiles,
  getFileInfo,
  isValidProvider
} from '../../../utils/provider'
import type { PricingConfigWithoutOwner } from '../NautilusAsset'
import { params as DatatokenConstantParams } from '../constants/datatoken.constants'

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
  existingEncryptedFiles: string

  pricing: PricingConfigWithoutOwner
  newPrice: string
  datatokenCreateParams: DatatokenCreateParamsWithoutOwner
  editExistingService: boolean
  filesEdited: boolean
  serviceEndpointEdited: boolean

  name?: string
  description?: string

  compute: ServiceComputeOptions = {
    allowNetworkAccess: false,
    allowRawAlgorithm: false,
    publisherTrustedAlgorithmPublishers: [],
    publisherTrustedAlgorithms: []
  }

  addedPublisherTrustedAlgorithms: TrustedAlgorithmAsset[] = []

  consumerParameters?: ConsumerParameter[] = []
  // biome-ignore lint/suspicious/noExplicitAny: can be any user defined information
  additionalInformation?: { [key: string]: any }

  id?: string
  datatokenAddress?: string

  constructor() {
    this.editExistingService = false
    this.filesEdited = false
    this.initDatatokenData()
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

    const isFilesObjectChanged = this.checkIfFilesObjectChanged()

    let encryptedFiles: string

    if (isFilesObjectChanged || !this.existingEncryptedFiles) {
      if (this.files.length < 1) {
        throw new Error('Can not encrypt files. No files defined!')
      }

      const assetURL = {
        datatokenAddress,
        nftAddress,
        files: this.files
      }

      encryptedFiles = await getEncryptedFiles(
        assetURL,
        chainId,
        this.serviceEndpoint
      )
    } else {
      encryptedFiles = this.existingEncryptedFiles
    }

    // required attributes
    const oceanService: Service = {
      id: this.id && !isFilesObjectChanged ? this.id : getHash(encryptedFiles),
      datatokenAddress,
      type: this.type,
      serviceEndpoint: this.serviceEndpoint,
      timeout: this.timeout,
      files: encryptedFiles
    }

    // add optional attributes if they are defined
    if (this.name) oceanService.name = this.name
    if (this.description) oceanService.description = this.description
    if (this.additionalInformation)
      oceanService.additionalInformation = this.additionalInformation

    if (this.consumerParameters.length > 0)
      oceanService.consumerParameters = this.consumerParameters

    // we only add the compute attribute for `compute` type services
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

  checkIfFilesObjectChanged(): boolean {
    return (
      (this.editExistingService &&
        (this.filesEdited || this.serviceEndpointEdited)) ||
      !!this.pricing
    )
  }
}
