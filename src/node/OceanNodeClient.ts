/**
 * The single seam between nautilus and ocean-node.
 *
 * ocean-node replaced both Aquarius and Provider. ocean.js still exposes them as two
 * objects — the `Aquarius` class for metadata and `ProviderInstance` for services — so
 * this client puts them behind one façade, binds the node URI and auth mode once, and
 * gives every call the same error contract.
 *
 * Why a wrapper rather than calling ocean.js directly:
 *
 *   - **Error handling.** Several ocean.js methods swallow failures and return
 *     `null`/`undefined` (`Aquarius.validate`, `sendPreparedTransaction`). A silent
 *     `undefined` three frames later is far worse than a throw at the call site.
 *   - **Auth.** Every method takes `SignerOrAuthTokenOrSignature` separately; binding it
 *     once removes a repeated argument and a repeated mistake.
 *   - **The policy-server slot.** `policyServer` is an opaque `any` threaded through five
 *     methods. Keeping it in one place is what lets the identity layer stay out of the flows.
 *
 * One thing this client deliberately does *not* do: cache endpoint discovery. Every
 * `ProviderInstance` call re-fetches the node root to resolve its service endpoint, which
 * costs two extra round-trips per operation, but `getEndpoints`/`getServiceEndpoints` live
 * on `HttpProvider` and are not reachable through the `BaseProvider` façade, so there is
 * no supported way to hand them in. What *is* memoized is nautilus's own repeated
 * probing — see `isValidNode()`.
 */
import type { AssetV5, ValidateMetadata } from '@oceanprotocol/ddo-js'
import {
  Aquarius,
  type ComputeAlgorithm,
  type ComputeAsset,
  type ComputeEnvironment,
  type ComputeJob,
  type ComputeJobMetadata,
  type ComputeOutput,
  type ComputeResourceRequest,
  type ComputeResultStream,
  type DownloadResponse,
  type FileInfo,
  type NodeStatus,
  type PersistentStorageFileEntry,
  type ProviderComputeInitializeResults,
  type ProviderInitialize,
  ProviderInstance,
  type SearchQuery,
  type StorageObject,
  type UserCustomParameters
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type { PolicyServerPayload } from '../ddo/types.js'
import { isSigner, type NodeAuth, resolveConsumerAddress } from './auth.js'

/** Payload accepted by the `policyServer` slots: one entry, or one per compute asset. */
export type PolicyServerArg =
  | PolicyServerPayload
  | PolicyServerPayload[]
  | null
  | undefined

export interface OceanNodeClientOptions {
  /** The ocean-node URI. An HTTP URL, or a peerId/multiaddr to use the libp2p transport. */
  nodeUri: string
  chainId: number
  /** A Signer, a JWT auth token, or a pre-computed signature. */
  auth: NodeAuth
  /** Required when `auth` is a JWT, which nautilus cannot decode. */
  consumerAddress?: string
}

/** Thrown when ocean-node rejects a request or answers unusably. */
export class OceanNodeError extends Error {
  readonly operation: string
  readonly cause?: unknown

  constructor(operation: string, message: string, cause?: unknown) {
    super(`[ocean-node] ${operation}: ${message}`)
    this.name = 'OceanNodeError'
    this.operation = operation
    this.cause = cause
  }
}

async function attempt<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new OceanNodeError(
      operation,
      error instanceof Error ? error.message : String(error),
      error
    )
  }
}

export class OceanNodeClient {
  readonly nodeUri: string
  readonly chainId: number

  private readonly aquarius: Aquarius
  private auth: NodeAuth
  private consumerAddressOverride?: string

  /** Memoized `isValidProvider` probes, keyed by URI. Service endpoints are re-checked
   * once per service on every publish, and the answer does not change mid-run. */
  private static readonly validityCache = new Map<string, Promise<boolean>>()

  constructor(options: OceanNodeClientOptions) {
    this.nodeUri = options.nodeUri
    this.chainId = options.chainId
    this.auth = options.auth
    this.consumerAddressOverride = options.consumerAddress
    this.aquarius = new Aquarius(options.nodeUri)
  }

