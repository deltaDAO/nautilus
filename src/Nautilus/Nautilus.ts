import type { AssetV5 } from '@oceanprotocol/ddo-js'
import {
  type ComputeEnvironment,
  type ComputeJob,
  type ComputeResultStream,
  type Config,
  ConfigHelper,
  LoggerInstance,
  type LogLevel,
  type SearchQuery
} from '@oceanprotocol/lib'
import { isAddress, type Signer, type TransactionReceipt } from 'ethers'
import type {
  AccessConfig,
  AccessResult,
  ComputeConfig,
  ComputeResult,
  ComputeResultConfig,
  ComputeStatusConfig,
  FreeComputeConfig,
  PublishedService,
  PublishResponse,
  StopComputeConfig
} from '../@types/index.js'
import type { AssetState } from '../@types/Nautilus.js'
import { access } from '../access/index.js'
import { compute, freeCompute, selectEnvironment } from '../compute/index.js'
import { getLifecycleState, getNftAddress } from '../ddo/read.js'
import { assertValid } from '../ddo/validate.js'
import type { CredentialProvider } from '../identity/CredentialProvider.js'
import { NoopCredentialProvider } from '../identity/CredentialProvider.js'
import { OceanNodeClient } from '../node/OceanNodeClient.js'
import {
  createDatatokenForService,
  createNftWithService,
  prepareMetadata,
  waitForMetadataPermission,
  writeMetadata
} from '../publish/index.js'
import type { RemoteStore } from '../remote/RemoteStore.js'
import { type DdoSigner, Eip191VcSigner } from '../signing/vc.js'
import { editPrice, setMetadataState } from '../utils/contracts.js'
import { resolvePublisherTrustedAlgorithms } from '../utils/helpers/trusted-algorithms.js'
import { getChainId } from '../utils/index.js'
import type { NautilusAsset } from './Asset/NautilusAsset.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Asset/Service/NautilusService.js'

export { LogLevel } from '@oceanprotocol/lib'

export interface NautilusOptions {
  /**
   * Where the signed DDO is stored. Required to publish, because nautilus writes a
   * `{remote}` pointer on chain rather than the document itself.
   */
  remoteStore?: RemoteStore
  /**
   * Signs the DDO as a verifiable credential. Defaults to signing with the Ethereum key
   * (`alg: 'ETH-EIP191'`); pass a `WaltIdVcSigner` to issue from a real DID.
   */
  ddoSigner?: DdoSigner
  /** Satisfies credential-gated access. Omit to skip SSI entirely. */
  credentials?: CredentialProvider
  /** Overrides for the chain config resolved from the signer's network. */
  config?: Partial<Config>
}

export interface PublishOptions {
  /** Encrypt the on-chain pointer. Default `true` (flags `0x02`). */
  encrypt?: boolean
  /** Block until the indexer has the asset, so the result is immediately resolvable. */
  waitForIndexer?: boolean
  /** Override the remote store for this call. */
  remoteStore?: RemoteStore
  /** Override the DDO signer for this call. */
  ddoSigner?: DdoSigner
}

/**
 * The nautilus client.
 *
 * @example
 * ```ts
 * import { JsonRpcProvider, Wallet } from 'ethers'
 * import { Nautilus } from '@deltadao/nautilus'
 *
 * const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')
 * const signer = new Wallet('0x…', provider)
 *
 * const nautilus = await Nautilus.create(signer, {
 *   config: { oceanNodeUri: 'https://node.example.org' }
 * })
 *
 * const { url } = await nautilus.access({ assetDid: 'did:ope:…' })
 * ```
 */
/**
 * The results endpoint addresses a job as `<environmentHash>-<jobId>`.
 *
 * It splits on the first dash to recover the compute environment
 * (`getResults.ts`), so a bare job id resolves to an empty hash and the node
 * answers "Invalid C2D Environment". Every other compute endpoint takes the
 * plain id, which is why this only applies here.
 */
function qualifyJobId(job: { jobId: string; environment?: string }): string {
  const [environmentHash] = (job.environment ?? '').split('-')

  if (!environmentHash) return job.jobId

  // Idempotent on purpose: `compute`/`freeCompute` hand back an already
  // qualified id while `getComputeStatus` reports the bare one, so this is
  // reached with both forms.
  const bare = job.jobId.startsWith(`${environmentHash}-`)
    ? job.jobId.slice(environmentHash.length + 1)
    : job.jobId

  return `${environmentHash}-${bare}`
}

