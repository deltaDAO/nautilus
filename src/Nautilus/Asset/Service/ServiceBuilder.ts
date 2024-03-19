import type { ConsumerParameter, Service } from '@oceanprotocol/lib'
import type {
  IServiceBuilder,
  ServiceBuilderConfig
} from '../../../@types/Nautilus'
import {
  ConsumerParameterSelectOption,
  type DatatokenCreateParamsWithoutOwner,
  type TrustedAlgorithmAsset
} from '../../../@types/Publish'
import { ConsumerParameterBuilder } from '../ConsumerParameters'
import type { PricingConfigWithoutOwner } from '../NautilusAsset'
import {
  type FileTypes,
  NautilusService,
  type ServiceFileType,
  ServiceTypes
} from './NautilusService'

export class ServiceBuilder<
  ServiceType extends ServiceTypes,
  FileType extends FileTypes
> implements IServiceBuilder<ServiceType, FileType>
{
  private service = new NautilusService<ServiceType, FileType>()

  constructor(config: ServiceBuilderConfig) {
    if ('serviceType' in config) {
      this.service.type = config.serviceType as ServiceType

      if (this.service.type === ServiceTypes.COMPUTE) {
        this.service.compute = {
          allowNetworkAccess: false,
          allowRawAlgorithm: false,
          publisherTrustedAlgorithmPublishers: [],
          publisherTrustedAlgorithms: []
        }
      }
    } else {
      const { aquariusAsset, serviceId } = config

      if (!aquariusAsset || !serviceId) {
        throw new Error('Missing parameter(s) in serviceBuilder config.')
      }
      const service: Service = aquariusAsset.services.find(
        (service) => service.id === serviceId
      )
      if (!service) {
        throw new Error('No service with matching id found in provided DDO.')
      }

      // mark service as existing service
      this.service.editExistingService = true

      this.service.id = service.id
      this.service.type = ServiceTypes[service.type.toUpperCase()]
      this.service.datatokenAddress = service.datatokenAddress
      this.service.serviceEndpoint = service.serviceEndpoint
      this.service.timeout = service.timeout

      // aquariusAsset must be used since datatoken NAME and SYMBOL are not included in the service object of the DDO
      const datatokenObj = aquariusAsset.datatokens.find(
        (datatoken) => datatoken.address === service.datatokenAddress
      )
      this.service.datatokenCreateParams = {
        ...this.service.datatokenCreateParams,
        name: datatokenObj.name,
        symbol: datatokenObj.symbol
      }

      this.service.existingEncryptedFiles = service.files

      // required for compute assets
      if (service.compute) this.service.compute = service.compute

      // optional
      if (service.name) this.service.name = service.name
      if (service.description) this.service.description = service.description
      if (service.additionalInformation)
        this.service.additionalInformation = service.additionalInformation

      if (service.consumerParameters && service.consumerParameters.length > 0)
        this.service.consumerParameters = service.consumerParameters
    }
  }

  addFile(file: ServiceFileType<FileType>) {
    this.service.files.push(file)
    this.service.filesEdited = true

    return this
  }

  setTimeout(timeout: number) {
    this.service.timeout = timeout

    return this
  }

  setServiceEndpoint(endpoint: string) {
    this.service.serviceEndpoint = endpoint
    this.service.serviceEndpointEdited = true

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

  addConsumerParameter(parameter: ConsumerParameter) {
    this.service.consumerParameters.push(parameter)

    return this
  }

  // biome-ignore lint/suspicious/noExplicitAny: can be any user info
  addAdditionalInformation(additionalInformation: { [key: string]: any }) {
    this.service.additionalInformation = {
      ...this.service.additionalInformation,
      ...additionalInformation
    }

    return this
  }

  // #region compute
  allowRawAlgorithms(allow = true) {
    if (this.service.type !== 'compute')
      throw new Error('Illegal operation, asset is not a compute asset!')

    this.service.compute.allowRawAlgorithm = allow

    return this
  }

  allowAlgorithmNetworkAccess(allow = true) {
    if (this.service.type !== 'compute')
      throw new Error('Illegal operation, asset is not a compute asset!')

    this.service.compute.allowNetworkAccess = allow

    return this
  }

  addTrustedAlgorithms(trustedAlgorithmAssets: TrustedAlgorithmAsset[]) {
    if (this.service.type !== 'compute') {
      throw new Error('Illegal operation, asset is not a compute asset!')
    }

    if (!trustedAlgorithmAssets || trustedAlgorithmAssets.length === 0) {
      throw new Error('No TrustedAlgorithmAssets provided.')
    }

    for (const trustedAlgorithmAsset of trustedAlgorithmAssets) {
      const existingIndex =
        this.service.addedPublisherTrustedAlgorithms.findIndex(
          (existingAsset) => existingAsset.did === trustedAlgorithmAsset.did
        )

      if (existingIndex > -1) {
        // Merge serviceIds
        this.service.addedPublisherTrustedAlgorithms[existingIndex].serviceIds =
          Array.from(
            new Set([
              ...(this.service.addedPublisherTrustedAlgorithms[existingIndex]
                .serviceIds || []),
              ...(trustedAlgorithmAsset.serviceIds || [])
            ])
          )
      } else {
        // Add new trusted algorithm asset
        this.service.addedPublisherTrustedAlgorithms.push(trustedAlgorithmAsset)
      }
    }

    return this
  }

  removeTrustedAlgorithm(did: string) {
    if (this.service.type !== 'compute')
      throw new Error('Illegal operation, asset is not a compute asset!')

    this.service.compute.publisherTrustedAlgorithms =
      this.service.compute.publisherTrustedAlgorithms.filter(
        (algorithm) => algorithm.did !== did
      )

    return this
  }

  setAllAlgorithmsTrusted() {
    this.service.compute.publisherTrustedAlgorithms = null

    return this
  }

  setAllAlgorithmsUntrusted() {
    this.service.compute.publisherTrustedAlgorithms = []

    return this
  }

  addTrustedAlgorithmPublisher(publisherAddress: string) {
    if (this.service.type !== 'compute') {
      throw new Error('Illegal operation, asset is not a compute asset!')
    }

    if (!this.service.compute.publisherTrustedAlgorithmPublishers) {
      this.service.compute.publisherTrustedAlgorithmPublishers = [
        publisherAddress
      ]
      return this
    }

    if (
      !this.service.compute.publisherTrustedAlgorithmPublishers.includes(
        publisherAddress
      )
    ) {
      this.service.compute.publisherTrustedAlgorithmPublishers.push(
        publisherAddress
      )
    }

    return this
  }

  removeTrustedAlgorithmPublisher(publisherAddress: string) {
    if (this.service.type !== 'compute')
      throw new Error('Illegal operation, asset is not a compute asset!')

    const lowerCasePublisherAddress = publisherAddress.toLowerCase()

    // Remove all occurrences of publisherAddress
    this.service.compute.publisherTrustedAlgorithmPublishers =
      this.service.compute.publisherTrustedAlgorithmPublishers.filter(
        (address) => address.toLowerCase() !== lowerCasePublisherAddress
      )

    return this
  }

  setAllAlgorithmPublishersTrusted() {
    this.service.compute.publisherTrustedAlgorithmPublishers = null

    return this
  }

  setAllAlgorithmPublishersUntrusted() {
    this.service.compute.publisherTrustedAlgorithmPublishers = []

    return this
  }

  setDatatokenData(tokenData: DatatokenCreateParamsWithoutOwner) {
    this.service.datatokenCreateParams = tokenData

    return this
  }

  setDatatokenNameAndSymbol(dtName: string, dtSymbol: string) {
    this.service.datatokenCreateParams = {
      ...this.service.datatokenCreateParams,
      name: dtName,
      symbol: dtSymbol
    }

    return this
  }

  setPricing(pricing: PricingConfigWithoutOwner) {
    if (this.service.editExistingService)
      throw new Error(
        'Can not set new pricing configs for existing services using the builder. Use nautilus.setServicePrice() method instead.'
      )
    this.service.pricing = pricing

    return this
  }
  // #endregion

  reset() {
    this.service = new NautilusService<ServiceType, FileType>()
  }

  build() {
    if (
      this.service.pricing === undefined &&
      !this.service.editExistingService
    ) {
      throw new Error('Missing pricing config.')
    }

    return this.service
  }
}
