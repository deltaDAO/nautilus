import type { MetadataV5, ServiceV5 } from '@oceanprotocol/ddo-js'
import type {
  Config,
  DatatokenCreateParams,
  DispenserParams,
  FreCreationParams,
  NftCreateData,
  StorageObject
} from '@oceanprotocol/lib'
import type { Signer, TransactionReceipt } from 'ethers'
import type { MetadataState } from '../ddo/project.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService.js'

/**
 * Metadata as the builders accumulate it — plain strings where DDO v5 wants
 * language-tagged objects, converted on projection. See `src/ddo/project.ts`.
 */
export type MetadataConfig = MetadataState

/** The fully-projected v5 metadata, as it appears in the published DDO. */
export type PublishedMetadata = MetadataV5

export type PricingType = 'fixed' | 'free'

export interface PricingConfig {
  type: PricingType
  freCreationParams?: FreCreationParams
  /** Overrides for the dispenser created by `type: 'free'`. */
  dispenserParams?: Partial<DispenserParams>
}

/** Pricing as supplied to `ServiceBuilder.setPricing` — the owner is filled in on publish. */
export type PricingConfigWithoutOwner = {
  type: PricingType
  freCreationParams?: Omit<FreCreationParams, 'owner'>
  dispenserParams?: Partial<DispenserParams>
}

export type DatatokenCreateParamsWithoutOwner = Omit<
  DatatokenCreateParams,
  'paymentCollector' | 'minter'
>

export type NftCreateDataWithoutOwner = Omit<NftCreateData, 'owner'>

export interface CreateAssetConfig {
  chainConfig: Config
  signer: Signer
  nftParams: NftCreateData
}

/**
 * One published service: the builder object, the datatoken minted for it, and the receipt
 * of the transaction that created both.
 */
export interface PublishedService {
  service: NautilusService<ServiceTypes, FileTypes>
  datatokenAddress: string
  /**
   * The transaction that created the datatoken (or, for a reused one, its pricing).
   * Absent for a datatoken `completePublish()` reused as it was.
   */
  tx?: TransactionReceipt
  /** `true` for a datatoken `completePublish()` found on the NFT instead of creating it. */
  reused?: boolean
}

export interface PublishResponse {
  nftAddress: string
  services: PublishedService[]
  /** The DDO as published, including its derived `did:ope:` id. */
  ddo: Record<string, unknown>
  /** The signed VC the DDO pointer refers to. */
  credential?: { jwt: string; issuer: string }
  /**
   * What went to the remote store: the pointer it returned (for IPFS `{ type, hash }`, with
   * the CID to unpin) and the on-chain metadata hash, which is the sha256 of the stored
   * envelope. The pointer is **redacted**: an S3 `secretAccessKey`, `url` header values and
   * URL passwords read `'<redacted>'`. `remove()` on the nautilus stores accepts it as is.
   */
  stored: { pointer: StorageObject; metadataHash: string }
  setMetadataTxReceipt: TransactionReceipt
  /**
   * `true` when `waitForIndexer` was passed: the asset is resolvable now. Waiting throws
   * when the node fails to index it, so this is never `false`.
   */
  indexed?: boolean
}

/**
 * An algorithm to trust, by DID and (now that v5 requires it) by service.
 *
 * DDO v5's `PublisherTrustedAlgorithms` carries a required `serviceId`, so nautilus finally
 * resolves one entry per (did, serviceId) pair instead of assuming `services[0]`.
 */
export type TrustedAlgorithmAsset = {
  did: string
  serviceIds?: string[]
}

/** Re-exported so callers can type a built service without reaching into internals. */
export type PublishedServiceDefinition = ServiceV5

/**
 * An error thrown after the metadata transaction was mined (the wait for the indexer
 * failed or timed out, or a `MetadataConflictError`). The asset is on chain: `published`
 * carries the full result, so the caller keeps the NFT address, the DDO and the stored
 * pointer instead of publishing again.
 */
export type PublishedNotIndexed = Error & { published: PublishResponse }

/**
 * What a failed `publish()`, `completePublish()` or `edit()` left in the remote store, on
 * `error.stored` (and on `PublishIncompleteError.stored`). Present when the envelope had
 * been stored but its metadata transaction was not confirmed.
 *
 * Nothing on chain points at an envelope whose transaction was never sent, so nautilus
 * deletes it with `RemoteStore.remove()`. Once the transaction was sent it may have been
 * mined and the envelope may be what the NFT now points at, so nautilus leaves it alone.
 */
export interface StoredBeforeFailure {
  /** The pointer the store returned, redacted as in `PublishResponse.stored`. */
  pointer: StorageObject
  /** `0x` + sha256 of the stored envelope. */
  metadataHash: string
  /**
   * - `'removed'`: the metadata transaction was never sent, and `remove()` deleted the
   *   object.
   * - `'not-removed'`: the transaction was never sent, but the store has no `remove()` or
   *   it failed (`removeError`). Nothing points at the object; delete or unpin it yourself.
   * - `'kept'`: the transaction was sent and may have been mined. Check the NFT's metadata
   *   (`getAsset()`, or `completePublish()`, which refuses an NFT with metadata) before
   *   removing the object: if the transaction landed, the asset needs it.
   */
  cleanup: 'removed' | 'not-removed' | 'kept'
  /** Why `remove()` did not delete it, for `'not-removed'`. */
  removeError?: string
}

/** An error from `publish()`, `completePublish()` or `edit()` that carries `stored`. */
export type FailedWithStoredObject = Error & { stored: StoredBeforeFailure }