export class Nautilus {
  private signer: Signer
  private config!: Config
  private node!: OceanNodeClient
  private options: NautilusOptions

  private constructor(signer: Signer, options: NautilusOptions) {
    this.signer = signer
    this.options = options
  }

  /** Creates an instance, resolving the chain config from the signer's network. */
  static async create(
    signer: Signer,
    options: NautilusOptions = {}
  ): Promise<Nautilus> {
    const instance = new Nautilus(signer, options)

    await instance.init()

    LoggerInstance.debug(
      `Nautilus ready on chain ${instance.config.chainId} via ${instance.config.oceanNodeUri}`
    )

    return instance
  }

  /** Sets the log level. ocean.js's `LoggerInstance` is used throughout. */
  static setLogLevel(level: LogLevel) {
    LoggerInstance.setLevel(level)
  }

  // #region setup

  private async init(): Promise<void> {
    const chainId = await getChainId(this.signer)
    const defaults = new ConfigHelper().getConfig(chainId)

    if (!defaults)
      LoggerInstance.debug(
        `No default Ocean config for chain ${chainId}; relying entirely on the config you passed.`
      )

    this.config = {
      ...(defaults || {}),
      chainId,
      ...this.options.config
    } as Config

    this.assertUsableConfig()

    this.node = new OceanNodeClient({
      nodeUri: this.config.oceanNodeUri as string,
      chainId: this.config.chainId,
      auth: this.signer
    })
  }

  /**
   * Checks the config can actually be used.
   *
   * Note what is *not* checked any more: `metadataCacheUri`, `providerUri` and
   * `subgraphUri` no longer exist on ocean.js's `Config`. One `oceanNodeUri` replaces the
   * first two, and the subgraph is gone entirely.
   */
  private assertUsableConfig(): void {
    const problems: string[] = []

    if (!(this.config.chainId > 0))
      problems.push('chainId is missing or not positive')
    if (!this.config.oceanNodeUri) problems.push('oceanNodeUri is not set')

    for (const field of [
      'nftFactoryAddress',
      'fixedRateExchangeAddress',
      'dispenserAddress'
    ] as const) {
      const value = this.config[field]
      if (!value || !isAddress(value))
        problems.push(`${field} is not a valid address`)
    }

    if (problems.length)
      throw new Error(
        `Cannot initialize Nautilus on chain ${this.config.chainId}: ${problems.join('; ')}. ConfigHelper only ships a few networks (Pontus-X devnet is 32456); pass the missing fields as \`config\` to Nautilus.create().`
      )
  }

  // #endregion

  // #region accessors

  getOceanConfig(): Config {
    return this.config
  }

  /** The ocean-node client, for calls nautilus does not wrap. */
  getNodeClient(): OceanNodeClient {
    return this.node
  }

  getSigner(): Signer {
    return this.signer
  }

  /** Swaps in a credential provider after construction. */
  setCredentialProvider(credentials: CredentialProvider): void {
    this.options.credentials = credentials
  }

  private getCredentialProvider(): CredentialProvider {
    return this.options.credentials || new NoopCredentialProvider()
  }

  // #endregion

  // #region metadata

  /** Resolves an asset by DID. */
  async getAsset(did: string): Promise<AssetV5> {
    return this.node.resolve(did)
  }

  /** Resolves several assets in one query, keyed by lower-cased DID. */
  async getAssets(dids: string[]): Promise<Record<string, AssetV5>> {
    return this.node.resolveMany(dids)
  }

  /** Raw metadata search against the node's index. */
  async query(query: SearchQuery): Promise<unknown> {
    return this.node.query(query)
  }

  /** Blocks until the indexer has the asset, or the update identified by `txid`. */
  async waitForIndexer(
    did: string,
    txid?: string
  ): Promise<AssetV5 | undefined> {
    return this.node.waitForIndexer(did, txid)
  }

  // #endregion

  // #region publish

