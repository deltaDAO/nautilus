import type {
  Compute,
  PublisherTrustedAlgorithms,
  ServiceV5
} from '@oceanprotocol/ddo-js'
import {
  type ArweaveFileObject,
  type AssetFiles,
  FileObjectType,
  type FtpFileObject,
  getHash,
  type IpfsFileObject,
  type PersistentStorageObject,
  type S3FileObject,
  type StorageObject,
  type UrlFileObject
} from '@oceanprotocol/lib'
import type {
  DatatokenCreateParamsWithoutOwner,
  PricingConfigWithoutOwner,
  TrustedAlgorithmAsset
} from '../../../@types/Publish.js'
import { type LanguageOptions, toLanguageValue } from '../../../ddo/language.js'
import type {
  ConsumerParameterV5,
  DdoCredentials,
  LanguageValue,
  RemoteObject
} from '../../../ddo/types.js'
import type { OceanNodeClient } from '../../../node/OceanNodeClient.js'
import { params as datatokenDefaults } from '../constants/datatoken.constants.js'

/**
 * Storage backends ocean-node can read.
 *
 * Two v1 types are gone because ocean-node no longer implements them: `graphql` and
 * `smartcontract`. Three are new: `s3`, `ftp` and the node's own persistent storage.
 */
export enum FileTypes {
  URL = 'url',
  IPFS = 'ipfs',
  ARWEAVE = 'arweave',
  S3 = 's3',
  FTP = 'ftp',
  NODE_PERSISTENT_STORAGE = 'nodePersistentStorage'
}

export enum ServiceTypes {
  ACCESS = 'access',
  COMPUTE = 'compute'
}

/** Maps a `FileTypes` member onto the ocean.js storage object it needs. */
export type ServiceFileType<FileType extends FileTypes> =
  FileType extends FileTypes.IPFS
    ? IpfsFileObject
    : FileType extends FileTypes.ARWEAVE
      ? ArweaveFileObject
      : FileType extends FileTypes.S3
        ? S3FileObject
        : FileType extends FileTypes.FTP
          ? FtpFileObject
          : FileType extends FileTypes.NODE_PERSISTENT_STORAGE
            ? PersistentStorageObject
            : UrlFileObject

export type {
  ArweaveFileObject,
  FtpFileObject,
  IpfsFileObject,
  PersistentStorageObject,
  S3FileObject,
  StorageObject,
  UrlFileObject
}
export { FileObjectType }

const EMPTY_COMPUTE: Compute = {
  allowRawAlgorithm: false,
  allowNetworkAccess: false,
  publisherTrustedAlgorithmPublishers: [],
  publisherTrustedAlgorithms: []
}

/**
 * A service under construction.
 *
 * @internal Built by `ServiceBuilder`; projected into a DDO v5 `Service` by
 * {@link NautilusService.getOceanService}.
 */
export class NautilusService<
  ServiceType extends ServiceTypes,
  FileType extends FileTypes
