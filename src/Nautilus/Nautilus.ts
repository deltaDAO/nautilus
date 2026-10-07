import type { AssetV5 } from '@oceanprotocol/ddo-js'
import {
  type ComputeEnvironment,
  type ComputeJob,
  type ComputeResultStream,
  type Config,
  ConfigHelper,
  LoggerInstance,
  type LogLevel,
  Nft,
  NftFactory,
  type SearchQuery
} from '@oceanprotocol/lib'
import {
  getAddress,
  isAddress,
  type Signer,
  type TransactionReceipt
} from 'ethers'
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
import {
  IndexerNonceStuckError,
  isIndexerNonceSignable,
  OceanNodeClient,
  type WaitForIndexerOptions
} from '../node/OceanNodeClient.js'
import {
  assertDdoFitsDecryptLimit,
  assertDid,
  assertEncryptOption,
  assertWritableState,
  readMetadataState
} from '../publish/envelope.js'
import {
  createDatatokenForService,
  createNftWithService,
  createPricingForDatatoken,
  MetadataConflictError,
  PublishIncompleteError,
  prepareMetadataForWrite,
  settleStoredEnvelope,
  waitForMetadataPermission,
  writeMetadata
} from '../publish/index.js'
import { NodePersistentRemoteStore } from '../remote/NodePersistentRemoteStore.js'
import type { RemoteStore } from '../remote/RemoteStore.js'
import { type DdoSigner, Eip191VcSigner } from '../signing/vc.js'
import {
  editPrice,
  getMetadataEventsInBlock,
  getNftDatatokens,
  setMetadataState
} from '../utils/contracts.js'
import { resolvePublisherTrustedAlgorithms } from '../utils/helpers/trusted-algorithms.js'
import { errorMessage } from '../utils/http.js'
import { getChainId } from '../utils/index.js'
import { getPricingInfo } from '../utils/pricing.js'
import { assertSecureTransport } from '../utils/transport.js'
import { warnOnce } from '../utils/warn.js'
import type { NautilusAsset } from './Asset/NautilusAsset.js'
import { PLACEHOLDER_ADDRESS } from './Asset/NautilusDDO.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Asset/Service/NautilusService.js'

export { LogLevel } from '@oceanprotocol/lib'

/** The polling options for `waitForIndexer`, from `PublishOptions.waitForIndexer`. */
function indexerOptions(options: PublishOptions): WaitForIndexerOptions {
  return typeof options.waitForIndexer === 'object'
    ? options.waitForIndexer
    : {}
}

/** Whether the NFT already carries metadata (`getMetaData()`'s `hasMetaData`). */
async function hasMetadata(
  signer: Signer,
  config: Config,
  nftAddress: string
): Promise<boolean> {
  const metadata = (await new Nft(signer, config.chainId, config).getMetadata(
    nftAddress
  )) as unknown[]

  return Boolean(metadata?.[3])
}

/**
 * Which existing datatoken of the NFT each service reuses in `completePublish()`.
 *
 * A service that already names a datatoken must name one of the NFT's. The NFT's other
 * datatokens go, in creation order, to the services without one, in service order: the
 * order `publish()` created them in. Services left over get new datatokens. More unclaimed
 * datatokens than services to give them to is ambiguous, so that is refused.
 */
function reconcileDatatokens(
  services: NautilusService<ServiceTypes, FileTypes>[],
  onNft: string[],
  nftAddress: string
): Map<NautilusService<ServiceTypes, FileTypes>, string> {
  const known = new Map(onNft.map((token) => [token.toLowerCase(), token]))
  const reuse = new Map<NautilusService<ServiceTypes, FileTypes>, string>()
  const claimed = new Set<string>()

  for (const service of services) {
    if (!service.datatokenAddress) continue

    const key = service.datatokenAddress.toLowerCase()
    const token = known.get(key)

    if (!token)
      throw new Error(
        `completePublish: service ${service.name || service.id} names datatoken ${service.datatokenAddress}, which is not a datatoken of NFT ${nftAddress} (it has ${onNft.join(', ') || 'none'}). Orders would pay into another asset's token.`
      )
    if (claimed.has(key))
      throw new Error(
        `completePublish: more than one service names datatoken ${service.datatokenAddress}.`
      )

    claimed.add(key)
    reuse.set(service, token)
  }

  const unclaimed = onNft.filter((token) => !claimed.has(token.toLowerCase()))
  const without = services.filter((service) => !service.datatokenAddress)

  if (unclaimed.length > without.length)
    throw new Error(
      `completePublish: NFT ${nftAddress} has ${unclaimed.length} datatoken(s) no service names (${unclaimed.join(', ')}), but only ${without.length} service(s) without one, so it is unclear which belongs where. Set datatokenAddress on each service.`
    )

  unclaimed.forEach((token, index) => {
    reuse.set(without[index], token)
  })

  return reuse
}

