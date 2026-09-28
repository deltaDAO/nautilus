import type { ServiceV5 } from '@oceanprotocol/ddo-js'
import type {
  AssetState,
  IServiceBuilder,
  ServiceBuilderConfig
} from '../../../@types/Nautilus.js'
import type {
  DatatokenCreateParamsWithoutOwner,
  PricingConfigWithoutOwner,
  TrustedAlgorithmAsset
} from '../../../@types/Publish.js'
import {
  getDatatokens,
  getService,
  getServiceCredentials
} from '../../../ddo/read.js'
import type {
  ConsumerParameterV5,
  CredentialListTypes,
  RemoteObject,
  RequestCredential
} from '../../../ddo/types.js'
import {
  addCredentialAddresses,
  addRequestCredentials
} from '../../../identity/policy.js'
import {
  type FileTypes,
  NautilusService,
  type ServiceFileType,
  ServiceTypes
} from './NautilusService.js'

/**
 * Fluent builder for one service on an asset.
 *
 * Two modes, chosen by the config passed to the constructor:
 *
 *   - `{ serviceType }` — a brand new service. `setPricing()` is required, because a new
 *     service needs its own datatoken.
 *   - `{ asset, serviceId }` — load a published service to edit. Pricing is locked (use
 *     `nautilus.setServicePrice()` instead), since changing it would mint a new datatoken
 *     and so change the service id.
 */
export class ServiceBuilder<
  ServiceType extends ServiceTypes,
  FileType extends FileTypes
