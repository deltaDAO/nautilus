/**
 * Resolving trusted algorithms.
 *
 * A compute service that trusts specific algorithms pins them by checksum, so a publisher
 * cannot swap the container out from under a consumer. Nautilus lets you stage them by DID
 * and resolves the checksums here, at publish time, from the live DDOs.
 *
 * DDO v5 changed the shape: `PublisherTrustedAlgorithms` now carries a required
 * `serviceId`, so an algorithm is trusted per service rather than wholesale. v1 could only
 * ever pin `services[0]` and carried a TODO saying so.
 */
import type { PublisherTrustedAlgorithms } from '@oceanprotocol/ddo-js'
import { getHash } from '@oceanprotocol/lib'
import type { TrustedAlgorithmAsset } from '../../@types/Publish.js'
import { getMetadata, getServiceByType, getServices } from '../../ddo/read.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from '../../Nautilus/index.js'
import type { OceanNodeClient } from '../../node/OceanNodeClient.js'

/**
 * Resolves one staged algorithm into one entry per trusted service.
 *
 * When no `serviceIds` are given, the algorithm's first compute service is used — matching
 * what a caller naming only a DID almost certainly means.
 */
async function resolveAlgorithm(
  node: OceanNodeClient,
  staged: TrustedAlgorithmAsset
): Promise<PublisherTrustedAlgorithms[]> {
  const asset = await node.resolve(staged.did)
  const metadata = getMetadata(asset)

  if (metadata?.type !== 'algorithm')
    throw new Error(
      `Asset ${staged.did} cannot be trusted as an algorithm: its metadata type is '${metadata?.type}'.`
    )

  const container = metadata.algorithm?.container

  if (!container?.entrypoint || !container?.checksum)
    throw new Error(
      `Algorithm ${staged.did} has no container entrypoint/checksum, so it cannot be pinned.`
    )

  // The container is pinned by hashing entrypoint + image checksum together, so changing
  // either invalidates the trust.
  const containerSectionChecksum = getHash(
    container.entrypoint + container.checksum
  )

  const serviceIds = staged.serviceIds?.length
    ? staged.serviceIds
    : [defaultServiceId(asset, staged.did)]

  const resolved: PublisherTrustedAlgorithms[] = []

  for (const serviceId of serviceIds) {
    const service = getServices(asset).find(
      (candidate) => candidate.id === serviceId
    )

    if (!service)
      throw new Error(
        `Algorithm ${staged.did} has no service with id ${serviceId}. Available: ${getServices(
          asset
        )
          .map((candidate) => candidate.id)
          .join(', ')}`
      )

    const fileInfo = await node.checkDidFiles(staged.did, serviceId)
    const filesChecksum = fileInfo?.[0]?.checksum

    if (!filesChecksum)
      throw new Error(
        `The node returned no file checksum for algorithm ${staged.did} service ${serviceId}.`
      )

    resolved.push({
      did: staged.did,
      serviceId,
      containerSectionChecksum,
      filesChecksum
    })
  }

  return resolved
}

function defaultServiceId(asset: unknown, did: string): string {
  const service = getServiceByType(asset, 'compute') || getServices(asset)[0]

  if (!service)
    throw new Error(
      `Algorithm ${did} has no services, so it cannot be trusted.`
    )

  return service.id
}

/**
 * Resolves every staged algorithm on every service, merging into whatever the service
 * already trusts and replacing entries whose checksums moved.
 *
 * Mutates the services in place, because it runs after the builders have handed them off
 * and before the DDO is projected.
 */
export async function resolvePublisherTrustedAlgorithms(
  node: OceanNodeClient,
  services: NautilusService<ServiceTypes, FileTypes>[]
): Promise<void> {
  for (const service of services) {
    if (!service.addedPublisherTrustedAlgorithms?.length) continue

    const resolved = (
      await Promise.all(
        service.addedPublisherTrustedAlgorithms.map((staged) =>
          resolveAlgorithm(node, staged)
        )
      )
    ).flat()

    // `null` means "trust everything" and must not be turned into a list.
    if (service.compute.publisherTrustedAlgorithms === null) continue

    const existing = service.compute.publisherTrustedAlgorithms || []

    for (const algorithm of resolved) {
      const index = existing.findIndex(
        (candidate) =>
          candidate.did === algorithm.did &&
          candidate.serviceId === algorithm.serviceId
      )

      if (index === -1) existing.push(algorithm)
      else existing[index] = algorithm
    }

    service.compute.publisherTrustedAlgorithms = existing
  }
}