  /** Swap in a session token after minting one, so later calls skip nonce-and-sign. */
  setAuth(auth: NodeAuth, consumerAddress?: string): void {
    this.auth = auth
    if (consumerAddress) this.consumerAddressOverride = consumerAddress
  }

  getAuth(): NodeAuth {
    return this.auth
  }

  /** The signer, when one is available. Contract calls need a real signer, not a token. */
  requireSigner(): Signer {
    if (!isSigner(this.auth))
      throw new OceanNodeError(
        'requireSigner',
        'this operation needs a Signer, but the client was constructed with an auth token or a pre-computed signature'
      )

    return this.auth
  }

  async getConsumerAddress(): Promise<string> {
    return resolveConsumerAddress(this.auth, this.consumerAddressOverride)
  }

  // #region metadata

  /** Resolves a DID. Throws rather than returning `undefined` for an unknown asset. */
  async resolve(did: string, signal?: AbortSignal): Promise<AssetV5> {
    const asset = await attempt('resolve', () =>
      this.aquarius.resolve(did, signal)
    )

    if (!asset) throw new OceanNodeError('resolve', `no asset found for ${did}`)

    return asset as unknown as AssetV5
  }

  /**
   * Blocks until the indexer has picked up the asset, or the update identified by `txid`.
   * Returns `undefined` on timeout rather than throwing, so callers can decide.
   */
  async waitForIndexer(
    did: string,
    txid?: string,
    options: {
      interval?: number
      maxRetries?: number
      signal?: AbortSignal
    } = {}
  ): Promise<AssetV5 | undefined> {
    const asset = await attempt('waitForIndexer', () =>
      this.aquarius.waitForIndexer(
        did,
        txid,
        options.signal,
        options.interval,
        options.maxRetries
      )
    )

    return (asset as unknown as AssetV5) || undefined
  }

  /** Raw metadata query. Note the endpoint-path caveat in the module docs of `../index`. */
  async query(query: SearchQuery, signal?: AbortSignal): Promise<unknown> {
    return attempt('query', () => this.aquarius.querySearch(query, signal))
  }

  /** Resolves many DIDs in one query, keyed by lower-cased DID. */
  async resolveMany(dids: string[]): Promise<Record<string, AssetV5>> {
    if (!dids.length) return {}

    const response = (await this.query({
      query: {
        bool: {
          filter: [{ ids: { values: dids.map((d) => d.toLowerCase()) } }]
        }
      },
      size: dids.length
    })) as { hits?: { hits?: { _source?: AssetV5 }[] } }

    const assets: Record<string, AssetV5> = {}

    for (const hit of response?.hits?.hits || []) {
      const asset = hit._source
      if (asset?.id) assets[asset.id.toLowerCase()] = asset
    }

    return assets
  }

  /**
   * Asks the node to validate a DDO and return its authoritative metadata hash.
   *
   * Only needed when writing the DDO itself on chain. Nautilus publishes a signed
   * `{remote}` pointer and computes that hash client-side, so this is here for callers
   * who need the node-validated hash instead. `Aquarius.validate` logs and returns
   * `undefined` on failure, which is normalized to a throw.
   */
  async validateRemote(
    ddo: unknown,
    signal?: AbortSignal
  ): Promise<ValidateMetadata> {
    const result = await attempt('validate', () =>
      this.aquarius.validate(
        // biome-ignore lint/suspicious/noExplicitAny: ocean.js types this parameter as the v4 DDO
        ddo as any,
        this.requireSigner(),
        this.nodeUri,
        signal
      )
    )

    if (!result?.valid || !result.hash)
      throw new OceanNodeError(
        'validate',
        'the node did not return a metadata hash; the DDO was rejected'
      )

    return result
  }

  // #endregion

  // #region files and encryption

  /** `true` if the URI answers as an ocean-node. Memoized per URI for the process. */
  async isValidNode(uri: string = this.nodeUri): Promise<boolean> {
    const cached = OceanNodeClient.validityCache.get(uri)
    if (cached) return cached

    const probe = ProviderInstance.isValidProvider(uri).catch(() => false)
    OceanNodeClient.validityCache.set(uri, probe)

    return probe
  }