> {
  type!: ServiceType
  serviceEndpoint!: string
  timeout = 0
  files: ServiceFileType<FileType>[] = []
  existingEncryptedFiles?: string

  pricing?: PricingConfigWithoutOwner
  datatokenCreateParams: DatatokenCreateParamsWithoutOwner
  editExistingService = false
  filesEdited = false
  serviceEndpointEdited = false

  /** Required by DDO v5, so `ServiceBuilder.build()` enforces it. */
  name?: string
  displayName?: string | LanguageValue
  description?: string | LanguageValue
  state?: number

  /** Per-service gating. Merged with the asset-level block by the policy server. */
  credentials: DdoCredentials = {}

  dataSchema?: RemoteObject
  inputSchema?: RemoteObject
  outputSchema?: RemoteObject

  compute: Compute = { ...EMPTY_COMPUTE }

  /** Staged trusted algorithms, resolved to checksums at publish time. */
  addedPublisherTrustedAlgorithms: TrustedAlgorithmAsset[] = []

  consumerParameters: ConsumerParameterV5[] = []
  additionalInformation?: Record<string, string | number | boolean>

  id?: string
  datatokenAddress?: string

  constructor() {
    // Spread, do not alias: the defaults are a shared module-level object, and assigning it
    // by reference let every builder mutate the process-wide default (a v1 bug).
    this.datatokenCreateParams = { ...datatokenDefaults }
  }

  /**
   * Projects into a DDO v5 service, encrypting the file object if needed.
   *
   * @param node the ocean-node client — encryption is node-side and now requires auth
   * @param chainId unused by the node call but kept for symmetry with the DDO
   * @param nftAddress bound into the encrypted file object
   * @param dtAddress the datatoken minted for this service
   */
  async getOceanService(
    node: OceanNodeClient,
    nftAddress: string,
    dtAddress?: string,
    language: LanguageOptions = {}
  ): Promise<ServiceV5> {
    if (!(await this.hasValidServiceEndpoint(node)))
      throw new Error(
        `serviceEndpoint ${this.serviceEndpoint} does not answer as an ocean-node.`
      )

    const datatokenAddress = dtAddress || this.datatokenAddress
    if (!datatokenAddress)
      throw new Error('datatokenAddress is required to build a service.')

    const filesChanged = this.checkIfFilesObjectChanged()

    let encryptedFiles: string
    if (filesChanged || !this.existingEncryptedFiles) {
      if (!this.files.length)
        throw new Error(
          'Cannot encrypt files: no files were added to this service.'
        )

      await this.assertFilesReadable(node)

      const assetFiles: AssetFiles = {
        datatokenAddress,
        nftAddress,
        files: this.files as unknown as StorageObject[]
      }

      encryptedFiles = await node.encrypt(assetFiles)
    } else {
      encryptedFiles = this.existingEncryptedFiles
    }

    // The service id is the hash of its encrypted file object, so re-encrypting new files
    // necessarily yields a new id — which is why an edited files object replaces the
    // service rather than mutating it.
    const service: ServiceV5 = {
      id: this.id && !filesChanged ? this.id : getHash(encryptedFiles),
      type: this.type,
      name: this.name as string,
      datatokenAddress,
      serviceEndpoint: this.serviceEndpoint,
      files: encryptedFiles,
      timeout: this.timeout,
      state: (this.state ?? 0) as ServiceV5['state'],
      credentials: this.credentials as unknown as ServiceV5['credentials']
    }

    if (this.displayName)
      service.displayName = toLanguageValue(this.displayName, language)

    if (this.description)
      service.description = toLanguageValue(this.description, language)

    if (this.additionalInformation)
      service.additionalInformation = this.additionalInformation

    if (this.consumerParameters.length)
      service.consumerParameters = this
        .consumerParameters as unknown as ServiceV5['consumerParameters']

    if (this.dataSchema) service.dataSchema = this.dataSchema
    if (this.inputSchema) service.inputSchema = this.inputSchema
    if (this.outputSchema) service.outputSchema = this.outputSchema

    if (this.type === ServiceTypes.COMPUTE) service.compute = this.compute

    return service
  }

  /** Memoized in the node client, so repeated services on one endpoint cost one probe. */
  async hasValidServiceEndpoint(node: OceanNodeClient): Promise<boolean> {
    return node.isValidNode(this.serviceEndpoint)
  }

  /**
   * Confirms the node can actually read every file, and says which one it could not.
   *
   * v1 returned a bare boolean here, so a typo'd URL surfaced as
   * "Some of the provided files could not be validated" with no indication which.
   */
  async assertFilesReadable(node: OceanNodeClient): Promise<void> {
    for (const [index, file] of this.files.entries()) {
      const info = await node.getFileInfo(file as unknown as StorageObject)

      if (!info?.length || info.some((entry) => !entry.valid))
        throw new Error(
          `The node could not read file ${index} of service ${this.name || this.id || '(unnamed)'}. Check its URL, credentials and reachability from the node.`
        )
    }
  }

  /**
   * Whether the encrypted file object has to be rebuilt — which also means the service id
   * changes. A new pricing config forces it because the datatoken address is part of the
   * encrypted payload.
   */
  checkIfFilesObjectChanged(): boolean {
    return (
      (this.editExistingService &&
        (this.filesEdited || this.serviceEndpointEdited)) ||
      !!this.pricing
    )
  }

  /** Trusted algorithms resolved so far, for inspection before publishing. */
  getTrustedAlgorithms(): PublisherTrustedAlgorithms[] {
    return this.compute.publisherTrustedAlgorithms || []
  }
}
