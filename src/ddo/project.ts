/**
 * Builder state -> DDO v5.
 *
 * This is the **only** module that writes `credentialSubject`. Every other module reads
 * through `./read`. Confining the shape here is what keeps a future DDO v6 from touching
 * the builders or the flows.
 */
import {
  DDOManager,
  type MetadataV5,
  type ServiceV5
} from '@oceanprotocol/ddo-js'
import { type LanguageOptions, toLanguageValue } from './language.js'
import type {
  DdoCredentials,
  LanguageValue,
  License,
  RemoteObject
} from './types.js'

/** The v5 Verifiable Credential context. */
export const VC_CONTEXT = ['https://www.w3.org/ns/credentials/v2']
export const DDO_VERSION = '5.0.0'
export const VC_TYPE = ['VerifiableCredential']

/**
 * Metadata as the builders accumulate it: plain strings where v5 wants language-tagged
 * objects, so callers are not forced to construct `{'@value', '@language', '@direction'}`
 * by hand. `project()` performs the conversion.
 */
export interface MetadataState {
  type?: string
  name?: string
  description?: string | LanguageValue
  displayTitle?: string | LanguageValue
  author?: string
  providedBy?: string
  copyrightHolder?: string
  license?: string | License
  links?: Record<string, string>
  attachments?: RemoteObject[]
  tags?: string[]
  categories?: string[]
  additionalInformation?: Record<string, string | number | boolean>
  algorithm?: MetadataV5['algorithm']
}

export interface DdoState {
  chainId?: number
  nftAddress?: string
  issuer?: string
  version: string
  context: string[]
  metadata: MetadataState
  credentials: DdoCredentials
  language: LanguageOptions
}

export interface ProjectOptions {
  /** `true` on first publish: stamps `created` and derives the DID. */
  create: boolean
  chainId: number
  nftAddress: string
  /** Fully-built v5 services, files already encrypted. */
  services: ServiceV5[]
  /** The previously published DDO, when editing. */
  baseline?: Record<string, unknown>
  /** ISO-8601 timestamp used for `created`/`updated`. Injected so it can be asserted. */
  now?: string
}

/** v5 timestamps are second-precision ISO-8601 — the millisecond form is rejected. */
export function timestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.[0-9]{3}Z$/, 'Z')
}

function projectMetadata(
  state: MetadataState,
  language: LanguageOptions,
  baselineMetadata: Partial<MetadataV5> | undefined,
  options: ProjectOptions
): MetadataV5 {
  const now = options.now || timestamp()

  const metadata: Record<string, unknown> = { ...baselineMetadata }

  const assign = (key: string, value: unknown) => {
    if (value !== undefined) metadata[key] = value
  }

  assign('type', state.type)
  assign('name', state.name)
  assign('author', state.author)
  assign('providedBy', state.providedBy)
  assign('copyrightHolder', state.copyrightHolder)
  assign('links', state.links)
  assign('attachments', state.attachments)
  assign('tags', state.tags)
  assign('categories', state.categories)
  assign('additionalInformation', state.additionalInformation)
  assign('algorithm', state.algorithm)

  if (state.description !== undefined)
    metadata.description = toLanguageValue(state.description, language)

  if (state.displayTitle !== undefined)
    metadata.displayTitle = toLanguageValue(state.displayTitle, language)

  if (state.license !== undefined)
    metadata.license =
      typeof state.license === 'string'
        ? { name: state.license }
        : state.license

  metadata.created = options.create
    ? now
    : (baselineMetadata?.created as string | undefined) || now
  metadata.updated = now

  return metadata as unknown as MetadataV5
}

/**
 * Builds the v5 DDO. On edit, unset builder fields fall through to the baseline, so a
 * caller can change one field without resupplying the rest — unlike the shallow
 * top-level merge the ocean-cli does.
 */
export function project(
  state: DdoState,
  options: ProjectOptions
): Record<string, unknown> {
  const { create, chainId, nftAddress, services, baseline } = options

  if (create && (!chainId || !nftAddress))
    throw new Error(
      'chainId and nftAddress are required to create a new DDO. Publish the NFT first.'
    )

  const baselineSubject =
    (baseline?.credentialSubject as Record<string, unknown> | undefined) || {}

  const version = state.version || DDO_VERSION

  // The DID is derived from (nftAddress, chainId) by the version-specific manager, which
  // for v5 means the `did:ope:` prefix. ocean.js's own generateDid() still emits the v4
  // `did:op:` form and must not be used here.
  const manager = DDOManager.getDDOClass({
    version,
    id: (baseline?.id as string) || 'did:ope:',
    credentialSubject: baselineSubject
  })
  const id = create
    ? manager.makeDid(nftAddress, String(chainId))
    : (baseline?.id as string)

  const metadata = projectMetadata(
    state.metadata,
    state.language,
    baselineSubject.metadata as Partial<MetadataV5> | undefined,
    options
  )

  const credentialSubject: Record<string, unknown> = {
    ...baselineSubject,
    id,
    chainId,
    nftAddress,
    version,
    metadata,
    services,
    credentials: state.credentials
  }

  const ddo: Record<string, unknown> = {
    ...baseline,
    '@context': state.context?.length ? state.context : VC_CONTEXT,
    id,
    type: (baseline?.type as string[]) || VC_TYPE,
    version,
    credentialSubject
  }

  if (state.issuer !== undefined) ddo.issuer = state.issuer
  else if (ddo.issuer === undefined) ddo.issuer = ''

  return ddo
}

/**
 * Fields that must not be signed or written on-chain.
 *
 * `datatokens`, `event` and `stats` are derived by the indexer from chain state, so
 * signing them would bake in a snapshot that goes stale immediately. `accessDetails`,
 * `views` and `offchain` are consumer-side decorations that some clients (the market)
 * attach to a resolved asset and must be stripped before republishing.
 */
const DERIVED_SUBJECT_FIELDS = [
  'datatokens',
  'event',
  'stats',
  'accessDetails',
  'views',
  'offchain'
] as const

const DERIVED_TOP_LEVEL_FIELDS = [
  'indexedMetadata',
  'accessDetails',
  'views',
  'offchain',
  'proof'
] as const

/** Returns a copy with every indexer-derived and consumer-side field removed. */
export function stripDerivedFields(
  ddo: Record<string, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(ddo)

  for (const field of DERIVED_TOP_LEVEL_FIELDS) delete copy[field]

  const subject = copy.credentialSubject as Record<string, unknown> | undefined
  if (subject) for (const field of DERIVED_SUBJECT_FIELDS) delete subject[field]

  return copy
}

/**
 * Replaces services by id, keeping any baseline service that was not rebuilt and dropping
 * the ids in `removed`.
 */
export function mergeServices(
  baselineServices: ServiceV5[],
  newServices: ServiceV5[],
  removed: string[] = []
): ServiceV5[] {
  const dropped = new Set(removed)
  const replacements = new Map(
    newServices.map((service) => [service.id, service])
  )

  const merged = baselineServices
    .filter((service) => !dropped.has(service.id))
    .map((service) => {
      const replacement = replacements.get(service.id)
      if (!replacement) return service

      replacements.delete(service.id)
      return replacement
    })

  return [...merged, ...replacements.values()]
}