  /** Clears the memoized node probes. Only needed in tests. */
  static clearValidityCache(): void {
    OceanNodeClient.validityCache.clear()
  }

  async getFileInfo(
    file: StorageObject,
    withChecksum = false,
    signal?: AbortSignal
  ): Promise<FileInfo[]> {
    return attempt('getFileInfo', () =>
      ProviderInstance.getFileInfo(file, this.nodeUri, withChecksum, signal)
    )
  }

  /** File info for an already-published service, used to derive algorithm checksums. */
  async checkDidFiles(
    did: string,
    serviceId: string,
    withChecksum = true,
    signal?: AbortSignal
  ): Promise<FileInfo[]> {
    return attempt('checkDidFiles', () =>
      ProviderInstance.checkDidFiles(
        did,
        serviceId,
        this.nodeUri,
        withChecksum,
        signal
      )
    )
  }

  /**
   * Node-side encryption, used for service file objects and for the on-chain metadata.
   * Unlike ocean.js 3.x this requires auth, so the client's signer/token is passed through.
   */
  async encrypt(
    data: unknown,
    policyServer?: PolicyServerArg,
    signal?: AbortSignal
  ): Promise<string> {
    const encrypted = await attempt('encrypt', () =>
      ProviderInstance.encrypt(
        data,
        this.chainId,
        this.nodeUri,
        this.auth,
        policyServer ?? undefined,
        signal
      )
    )

    if (!encrypted)
      throw new OceanNodeError(
        'encrypt',
        'the node returned an empty ciphertext'
      )

    return encrypted
  }

  // #endregion

  // #region access

  /** Provider fees and any reusable order for a service. */
  async initialize(
    did: string,
    serviceId: string,
    options: {
      fileIndex?: number
      consumerAddress?: string
      userdata?: UserCustomParameters
      computeEnv?: string
      validUntil?: number
      signal?: AbortSignal
    } = {}
  ): Promise<ProviderInitialize> {
    const consumerAddress =
      options.consumerAddress || (await this.getConsumerAddress())

    const result = await attempt('initialize', () =>
      ProviderInstance.initialize(
        did,
        serviceId,
        options.fileIndex ?? 0,
        consumerAddress,
        this.nodeUri,
        options.signal,
        options.userdata,
        options.computeEnv,
        options.validUntil
      )
    )

    if (!result)
      throw new OceanNodeError(
        'initialize',
        `the node did not advertise an initialize endpoint for ${did}`
      )

    return result
  }

  /**
   * Builds the one-time download URL. `policyServer` carries the verifier session id when
   * the service is credential-gated.
   */
  async getDownloadUrl(
    did: string,
    serviceId: string,
    transferTxId: string,
    options: {
      fileIndex?: number
      policyServer?: PolicyServerArg
      userdata?: UserCustomParameters
    } = {}
  ): Promise<string> {
    const url = await attempt('getDownloadUrl', () =>
      ProviderInstance.getDownloadUrl(
        did,
        serviceId,
        options.fileIndex ?? 0,
        transferTxId,
        this.nodeUri,
        this.auth,
        options.policyServer ?? undefined,
        options.userdata
      )
    )

    if (!url)
      throw new OceanNodeError(
        'getDownloadUrl',
        'the node returned no download URL'
      )

    return typeof url === 'string'
      ? url
      : (url as DownloadResponse as unknown as string)
  }

  // #endregion

  // #region compute

  async getComputeEnvironments(
    signal?: AbortSignal
  ): Promise<ComputeEnvironment[]> {
    const environments = await attempt('getComputeEnvironments', () =>
      ProviderInstance.getComputeEnvironments(this.nodeUri, signal)
    )

    return environments || []
  }

