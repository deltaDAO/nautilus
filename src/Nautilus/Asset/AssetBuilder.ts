import type { AssetV5, ServiceV5 } from '@oceanprotocol/ddo-js'
import type {
  AssetState,
  IAssetBuilder,
  MetadataAlgorithmConfig
} from '../../@types/Nautilus.js'
import type { NftCreateDataWithoutOwner } from '../../@types/Publish.js'
import { DEFAULT_DIRECTION, DEFAULT_LANGUAGE } from '../../ddo/language.js'
import {
  getLifecycleState,
  getOwner,
  getServiceCredentials
} from '../../ddo/read.js'
import type {
  CredentialListTypes,
  DdoCredentials,
  License,
  MatchRule,
  RemoteObject,
  RequestCredential,
  VcPolicy,
  VpPolicy
} from '../../ddo/types.js'
import {
  addCredentialAccessList,
  addCredentialAddresses,
  addRequestCredentials,
  normalizeStoredCredentials,
  removeCredentialAddresses,
  setVcPolicies,
  setVpPolicies
} from '../../identity/policy.js'
import {
  applySsiPolicyLint,
  lintSsiPolicies,
  type SsiPolicyLintMode,
  type SsiPolicyScope
} from '../../identity/policyLint.js'
import { sanitize } from '../../node/messages.js'
import { NautilusAsset } from './NautilusAsset.js'
import { NautilusDDO } from './NautilusDDO.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService.js'

/**
 * Fluent builder for an asset.
 *
 * Pass a resolved asset to the constructor to edit it; omit it to create a new one. Unlike
 * a top-level merge, unset fields fall through to the published document, so changing one
 * field does not require resupplying the rest.
 *
 * DDO v5 notes that show up in this API:
 *
 *   - `description` and `displayTitle` are language-tagged in v5. The setters take plain
 *     strings and wrap them; `setContentLanguage()` chooses the tag.
 *   - `license` became a structured object. `setLicense()` accepts either form.
 *   - `providedBy` is required by the v5 schema, so `build()` warns if it is missing.
 */
export class AssetBuilder implements IAssetBuilder {
  private asset: NautilusAsset
  private readonly source?: AssetV5
  private ssiPolicyLint: SsiPolicyLintMode = 'warn'

  constructor(asset?: AssetV5) {
    this.source = asset
    this.asset = AssetBuilder.seed(asset)
  }

  private static seed(source?: AssetV5): NautilusAsset {
    if (!source) return new NautilusAsset()

    const asset = new NautilusAsset(NautilusDDO.createFromAsset(source))
    asset.owner = getOwner(source)
    // Inherited, not requested: `edit()` writes the state the NFT has on chain unless
    // `setLifecycleState()` asks for another.
    asset.inheritLifecycleState(getLifecycleState(source))

    return asset
  }

  /** Returns to the state the constructor produced, keeping any loaded asset. */
  reset() {
    this.asset = AssetBuilder.seed(this.source)
  }

  // #region metadata

  setType(type: string) {
    this.asset.ddo.metadata.type = type
    return this
  }

  setName(name: string) {
    this.asset.ddo.metadata.name = name
    return this
  }

  /** Wrapped into a v5 language-tagged object using the builder's current language. */
  setDescription(description: string) {
    this.asset.ddo.metadata.description = description
    return this
  }

  /** A presentational title, distinct from `name`. New in DDO v5. */
  setDisplayTitle(displayTitle: string) {
    this.asset.ddo.metadata.displayTitle = displayTitle
    return this
  }

  /**
   * A bare string becomes `{ name }`. Pass the object form for ODRL terms or license
   * documents.
   */
  setLicense(license: string | License) {
    this.asset.ddo.metadata.license = license
    return this
  }

  setAuthor(author: string) {
    this.asset.ddo.metadata.author = author
    return this
  }

  /** Required by the DDO v5 schema — the organisation providing the asset. */
  setProvidedBy(providedBy: string) {
    this.asset.ddo.metadata.providedBy = providedBy
    return this
  }

  setCopyrightHolder(copyrightHolder: string) {
    this.asset.ddo.metadata.copyrightHolder = copyrightHolder
    return this
  }

  setAlgorithm(algorithm: MetadataAlgorithmConfig) {
    this.asset.ddo.metadata.algorithm = algorithm
    return this
  }

  /**
   * Sets the language tag applied to every language-tagged field this builder emits.
   *
   * Repurposed from v1: `contentLanguage` was a metadata field in v4, but v5 moved the
   * language onto each value, so this now configures that tagging rather than writing a
   * field of its own.
   */
  setContentLanguage(language: string, direction = DEFAULT_DIRECTION) {
    this.asset.ddo.language = { language, direction }
    return this
  }