  /**
   * Publishes a new asset.
   *
   * Creates one NFT-plus-datatoken bundle for the first service and a datatoken for each
   * further one, validates the DDO locally, signs it, stores it, and writes the pointer.
   */
  async publish(
    asset: NautilusAsset,
    options: PublishOptions = {}
  ): Promise<PublishResponse> {
    const owner = asset.owner || (await this.signer.getAddress())
    const services = asset.ddo.services

    if (!services.length)
      throw new Error('Cannot publish an asset with no services.')

    // Everything that does not need an on-chain address happens first. A missing remote
    // store, an unreachable serviceEndpoint or a file the node cannot read are all
    // failures of configuration, and discovering them after the NFT and datatokens had
    // been created only burned gas and left orphaned tokens behind.
    const remoteStore = this.requireRemoteStore(options)
    await resolvePublisherTrustedAlgorithms(this.node, services)
    await this.assertServicesPublishable(services)

    const published: PublishedService[] = []

    // The first service is bundled with the NFT, so publishing a single-service asset costs
    // one transaction rather than three.
    const [first, ...rest] = services

    const created = await createNftWithService({
      signer: this.signer,
      chainConfig: this.config,
      nftParams: asset.getNftParams(owner),
      service: first,
      owner
    })

    first.datatokenAddress = created.datatokenAddress
    published.push({
      service: first,
      datatokenAddress: created.datatokenAddress,
      tx: created.tx
    })

    for (const service of rest) {
      const { datatokenAddress, tx } = await createDatatokenForService({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress: created.nftAddress,
        service,
        owner
      })

      service.datatokenAddress = datatokenAddress
      published.push({ service, datatokenAddress, tx })
    }

    const result = await this.writeAsset(
      asset,
      created.nftAddress,
      true,
      options,
      remoteStore
    )

    return { ...result, nftAddress: created.nftAddress, services: published }
  }

  /**
   * Republishes an edited asset.
   *
   * Only services carrying a new pricing config get a new datatoken; everything else is
   * merged over the published document, so changing one field does not require resupplying
   * the rest.
   */
  async edit(
    asset: NautilusAsset,
    options: PublishOptions = {}
  ): Promise<PublishResponse> {
    const baseline = asset.ddo.getOriginalDDO()

    if (!baseline)
      throw new Error(
        'edit() needs an asset built from a resolved DDO. Construct the AssetBuilder with the asset you fetched.'
      )

    const nftAddress = getNftAddress(baseline)
    const owner = asset.owner || (await this.signer.getAddress())

    const remoteStore = this.requireRemoteStore(options)
    await resolvePublisherTrustedAlgorithms(this.node, asset.ddo.services)
    await this.assertServicesPublishable(asset.ddo.services)

    const published: PublishedService[] = []

    for (const service of asset.ddo.services) {
      if (!service.pricing) continue

      const { datatokenAddress, tx } = await createDatatokenForService({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress,
        service,
        owner
      })

      service.datatokenAddress = datatokenAddress
      published.push({ service, datatokenAddress, tx })
    }

    const result = await this.writeAsset(
      asset,
      nftAddress,
      false,
      options,
      remoteStore
    )

    return { ...result, nftAddress, services: published }
  }

  /**
   * The remote store this call will use, resolved before any transaction.
   *
   * Called from `publish()`/`edit()` rather than from `writeAsset()`: it is pure
   * configuration, and there is no sense in learning it is missing only after the tokens
   * have been minted.
   */
  private requireRemoteStore(options: PublishOptions): RemoteStore {
    const remoteStore = options.remoteStore || this.options.remoteStore

    if (!remoteStore)
      throw new Error(
        'Publishing needs a remote store for the signed DDO. Pass `remoteStore` to Nautilus.create() — for example an IpfsRemoteStore, or a NodePersistentRemoteStore to use the node itself.'
      )

    return remoteStore
  }

  /**
   * Endpoint and file checks for every service, before the first transaction.
   *
   * The results are memoized on each service, so the projection in `writeAsset()` reuses
   * them instead of repeating the round trips.
   */
  private async assertServicesPublishable(
    services: NautilusService<ServiceTypes, FileTypes>[]
  ): Promise<void> {
    for (const service of services) await service.assertPublishable(this.node)
  }

