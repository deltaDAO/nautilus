import type { Signer } from 'ethers'
import type { PublishResponse } from '../../src/@types/Publish.js'
import {
  AssetBuilder,
  type FileTypes,
  Nautilus,
  type NautilusAsset,
  NodePersistentRemoteStore,
  ServiceBuilder,
  ServiceTypes
} from '../../src/index.js'
import {
  algorithmFile,
  algorithmMetadata,
  datasetFile,
  datasetMetadata
} from '../fixtures/AssetConfig.js'
import { getNodeUri, getTestConfig } from '../fixtures/Config.js'
import { getSigner, hasIntegrationEnv } from '../fixtures/Ethers.js'

/**
 * The integration suite talks to a live ocean-node on Pontus-X devnet and spends gas, so it
 * skips itself unless `PRIVATE_KEY_TESTS_1`, `PRIVATE_KEY_TESTS_2` and `NODE_URL` are all
 * set. Copy `example.env` to `.env` to run it.
 */
export const integrationEnabled = hasIntegrationEnv()

/**
 * A Nautilus instance wired with a remote store, ready to publish.
 *
 * The store is the node's own persistent storage, so the suite needs no external IPFS.
 * Building it takes a node client, hence the two-step construction.
 */
export async function createPublisher(signer?: Signer): Promise<Nautilus> {
  const account = signer || getSigner(1)
  const config = await getTestConfig(account)

  const bootstrap = await Nautilus.create(account, { config })

  return Nautilus.create(account, {
    config,
    remoteStore: new NodePersistentRemoteStore(bootstrap.getNodeClient())
  })
}

/** A second account, for tests that need a consumer distinct from the publisher. */
export async function createConsumer(): Promise<Nautilus> {
  return createPublisher(getSigner(2))
}

export function accessService(nodeUri = getNodeUri()) {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(nodeUri)
    .setName('Access Service')
    .setTimeout(86400)
    .addFile(datasetFile)
}

export function computeService(nodeUri = getNodeUri()) {
  return new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(nodeUri)
    .setName('Compute Service')
    .setTimeout(86400)
    .addFile(datasetFile)
}

export function algorithmService(nodeUri = getNodeUri()) {
  return new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(nodeUri)
    .setName('Algorithm Service')
    .setTimeout(86400)
    .addFile(algorithmFile)
}

/** A free-to-access dataset. */
export function freeDataset(): NautilusAsset {
  return new AssetBuilder()
    .setType(datasetMetadata.type as string)
    .setName(datasetMetadata.name as string)
    .setDescription(datasetMetadata.description as string)
    .setAuthor(datasetMetadata.author as string)
    .setProvidedBy(datasetMetadata.providedBy as string)
    .setLicense(datasetMetadata.license as string)
    .setNftTokenName('Nautilus Test NFT')
    .setNftTokenSymbol('NAUT-TEST')
    .addService(accessService().setPricing({ type: 'free' }).build())
    .build()
}

/** A free-to-access algorithm, for compute tests. */
export function freeAlgorithm(): NautilusAsset {
  return new AssetBuilder()
    .setType('algorithm')
    .setName(algorithmMetadata.name as string)
    .setDescription(algorithmMetadata.description as string)
    .setAuthor(algorithmMetadata.author as string)
    .setProvidedBy(algorithmMetadata.providedBy as string)
    .setLicense(algorithmMetadata.license as string)
    .setAlgorithm(algorithmMetadata.algorithm as never)
    .setNftTokenName('Nautilus Test Algorithm NFT')
    .setNftTokenSymbol('NAUT-ALGO')
    .addService(algorithmService().setPricing({ type: 'free' }).build())
    .build()
}

/** Publishes and waits for the indexer, so the result is immediately resolvable. */
export async function publishAndIndex(
  nautilus: Nautilus,
  asset: NautilusAsset
): Promise<PublishResponse> {
  return nautilus.publish(asset, { waitForIndexer: true })
}