  async initializeCompute(params: {
    datasets: ComputeAsset[]
    algorithm: ComputeAlgorithm
    computeEnv: string
    paymentToken: string
    validUntil: number
    resources: ComputeResourceRequest[]
    consumerAddress?: string
    policyServer?: PolicyServerArg
    queueMaxWaitTime?: number
    output?: ComputeOutput
    signal?: AbortSignal
  }): Promise<ProviderComputeInitializeResults> {
    const consumerAddress =
      params.consumerAddress || (await this.getConsumerAddress())

    const result = await attempt('initializeCompute', () =>
      ProviderInstance.initializeCompute(
        params.datasets,
        params.algorithm,
        params.computeEnv,
        params.paymentToken,
        params.validUntil,
        this.nodeUri,
        consumerAddress,
        params.resources,
        this.chainId,
        params.policyServer ?? undefined,
        params.signal,
        params.queueMaxWaitTime,
        undefined,
        params.output
      )
    )

    if (!result)
      throw new OceanNodeError(
        'initializeCompute',
        'the node returned no init result'
      )

    return result
  }

  async computeStart(params: {
    computeEnv: string
    datasets: ComputeAsset[]
    algorithm: ComputeAlgorithm
    maxJobDuration: number
    paymentToken: string
    resources: ComputeResourceRequest[]
    metadata?: ComputeJobMetadata
    additionalViewers?: string[]
    output?: ComputeOutput
    policyServer?: PolicyServerArg
    queueMaxWaitTime?: number
    outputBucketId?: string
    signal?: AbortSignal
  }): Promise<ComputeJob[]> {
    const jobs = await attempt('computeStart', () =>
      ProviderInstance.computeStart(
        this.nodeUri,
        this.auth,
        params.computeEnv,
        params.datasets,
        params.algorithm,
        params.maxJobDuration,
        params.paymentToken,
        params.resources,
        this.chainId,
        params.metadata,
        params.additionalViewers,
        params.output,
        params.policyServer ?? undefined,
        params.signal,
        params.queueMaxWaitTime,
        undefined,
        params.outputBucketId
      )
    )

    return toJobArray('computeStart', jobs)
  }

  /** Free compute: no order, no escrow, no payment token. Gated by `env.free`. */
  async freeComputeStart(params: {
    computeEnv: string
    datasets: ComputeAsset[]
    algorithm: ComputeAlgorithm
    resources?: ComputeResourceRequest[]
    metadata?: ComputeJobMetadata
    additionalViewers?: string[]
    output?: ComputeOutput
    policyServer?: PolicyServerArg
    queueMaxWaitTime?: number
    outputBucketId?: string
    signal?: AbortSignal
  }): Promise<ComputeJob[]> {
    const jobs = await attempt('freeComputeStart', () =>
      ProviderInstance.freeComputeStart(
        this.nodeUri,
        this.auth,
        params.computeEnv,
        params.datasets,
        params.algorithm,
        params.resources,
        params.metadata,
        params.additionalViewers,
        params.output,
        params.policyServer ?? undefined,
        params.signal,
        params.queueMaxWaitTime,
        undefined,
        params.outputBucketId
      )
    )

    return toJobArray('freeComputeStart', jobs)
  }

  async computeStatus(
    jobId?: string,
    agreementId?: string,
    signal?: AbortSignal
  ): Promise<ComputeJob[]> {
    const status = await attempt('computeStatus', () =>
      ProviderInstance.computeStatus(
        this.nodeUri,
        this.auth,
        jobId,
        agreementId,
        signal
      )
    )

    return Array.isArray(status) ? status : status ? [status] : []
  }

  /** Status of one job, or `undefined` if the node does not know it. */
  async getComputeJob(
    jobId: string,
    signal?: AbortSignal
  ): Promise<ComputeJob | undefined> {
    const jobs = await this.computeStatus(jobId, undefined, signal)

    return jobs.find((job) => job.jobId === jobId) || jobs[0]
  }

  async computeStop(
    jobId: string,
    agreementId?: string,
    signal?: AbortSignal
  ): Promise<ComputeJob[]> {
    const jobs = await attempt('computeStop', () =>
      ProviderInstance.computeStop(
        jobId,
        this.nodeUri,
        this.auth,
        agreementId,
        signal
      )
    )

    return toJobArray('computeStop', jobs)
  }