  /** Builds, validates, signs, stores and writes the DDO. Shared by publish and edit. */
  private async writeAsset(
    asset: NautilusAsset,
    nftAddress: string,
    create: boolean,
    options: PublishOptions,
    remoteStore: RemoteStore
  ): Promise<Omit<PublishResponse, 'nftAddress' | 'services'>> {
    const ddoSigner =
      options.ddoSigner ||
      this.options.ddoSigner ||
      new Eip191VcSigner(this.signer)

    const ddo = await asset.ddo.getDDO(this.node, {
      create,
      chainId: this.config.chainId,
      nftAddress
    })

    /**
     * The signer is authoritative for `issuer`, so stamp it before validating, signing or
     * returning the document. Leaving it to the signing envelope meant a builder-supplied
     * issuer was overwritten there and nowhere else: `setIssuer()` looked like it worked,
     * SHACL validated a document that was never signed, and `PublishResponse.ddo` reported
     * an issuer the credential did not carry. A declared issuer that names someone other
     * than the signer is rejected by `toCredential()` rather than silently replaced.
     */
    ddo.issuer = await ddoSigner.getIssuer()

    // Local SHACL validation, before anything is signed or written. Cheap, and it names the
    // exact failing field — the node never sees this document, so nothing else would.
    await assertValid(ddo)

    if (create)
      await waitForMetadataPermission({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress
      })

    const prepared = await prepareMetadata({
      node: this.node,
      ddo,
      signer: ddoSigner,
      remoteStore,
      did: ddo.id as string,
      encrypt: options.encrypt
    })

    const lifecycleState = (asset.lifecycleState ?? 0) as number

    const setMetadataTxReceipt = await writeMetadata({
      signer: this.signer,
      chainConfig: this.config,
      nftAddress,
      nodeUri: this.config.oceanNodeUri as string,
      lifecycleState,
      prepared
    })

    let indexed: boolean | undefined
    if (options.waitForIndexer)
      indexed = Boolean(
        await this.node.waitForIndexer(
          ddo.id as string,
          setMetadataTxReceipt.hash
        )
      )

    return {
      ddo,
      credential: prepared.credential,
      setMetadataTxReceipt,
      ...(indexed === undefined ? {} : { indexed })
    }
  }

  /** Sets a new fixed-rate price for a service. */
  async setServicePrice(
    asset: AssetV5,
    serviceId: string,
    newPrice: string
  ): Promise<TransactionReceipt> {
    if (
      typeof newPrice !== 'string' ||
      Number.isNaN(Number.parseFloat(newPrice))
    )
      throw new Error('newPrice must be a numeric string, e.g. "2.5".')

    return editPrice({
      asset,
      serviceId,
      newPrice,
      chainConfig: this.config,
      signer: this.signer
    })
  }

  /** Changes the asset's lifecycle state on its NFT. */
  async setAssetLifecycleState(
    asset: AssetV5,
    state: AssetState
  ): Promise<TransactionReceipt | undefined> {
    const current = getLifecycleState(asset)

    if (current === state) {
      LoggerInstance.warn(
        `[lifecycle] asset ${asset.id} is already in state ${state}; nothing to do`
      )
      return undefined
    }

    return setMetadataState({
      nftAddress: getNftAddress(asset),
      state: state as number,
      chainConfig: this.config,
      signer: this.signer
    })
  }

  // #endregion

  // #region access

  /** Orders a service if needed and returns a one-time download URL. */
  async access(config: AccessConfig): Promise<AccessResult> {
    return access(config, {
      node: this.node,
      signer: this.signer,
      chainConfig: this.config,
      credentials: this.getCredentialProvider()
    })
  }

  // #endregion

  // #region compute

  /** Lists the node's compute environments, with their resources, limits and fees. */
  async getComputeEnvironments(): Promise<ComputeEnvironment[]> {
    return this.node.getComputeEnvironments()
  }

  /** Resolves one environment by id, or the node's first. */
  async getComputeEnvironment(
    computeEnv?: string
  ): Promise<ComputeEnvironment> {
    return selectEnvironment(this.node, computeEnv)
  }

  /** Starts a paid compute job: orders inputs, funds escrow, then starts. */
  async compute(config: ComputeConfig): Promise<ComputeResult> {
    return compute(config, {
      node: this.node,
      signer: this.signer,
      chainConfig: this.config,
      credentials: this.getCredentialProvider()
    })
  }

