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
  type NodeComputeJob,
  type SearchQuery
} from '@oceanprotocol/lib'
import {
  getAddress,
  isAddress,
  isHexString,
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
import { findResultIndex, isJobFinished } from '../compute/jobs.js'
import { getLifecycleState, getNftAddress } from '../ddo/read.js'
import type { DdoCredentials } from '../ddo/types.js'
import { assertValid } from '../ddo/validate.js'
import type { CredentialProvider } from '../identity/CredentialProvider.js'
import { PolicySessionResolver } from '../identity/PolicySessionResolver.js'
import { isAddressCredential } from '../identity/policy.js'
import type { SessionStore } from '../identity/session.js'
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
  readMetadataState,
  readMetadataStatus
} from '../publish/envelope.js'
import {
  assertNftPermissions,
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
import { pricingMismatches, readExistingPricing } from '../publish/reuse.js'
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
import { createKeyedLock } from '../utils/keyedLock.js'
import {
  assertValidLimits,
  type EscrowPaymentLimits,
  type ProviderFeeLimits
} from '../utils/paymentLimits.js'
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

/** A datatoken `completePublish()` reuses, and whether only the creation order says so. */
interface ReusedDatatoken {
  token: string
  byOrder: boolean
}

/**
 * One service in `completePublish()`: the datatoken it reuses, if any, and whether that
 * datatoken's pricing still has to be created.
 */
interface ReuseStep {
  service: NautilusService<ServiceTypes, FileTypes>
  datatokenAddress?: string
  price?: boolean
}

/**
 * Which existing datatoken of the NFT each service reuses in `completePublish()`.
 *
 * A service that already names a datatoken must name one of the NFT's. The NFT's other
 * datatokens go, in creation order, to the services without one, in service order: the
 * order `publish()` created them in. Services left over get new datatokens. More unclaimed
 * datatokens than services to give them to is ambiguous, so that is refused. A match by
 * order is then checked against the datatoken's pricing (`completePublish()`).
 */
function reconcileDatatokens(
  services: NautilusService<ServiceTypes, FileTypes>[],
  onNft: string[],
  nftAddress: string
): Map<NautilusService<ServiceTypes, FileTypes>, ReusedDatatoken> {
  const known = new Map(onNft.map((token) => [token.toLowerCase(), token]))
  const reuse = new Map<
    NautilusService<ServiceTypes, FileTypes>,
    ReusedDatatoken
  >()
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
    reuse.set(service, { token, byOrder: false })
  }

  const unclaimed = onNft.filter((token) => !claimed.has(token.toLowerCase()))
  const without = services.filter((service) => !service.datatokenAddress)

  if (unclaimed.length > without.length)
    throw new Error(
      `completePublish: NFT ${nftAddress} has ${unclaimed.length} datatoken(s) no service names (${unclaimed.join(', ')}), but only ${without.length} service(s) without one, so it is unclear which belongs where. Set datatokenAddress on each service.`
    )

  unclaimed.forEach((token, index) => {
    reuse.set(without[index], { token, byOrder: true })
  })

  return reuse
}

/**
 * Adds `extra` to the error and `note` to its message. An error that cannot take them (a
 * frozen one, a `DOMException` abort reason, whose `message` is a getter, or a thrown
 * string) is wrapped instead: a new `Error` with the note and `extra`, the original as its
 * `cause`.
 */
function annotateError<T extends object>(
  error: unknown,
  extra: T,
  note: string
): Error & T {
  if (error && typeof error === 'object')
    try {
      Object.assign(error, extra)
      const target = error as Error
      if (typeof target.message !== 'string') throw new TypeError('no message')
      target.message += note
      return target as Error & T
    } catch {
      // Wrapped below.
    }

  return Object.assign(
    new Error(`${errorMessage(error)}${note}`, { cause: error }),
    extra
  )
}

/**
 * Attaches the response of a write whose metadata transaction was mined to the error that
 * followed it, as `error.published`, and says so in the message.
 */
function attachPublished(
  error: unknown,
  published: PublishResponse
): Error & { published: PublishResponse } {
  return annotateError(
    error,
    { published },
    ` The metadata transaction ${published.setMetadataTxReceipt.hash} was mined, so ${published.nftAddress} carries the new metadata; the full result is on error.published.`
  )
}