/**
 * Attaches the response of a write whose metadata transaction was mined to the error that
 * followed it, as `error.published`, and says so in the message.
 */
function attachPublished(error: unknown, published: PublishResponse): unknown {
  if (!error || typeof error !== 'object') return error

  const target = error as Error & { published?: PublishResponse }
  target.published = published

  if (typeof target.message === 'string')
    target.message += ` The metadata transaction ${published.setMetadataTxReceipt.hash} was mined, so ${published.nftAddress} carries the new metadata; the full result is on error.published.`

  return target
}

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
  /**
   * Accept a plain `http://` `oceanNodeUri` on a host other than `localhost`,
   * `127.0.0.1`, `::1` or `*.localhost`. Default `false`: the plaintext pointer (an S3 read
   * key included) and the signed DDO go to the node for encryption, and node auth travels
   * with every request.
   */
  allowInsecureTransport?: boolean
}

export interface PublishOptions {
  /**
   * Block until the indexer has the asset, so the result is immediately resolvable. Pass
   * `{ intervalMs, timeoutMs }` to tune the polling. Throws an `IndexingError` when the
   * node records that it could not index the asset, and an `OceanNodeError` on timeout.
   * Either way the metadata transaction was mined: the error carries the full
   * `PublishResponse` as `error.published` (see `PublishedNotIndexed`).
   *
   * There is no `encrypt` option any more: the pointer and the stored envelope are always
   * node-encrypted, and `encrypt: false` throws.
   */
  waitForIndexer?:
    | boolean
    | Pick<WaitForIndexerOptions, 'intervalMs' | 'timeoutMs'>
  /** Override the remote store for this call. */
  remoteStore?: RemoteStore
  /** Override the DDO signer for this call. */
  ddoSigner?: DdoSigner
  /**
   * Before the first transaction, read the node's indexer nonce
   * (`OceanNodeClient.getIndexerNonceState()`, two GETs, nothing signed) and throw an
   * `IndexerNonceStuckError` when the indexer nonce is stuck, since the asset would not be
   * indexed. A node that does not answer is not an error: the check is
   * skipped. Default `true`; `false` skips it.
   */
  checkIndexerNonce?: boolean
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

  /**
   * One promise chain per NFT (lower-cased), so this instance's publish, edit and
   * lifecycle transactions for one asset never run concurrently. See `withNftLock()`.
   */
  private readonly nftLocks = new Map<string, Promise<void>>()

  /** The one-time check that the publisher is not the node's own key. */
  private nodeKeyCheck?: Promise<void>

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

    // `config.chainId` must not override the network the signer is on: the contract
    // addresses would then belong to another chain than the transactions.
    const configured = this.options.config?.chainId
    if (configured !== undefined && Number(configured) !== chainId)
      throw new Error(
        `Nautilus.create: config.chainId is ${configured}, but the signer's provider is on chain ${chainId}. Connect the signer to the right RPC, or drop config.chainId.`
      )

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
      auth: this.signer,
      allowInsecureTransport: this.options.allowInsecureTransport
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
    else
      assertSecureTransport(
        this.config.oceanNodeUri,
        'oceanNodeUri',
        this.options.allowInsecureTransport
      )

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

