import {
  Arweave,
  GraphqlQuery,
  Ipfs,
  ServiceComputeOptions,
  Smartcontract,
  UrlFile
} from '@oceanprotocol/lib'
import { ServiceConfig } from '../../../@types/Publish'
import {
  ConsumerParameterType,
  NautilusConsumerParameter
} from '../consumerParameters'

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

  consumerParameters?: NautilusConsumerParameter<ConsumerParameterType>[] = []
  additionalInformation?: { [key: string]: any } = {}

  // TODO: config transformation
  getConfig(): ServiceConfig {
    return {
      ...this,
      files: this.files as ServiceConfig['files']
    }
  }
}