  addTags(tags: string[]) {
    this.asset.ddo.metadata.tags = unique([
      ...(this.asset.ddo.metadata.tags || []),
      ...tags
    ])
    return this
  }

  addCategories(categories: string[]) {
    this.asset.ddo.metadata.categories = unique([
      ...(this.asset.ddo.metadata.categories || []),
      ...categories
    ])
    return this
  }

  /**
   * v5 stores links as a `{ label: url }` map rather than a list. An array is accepted and
   * keyed by index, so v1-style calls keep working.
   */
  addLinks(links: string[] | Record<string, string>) {
    const existing = this.asset.ddo.metadata.links || {}

    const added = Array.isArray(links)
      ? Object.fromEntries(
          links.map((url, index) => [
            `link-${Object.keys(existing).length + index}`,
            url
          ])
        )
      : links

    this.asset.ddo.metadata.links = { ...existing, ...added }

    return this
  }

  /** Referenced documents — datasheets, terms, sample files. New in DDO v5. */
  addAttachments(attachments: RemoteObject[]) {
    this.asset.ddo.metadata.attachments = [
      ...(this.asset.ddo.metadata.attachments || []),
      ...attachments
    ]
    return this
  }

  /**
   * v5 narrowed this to primitive values, so nested objects must be serialized by the
   * caller rather than passed through.
   */
  addAdditionalInformation(
    additionalInformation: Record<string, string | number | boolean>
  ) {
    this.asset.ddo.metadata.additionalInformation = {
      ...this.asset.ddo.metadata.additionalInformation,
      ...additionalInformation
    }
    return this
  }

  // #endregion

  // #region services

  addService(service: NautilusService<ServiceTypes, FileTypes>) {
    this.asset.ddo.services.push(service)
    return this
  }

  removeService(serviceId: string) {
    this.asset.ddo.removeServices.push(serviceId)
    return this
  }

  // #endregion

  // #region nft

  setNftData(tokenData: NftCreateDataWithoutOwner) {
    this.asset.nftCreateData = { ...tokenData }
    return this
  }

  setNftTokenName(name: string) {
    this.asset.nftCreateData.name = name
    return this
  }

  setNftTokenSymbol(symbol: string) {
    this.asset.nftCreateData.symbol = symbol
    return this
  }

  setNftTokenUri(uri: string) {
    this.asset.nftCreateData.tokenURI = uri
    return this
  }

  setNftTokenTransferable(transferable = true) {
    this.asset.nftCreateData.transferable = transferable
    return this
  }

  setNftTokenTemplate(template: number) {
    this.asset.nftCreateData.templateIndex = template
    return this
  }

  // #endregion

  // #region identity and gating

  /**
   * The DID or address that issues the asset's verifiable credential. Left unset, publish
   * fills it in from whichever signer signs the DDO.
   */
  setIssuer(issuer: string) {
    this.asset.ddo.issuer = issuer
    return this
  }

  addCredentialAddresses(list: CredentialListTypes, addresses: string[]) {
    this.asset.ddo.credentials = addCredentialAddresses(
      this.asset.ddo.credentials,
      list,
      addresses
    )
    return this
  }

  removeCredentialAddresses(list: CredentialListTypes, addresses: string[]) {
    this.asset.ddo.credentials = removeCredentialAddresses(
      this.asset.ddo.credentials,
      list,
      addresses
    )
    return this
  }

  /** Gates on membership of an on-chain access list. New in DDO v5. */
  addCredentialAccessList(
    list: CredentialListTypes,
    accessList: { chainId: number; accessList: string }
  ) {
    this.asset.ddo.credentials = addCredentialAccessList(
      this.asset.ddo.credentials,
      list,
      accessList
    )
    return this
  }

  /**
   * Requires verifiable credentials to access the asset.
   *
   * Emitted as the `type: 'SSIpolicy'` entry the policy server parses — not the
   * `verifiableCredential` shape the ddo-js types declare, which nothing in the stack reads.
   */
  addRequestCredentials(
    list: CredentialListTypes,
    requestCredentials: RequestCredential[]
  ) {
    this.asset.ddo.credentials = addRequestCredentials(
      this.asset.ddo.credentials,
      list,
      requestCredentials
    )
    return this
  }

  /** Credential-level checks, e.g. `signature`, `not-before`, `revoked-status-list`. */
  setVcPolicies(list: CredentialListTypes, policies: VcPolicy[]) {
    this.asset.ddo.credentials = setVcPolicies(
      this.asset.ddo.credentials,
      list,
      policies
    )
    return this
  }

