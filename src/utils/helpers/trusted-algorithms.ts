import {
  Asset,
  FileInfo,
  ProviderInstance,
  PublisherTrustedAlgorithm,
  getHash
} from '@oceanprotocol/lib'
import { Nautilus } from '../../Nautilus'
import { getAsset } from '../aquarius'

// TODO replace hardcoded service index 0 with service id once supported by the stack
export async function getPublisherTrustedAlgorithms(
  dids: string[],
  nautilus: Nautilus
) {
  const trustedAlgorithms: PublisherTrustedAlgorithm[] = []
  const config = await nautilus.getOceanConfig()

  const assetPromises = dids.map((did) =>
    getAsset(config.metadataCacheUri, did)
  )
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

    const filesChecksum = await getFileDidInfo(
      asset?.id,
      asset?.services?.[0]?.id,
      asset?.services?.[0]?.serviceEndpoint
    )
    if (!filesChecksum?.[0]?.checksum)
      throw new Error(`Unable to get fileChecksum for asset ${asset.id}`)

    const containerChecksum =
      asset.metadata.algorithm.container.entrypoint +
      asset.metadata.algorithm.container.checksum
    const trustedAlgorithm = {
      did: asset.id,
      containerSectionChecksum: getHash(containerChecksum),
      filesChecksum: filesChecksum?.[0]?.checksum
    }
    trustedAlgorithms.push(trustedAlgorithm)
  }
  return trustedAlgorithms
}

async function getFileDidInfo(
  did: string,
  serviceId: string,
  providerUrl: string
): Promise<FileInfo[]> {
  try {
    const response = await ProviderInstance.checkDidFiles(
      did,
      serviceId,
      providerUrl,
      true
    )
    return response
  } catch (error) {
    throw new Error(`[Initialize check file did] Error:' ${error}`)
  }
}
