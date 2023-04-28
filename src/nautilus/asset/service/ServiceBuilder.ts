import { PublisherTrustedAlgorithm } from '@oceanprotocol/lib'
import { IServiceBuilder } from '../../../@types/Nautilus'
import {
  FileTypes,
  NautilusService,
  ServiceFileType,
  ServiceTypes
} from './NautilusService'
import { NautilusConsumerParameter } from '../consumerParameters'
import { ConsumerParameterType } from '../../../@types/Publish'

export class ServiceBuilder<
  ServiceType extends ServiceTypes,
  FileType extends FileTypes
> implements IServiceBuilder<ServiceType, FileType>
{
  private service = new NautilusService<ServiceType, FileType>()

  constructor(serviceType: ServiceType, fileType = FileTypes.URL) {
    this.service.type = serviceType

    if (this.service.type === 'compute') {
      this.service.compute = {
        allowNetworkAccess: false,
        allowRawAlgorithm: false,
        publisherTrustedAlgorithmPublishers: [],
        publisherTrustedAlgorithms: []
      }
    }
  }

  addFile(file: ServiceFileType<FileType>) {
    this.service.files.push(file)

    return this
  }

  setTimeout(timeout: number) {
    this.service.timeout = timeout

    return this
  }

  setServiceEndpoint(endpoint: string) {
    this.service.serviceEndpoint = endpoint

    return this
  }

  setName(name: string) {
    this.service.name = name

    return this
  }

  setDescription(description: string) {
    this.service.description = description

    return this
  }

  addConsumerParameter(parameter: NautilusConsumerParameter) {
    this.service.consumerParameters.push(parameter)

    return this
  }

  // #region compute
  allowRawAlgorithms(allow = true) {
    if (this.service.type !== 'compute') return

    this.service.compute.allowRawAlgorithm = allow

    return this
  }

  allowAlgorithmNetworkAccess(allow = true) {
    if (this.service.type !== 'compute') return

    this.service.compute.allowNetworkAccess = allow

    return this
  }

  addTrustedAlgorithm(algorithm: PublisherTrustedAlgorithm) {
    if (this.service.type !== 'compute') return

    this.service.compute.publisherTrustedAlgorithms.push(algorithm)

    return this
  }

  addTrustedAlgorithmPublisher(publisher: string) {
    if (this.service.type !== 'compute') return

    this.service.compute.publisherTrustedAlgorithmPublishers.push(publisher)

    return this
  }
  // #endregion

  reset() {
    this.service = new NautilusService<ServiceType, FileType>()
  }

  build() {
    return this.service
  }
}
