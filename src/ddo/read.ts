/**
 * The only place nautilus reads a DDO's structure.
 *
 * Every accessor goes through `DDOManager`, which flattens v5's `credentialSubject.*` into
 * a version-agnostic view. Keeping this the single reader is what makes a future DDO v6 a
 * change to ddo-js plus this file, rather than a change to every flow.
 */
import {
  type AssetDatatoken,
  type AssetV5,
  DDOManager,
  type IndexedMetadata,
  type MetadataV5,
  type ServiceV5,
  type Stats,
  type VersionedDDO
} from '@oceanprotocol/ddo-js'
import type { DdoCredentials } from './types.js'

/** Wraps a raw DDO in its version-specific manager. */
export function asVersioned(ddo: unknown): VersionedDDO {
  return DDOManager.getDDOClass(ddo as Record<string, unknown>)
}

/** `true` when the DDO is v5 or newer — the gate for every SSI code path. */
export function isVersionGte(
  version: string | undefined,
  minimum: string
): boolean {
  if (!version) return false

  const left = version.split('.').map((part) => Number.parseInt(part, 10))
  const right = minimum.split('.').map((part) => Number.parseInt(part, 10))

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = Number.isNaN(left[i]) ? 0 : left[i] || 0
    const b = Number.isNaN(right[i]) ? 0 : right[i] || 0
    if (a !== b) return a > b
  }

  return true
}

export function getVersion(ddo: unknown): string | undefined {
  return asVersioned(ddo).getDDOFields().version || undefined
}

export function supportsSsi(ddo: unknown): boolean {
  return isVersionGte(getVersion(ddo), '5.0.0')
}

export function getDid(ddo: unknown): string {
  return asVersioned(ddo).getDid()
}

export function getChainId(ddo: unknown): number {
  return asVersioned(ddo).getDDOFields().chainId as number
}

export function getNftAddress(ddo: unknown): string {
  return asVersioned(ddo).getDDOFields().nftAddress as string
}

export function getMetadata(ddo: unknown): MetadataV5 {
  return asVersioned(ddo).getDDOFields().metadata as unknown as MetadataV5
}

export function getServices(ddo: unknown): ServiceV5[] {
  return (asVersioned(ddo).getDDOFields().services ||
    []) as unknown as ServiceV5[]
}

/**
 * The asset-level credentials block. Typed as an array upstream but written as an object
 * by every producer in the stack, so it is normalized here.
 */
export function getCredentials(ddo: unknown): DdoCredentials {
  const raw = asVersioned(ddo).getDDOFields().credentials

  if (!raw) return {}
  if (Array.isArray(raw))
    return { allow: raw as unknown as DdoCredentials['allow'] }

  return raw as unknown as DdoCredentials
}

export function getServiceCredentials(service: ServiceV5): DdoCredentials {
  const raw = service.credentials as unknown

  if (!raw) return {}
  if (Array.isArray(raw)) return { allow: raw as DdoCredentials['allow'] }

  return raw as DdoCredentials
}

export function getIndexedMetadata(ddo: unknown): IndexedMetadata | undefined {
  return asVersioned(ddo).getAssetFields().indexedMetadata
}

export function getDatatokens(ddo: unknown): AssetDatatoken[] {
  return asVersioned(ddo).getAssetFields().datatokens || []
}

export function getNft(ddo: unknown): IndexedMetadata['nft'] | undefined {
  return getIndexedMetadata(ddo)?.nft
}

/** Current on-chain lifecycle state, or `undefined` when the DDO is not indexed yet. */
export function getLifecycleState(ddo: unknown): number | undefined {
  return getNft(ddo)?.state
}

export function getOwner(ddo: unknown): string | undefined {
  return getNft(ddo)?.owner
}

export function getService(
  ddo: unknown,
  serviceId: string
): ServiceV5 | undefined {
  return getServices(ddo).find((service) => service.id === serviceId)
}

/** First service of the given type — how `access` and `compute` pick a default service. */
export function getServiceByType(
  ddo: unknown,
  type: string
): ServiceV5 | undefined {
  return getServices(ddo).find((service) => service.type === type)
}

export function getServiceIndex(ddo: unknown, serviceId: string): number {
  const index = getServices(ddo).findIndex(
    (service) => service.id === serviceId
  )

  return index < 0 ? 0 : index
}

/**
 * Indexed stats for one service. v5 made `stats` an array with one entry per service, so
 * it must be matched on `serviceId` rather than indexed positionally.
 */
export function getStatsForService(
  ddo: unknown,
  serviceId: string
): Stats | undefined {
  const stats = getIndexedMetadata(ddo)?.stats

  if (!stats?.length) return undefined

  return stats.find((entry) => entry.serviceId === serviceId) || stats[0]
}

export function getDatatokenForService(
  ddo: unknown,
  serviceId: string
): string | undefined {
  const service = getService(ddo, serviceId)
  if (service?.datatokenAddress) return service.datatokenAddress

  return getStatsForService(ddo, serviceId)?.datatokenAddress
}

/** Re-exported for callers that need the concrete v5 asset type. */
export type { AssetV5 }
