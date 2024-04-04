import {
  type Asset,
  FileInfo,
  ProviderInstance,
  type PublisherTrustedAlgorithm,
  getHash
} from '@oceanprotocol/lib'
import type { FileTypes, NautilusService, ServiceTypes } from '../../Nautilus'
import { getAsset } from '../aquarius'
import { checkDidFiles } from '../provider'

// TODO replace hardcoded service index 0 with service id once supported by the stack
async function getPublisherTrustedAlgorithms(
  dids: string[],
  metadataCacheUri: string
): Promise<PublisherTrustedAlgorithm[]> {
  const trustedAlgorithms: PublisherTrustedAlgorithm[] = []

  const assetPromises = dids.map((did) => getAsset(metadataCacheUri, did))
  let assets: Asset[] = []

  try {
    assets = await Promise.all(assetPromises)
  } catch (error) {
    throw new Error(
      `Failed to fetch assets for PublisherTrustedAlgorithms: ${error}`
    )
  }
  for (const asset of assets) {
    if (asset.metadata.type !== 'algorithm')
      throw new Error(`Asset ${asset.id} is not of type algorithm`)
    if (!asset.services?.[0]) throw new Error(`No service in ${asset.id}`)

    const filesChecksum = await checkDidFiles(
      asset?.id,
      asset?.services?.[0]?.id,
      asset?.services?.[0]?.serviceEndpoint
    )
    if (!filesChecksum?.[0]?.checksum)
      throw new Error(`Unable to get fileChecksum for asset ${asset.id}`)

    const containerChecksum =
      asset.metadata.algorithm.container.entrypoint +
      asset.metadata.algorithm.container.checksum

    // Trusted Algorithms Docs https://docs.oceanprotocol.com/developers/compute-to-data/compute-options#trusted-algorithms
    const trustedAlgorithm = {
      did: asset.id,
      containerSectionChecksum: getHash(containerChecksum),
      filesChecksum: filesChecksum?.[0]?.checksum
    }
    trustedAlgorithms.push(trustedAlgorithm)
  }
  return trustedAlgorithms
}

export async function resolvePublisherTrustedAlgorithms(
  nautilusDDOServices: NautilusService<ServiceTypes, FileTypes>[],
  metadataCacheUri: string
) {
  for (const service of nautilusDDOServices) {
    if (service.addedPublisherTrustedAlgorithms?.length < 1) continue

    const dids = service.addedPublisherTrustedAlgorithms.map(
      (asset) => asset.did
    )
    const newPublisherTrustedAlgorithms = await getPublisherTrustedAlgorithms(
      dids,
      metadataCacheUri
    )

    if (service.compute?.publisherTrustedAlgorithms?.length === 0) {
      service.compute.publisherTrustedAlgorithms = newPublisherTrustedAlgorithms
      continue
    }

    for (const algorithm of newPublisherTrustedAlgorithms) {
      const index = service.compute.publisherTrustedAlgorithms.findIndex(
        (existingAlgorithm) => existingAlgorithm.did === algorithm.did
      )

      if (index === -1) {
        // Algorithm with the same DID doesn't exist, add it
        service.compute.publisherTrustedAlgorithms.push(algorithm)
      } else {
        // If either checksum is different, replace the existing algorithm
        const existing = service.compute.publisherTrustedAlgorithms[index]
        if (
          existing.containerSectionChecksum !==
            algorithm.containerSectionChecksum ||
          existing.filesChecksum !== algorithm.filesChecksum
        ) {
          service.compute.publisherTrustedAlgorithms[index] = algorithm
        }
      }
    }
  }
}
