import type { AssetV5, ServiceV5, State } from '@oceanprotocol/ddo-js'
import type { Config } from '@oceanprotocol/lib'
import type {
  ConsumerParameterV5,
  DdoCredentials,
  License,
  MatchRule,
  RemoteObject,
  RequestCredential,
  VcPolicy,
  VpPolicy
} from '../ddo/types.js'
import type { NautilusAsset } from '../Nautilus/Asset/NautilusAsset.js'
import type {
  FileTypes,
  NautilusService,
  ServiceFileType,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService.js'
import type {
  DatatokenCreateParamsWithoutOwner,
  NftCreateDataWithoutOwner,
  PricingConfigWithoutOwner,
  TrustedAlgorithmAsset
} from './Publish.js'

/** Config for a `ServiceBuilder`: either a fresh service, or one loaded for editing. */
export type ServiceBuilderConfig =
  | { serviceType: ServiceTypes; fileType?: FileTypes }
  | { asset: AssetV5; serviceId: string }

export interface IBuilder<T> {
  build: () => T
  reset: () => void
}

/**
 * Asset lifecycle state, mirroring the NFT's metadata state.
 *
 * DDO v5 exports the same values as `State` from `@oceanprotocol/ddo-js`; this enum is kept
 * because it is part of nautilus's published API.
 */
export enum LifecycleStates {
  ACTIVE = 0,
  END_OF_LIFE = 1,
  DEPRECATED = 2,
  REVOKED_BY_PUBLISHER = 3,
  ORDERING_DISABLED_TEMPORARILY = 4,
  ASSET_UNLISTED = 5
}

/** `LifecycleStates` and ddo-js's `State` are the same values. */
export type AssetState = LifecycleStates | State

export interface IAssetBuilder extends IBuilder<NautilusAsset> {
  // metadata
  setType: (type: string) => IAssetBuilder
  setName: (name: string) => IAssetBuilder
  setDescription: (description: string) => IAssetBuilder
  setDisplayTitle: (displayTitle: string) => IAssetBuilder
  setLicense: (license: string | License) => IAssetBuilder
  setAuthor: (author: string) => IAssetBuilder
  setProvidedBy: (providedBy: string) => IAssetBuilder
  setCopyrightHolder: (copyrightHolder: string) => IAssetBuilder
  setAlgorithm: (algorithm: MetadataAlgorithmConfig) => IAssetBuilder
  setContentLanguage: (language: string, direction?: string) => IAssetBuilder
  addTags: (tags: string[]) => IAssetBuilder
  addCategories: (categories: string[]) => IAssetBuilder
  addLinks: (links: string[] | Record<string, string>) => IAssetBuilder
  addAttachments: (attachments: RemoteObject[]) => IAssetBuilder
  addAdditionalInformation: (
    additionalInformation: Record<string, string | number | boolean>
  ) => IAssetBuilder

  // services
  addService: (
    service: NautilusService<ServiceTypes, FileTypes>
  ) => IAssetBuilder
  removeService: (serviceId: string) => IAssetBuilder

  // nft
  setNftData: (nftCreateData: NftCreateDataWithoutOwner) => IAssetBuilder
  setNftTokenName: (name: string) => IAssetBuilder
  setNftTokenSymbol: (symbol: string) => IAssetBuilder
  setNftTokenUri: (uri: string) => IAssetBuilder
  setNftTokenTransferable: (transferable?: boolean) => IAssetBuilder
  setNftTokenTemplate: (template: number) => IAssetBuilder

  // identity and gating
  setIssuer: (issuer: string) => IAssetBuilder
  addCredentialAddresses: (
    list: CredentialListTypesAlias,
    addresses: string[]
  ) => IAssetBuilder
  removeCredentialAddresses: (
    list: CredentialListTypesAlias,
    addresses: string[]
  ) => IAssetBuilder
  addCredentialAccessList: (
    list: CredentialListTypesAlias,
    accessList: { chainId: number; accessList: string }
  ) => IAssetBuilder
  addRequestCredentials: (
    list: CredentialListTypesAlias,
    requestCredentials: RequestCredential[]
  ) => IAssetBuilder
  setVcPolicies: (
    list: CredentialListTypesAlias,
    policies: VcPolicy[]
  ) => IAssetBuilder
  setVpPolicies: (
    list: CredentialListTypesAlias,
    policies: VpPolicy[]
  ) => IAssetBuilder
  setCredentialMatchRules: (rules: {
    match_allow?: MatchRule
    match_deny?: MatchRule
  }) => IAssetBuilder

  // lifecycle
  setLifecycleState: (state: AssetState) => IAssetBuilder
  setOwner: (owner: string) => IAssetBuilder
}

export interface IServiceBuilder<S extends ServiceTypes, F extends FileTypes>
  extends IBuilder<NautilusService<S, F>> {
  setName: (name: string) => IServiceBuilder<S, F>
  setDisplayName: (displayName: string) => IServiceBuilder<S, F>
  setDescription: (description: string) => IServiceBuilder<S, F>
  setTimeout: (timeout: number) => IServiceBuilder<S, F>
  setServiceEndpoint: (endpoint: string) => IServiceBuilder<S, F>
  setState: (state: AssetState) => IServiceBuilder<S, F>
  addFile: (file: ServiceFileType<F>) => IServiceBuilder<S, F>
  addConsumerParameter: (
    parameter: ConsumerParameterV5
  ) => IServiceBuilder<S, F>
  addAdditionalInformation: (
    additionalInformation: Record<string, string | number | boolean>
  ) => IServiceBuilder<S, F>

  // schemas
  setDataSchema: (schema: RemoteObject) => IServiceBuilder<S, F>
  setInputSchema: (schema: RemoteObject) => IServiceBuilder<S, F>
  setOutputSchema: (schema: RemoteObject) => IServiceBuilder<S, F>

  // compute
  allowRawAlgorithms: (allow?: boolean) => IServiceBuilder<S, F>
  allowAlgorithmNetworkAccess: (allow?: boolean) => IServiceBuilder<S, F>
  addTrustedAlgorithms: (
    algorithms: TrustedAlgorithmAsset[]
  ) => IServiceBuilder<S, F>
  removeTrustedAlgorithm: (did: string) => IServiceBuilder<S, F>
  setAllAlgorithmsTrusted: () => IServiceBuilder<S, F>
  setAllAlgorithmsUntrusted: () => IServiceBuilder<S, F>
  addTrustedAlgorithmPublisher: (publisher: string) => IServiceBuilder<S, F>
  removeTrustedAlgorithmPublisher: (publisher: string) => IServiceBuilder<S, F>
  setAllAlgorithmPublishersTrusted: () => IServiceBuilder<S, F>
  setAllAlgorithmPublishersUntrusted: () => IServiceBuilder<S, F>

  // gating
  addCredentialAddresses: (
    list: CredentialListTypesAlias,
    addresses: string[]
  ) => IServiceBuilder<S, F>
  addRequestCredentials: (
    list: CredentialListTypesAlias,
    requestCredentials: RequestCredential[]
  ) => IServiceBuilder<S, F>

  // pricing and datatoken
  setPricing: (pricing: PricingConfigWithoutOwner) => IServiceBuilder<S, F>
  setDatatokenData: (
    datatokenCreateData: DatatokenCreateParamsWithoutOwner
  ) => IServiceBuilder<S, F>
  setDatatokenNameAndSymbol: (
    dtName: string,
    dtSymbol: string
  ) => IServiceBuilder<S, F>
}

/**
 * Algorithm metadata. v5 reuses the v4 `MetadataAlgorithm` shape verbatim, including its
 * v4-flavoured nested `container.consumerParameters` — so this stays v4-shaped even though
 * `ServiceV5.consumerParameters` are v5-shaped. `src/ddo/project.ts` owns that asymmetry.
 */
export type MetadataAlgorithmConfig = NonNullable<
  import('@oceanprotocol/ddo-js').MetadataV5['algorithm']
>

/** Alias so the interfaces above do not import from `../ddo/types` at the value level. */
export type CredentialListTypesAlias =
  import('../ddo/types.js').CredentialListTypes

export type { AssetV5, Config, DdoCredentials, ServiceV5 }