/**
 * `maxProviderFee`, `confirmProviderFees`, `maxEscrowPayment` and `confirmEscrowPayment`
 * set the default for every `access()` and `compute()` call of this instance. Each pair
 * is replaced as a whole: a call that sets `maxProviderFee` or `confirmProviderFees` (even
 * to `undefined`) uses its own pair and neither provider-fee default, and the same holds
 * for `maxEscrowPayment` / `confirmEscrowPayment`. Without them, a non-zero provider fee
 * or escrow payment is refused before anything is spent.
 */
export interface NautilusOptions
  extends ProviderFeeLimits,
    EscrowPaymentLimits {
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
  /**
   * Answers the verifiable-presentation request of a service whose `SSIpolicy` asks for
   * credentials, e.g. a `WaltIdCredentialProvider`. nautilus opens the policy-server
   * session itself, so a service gated by addresses only needs none; without one, a service
   * that asks for a presentation is refused before anything is spent.
   */
  credentials?: CredentialProvider
  /**
   * Where the policy-server sessions of this instance are cached. Defaults to an in-memory
   * store. A session is bound to one (node, asset, service, consumer).
   */
  sessionStore?: SessionStore
  /**
   * How long, in milliseconds from its opening, a cached policy-server session is reused
   * before it is opened again. `0` turns the cache off. Default: `DEFAULT_SESSION_TTL_MS`
   * (2 minutes), well within the 5 minutes walt.id's verifier keeps a session.
   */
  sessionTtlMs?: number
  /**
   * Overrides for the chain config resolved from the signer's network.
   *
   * `config.escrow`, when set here, is the only escrow contract paid compute funds. Left
   * out, nautilus funds the chain's `EnterpriseEscrow` from Ocean's address data, else its
   * `Escrow`: the `escrow` ocean.js's `ConfigHelper` fills in (its `Escrow` entry) does not
   * count as a choice. Spreading `ConfigHelper`'s config in here does, so leave its
   * `escrow` out.
   */
  config?: Partial<Config>
  /**
   * Accept a plain `http://` `oceanNodeUri` on a host other than `localhost`,
   * `127.0.0.0/8`, `::1` or `*.localhost`. Default `false`: the plaintext pointer (an S3 read
   * key included) and the signed DDO go to the node for encryption, and node auth travels
   * with every request.
   */
  allowInsecureTransport?: boolean
  /**
   * Per-call timeout for the node client's `encrypt` calls, passed to `OceanNodeClient`.
   * Default 120 s.
   */
  requestTimeoutMs?: number
}

