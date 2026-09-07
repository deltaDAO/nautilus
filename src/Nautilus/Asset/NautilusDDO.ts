import type { AssetV5, MetadataV5, ServiceV5 } from '@oceanprotocol/ddo-js'
import type { LanguageOptions } from '../../ddo/language.js'
import {
  DDO_VERSION,
  type DdoState,
  type MetadataState,
  mergeServices,
  project,
  stripDerivedFields,
  VC_CONTEXT
} from '../../ddo/project.js'
import { getCredentials, getMetadata, getServices } from '../../ddo/read.js'
import type { DdoCredentials, RemoteObject } from '../../ddo/types.js'
import type { OceanNodeClient } from '../../node/OceanNodeClient.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from './Service/NautilusService.js'

/**
 * Accumulates the state that becomes a DDO.
 *
 * Deliberately thin: it holds builder state and delegates every structural decision to
 * `src/ddo/project.ts`, which is the only module that knows what a v5 DDO looks like. That
 * is what keeps a future DDO v6 from reaching into the builders.
 */
export class NautilusDDO {
  id?: string
  context: string[] = [...VC_CONTEXT]
  nftAddress?: string
  chainId?: number
  version = DDO_VERSION
  issuer?: string

  metadata: MetadataState = {}
  credentials: DdoCredentials = {}
  language: LanguageOptions = {}

  services: NautilusService<ServiceTypes, FileTypes>[] = []
  removeServices: string[] = []

  /** The previously published DDO, when editing. */
  private baseline?: Record<string, unknown>

  /** Seeds a builder from a resolved asset, for editing. */
  static createFromAsset(asset: AssetV5): NautilusDDO {
    const ddo = new NautilusDDO()

    // Indexer-derived fields are dropped up front, so they can never be carried into the
    // republished document.
    ddo.baseline = stripDerivedFields(
      asset as unknown as Record<string, unknown>
    )

    ddo.id = asset.id
    ddo.context = (asset['@context'] as string[]) || [...VC_CONTEXT]
    ddo.version = asset.version || DDO_VERSION
    ddo.issuer = asset.issuer
    ddo.chainId = asset.credentialSubject?.chainId
    ddo.nftAddress = asset.credentialSubject?.nftAddress
    ddo.credentials = getCredentials(asset)
    ddo.metadata = seedAdditiveMetadata(asset)

    return ddo
  }

  /** The DDO this builder was seeded from, or `undefined` for a fresh asset. */
  getOriginalDDO(): Record<string, unknown> | undefined {
    return this.baseline
  }

  /** Services already published on the asset. */
  getBaselineServices(): ServiceV5[] {
    return this.baseline ? getServices(this.baseline) : []
  }

  /**
   * Projects the accumulated state into a DDO v5 document.
   *
   * @param node used to encrypt each new service's file object
   * @param options `create` stamps `created` and derives the `did:ope:` id
   */
  async getDDO(
    node: OceanNodeClient,
    options: {
      create: boolean
      chainId?: number
      nftAddress?: string
      /**
       * Only for building a DDO before anything is on chain — a validation dry
       * run. Published services take their datatoken from the publish flow; a
       * service that has neither cannot be built at all, which made the
       * "validate before you publish" path impossible.
       */
      datatokenAddress?: string
      now?: string
    }
  ): Promise<Record<string, unknown>> {
    const chainId = options.chainId ?? this.chainId
    const nftAddress = options.nftAddress ?? this.nftAddress

    if (!chainId || !nftAddress)
      throw new Error(
        'A DDO needs both a chainId and an nftAddress. Publish the NFT before building it.'
      )

    this.chainId = chainId
    this.nftAddress = nftAddress

    const built = await this.buildServices(
      node,
      nftAddress,
      options.datatokenAddress
    )

    if (options.create && !built.length)
      throw new Error('An asset needs at least one service. Call addService().')

    const services = mergeServices(
      this.getBaselineServices(),
      built,
      this.collectRemovedServiceIds()
    )

    if (!services.length)
      throw new Error(
        'An asset needs at least one service; all of them were removed.'
      )

    return project(this.toState(), {
      create: options.create,
      chainId,
      nftAddress,
      services,
      baseline: this.baseline,
      now: options.now
    })
  }

  private toState(): DdoState {
    return {
      chainId: this.chainId,
      nftAddress: this.nftAddress,
      issuer: this.issuer,
      version: this.version,
      context: this.context,
      metadata: this.metadata,
      credentials: this.credentials,
      language: this.language
    }
  }

  /** Encrypts and projects every service the builder holds. */
  private async buildServices(
    node: OceanNodeClient,
    nftAddress: string,
    datatokenAddress?: string
  ): Promise<ServiceV5[]> {
    return Promise.all(
      this.services.map((service) =>
        service.getOceanService(
          node,
          nftAddress,
          datatokenAddress,
          this.language
        )
      )
    )
  }

  /**
   * Ids to drop from the published document.
   *
   * Includes explicitly removed services, plus any edited service whose file object
   * changed — because the service id is the hash of that object, the rebuilt service gets a
   * new id and the old entry would otherwise linger alongside it.
   */
  private collectRemovedServiceIds(): string[] {
    const removed = new Set(this.removeServices)

    for (const service of this.services)
      if (service.id && service.checkIfFilesObjectChanged())
        removed.add(service.id)

    return Array.from(removed)
  }
}

/**
 * Seeds the *additive* metadata collections from the asset being edited.
 *
 * `projectMetadata` assigns these fields wholesale, so whatever the builder holds replaces
 * the published value rather than extending it. The additive methods — `addTags`,
 * `addCategories`, `addLinks`, `addAttachments`, `addAdditionalInformation` — each append
 * to builder state that started empty, so on an edit they would publish only the newly
 * added entries and drop everything the asset already carried.
 *
 * Only these five are seeded. The scalar fields are meant to be replaced when set and to
 * fall through to the baseline when not, which `projectMetadata` already does; and
 * `description`, `displayTitle` and `license` are stored language-tagged/structured in the
 * baseline but held as plain values here, so copying them back would double-wrap them.
 */
function seedAdditiveMetadata(asset: AssetV5): MetadataState {
  const metadata = getMetadata(asset) as Partial<MetadataV5> | undefined

  if (!metadata) return {}

  const seeded: MetadataState = {}

  if (metadata.tags?.length) seeded.tags = [...metadata.tags]
  if (metadata.categories?.length) seeded.categories = [...metadata.categories]
  if (metadata.attachments?.length)
    seeded.attachments = [...(metadata.attachments as RemoteObject[])]

  if (metadata.links && Object.keys(metadata.links).length)
    seeded.links = { ...(metadata.links as Record<string, string>) }

  if (
    metadata.additionalInformation &&
    Object.keys(metadata.additionalInformation).length
  )
    seeded.additionalInformation = {
      ...(metadata.additionalInformation as Record<
        string,
        string | number | boolean
      >)
    }

  return seeded
}