  /** Starts a free compute job. No orders, no escrow, no payment token. */
  async freeCompute(
    config: FreeComputeConfig
  ): Promise<Omit<ComputeResult, 'initializeResults' | 'orders'>> {
    return freeCompute(config, {
      node: this.node,
      signer: this.signer,
      chainConfig: this.config,
      credentials: this.getCredentialProvider()
    })
  }

  async getComputeStatus(
    config: ComputeStatusConfig
  ): Promise<ComputeJob | undefined> {
    return this.nodeFor(config.nodeUri).getComputeJob(config.jobId)
  }

  /** `JobFinished` and `JobSettle` — see `getComputeResult` below. */
  private static readonly TERMINAL_JOB_STATUSES = [70, 71]

  /**
   * A download URL for a finished job's result.
   *
   * Defaults to the first `output` result. Statuses 70 (`JobFinished`) and 71
   * (`JobSettle`) are both terminal for results — see `TERMINAL_JOB_STATUSES`.
   */
  async getComputeResult(
    config: ComputeResultConfig
  ): Promise<string | undefined> {
    const node = this.nodeFor(config.nodeUri)
    const job = await node.getComputeJob(config.jobId)

    if (!job) {
      LoggerInstance.warn(`[compute] node does not know job ${config.jobId}`)
      return undefined
    }

    /**
     * 70 is `JobFinished`, 71 is `JobSettle`. Both are terminal as far as
     * results go: by the time a job reaches 71 the algorithm has run and the
     * node has already listed its outputs — it is only waiting on the
     * payment-claim cron, which a free job never has anything to do for.
     * Treating 71 as unfinished made results unreachable for the whole of that
     * window (an hour by default).
     */
    if (!Nautilus.TERMINAL_JOB_STATUSES.includes(job.status)) {
      LoggerInstance.log(
        `[compute] job ${config.jobId} is not finished yet (status ${job.status}: ${job.statusText})`
      )
      return undefined
    }

    const index =
      config.resultIndex ??
      job.results?.findIndex((result) => result.type === 'output')

    if (index === undefined || index < 0) {
      LoggerInstance.error(
        `[compute] job ${config.jobId} has no 'output' result; pass resultIndex explicitly. Results: ${JSON.stringify(job.results)}`
      )
      return undefined
    }

    return node.getComputeResultUrl(qualifyJobId(job), index)
  }

  /** Streams a result instead of returning a URL. */
  async streamComputeResult(
    config: ComputeResultConfig
  ): Promise<ComputeResultStream> {
    const node = this.nodeFor(config.nodeUri)
    const job = await node.getComputeJob(config.jobId)

    if (!job)
      throw new Error(`[compute] node does not know job ${config.jobId}`)

    return node.getComputeResult(
      qualifyJobId({ ...job, jobId: config.jobId }),
      config.resultIndex ?? 0
    )
  }

  /** Streamable job logs — useful while a job is still running. */
  async getComputeLogs(config: ComputeStatusConfig): Promise<unknown> {
    const node = this.nodeFor(config.nodeUri)

    return node.getComputeLogs(await this.qualify(node, config.jobId))
  }

  async stopCompute(config: StopComputeConfig): Promise<ComputeJob[]> {
    const node = this.nodeFor(config.nodeUri)

    return node.computeStop(
      await this.qualify(node, config.jobId),
      config.agreementId
    )
  }

  /**
   * Rewrites a bare job id into the `<environmentHash>-<jobId>` form.
   *
   * The results, streamable-logs and stop handlers all recover the compute
   * environment by splitting the id on its first dash, so a bare id leaves them
   * with an empty hash and they answer "Invalid C2D Environment" — or, for
   * stop, a bare 500. `getComputeStatus` is the exception: it tolerates either.
   *
   * nautilus reports bare ids everywhere (see `normaliseJobIds`), so this is
   * where the node's preferred form is put back.
   */
  private async qualify(node: OceanNodeClient, jobId: string): Promise<string> {
    const job = await node.getComputeJob(jobId)

    return job ? qualifyJobId({ ...job, jobId }) : jobId
  }

  /** A client for another node, when a job runs somewhere other than the default. */
  private nodeFor(nodeUri?: string): OceanNodeClient {
    if (!nodeUri || nodeUri === this.node.nodeUri) return this.node

    return new OceanNodeClient({
      nodeUri,
      chainId: this.config.chainId,
      auth: this.signer
    })
  }

  // #endregion
}