export interface PublishOptions {
  /**
   * Block until the indexer has the asset, so the result is immediately resolvable. Pass
   * `{ intervalMs, timeoutMs }` to tune the polling, and `signal` to stop waiting. Throws
   * an `IndexingError` when the node records that it could not index the asset, and an
   * `OceanNodeError` on timeout; an abort rejects with the signal's reason.
   * Either way the metadata transaction was mined: the error carries the full
   * `PublishResponse` as `error.published` (see `PublishedNotIndexed`).
   *
   * There is no `encrypt` option any more: the pointer and the stored envelope are always
   * node-encrypted, and `encrypt: false` throws.
   */
  waitForIndexer?:
    | boolean
    | Pick<WaitForIndexerOptions, 'intervalMs' | 'timeoutMs' | 'signal'>
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

/** `completePublish()`'s options: those of `publish()`, plus the earlier attempt's transaction. */
export interface CompletePublishOptions extends PublishOptions {
  /**
   * The metadata transaction the failed attempt sent, from
   * `PublishIncompleteError.stored.txHash` (`cleanup: 'kept'`). `completePublish()` then
   * refuses while that transaction is pending, and once it was mined successfully, instead
   * of writing the metadata a second time. A reverted one is no obstacle. Without it,
   * only the signer's pending transaction count guards against a second write.
   */
  metadataTxHash?: string
}

/** Whether the asset-level `allow` list has an `address` entry naming at least one address. */
function hasAddressAllowList(credentials: DdoCredentials | undefined): boolean {
  return (credentials?.allow || []).some(
    (entry) => isAddressCredential(entry) && (entry.values || []).length > 0
  )
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
export class Nautilus {
  private signer: Signer
  private config!: Config
  private node!: OceanNodeClient
  private options: NautilusOptions
  /**
   * The escrow contract the caller set as `config.escrow`, if any; `compute()` funds only
   * that one. Kept apart from `config.escrow`, which ocean.js fills from `Escrow`.
   */
  private explicitEscrow?: string

  /**
   * One promise chain per NFT (lower-cased), so this instance's publish, edit and
   * lifecycle transactions for one asset never run concurrently. See `withNftLock()`.
   */
  private readonly nftLocks = new Map<string, Promise<void>>()

  /**
   * Serialises this instance's paid compute jobs per (chain, payer, payment token, payee):
   * escrow reads, deposit, authorisation, orders and `computeStart` run one job at a time,
   * so concurrent jobs do not overwrite each other's escrow authorisation. Jobs from other
   * instances or processes are not covered.
   */
  private readonly escrowLock = createKeyedLock()

  /** The one-time check that the publisher is not the node's own key. */
  private nodeKeyCheck?: Promise<void>

  /** Opens and caches the policy-server sessions of `access()` and `compute()`. */
  private readonly policySessions: PolicySessionResolver

  private constructor(signer: Signer, options: NautilusOptions) {
    this.signer = signer
    this.options = options
    this.policySessions = new PolicySessionResolver({
      credentials: options.credentials,
      sessionStore: options.sessionStore,
      sessionTtlMs: options.sessionTtlMs
    })
  }

  /** Creates an instance, resolving the chain config from the signer's network. */
  static async create(
    signer: Signer,
    options: NautilusOptions = {}
  ): Promise<Nautilus> {
    // A malformed ceiling fails here, not at the first paid call.
    assertValidLimits(options)

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

    // Only the caller's own `config.escrow` pins the escrow contract; the one
    // `ConfigHelper` fills in is its address data's `Escrow` entry, not a choice.
    const escrow = this.options.config?.escrow
    this.explicitEscrow =
      typeof escrow === 'string' && escrow.trim() ? escrow.trim() : undefined

    this.assertUsableConfig()

    this.node = new OceanNodeClient({
      nodeUri: this.config.oceanNodeUri as string,
      chainId: this.config.chainId,
      auth: this.signer,
      allowInsecureTransport: this.options.allowInsecureTransport,
      requestTimeoutMs: this.options.requestTimeoutMs
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

    if (this.explicitEscrow !== undefined && !isAddress(this.explicitEscrow))
      problems.push(
        "escrow is not a valid address (set the chain's EnterpriseEscrow contract, or leave escrow out to use Ocean's address data)"
      )

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

  /** Swaps in a credential provider after construction. Cached sessions stay. */
  setCredentialProvider(credentials: CredentialProvider): void {
    this.options.credentials = credentials
    this.policySessions.setCredentialProvider(credentials)
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

    const owner = await this.ownerForNewAsset(asset, 'publish')
    const services = asset.ddo.services

    if (!services.length)
      throw new Error('Cannot publish an asset with no services.')

    // A publish always mints fresh datatokens. A `datatokenAddress` still on a service (from
    // an earlier attempt, or copied by `ServiceBuilder`) belongs to another NFT: it would end
    // up in `PublishIncompleteError.datatokens`, and `completePublish()` would then refuse
    // the service for naming a datatoken this NFT does not have.
    for (const service of services) service.datatokenAddress = undefined

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
    await this.warnIfPolicyServerDeniesAll(asset)
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
          lifecycleState: asset.lifecycleState ?? 0,
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
   * factory created it, that its lifecycle state takes metadata, that the signer holds the
   * permissions the writes need, and that every datatoken a service already names belongs
   * to it. Services without a datatoken get the NFT's unclaimed ones (the one bundled at
   * mint first, in service order) and only the rest get new ones. A reused datatoken whose
   * pricing never got created is priced now; one that has pricing must match the service's
   * pricing config, or the call is refused. The response lists every service. Refuses an
   * NFT that already has metadata; use `edit()` there.
   *
   * A metadata transaction the failed attempt sent may still be pending, and the NFT then
   * reads as having no metadata. So it also refuses while the signer has pending
   * transactions (`getNonce('pending')` above `getNonce('latest')`), and, given
   * `options.metadataTxHash`, while that transaction is pending or once it succeeded.
   */
  async completePublish(
    nftAddress: string,
    asset: NautilusAsset,
    options: CompletePublishOptions = {}
  ): Promise<PublishResponse> {
    assertEncryptOption(options)
    assertWritableState(asset.lifecycleState ?? 0, 'the asset')

    if (!isAddress(nftAddress))
      throw new Error(`completePublish: ${nftAddress} is not an address.`)

    const { metadataTxHash } = options
    if (metadataTxHash !== undefined && !isHexString(metadataTxHash, 32))
      throw new Error(
        `completePublish: metadataTxHash ${metadataTxHash} is not a transaction hash.`
      )

    const owner = await this.ownerForNewAsset(asset, 'completePublish')
    const services = asset.ddo.services

    if (!services.length)
      throw new Error('Cannot publish an asset with no services.')

    const response = await this.withNftLock(nftAddress, async () => {
      // Before the metadata read: a pending write reads as "no metadata", and one mined
      // between these checks and that read shows up there.
      if (metadataTxHash)
        await this.assertEarlierWriteSettled(nftAddress, metadataTxHash)
      await this.assertNoPendingTransactions(nftAddress)

      const status = await readMetadataStatus(
        new Nft(this.signer, this.config.chainId, this.config),
        nftAddress
      )

      if (status.hasMetadata)
        throw new Error(
          `${nftAddress} already has metadata, so there is no publish left to complete. Use edit() to change it.`
        )
      assertWritableState(status.state, `NFT ${nftAddress}`)

      await this.assertOwnFactoryNft(nftAddress)
      const plan = await this.planReuse(
        services,
        reconcileDatatokens(
          services,
          await getNftDatatokens(this.signer, nftAddress),
          nftAddress
        ),
        owner
      )
      await assertNftPermissions({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress,
        deployDatatokens: plan.some(
          (step) => !step.datatokenAddress || step.price
        ),
        operation: 'completePublish'
      })

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
      await this.warnIfPolicyServerDeniesAll(asset)
      await this.assertIndexerNotStuck(options)

      // Every reused datatoken is on its service before the first transaction, so a retry
      // after a failure further down finds them by name.
      for (const step of plan)
        if (step.datatokenAddress)
          step.service.datatokenAddress = step.datatokenAddress

      const published: PublishedService[] = []

      for (const { service, datatokenAddress, price } of plan) {
        if (!datatokenAddress) {
          published.push(
            ...(await this.createDatatokens(nftAddress, [service], owner))
          )
          continue
        }

        published.push({
          service,
          datatokenAddress,
          reused: true,
          ...(price
            ? {
                tx: await createPricingForDatatoken({
                  signer: this.signer,
                  chainConfig: this.config,
                  datatokenAddress,
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
        lifecycleState: asset.lifecycleState ?? 0,
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
   * What `completePublish()` does for each service, decided from chain reads alone before
   * any transaction: reuse a datatoken as it is, reuse it and create its pricing, or
   * (no `datatokenAddress`) create a new one.
   *
   * A reused datatoken that has pricing must match the service's pricing config
   * (`pricingMismatches`), since `completePublish()` does not change existing pricing. A
   * mismatch on a datatoken matched only by creation order means the order cannot be
   * trusted, so the caller is asked to name the datatokens.
   */
  private async planReuse(
    services: NautilusService<ServiceTypes, FileTypes>[],
    reuse: Map<NautilusService<ServiceTypes, FileTypes>, ReusedDatatoken>,
    owner: string
  ): Promise<ReuseStep[]> {
    const plan: ReuseStep[] = []

    for (const service of services) {
      const match = reuse.get(service)
      const name = service.name || service.id

      if (!match) {
        plan.push({ service })
        continue
      }

      const info = await getPricingInfo(this.signer, match.token, this.config)

      if (info.schema === 'none') {
        if (!service.pricing)
          throw new Error(
            `completePublish: datatoken ${match.token} has no pricing, and service ${name} has no pricing config to create it from. Call setPricing() on the service.`
          )

        plan.push({ service, datatokenAddress: match.token, price: true })
        continue
      }

      const mismatches = pricingMismatches({
        pricing: service.pricing,
        existing: await readExistingPricing({
          signer: this.signer,
          chainConfig: this.config,
          datatokenAddress: match.token,
          info
        }),
        owner,
        nftFactoryAddress: this.config.nftFactoryAddress as string
      })

      if (mismatches.length)
        throw new Error(
          match.byOrder
            ? `completePublish: datatoken ${match.token} would go to service ${name} by creation order, but its pricing does not match that service's: ${mismatches.join('; ')}. Nothing was sent. Set datatokenAddress on each service to say which datatoken belongs to it.`
            : `completePublish: datatoken ${match.token}, which service ${name} names, is priced differently from the service's pricing config: ${mismatches.join('; ')}. completePublish() does not change existing pricing, so nothing was sent. Make the service's setPricing() match the datatoken's pricing.`
        )

      plan.push({ service, datatokenAddress: match.token })
    }

    return plan
  }

  /**
   * The owner of a new asset, which must be the signer. The NFT, its datatokens and their
   * pricing are created for `asset.owner`, but the transactions after the mint need the
   * signer to hold the NFT's roles, so an `asset.owner` other than the signer would leave
   * the NFT stranded without metadata. Refused before the mint.
   */
  private async ownerForNewAsset(
    asset: NautilusAsset,
    operation: string
  ): Promise<string> {
    const signer = getAddress(await this.signer.getAddress())

    if (
      asset.owner &&
      (!isAddress(asset.owner) || getAddress(asset.owner) !== signer)
    )
      throw new Error(
        `${operation}: the asset's owner ${asset.owner} is not the signer ${signer}. The NFT, its datatokens and their pricing are created for the asset's owner, while every transaction after the mint needs the signer to hold the NFT's roles. Nothing was sent. Publish with the owner's signer, or transfer the NFT once it is published.`
      )

    return asset.owner || signer
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

  /**
   * Refuses to complete while the earlier attempt's metadata transaction (`txHash`) is
   * pending, or once it was mined successfully: either way it writes, or wrote, the
   * metadata, and completing would write it a second time. A reverted transaction changed
   * nothing. One the RPC does not know was dropped or replaced; the pending-transaction
   * check and the metadata read that follow cover both.
   */
  private async assertEarlierWriteSettled(
    nftAddress: string,
    txHash: string
  ): Promise<void> {
    const provider = this.signer.provider

    if (!provider)
      throw new Error(
        `completePublish: the signer has no provider, so metadata transaction ${txHash} cannot be looked up. Nothing was sent.`
      )

    const receipt = await provider.getTransactionReceipt(txHash)

    if (receipt) {
      if (receipt.status === 0) return

      throw new Error(
        `completePublish: metadata transaction ${txHash} of the earlier attempt was mined in block ${receipt.blockNumber}, so NFT ${nftAddress} has its metadata and there is no publish left to complete. Nothing was sent. Use edit() to change it.`
      )
    }

    if (await provider.getTransaction(txHash))
      throw new Error(
        `completePublish: metadata transaction ${txHash} of the earlier attempt is still pending. Once mined, it gives NFT ${nftAddress} its metadata, so completing now would write it twice. Nothing was sent. Wait until it is mined or dropped, then call completePublish() again.`
      )
  }

  /**
   * Refuses to complete while the signer has transactions that are not mined yet
   * (`getNonce('pending')` above `getNonce('latest')`). One of them may be the earlier
   * attempt's metadata transaction: the NFT reads as having no metadata until it is mined,
   * so completing now could write the metadata twice. Any pending transaction of the
   * signer counts, since nautilus cannot tell which it is. Best effort: when the counts
   * cannot be read, it warns and goes on.
   */
  private async assertNoPendingTransactions(nftAddress: string): Promise<void> {
    let pending: number
    let latest: number
    try {
      ;[pending, latest] = await Promise.all([
        this.signer.getNonce('pending'),
        this.signer.getNonce('latest')
      ])
    } catch (error) {
      LoggerInstance.warn(
        `[publish] completePublish could not read the signer's pending transaction count, so it cannot tell whether an earlier metadata transaction for ${nftAddress} is still pending: ${errorMessage(error)}`
      )
      return
    }

    if (pending > latest)
      throw new Error(
        `completePublish: the signer ${await this.signer.getAddress()} has ${pending - latest} transaction(s) not mined yet (nonces ${latest} to ${pending - 1}). One may be the earlier attempt's metadata transaction, and NFT ${nftAddress} reads as having no metadata until it is mined, so completing now could write it twice. Nothing was sent. Wait until they are mined or dropped, then call completePublish() again.`
      )
  }

  /**
   * Creates a datatoken, with its pricing, on the NFT for each service.
   *
   * `createDatatokenForService()` sets `service.datatokenAddress` before the pricing, so a
   * pricing failure still leaves the datatoken on record for `PublishIncompleteError`.
   * Every datatoken this creates, priced or not, is also added to `created`.
   */
  private async createDatatokens(
    nftAddress: string,
    services: NautilusService<ServiceTypes, FileTypes>[],
    owner: string,
    created: string[] = []
  ): Promise<PublishedService[]> {
    const published: PublishedService[] = []

    for (const service of services) {
      const before = service.datatokenAddress
      try {
        const { datatokenAddress, tx } = await createDatatokenForService({
          signer: this.signer,
          chainConfig: this.config,
          nftAddress,
          service,
          owner
        })

        published.push({ service, datatokenAddress, tx })
      } finally {
        if (service.datatokenAddress && service.datatokenAddress !== before)
          created.push(service.datatokenAddress)
      }
    }

    return published
  }

  /**
   * Republishes an edited asset.
   *
   * Only services carrying a new pricing config get a new datatoken; everything else is
   * merged over the published document, so changing one field does not require resupplying
   * the rest. Before any datatoken is minted, the remote store is checked, and so are the
   * NFT's lifecycle state and the signer's permissions, under the per-NFT lock. A failure
   * after a datatoken was created names it, as `error.datatokens`.
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
    const priced = asset.ddo.services.filter((service) => service.pricing)

    const response = await this.withNftLock(nftAddress, async () => {
      // Inside the lock, so a lifecycle change this instance started for the NFT has landed:
      // a DEPRECATED or REVOKED asset can never take metadata again.
      const onChainState = await readMetadataState(
        new Nft(this.signer, this.config.chainId, this.config),
        nftAddress
      )
      assertWritableState(onChainState, `NFT ${nftAddress}`)

      // The state the builder took over from the indexed DDO may predate a
      // setAssetLifecycleState() (or the index may lag one), and writing it would undo that
      // change. Only a state set on the builder replaces the one on chain.
      const lifecycleState = asset.hasRequestedLifecycleState
        ? (asset.lifecycleState ?? 0)
        : onChainState
      await assertNftPermissions({
        signer: this.signer,
        chainConfig: this.config,
        nftAddress,
        deployDatatokens: priced.length > 0,
        operation: 'edit'
      })

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
      await this.warnIfPolicyServerDeniesAll(asset)
      await this.assertIndexerNotStuck(options)

      const published: PublishedService[] = []
      const created: string[] = []
      let minting = true
      let result: Awaited<ReturnType<Nautilus['writeAsset']>>
      try {
        published.push(
          ...(await this.createDatatokens(nftAddress, priced, owner, created))
        )
        minting = false

        result = await this.writeAsset({
          asset,
          nftAddress,
          create: false,
          lifecycleState,
          remoteStore,
          ddoSigner,
          issuer
        })
      } catch (error) {
        if (!created.length) throw error

        throw annotateError(
          error,
          { datatokens: created },
          ` edit() had created datatoken(s) ${created.join(', ')} on NFT ${nftAddress} (error.datatokens, and on each service's datatokenAddress)${minting ? `; ${created[created.length - 1]} may have no pricing yet` : ''}. Unless the metadata transaction was sent, no metadata references them, and a retried edit() creates new ones.`
        )
      }

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
   * Warns when a node that checks this asset has a policy server and the asset-level
   * `credentials` hold no address allow list: `{}`, or an `allow` list without an
   * `address` entry that names an address. That policy server checks the consumer's
   * address against the asset-level allow list before anything else and refuses an
   * address that is not on it, so it refuses every consumer: the asset is published, but
   * nobody can download it or run compute on it.
   *
   * The nodes asked are the configured one and each service's `serviceEndpoint`. Best
   * effort: a node whose status cannot be read is skipped. Never throws.
   */
  private async warnIfPolicyServerDeniesAll(
    asset: NautilusAsset
  ): Promise<void> {
    if (hasAddressAllowList(asset.ddo.credentials)) return

    const endpoints = new Set([
      this.node.nodeUri,
      ...asset.ddo.services
        .map((service) => service.serviceEndpoint)
        .filter(Boolean)
    ])

    for (const endpoint of endpoints) {
      let configured: boolean | undefined
      try {
        configured = await this.node.forEndpoint(endpoint).hasPolicyServer()
      } catch (error) {
        LoggerInstance.debug(
          `[publish] could not ask ${endpoint} whether it has a policy server: ${errorMessage(error)}`
        )
        continue
      }

      if (configured) {
        LoggerInstance.warn(
          `[publish] ${endpoint} has a policy server, and this asset's credentials have no address allow list (credentials: {}, or an allow list without an 'address' entry). The policy server checks the consumer's address against that list first, so it denies every consumer: the asset will be published, but nobody can download it or compute on it. Add the consumers' addresses with addCredentialAddresses(CredentialListTypes.ALLOW, [...]) before publishing.`
        )
        return
      }
    }
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
    /** The lifecycle state to write with the metadata. */
    lifecycleState: number
    remoteStore: RemoteStore
    ddoSigner: DdoSigner
    /** Resolved before the first transaction, so it is not asked for twice. */
    issuer: string
  }): Promise<Omit<PublishResponse, 'nftAddress' | 'services' | 'indexed'>> {
    const {
      asset,
      nftAddress,
      create,
      lifecycleState,
      remoteStore,
      ddoSigner
    } = params

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

    // From here the envelope is stored. A failure while no transaction can point at it
    // (before the broadcast, or after a mined revert) orphans it, so it is removed again;
    // once the transaction may be on chain it is kept.
    let sent = false
    let txHash: string | undefined
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
        onProgress: (progress, hash) => {
          sent = progress === 'sent'
          txHash = hash ?? txHash
        }
      })
    } catch (error) {
      throw await settleStoredEnvelope(error, {
        remoteStore,
        storedPointer: prepared.storedPointer,
        metadataHash: prepared.written.metadataHash,
        sent,
        ...(txHash ? { txHash } : {})
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

  /**
   * The provider-fee pair for a call: the call's own when it sets either option, else
   * `Nautilus.create`'s.
   *
   * The pair is taken as a whole, never merged field by field: a call that sets a tight
   * `maxProviderFee` must not inherit a permissive `confirmProviderFees` default. A key
   * the call sets to `undefined` counts as set, so `{ confirmProviderFees: undefined }`
   * clears the default callback.
   */
  private withProviderFeeDefaults<T extends ProviderFeeLimits>(config: T): T {
    if ('maxProviderFee' in config || 'confirmProviderFees' in config)
      return config

    return {
      ...config,
      maxProviderFee: this.options.maxProviderFee,
      confirmProviderFees: this.options.confirmProviderFees
    }
  }

  /**
   * The escrow pair for a call: the call's own when it sets `maxEscrowPayment` or
   * `confirmEscrowPayment`, else `Nautilus.create`'s. Taken as a whole, like
   * `withProviderFeeDefaults`.
   */
  private withEscrowDefaults<T extends EscrowPaymentLimits>(config: T): T {
    if ('maxEscrowPayment' in config || 'confirmEscrowPayment' in config)
      return config

    return {
      ...config,
      maxEscrowPayment: this.options.maxEscrowPayment,
      confirmEscrowPayment: this.options.confirmEscrowPayment
    }
  }

  // #endregion

  // #region access

  /** Orders a service if needed and returns a one-time download URL. */
  async access(config: AccessConfig): Promise<AccessResult> {
    return access(this.withProviderFeeDefaults(config), {
      node: this.node,
      signer: this.signer,
      chainConfig: this.config,
      policySessions: this.policySessions
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
    return compute(
      this.withEscrowDefaults(this.withProviderFeeDefaults(config)),
      {
        node: this.node,
        signer: this.signer,
        chainConfig: this.config,
        policySessions: this.policySessions,
        escrow: this.explicitEscrow,
        escrowLock: this.escrowLock
      }
    )
  }

  /** Starts a free compute job. No orders, no escrow, no payment token. */
  async freeCompute(
    config: FreeComputeConfig
  ): Promise<Omit<ComputeResult, 'initializeResults' | 'orders'>> {
    return freeCompute(config, {
      node: this.node,
      signer: this.signer,
      chainConfig: this.config,
      policySessions: this.policySessions
    })
  }

  /**
   * The status of a job, or `undefined` when the node does not know it.
   *
   * `jobId` is the `<environmentHash>-<jobId>` id `compute()` and `freeCompute()` return,
   * and the job comes back under that same id. A bare id is refused: the node would answer
   * with every job of the consumer instead.
   */
  async getComputeStatus(
    config: ComputeStatusConfig
  ): Promise<NodeComputeJob | undefined> {
    return this.nodeFor(config.nodeUri).getComputeJob(config.jobId)
  }

  /**
   * A download URL for a finished job's result: its `output` (the job's `outputs.tar`)
   * unless `resultIndex` names another.
   *
   * `undefined`, with a log line saying why, when the node does not know the job, the job
   * has not finished (status below `70`), or it has no such result.
   */
  async getComputeResult(
    config: ComputeResultConfig
  ): Promise<string | undefined> {
    const node = this.nodeFor(config.nodeUri)
    const result = await this.findResult(node, config)

    if ('pending' in result) {
      LoggerInstance.log(`[compute] ${result.pending}`)
      return undefined
    }

    if ('missing' in result) {
      LoggerInstance.warn(`[compute] ${result.missing}`)
      return undefined
    }

    return node.getComputeResultUrl(result.jobId, result.index)
  }

  /**
   * Streams a finished job's result, chosen as `getComputeResult` chooses it: its `output`
   * unless `resultIndex` names another. Throws where `getComputeResult` returns
   * `undefined`.
   */
  async streamComputeResult(
    config: ComputeResultConfig
  ): Promise<ComputeResultStream> {
    const node = this.nodeFor(config.nodeUri)
    const result = await this.findResult(node, config)

    if ('pending' in result) throw new Error(`[compute] ${result.pending}`)
    if ('missing' in result) throw new Error(`[compute] ${result.missing}`)

    return node.getComputeResult(result.jobId, result.index)
  }

  /**
   * A job's algorithm logs: streamed live while the algorithm runs, and read from the
   * job's `algorithmLog` result once it has finished, since the node streams logs only
   * while the algorithm runs.
   */
  async getComputeLogs(
    config: ComputeStatusConfig
  ): Promise<ComputeResultStream> {
    const node = this.nodeFor(config.nodeUri)
    let job = await this.requireJob(node, config.jobId)

    if (!isJobFinished(job)) {
      try {
        return await node.getComputeLogs(job.jobId)
      } catch (error) {
        // The job may have finished since its status was read.
        const latest = await node.getComputeJob(job.jobId)
        if (!latest || !isJobFinished(latest)) throw error
        job = latest
      }
    }

    const index = findResultIndex(job, 'algorithmLog')

    if (index === undefined)
      throw new Error(
        `[compute] job ${job.jobId} has finished and has no 'algorithmLog' result. Results: ${JSON.stringify(job.results)}`
      )

    return node.getComputeResult(job.jobId, index)
  }

  async stopCompute(config: StopComputeConfig): Promise<ComputeJob[]> {
    return this.nodeFor(config.nodeUri).computeStop(
      config.jobId,
      config.agreementId
    )
  }

  /** The job, or an error saying the node does not know it. */
  private async requireJob(
    node: OceanNodeClient,
    jobId: string
  ): Promise<NodeComputeJob> {
    const job = await node.getComputeJob(jobId)

    if (!job)
      throw new Error(
        `[compute] node ${node.nodeUri} does not know job ${jobId}`
      )

    return job
  }

  /**
   * Finds the result `getComputeResult` and `streamComputeResult` read: `resultIndex`, or
   * the finished job's `output`. `pending` while the job runs, `missing` when the node does
   * not know the job or it has no such result.
   */
  private async findResult(
    node: OceanNodeClient,
    config: ComputeResultConfig
  ): Promise<
    { jobId: string; index: number } | { pending: string } | { missing: string }
  > {
    const job = await node.getComputeJob(config.jobId)

    if (!job)
      return {
        missing: `node ${node.nodeUri} does not know job ${config.jobId}`
      }

    if (!isJobFinished(job))
      return {
        pending: `job ${job.jobId} is not finished yet (status ${job.status}: ${job.statusText})`
      }

    const index = config.resultIndex ?? findResultIndex(job, 'output')

    if (index === undefined)
      return {
        missing: `job ${job.jobId} has no 'output' result; pass resultIndex to read another. Results: ${JSON.stringify(job.results)}`
      }

    return { jobId: job.jobId, index }
  }

  /** A client for another node, when a job runs somewhere other than the default. */
  private nodeFor(nodeUri?: string): OceanNodeClient {
    if (!nodeUri || nodeUri === this.node.nodeUri) return this.node

    return new OceanNodeClient({
      nodeUri,
      chainId: this.config.chainId,
      auth: this.signer,
      allowInsecureTransport: this.options.allowInsecureTransport,
      requestTimeoutMs: this.options.requestTimeoutMs
    })
  }

  // #endregion
}