  /** Presentation-level checks, e.g. `holder-binding`, `minimum-credentials`. */
  setVpPolicies(list: CredentialListTypes, policies: VpPolicy[]) {
    this.asset.ddo.credentials = setVpPolicies(
      this.asset.ddo.credentials,
      list,
      policies
    )
    return this
  }

  /**
   * What `build()` does when the SSI policies of the asset or its services check less than
   * they seem to, or refuse common credentials: `'warn'` (the default) logs a warning event
   * for each, `'error'` throws an `SsiPolicyError` instead, `'off'` skips them. Policies that
   * cannot work at all (a VC policy with arguments at asset or service level, a bare
   * `minimum-credentials`) throw in every mode. Kept across `reset()`.
   */
  setSsiPolicyLint(mode: SsiPolicyLintMode) {
    if (!['warn', 'error', 'off'].includes(mode))
      throw new TypeError(
        `ssiPolicyLint must be 'warn', 'error' or 'off', not ${JSON.stringify(mode)}.`
      )
    this.ssiPolicyLint = mode
    return this
  }

  /**
   * How multiple rules combine. Defaults, applied by the policy server, are
   * `match_allow: 'all'` and `match_deny: 'any'`.
   */
  setCredentialMatchRules(rules: {
    match_allow?: MatchRule
    match_deny?: MatchRule
  }) {
    this.asset.ddo.credentials = { ...this.asset.ddo.credentials, ...rules }
    return this
  }

  // #endregion

  // #region lifecycle

  /**
   * The lifecycle state to write with the metadata. Without it, `publish()` writes `ACTIVE`
   * (0) and `edit()` keeps the state the NFT has on chain at the time of the write, not the
   * one in the DDO this builder was constructed with.
   */
  setLifecycleState(state: AssetState) {
    this.asset.lifecycleState = state
    return this
  }

  setOwner(owner: string) {
    this.asset.owner = owner
    return this
  }

  // #endregion

  /**
   * Finishes the asset.
   *
   * Only checks what cannot be checked later. Full schema conformance is verified by
   * `nautilus.publish()`, which runs ddo-js's local SHACL validation and reports the exact
   * failing field before spending any gas.
   */
  build(): NautilusAsset {
    const { metadata } = this.asset.ddo
    const isNew = !this.source

    if (isNew) {
      const missing = (['name', 'type', 'providedBy'] as const).filter(
        (field) => !metadata[field]
      )

      if (missing.length)
        throw new Error(
          `A new asset is missing required metadata: ${missing.join(', ')}. DDO v5 requires name, type and providedBy.`
        )

      if (!this.asset.ddo.services.length)
        throw new Error(
          'A new asset needs at least one service. Call addService().'
        )

      if (
        metadata.type === 'algorithm' &&
        !metadata.algorithm?.container?.image
      )
        throw new Error(
          "An asset of type 'algorithm' needs algorithm.container metadata. Call setAlgorithm()."
        )
    }

    applySsiPolicyLint(
      lintSsiPolicies(
        { where: 'asset', credentials: this.asset.ddo.credentials },
        this.serviceScopes()
      ),
      this.ssiPolicyLint
    )

    if (!this.asset.ddo.language.language)
      this.asset.ddo.language = {
        language: DEFAULT_LANGUAGE,
        direction: DEFAULT_DIRECTION
      }

    return this.asset
  }

  /**
   * The credentials of every service the built asset will have: the builder's own, and on an
   * edit the published ones it neither replaces nor removes.
   */
  private serviceScopes(): SsiPolicyScope[] {
    const { services, removeServices } = this.asset.ddo
    const replaced = new Set([
      ...removeServices,
      ...services.flatMap((service) => (service.id ? [service.id] : []))
    ])

    return [
      ...services.map((service, index) => ({
        where: serviceWhere(service.id || service.name || `#${index + 1}`),
        credentials: service.credentials
      })),
      ...this.asset.ddo
        .getBaselineServices()
        .filter((service) => !replaced.has(service.id))
        .map((service) => ({
          where: serviceWhere(service.id),
          credentials: storedServiceCredentials(service)
        }))
    ]
  }
}

/** A service id or name, which on an edit comes from the node, made safe to quote. */
function serviceWhere(name: string): string {
  return `service ${sanitize(String(name), 100, 'node')}`
}

/**
 * A kept service's credentials in the form the edit writes (`mergeServices` normalises them),
 * or as stored when they cannot be read: the publish then refuses them with its own error.
 */
function storedServiceCredentials(service: ServiceV5): DdoCredentials {
  const credentials = getServiceCredentials(service)
  try {
    return normalizeStoredCredentials(credentials)
  } catch {
    return credentials
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
