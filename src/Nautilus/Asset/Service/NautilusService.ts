import {
  Arweave,
  FixedRateExchange,
  GraphqlQuery,
  Ipfs,
  Service,
  ServiceComputeOptions,
  Smartcontract,
  UrlFile,
  getHash
} from '@oceanprotocol/lib'
import {
  DatatokenCreateParamsWithoutOwner,
  TrustedAlgorithmAsset
} from '../../../@types/Publish'
import {
  getEncryptedFiles,
  getFileInfo,
  isValidProvider
} from '../../../utils/provider'
import { NautilusConsumerParameter } from '../ConsumerParameters'
import { PricingConfigWithoutOwner } from '../NautilusAsset'
import { params as DatatokenConstantParams } from '../constants/datatoken.constants'
import { Nautilus } from '../../Nautilus'
import { Signer } from 'ethers'
import { getAsset } from '../../../utils/aquarius'
import { getAccessDetails } from '../../../utils/helpers/access-details'

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

  consumerParameters?: NautilusConsumerParameter[] = []
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

  public static async editPrice(
    nautilus: Nautilus,
    signer: Signer,
    did: string,
    serviceId: string,
    newPrice: string
  ) {
    const config = nautilus.getOceanConfig()

    const aquariusAsset = await getAsset(config.metadataCacheUri, did)

    const service: Service = aquariusAsset.services.find(
      (service) => service.id === serviceId
    )

    const fixedRateInstance = new FixedRateExchange(
      config.fixedRateExchangeAddress,
      signer
    )

    const accessDetails = await getAccessDetails(
      config.subgraphUri,
      service.datatokenAddress
    )

    const tx = await fixedRateInstance.setRate(
      accessDetails.addressOrId,
      newPrice
    )
    const txReceipt = await tx.wait()

    return txReceipt
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

    const isFilesObjectChanged = !!(
      (this.editExistingService && this.filesEdited) ||
      (this.editExistingService && this.serviceEndpointEdited) ||
      this.pricing
    )

    let encryptedFiles: string

    if (isFilesObjectChanged) {
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
    }

    // required attributes
    const oceanService: Service = {
      id: this.id && !isFilesObjectChanged ? this.id : getHash(encryptedFiles),
      datatokenAddress,
      type: this.type,
      serviceEndpoint: this.serviceEndpoint,
      timeout: this.timeout,
      files: isFilesObjectChanged ? encryptedFiles : this.existingEncryptedFiles
    }

    // add optional attributes if they are defined
    if (this.name) oceanService.name = this.name
    if (this.description) oceanService.description = this.description
    if (this.additionalInformation)
      oceanService.additionalInformation = this.additionalInformation

    if (this.consumerParameters.length > 0)
      // TODO: remove ignore once we use updated ocean.js with correct types
      // @ts-ignore
      oceanService.consumerParameters = this.consumerParameters.map(
        (parameter) => parameter.getConfig()
      )

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
}
