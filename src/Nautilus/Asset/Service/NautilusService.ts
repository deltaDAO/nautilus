import {
  Arweave,
  GraphqlQuery,
  Ipfs,
  ProviderInstance,
  ServiceComputeOptions,
  Smartcontract,
  UrlFile
} from '@oceanprotocol/lib'
import { ServiceConfig } from '../../../@types/Publish'
import { getFileInfo } from '../../../utils/provider'
import { NautilusConsumerParameter } from '../ConsumerParameters'

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

export class NautilusService<
  ServiceType extends ServiceTypes,
  FileType extends FileTypes
> {
  type: ServiceType
  serviceEndpoint: string
  timeout: number
  files: ServiceFileType<FileType>[] = []

  name?: string
  description?: string

  compute?: ServiceComputeOptions

  consumerParameters?: NautilusConsumerParameter[] = []
  additionalInformation?: { [key: string]: any } = {}

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

    return {
      ...this,
      files: this.files as ServiceConfig['files'],
      consumerParameters: this.consumerParameters?.map((param) =>
        param.getConfig()
      )
    }
  }
}
