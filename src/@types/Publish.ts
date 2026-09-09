import type { MetadataV5, ServiceV5 } from '@oceanprotocol/ddo-js'
import type {
  Config,
  DatatokenCreateParams,
  DispenserParams,
  FreCreationParams,
  NftCreateData
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
  tx: TransactionReceipt
}

export interface PublishResponse {
  nftAddress: string
  services: PublishedService[]
  /** The DDO as published, including its derived `did:ope:` id. */
  ddo: Record<string, unknown>
  /** The signed VC the DDO pointer refers to. */
  credential?: { jwt: string; issuer: string }
  setMetadataTxReceipt: TransactionReceipt
  /** Present when `publish({ waitForIndexer: true })` was used. */
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