  async getComputeResultUrl(jobId: string, index: number): Promise<string> {
    const url = await attempt('getComputeResultUrl', () =>
      ProviderInstance.getComputeResultUrl(
        this.nodeUri,
        this.auth,
        jobId,
        index
      )
    )

    if (!url)
      throw new OceanNodeError(
        'getComputeResultUrl',
        'the node returned no result URL'
      )

    return url
  }

  /** Streams a result instead of handing back a URL. */
  async getComputeResult(
    jobId: string,
    index: number,
    offset = 0
  ): Promise<ComputeResultStream> {
    return attempt('getComputeResult', () =>
      ProviderInstance.getComputeResult(
        this.nodeUri,
        this.auth,
        jobId,
        index,
        offset
      )
    )
  }

  async getComputeLogs(jobId: string, signal?: AbortSignal): Promise<unknown> {
    return attempt('computeStreamableLogs', () =>
      ProviderInstance.computeStreamableLogs(
        this.nodeUri,
        this.auth,
        jobId,
        signal
      )
    )
  }

  // #endregion

  // #region policy server

  /**
   * Starts a policy-server verification for one asset/service.
   *
   * Returns `null` when the node does not advertise the endpoint — the clean feature-test
   * for "this deployment has no policy server", which callers should treat as "SSI is
   * unavailable" rather than as an error.
   */
  async initializePolicyVerification(
    request: {
      documentId: string
      serviceId: string
      consumerAddress: string
      policyServer: unknown
    },
    signal?: AbortSignal
  ): Promise<unknown | null> {
    return attempt('initializePSVerification', () =>
      ProviderInstance.initializePSVerification(
        this.nodeUri,
        this.auth,
        request,
        signal
      )
    )
  }

  /** Forwards an action to the policy server through the node. */
  async policyServerPassthrough(
    action: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    return attempt('PolicyServerPassthrough', () =>
      ProviderInstance.PolicyServerPassthrough(
        this.nodeUri,
        { policyServerPassthrough: action },
        signal
      )
    )
  }

  // #endregion

  // #region node

  async getNodeStatus(signal?: AbortSignal): Promise<NodeStatus> {
    return attempt('getNodeStatus', () =>
      ProviderInstance.getNodeStatus(this.nodeUri, signal)
    )
  }

  // #endregion

  // #region persistent storage

  async createBucket(
    accessLists: Parameters<
      typeof ProviderInstance.createPersistentStorageBucket
    >[2]['accessLists'],
    label?: string
  ): Promise<string> {
    const bucket = await attempt('createPersistentStorageBucket', () =>
      ProviderInstance.createPersistentStorageBucket(this.nodeUri, this.auth, {
        accessLists,
        label
      })
    )

    if (!bucket?.bucketId)
      throw new OceanNodeError(
        'createPersistentStorageBucket',
        'no bucketId returned'
      )

    return bucket.bucketId
  }

  async uploadFile(
    bucketId: string,
    fileName: string,
    content: Parameters<typeof ProviderInstance.uploadPersistentStorageFile>[4]
  ): Promise<PersistentStorageFileEntry> {
    return attempt('uploadPersistentStorageFile', () =>
      ProviderInstance.uploadPersistentStorageFile(
        this.nodeUri,
        this.auth,
        bucketId,
        fileName,
        content
      )
    )
  }

  async getFileObject(
    bucketId: string,
    fileName: string
  ): Promise<StorageObject> {
    return attempt('getPersistentStorageFileObject', () =>
      ProviderInstance.getPersistentStorageFileObject(
        this.nodeUri,
        this.auth,
        bucketId,
        fileName
      )
    ) as Promise<StorageObject>
  }

  // #endregion
}

function toJobArray(
  operation: string,
  jobs: ComputeJob | ComputeJob[]
): ComputeJob[] {
  if (!jobs)
    throw new OceanNodeError(operation, 'the node returned no compute job')

  return Array.isArray(jobs) ? jobs : [jobs]
}