  /**
   * Blocks until the indexer has the asset, or the update identified by `txid`.
   *
   * Throws an `IndexingError` with the node's message when the node records that it
   * could not index it, and an `OceanNodeError` once `timeoutMs` (default 5 minutes) is up.
   */
  async waitForIndexer(
    did: string,
    txid?: string,
    options?: WaitForIndexerOptions
  ): Promise<AssetV5> {
    return this.node.waitForIndexer(did, txid, options)
  }

  // #endregion

  // #region publish

  /**
   * Publishes a new asset.
   *
   * Creates one NFT-plus-datatoken bundle for the first service and a datatoken for each
   * further one, validates the DDO locally, signs it, stores it, reads it back
   * (`RemoteStore.verify`), and writes the pointer.
   */
  async publish(
    asset: NautilusAsset,
    options: PublishOptions = {}
  ): Promise<PublishResponse> {
    assertEncryptOption(options)
    assertWritableState(asset.lifecycleState ?? 0, 'the asset')

    const owner = asset.owner || (await this.signer.getAddress())
    const services = asset.ddo.services

    if (!services.length)
      throw new Error('Cannot publish an asset with no services.')

    // Everything that does not need an on-chain address happens first. A missing remote
    // store, an unreachable serviceEndpoint or a file the node cannot read are all
    // failures of configuration, and discovering them after the NFT and datatokens had
    // been created only burned gas and left orphaned tokens behind.
    const remoteStore = this.requireRemoteStore(options)
    const ddoSigner = this.resolveDdoSigner(options)
    const issuer = await ddoSigner.getIssuer()

    await resolvePublisherTrustedAlgorithms(this.node, services)
    await this.assertServicesPublishable(services)
    await this.assertValidBeforeSpend({
      asset,
      create: true,
      nftAddress: PLACEHOLDER_ADDRESS,
      issuer
    })

    // The DID depends on the NFT address, so the DDO can only be stored after the mint. A
    // store that can tell it will fail says so now, before anything is spent.
    await remoteStore.check?.()
    await this.warnIfPublisherIsNode()
    await this.assertIndexerNotStuck(options)

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

    const response = await this.withNftLock(created.nftAddress, async () => {
      // From here on the NFT exists. A failure leaves it without metadata, so report it in
      // a form `completePublish()` can pick up rather than as a bare error.
      let result: Awaited<ReturnType<Nautilus['writeAsset']>>
      try {
        published.push(
          ...(await this.createDatatokens(created.nftAddress, rest, owner))
        )

        result = await this.writeAsset({
          asset,
          nftAddress: created.nftAddress,
          create: true,
          remoteStore,
          ddoSigner,
          issuer
        })
      } catch (error) {
        throw new PublishIncompleteError(
          created.nftAddress,
          services.flatMap((service) =>
            service.datatokenAddress ? [service.datatokenAddress] : []
          ),
          error
        )
      }

      return this.assertAloneInBlock({
        ...result,
        nftAddress: created.nftAddress,
        services: published
      })
    })

    return this.finishWrite(response, options)
  }

