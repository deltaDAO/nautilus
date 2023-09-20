import { PublisherTrustedAlgorithm, Service, Asset } from '@oceanprotocol/lib'
import { IServiceBuilder, ServiceBuilderConfig } from '../../../@types/Nautilus'
import {
  ConsumerParameterBuilder,
  NautilusConsumerParameter
} from '../ConsumerParameters'
import {
  FileTypes,
  NautilusService,
  ServiceFileType,
  ServiceTypes
} from './NautilusService'
import {
  ConsumerParameterSelectOption,
  DatatokenCreateParamsWithoutOwner
} from '../../../@types/Publish'
import { PricingConfigWithoutOwner } from '../NautilusAsset'

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

      if (service.consumerParameters && service.consumerParameters.length > 0) {
        for (const ddoParameter of service.consumerParameters) {
          const builder = new ConsumerParameterBuilder()

          builder
            .setType(ddoParameter.type)
            .setName(ddoParameter.name)
            .setLabel(ddoParameter.label)
            .setDescription(ddoParameter.description)
            .setDefault(ddoParameter.default)
            .setRequired(ddoParameter.required)

          if (ddoParameter.options) {
            const parameterOptions: ConsumerParameterSelectOption[] =
              JSON.parse(ddoParameter.options)
            for (const option of parameterOptions) {
              builder.addOption(option)
            }
          }

          const parameter = builder.build()

          this.addConsumerParameter(parameter)
        }
      }
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

    if (
      this.service.compute.publisherTrustedAlgorithms === null ||
      this.service.compute.publisherTrustedAlgorithms === undefined
    ) {
      this.service.compute.publisherTrustedAlgorithms = [algorithm]
    } else {
      this.service.compute.publisherTrustedAlgorithms.push(algorithm)
    }

    return this
  }

  addTrustedAlgorithmPublisher(publisher: string) {
    if (this.service.type !== 'compute') return

    if (
      this.service.compute.publisherTrustedAlgorithmPublishers === null ||
      this.service.compute.publisherTrustedAlgorithmPublishers === undefined
    ) {
      this.service.compute.publisherTrustedAlgorithmPublishers = [publisher]
    } else {
      this.service.compute.publisherTrustedAlgorithmPublishers.push(publisher)
    }

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
        'Can not set new Pricing configs for existing assets. Use static editPrice() function.'
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
      throw new Error(`Missing pricing config.`)
    }

    return this.service
  }
}