> implements IServiceBuilder<ServiceType, FileType>
{
  private service: NautilusService<ServiceType, FileType>
  private readonly config: ServiceBuilderConfig

  constructor(config: ServiceBuilderConfig) {
    this.config = config
    this.service = ServiceBuilder.seed<ServiceType, FileType>(config)
  }

  /** Builds the initial service state, so `reset()` can replay it. */
  private static seed<S extends ServiceTypes, F extends FileTypes>(
    config: ServiceBuilderConfig
  ): NautilusService<S, F> {
    const service = new NautilusService<S, F>()

    if ('serviceType' in config) {
      service.type = config.serviceType as S
      return service
    }

    const { asset, serviceId } = config

    if (!asset || !serviceId)
      throw new Error(
        'ServiceBuilder needs both an asset and a serviceId to edit an existing service.'
      )

    const existing = getService(asset, serviceId)

    if (!existing)
      throw new Error(
        `No service with id ${serviceId} exists on asset ${asset.id}.`
      )

    service.editExistingService = true
    service.id = existing.id
    service.type = existing.type as S
    service.datatokenAddress = existing.datatokenAddress
    service.serviceEndpoint = existing.serviceEndpoint
    service.timeout = existing.timeout
    service.existingEncryptedFiles = existing.files
    service.state = existing.state

    // Deep copies, not references: `getService()` hands back the resolved asset's own
    // objects, and the compute/credential mutators write in place — aliasing them would
    // contaminate the caller's asset, and reset() would replay the mutated state.
    service.credentials = structuredClone(getServiceCredentials(existing))

    if (existing.name) service.name = existing.name
    if (existing.displayName) service.displayName = existing.displayName
    if (existing.description) service.description = existing.description
    if (existing.additionalInformation)
      service.additionalInformation = structuredClone(
        existing.additionalInformation
      )
    if (existing.compute) service.compute = structuredClone(existing.compute)
    if (existing.consumerParameters?.length)
      service.consumerParameters = structuredClone(
        existing.consumerParameters
      ) as unknown as ConsumerParameterV5[]
    if (existing.dataSchema) service.dataSchema = existing.dataSchema
    if (existing.inputSchema) service.inputSchema = existing.inputSchema
    if (existing.outputSchema) service.outputSchema = existing.outputSchema

    // The datatoken name and symbol are not on the DDO's service object, only in the
    // indexer's datatoken list, so they are recovered from there and matched on serviceId.
    const datatoken = getDatatokens(asset).find(
      (candidate) =>
        candidate.serviceId === serviceId ||
        candidate.address?.toLowerCase() ===
          existing.datatokenAddress?.toLowerCase()
    )

    if (datatoken?.name || datatoken?.symbol)
      service.datatokenCreateParams = {
        ...service.datatokenCreateParams,
        name: datatoken.name,
        symbol: datatoken.symbol
      }

    return service
  }

  // #region description

  setName(name: string) {
    this.service.name = name
    return this
  }

  setDisplayName(displayName: string) {
    this.service.displayName = displayName
    return this
  }

  setDescription(description: string) {
    this.service.description = description
    return this
  }

  setTimeout(timeout: number) {
    this.service.timeout = timeout
    return this
  }

  /**
   * Changing the endpoint means the file object must be re-encrypted by the new node, so
   * this also marks the service for rebuild.
   */
  setServiceEndpoint(endpoint: string) {
    this.service.serviceEndpoint = endpoint
    this.service.serviceEndpointEdited = true
    return this
  }

  /** Per-service lifecycle state — new in DDO v5. */
  setState(state: AssetState) {
    this.service.state = state as number
    return this
  }

  addFile(file: ServiceFileType<FileType>) {
    this.service.files.push(file)
    this.service.filesEdited = true
    return this
  }

  addConsumerParameter(parameter: ConsumerParameterV5) {
    this.service.consumerParameters.push(parameter)
    return this
  }

  addAdditionalInformation(
    additionalInformation: Record<string, string | number | boolean>
  ) {
    this.service.additionalInformation = {
      ...this.service.additionalInformation,
      ...additionalInformation
    }
    return this
  }

  // #endregion

  // #region schemas — new in DDO v5

  /** Describes the shape of the data this service serves. */
  setDataSchema(schema: RemoteObject) {
    this.service.dataSchema = schema
    return this
  }

  /** For algorithm services: the input the algorithm expects. */
  setInputSchema(schema: RemoteObject) {
    this.service.inputSchema = schema
    return this
  }

  /** For algorithm services: the output the algorithm produces. */
  setOutputSchema(schema: RemoteObject) {
    this.service.outputSchema = schema
    return this
  }

  // #endregion

  // #region compute

  private assertCompute(operation: string): void {
    if (this.service.type !== ServiceTypes.COMPUTE)
      throw new Error(
        `${operation} is only valid on a compute service; this one is '${this.service.type}'.`
      )
  }

  allowRawAlgorithms(allow = true) {
    this.assertCompute('allowRawAlgorithms')
    this.service.compute.allowRawAlgorithm = allow
    return this
  }

  allowAlgorithmNetworkAccess(allow = true) {
    this.assertCompute('allowAlgorithmNetworkAccess')
    this.service.compute.allowNetworkAccess = allow
    return this
  }

  /**
   * Stages algorithms to trust. Their container and file checksums are resolved from the
   * live DDOs at publish time.
   *
   * DDO v5 requires a `serviceId` per trusted algorithm, so `serviceIds` is finally
   * meaningful — omit it to trust the algorithm's first compute service.
   */
  addTrustedAlgorithms(trustedAlgorithmAssets: TrustedAlgorithmAsset[]) {
    this.assertCompute('addTrustedAlgorithms')

    if (!trustedAlgorithmAssets?.length)
      throw new Error('addTrustedAlgorithms was called with no algorithms.')

    for (const asset of trustedAlgorithmAssets) {
      const existing = this.service.addedPublisherTrustedAlgorithms.find(
        (staged) => staged.did === asset.did
      )

      if (existing)
        existing.serviceIds = Array.from(
          new Set([...(existing.serviceIds || []), ...(asset.serviceIds || [])])
        )
      else this.service.addedPublisherTrustedAlgorithms.push({ ...asset })
    }

    return this
  }

  /** Removes an algorithm from both the staged and the resolved lists. */
  removeTrustedAlgorithm(did: string) {
    this.assertCompute('removeTrustedAlgorithm')

    this.service.addedPublisherTrustedAlgorithms =
      this.service.addedPublisherTrustedAlgorithms.filter(
        (staged) => staged.did !== did
      )

    this.service.compute.publisherTrustedAlgorithms = (
      this.service.compute.publisherTrustedAlgorithms || []
    ).filter((algorithm) => algorithm.did !== did)

    return this
  }

  /** `null` means "no restriction" to the node — any algorithm may run. */
  setAllAlgorithmsTrusted() {
    this.assertCompute('setAllAlgorithmsTrusted')
    this.service.addedPublisherTrustedAlgorithms = []
    this.service.compute.publisherTrustedAlgorithms =
      null as unknown as typeof this.service.compute.publisherTrustedAlgorithms
    return this
  }

  /** An empty list means "no algorithm may run". */
  setAllAlgorithmsUntrusted() {
    this.assertCompute('setAllAlgorithmsUntrusted')
    this.service.addedPublisherTrustedAlgorithms = []
    this.service.compute.publisherTrustedAlgorithms = []
    return this
  }

  addTrustedAlgorithmPublisher(publisherAddress: string) {
    this.assertCompute('addTrustedAlgorithmPublisher')

    const publishers =
      this.service.compute.publisherTrustedAlgorithmPublishers || []

    if (
      !publishers.some(
        (address) => address.toLowerCase() === publisherAddress.toLowerCase()
      )
    )
      publishers.push(publisherAddress)

    this.service.compute.publisherTrustedAlgorithmPublishers = publishers

    return this
  }

  removeTrustedAlgorithmPublisher(publisherAddress: string) {
    this.assertCompute('removeTrustedAlgorithmPublisher')

    this.service.compute.publisherTrustedAlgorithmPublishers = (
      this.service.compute.publisherTrustedAlgorithmPublishers || []
    ).filter(
      (address) => address.toLowerCase() !== publisherAddress.toLowerCase()
    )

    return this
  }

  setAllAlgorithmPublishersTrusted() {
    this.assertCompute('setAllAlgorithmPublishersTrusted')
    this.service.compute.publisherTrustedAlgorithmPublishers =
      null as unknown as string[]
    return this
  }

  setAllAlgorithmPublishersUntrusted() {
    this.assertCompute('setAllAlgorithmPublishersUntrusted')
    this.service.compute.publisherTrustedAlgorithmPublishers = []
    return this
  }

  // #endregion

  // #region gating

  /** Restricts this service to specific addresses, independently of the asset's list. */
  addCredentialAddresses(list: CredentialListTypes, addresses: string[]) {
    this.service.credentials = addCredentialAddresses(
      this.service.credentials,
      list,
      addresses
    )
    return this
  }

  /** Requires verifiable credentials for this service specifically. */
  addRequestCredentials(
    list: CredentialListTypes,
    requestCredentials: RequestCredential[]
  ) {
    this.service.credentials = addRequestCredentials(
      this.service.credentials,
      list,
      requestCredentials
    )
    return this
  }

  // #endregion

  // #region pricing and datatoken

  setDatatokenData(tokenData: DatatokenCreateParamsWithoutOwner) {
    this.service.datatokenCreateParams = { ...tokenData }
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
        'Pricing cannot be changed through the builder for an existing service, because a new datatoken would change the service id. Use nautilus.setServicePrice() instead.'
      )

    this.service.pricing = pricing

    return this
  }

  // #endregion

  /** Returns to the state the constructor produced, including any loaded service. */
  reset() {
    this.service = ServiceBuilder.seed<ServiceType, FileType>(this.config)
  }

  build(): NautilusService<ServiceType, FileType> {
    if (!this.service.editExistingService && this.service.pricing === undefined)
      throw new Error(
        'A new service needs a pricing config. Call setPricing({ type: "free" }) or setPricing({ type: "fixed", freCreationParams }).'
      )

    if (!this.service.serviceEndpoint)
      throw new Error(
        'A service needs a serviceEndpoint. Call setServiceEndpoint().'
      )

    // Required by DDO v5. Defaulted rather than thrown so the common case stays terse.
    if (!this.service.name)
      this.service.name =
        this.service.type === ServiceTypes.COMPUTE
          ? 'Compute Service'
          : 'Access Service'

    return this.service
  }
}

export type { ServiceV5 }