  /**
   * Finishes a publish that failed after its NFT was minted.
   *
   * `publish()` throws a `PublishIncompleteError` in that case. Pass its `nftAddress` and
   * the asset, either the same object or one rebuilt the same way. Before any
   * transaction this checks that the signer owns the NFT, that the configured ERC721
   * factory created it, and that every datatoken a service already names belongs to it.
   * Services without a datatoken get the NFT's unclaimed ones (the one bundled at mint
   * first, in service order) and only the rest get new ones; a reused datatoken whose
   * pricing never got created is priced now. The response lists every service. Refuses an
   * NFT that already has metadata; use `edit()` there.
   */
  async completePublish(
    nftAddress: string,
    asset: NautilusAsset,
    options: PublishOptions = {}
  ): Promise<PublishResponse> {
    assertEncryptOption(options)
    assertWritableState(asset.lifecycleState ?? 0, 'the asset')

    if (!isAddress(nftAddress))
      throw new Error(`completePublish: ${nftAddress} is not an address.`)

    const owner = asset.owner || (await this.signer.getAddress())
    const services = asset.ddo.services

    if (!services.length)
      throw new Error('Cannot publish an asset with no services.')

    const response = await this.withNftLock(nftAddress, async () => {
      if (await hasMetadata(this.signer, this.config, nftAddress))
        throw new Error(
          `${nftAddress} already has metadata, so there is no publish left to complete. Use edit() to change it.`
        )

      await this.assertOwnFactoryNft(nftAddress)
      const reuse = reconcileDatatokens(
        services,
        await getNftDatatokens(this.signer, nftAddress),
        nftAddress
      )

      const remoteStore = this.requireRemoteStore(options)
      const ddoSigner = this.resolveDdoSigner(options)
      const issuer = await ddoSigner.getIssuer()

      await resolvePublisherTrustedAlgorithms(this.node, services)
      await this.assertServicesPublishable(services)
      await this.assertValidBeforeSpend({
        asset,
        create: true,
        nftAddress,
        issuer
      })
      await remoteStore.check?.()
      await this.warnIfPublisherIsNode()
      await this.assertIndexerNotStuck(options)

      const published: PublishedService[] = []

      for (const service of services) {
        const existing = reuse.get(service)

        if (!existing) {
          published.push(
            ...(await this.createDatatokens(nftAddress, [service], owner))
          )
          continue
        }

        service.datatokenAddress = existing
        const pricing = await getPricingInfo(this.signer, existing, this.config)

        published.push({
          service,
          datatokenAddress: existing,
          reused: true,
          ...(pricing.schema === 'none'
            ? {
                tx: await createPricingForDatatoken({
                  signer: this.signer,
                  chainConfig: this.config,
                  datatokenAddress: existing,
                  service,
                  owner
                })
              }
            : {})
        })
      }

      const result = await this.writeAsset({
        asset,
        nftAddress,
        create: true,
        remoteStore,
        ddoSigner,
        issuer
      })

      return this.assertAloneInBlock({
        ...result,
        nftAddress,
        services: published
      })
    })

    return this.finishWrite(response, options)
  }

  /**
   * Refuses an NFT the signer does not own, or one the configured ERC721 factory did not
   * create. Before `completePublish()` spends anything on it.
   */
  private async assertOwnFactoryNft(nftAddress: string): Promise<void> {
    const signerAddress = getAddress(await this.signer.getAddress())
    const nft = new Nft(this.signer, this.config.chainId, this.config)
    const nftOwner = await nft.getNftOwner(nftAddress)

    if (!nftOwner || getAddress(nftOwner) !== signerAddress)
      throw new Error(
        `completePublish: NFT ${nftAddress} is owned by ${nftOwner}, not by the signer ${signerAddress}. Refusing to write a DDO onto an NFT someone else controls.`
      )

    const factory = new NftFactory(
      this.config.nftFactoryAddress as string,
      this.signer,
      this.config.chainId,
      this.config
    )
    const listed = await factory.checkNFT(nftAddress)

    if (
      !listed ||
      !isAddress(listed) ||
      getAddress(listed) !== getAddress(nftAddress)
    )
      throw new Error(
        `completePublish: NFT ${nftAddress} was not created by the ERC721 factory ${this.config.nftFactoryAddress}.`
      )
  }

  /** Creates a datatoken, with its pricing, on the NFT for each service. */
  private async createDatatokens(
    nftAddress: string,
    services: NautilusService<ServiceTypes, FileTypes>[],
    owner: string
  ): Promise<PublishedService[]> {
    const published: PublishedService[] = []

    for (const service of services) {
      // Sets `service.datatokenAddress` before pricing, so a pricing failure still leaves
      // the datatoken on record for `PublishIncompleteError`.
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

    return published
  }

  /**
   * Republishes an edited asset.
   *
   * Only services carrying a new pricing config get a new datatoken; everything else is
   * merged over the published document, so changing one field does not require resupplying
   * the rest. The remote store is checked before any datatoken is minted.
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

    assertEncryptOption(options)
    assertWritableState(asset.lifecycleState ?? 0, 'the asset')

    const nftAddress = getNftAddress(baseline)
    const owner = asset.owner || (await this.signer.getAddress())

    // Before anything is spent: a DEPRECATED or REVOKED asset can never take metadata again.
    assertWritableState(
      await readMetadataState(
        new Nft(this.signer, this.config.chainId, this.config),
        nftAddress
      ),
      `NFT ${nftAddress}`
    )

    const remoteStore = this.requireRemoteStore(options)
    const ddoSigner = this.resolveDdoSigner(options)
    const issuer = await ddoSigner.getIssuer()

    await resolvePublisherTrustedAlgorithms(this.node, asset.ddo.services)
    await this.assertServicesPublishable(asset.ddo.services)
    // The NFT is real on an edit; only the datatokens of newly priced services are not.
    await this.assertValidBeforeSpend({
      asset,
      create: false,
      nftAddress,
      issuer
    })
    await remoteStore.check?.()
    await this.warnIfPublisherIsNode()
    await this.assertIndexerNotStuck(options)

    const response = await this.withNftLock(nftAddress, async () => {
      const published: PublishedService[] = []

      for (const service of asset.ddo.services) {
        if (!service.pricing) continue

        published.push(
          ...(await this.createDatatokens(nftAddress, [service], owner))
        )
      }

      const result = await this.writeAsset({
        asset,
        nftAddress,
        create: false,
        remoteStore,
        ddoSigner,
        issuer
      })

      return this.assertAloneInBlock({
        ...result,
        nftAddress,
        services: published
      })
    })

    return this.finishWrite(response, options)
  }

  /**
   * Runs `fn` after every earlier publish, edit or lifecycle change this instance started
   * for the NFT, so their transactions never interleave. Other instances and processes are
   * not covered; `assertAloneInBlock()` reports what slips through.
   */
  private async withNftLock<T>(
    nftAddress: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const key = nftAddress.toLowerCase()
    const previous = this.nftLocks.get(key) ?? Promise.resolve()

    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.nftLocks.set(key, tail)

    try {
      await previous
      return await fn()
    } finally {
      release()
      if (this.nftLocks.get(key) === tail) this.nftLocks.delete(key)
    }
  }

  /**
   * Throws a `MetadataConflictError` when another `MetadataCreated`/`MetadataUpdated` for
   * the NFT landed in the same block as this one.
   *
   * ocean-node indexes only the first metadata event of an asset per block
   * (`isUpdateable`), and nothing on chain shows that it dropped the other. Sequential calls
   * from one instance cannot collide (each waits for its receipt, and `withNftLock()`
   * serializes concurrent ones); this catches writes from other instances or processes.
   * Best effort: when the logs cannot be read, it logs that and goes on.
   */
  private async assertAloneInBlock(
    response: PublishResponse
  ): Promise<PublishResponse> {
    const receipt = response.setMetadataTxReceipt
    if (typeof receipt?.blockNumber !== 'number') return response

    let events: { transactionHash: string }[]
    try {
      events = await getMetadataEventsInBlock(
        this.signer,
        response.nftAddress,
        receipt.blockNumber
      )
    } catch (error) {
      LoggerInstance.warn(
        `[metadata] could not check block ${receipt.blockNumber} for other metadata events on ${response.nftAddress}: ${errorMessage(error)}`
      )
      return response
    }

    const ours = receipt.hash.toLowerCase()
    const others = events
      .map((event) => event.transactionHash)
      .filter((hash) => hash.toLowerCase() !== ours)

    if (!others.length) return response

    throw new MetadataConflictError(
      response,
      others,
      events[0]?.transactionHash.toLowerCase() === ours
    )
  }

  /**
   * Waits for the indexer if asked to, and reports it. The metadata is on chain by now, so
   * a failed or timed-out wait carries the response as `error.published`.
   */
  private async finishWrite(
    response: PublishResponse,
    options: PublishOptions
  ): Promise<PublishResponse> {
    if (!options.waitForIndexer) return response

    try {
      await this.node.waitForIndexer(
        response.ddo.id as string,
        response.setMetadataTxReceipt.hash,
        indexerOptions(options)
      )
    } catch (error) {
      throw attachPublished(error, response)
    }

    return { ...response, indexed: true }
  }

  /**
   * Warns, once per instance, when the publisher's address is the node's own
   * (`providerAddress` from `GET /`). The indexer then signs its decrypt calls with the
   * same key and nonce sequence as the publisher's requests, they collide, and decrypt
   * fails with 401: the asset goes on chain but is never indexed. Best effort.
   */
  private warnIfPublisherIsNode(): Promise<void> {
    this.nodeKeyCheck ??= (async () => {
      try {
        const [nodeAddress, publisher] = await Promise.all([
          this.node.getNodeAddress(),
          this.signer.getAddress()
        ])

        if (nodeAddress && getAddress(publisher) === getAddress(nodeAddress))
          warnOnce(
            `publisher-is-node:${nodeAddress}`,
            `The publisher ${publisher} is the node's own address (${this.node.nodeUri} reports providerAddress ${nodeAddress}). The indexer signs its decrypt calls with that key, so its nonces collide with yours and decrypt fails with 401: the asset goes on chain but is not indexed. Publish with a different key than the node's.`
          )
      } catch (error) {
        LoggerInstance.debug(
          `[publish] could not read the node's address: ${errorMessage(error)}`
        )
      }
    })()

    return this.nodeKeyCheck
  }

  /**
   * Refuses to publish onto a node whose indexer nonce is stuck
   * (`IndexerNonceState.stuck`), before the first transaction.
   * Best effort: when the node does not answer (P2P, no `providerAddress`, an older node,
   * a network error) it goes on silently. `{ checkIndexerNonce: false }` skips it.
   *
   * Indexing a nautilus asset takes two decrypt calls, with the next two nonces. When only
   * the second is not accepted (`isIndexerNonceSignable`), the nonce is not stuck yet but
   * will be after this publish, and the asset will not be indexed; that is warned about,
   * not refused.
   */
  private async assertIndexerNotStuck(options: PublishOptions): Promise<void> {
    if (options.checkIndexerNonce === false) return

    let state: Awaited<ReturnType<OceanNodeClient['getIndexerNonceState']>>
    try {
      state = await this.node.getIndexerNonceState()
    } catch (error) {
      LoggerInstance.debug(
        `[publish] could not read the indexer's nonce, skipping the check: ${errorMessage(error)}`
      )
      return
    }

    if (!state) return
    if (state.stuck) throw new IndexerNonceStuckError(state)

    if (!isIndexerNonceSignable(state.nodeAddress, state.nextNonce + 1))
      LoggerInstance.warn(
        `[publish] the indexer of ${this.node.nodeUri} will sign its second decrypt call for this asset with nonce ${state.nextNonce + 1}, which the node does not accept: unless another decrypt moves the nonce first, this asset will not be indexed and the indexer nonce will be stuck until the operator advances it.`
      )
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
        'Publishing needs a remote store for the signed DDO. Pass `remoteStore` to Nautilus.create(), for example an IpfsRemoteStore or an S3RemoteStore.'
      )

    // ocean-node 4.2 resolves a remote DDO without a consumer address, and a bucket requires
    // one, so a DDO stored there would go on chain without being indexed.
    if (remoteStore instanceof NodePersistentRemoteStore)
      throw new Error(
        'NodePersistentRemoteStore cannot hold DDOs: ocean-node 4.2 does not read remote DDOs from its bucket storage, so the asset would not be indexed. Use an IpfsRemoteStore or an S3RemoteStore instead.'
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

  /** The signer for the DDO's credential, which is not necessarily the chain signer. */
  private resolveDdoSigner(options: PublishOptions): DdoSigner {
    return (
      options.ddoSigner ||
      this.options.ddoSigner ||
      new Eip191VcSigner(this.signer)
    )
  }

  /**
   * SHACL-validates the document before the first transaction.
   *
   * The configuration checks above catch a missing store or an unreachable endpoint, but
   * the document's own shape was only checked in `writeAsset()` — after the NFT and every
   * datatoken had been minted. A misshapen `license` or a missing `providedBy` therefore
   * cost gas and left orphaned tokens behind, which is exactly what validating locally is
   * supposed to prevent.
   *
   * The addresses are stand-ins, so this cannot be the last word: `writeAsset()` validates
   * the real document again once they exist.
   */
  private async assertValidBeforeSpend(params: {
    asset: NautilusAsset
    create: boolean
    nftAddress: string
    issuer: string
  }): Promise<void> {
    const preflight = params.asset.ddo.getPreflightDDO({
      create: params.create,
      chainId: this.config.chainId as number,
      nftAddress: params.nftAddress,
      datatokenAddress: PLACEHOLDER_ADDRESS
    })

    if (!preflight.issuer) preflight.issuer = params.issuer

    await assertValid(preflight)

    // The node accepts decrypt requests up to 100 KB, so a DDO whose envelope does not fit
    // would go on chain without being indexed. The preflight document is as large as the
    // published one, so this checks the largest envelope its signature can give.
    assertDdoFitsDecryptLimit(preflight, params.issuer)
  }

  /**
   * Builds, validates, signs, stores, verifies and writes the DDO. Shared by publish and
   * edit.
   */
  private async writeAsset(params: {
    asset: NautilusAsset
    nftAddress: string
    create: boolean
    remoteStore: RemoteStore
    ddoSigner: DdoSigner
    /** Resolved before the first transaction, so it is not asked for twice. */
    issuer: string
  }): Promise<Omit<PublishResponse, 'nftAddress' | 'services' | 'indexed'>> {
    const { asset, nftAddress, create, remoteStore, ddoSigner } = params

    const ddo = await asset.ddo.getDDO(this.node, {
      create,
      chainId: this.config.chainId,
      nftAddress
    })

    /**
     * The signer's identity is the *default* for `issuer`, stamped before validating,
     * signing or returning the document, so SHACL checks the exact document that gets
     * signed and `PublishResponse.ddo` reports the issuer the credential carries. Only the
     * unset case is stamped (`project()` emits `''` when no issuer was declared): a
     * deliberately declared issuer — `setIssuer()`, or the one seeded from a resolved asset
     * on edit — must reach `toCredential()`, whose mismatch guard rejects signing for
     * somebody else. Overwriting unconditionally here made that guard unreachable, so
     * `setIssuer()` looked like it worked while the signed claims said something else.
     */
    if (!ddo.issuer) ddo.issuer = params.issuer

    // The node derives the DID itself and drops a DDO whose id differs (step 16).
    assertDid(ddo.id, nftAddress, this.config.chainId)

    // Local SHACL validation, before anything is signed or written. Cheap, and it names the
    // exact failing field — the node never sees this document, so nothing else would.
    await assertValid(ddo)

    if (create)
      await waitForMetadataPermission({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress
      })

    const prepared = await prepareMetadataForWrite({
      node: this.node,
      ddo,
      signer: ddoSigner,
      remoteStore,
      did: ddo.id as string
    })

    const lifecycleState = (asset.lifecycleState ?? 0) as number

    // From here the envelope is stored. A failure before the transaction is sent orphans
    // it, so it is removed again; once the transaction may be on chain it is kept.
    let sent = false
    let setMetadataTxReceipt: TransactionReceipt
    try {
      // Read the stored object back the way the node will, before the transaction, so an
      // unreadable or altered object is caught while nothing is on chain yet.
      await remoteStore.verify?.(
        prepared.storedPointer,
        prepared.written.metadataHash
      )

      setMetadataTxReceipt = await writeMetadata({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress,
        nodeUri: this.config.oceanNodeUri as string,
        lifecycleState,
        prepared,
        onSent: () => {
          sent = true
        }
      })
    } catch (error) {
      throw await settleStoredEnvelope(error, {
        remoteStore,
        storedPointer: prepared.storedPointer,
        metadataHash: prepared.written.metadataHash,
        sent
      })
    }

    return {
      ddo,
      credential: prepared.written.credential,
      stored: prepared.written.stored,
      setMetadataTxReceipt
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

    const nftAddress = getNftAddress(asset)

    return this.withNftLock(nftAddress, () =>
      setMetadataState({
        nftAddress,
        state: state as number,
        chainConfig: this.config,
        signer: this.signer
      })
    )
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
      auth: this.signer,
      allowInsecureTransport: this.options.allowInsecureTransport
    })
  }

  // #endregion
}
