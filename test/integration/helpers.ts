import type { Signer } from 'ethers'
import type { PublishResponse } from '../../src/@types/Publish.js'
import {
  AssetBuilder,
  type FileTypes,
  IpfsRemoteStore,
  Nautilus,
  type NautilusAsset,
  type RemoteStore,
  S3RemoteStore,
  ServiceBuilder,
  ServiceTypes
} from '../../src/index.js'
import type { WaitForIndexerOptions } from '../../src/node/OceanNodeClient.js'
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
 * set. Copy `example.env` to `.env` to run it. Publishing also needs a DDO store
 * (`IPFS_UPLOAD_URL`, or `DDO_STORE=s3` with the S3 variables; see
 * `createTestRemoteStore`); without one the publishing tests fail with that message.
 */
export const integrationEnabled = hasIntegrationEnv()

/**
 * The store the suite publishes DDOs to, chosen by `DDO_STORE` (`ipfs`, the default, or
 * `s3`). ocean-node 4.2 cannot read a DDO from its own bucket storage, so it is one of
 * these. Both run `check()` before anything is minted.
 *
 * - `ipfs`: `IPFS_UPLOAD_URL` and an optional `IPFS_JWT` (sent as a Bearer token). Any
 *   endpoint that takes a multipart `file` works: a local Kubo `/api/v0/add`, or Pinata's
 *   `pinFileToIPFS`. The node must fetch the CID through its own IPFS gateway. Before each
 *   metadata transaction the envelope is read back through `IPFS_GATEWAY_URL`, or, for
 *   Kubo without it, through the same node's `/api/v0/cat`. Pinata needs
 *   `IPFS_GATEWAY_URL`: without it the store's `check()` fails before anything is minted.
 * - `s3`: `S3_ENDPOINT`, `S3_BUCKET`, the `S3_WRITE_*` and `S3_READ_*` key pairs, and
 *   optionally `S3_NODE_ENDPOINT`, `S3_REGION`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE`. An IP or
 *   `localhost` endpoint needs `S3_FORCE_PATH_STYLE=true`. The envelope is read back with
 *   the read key before each metadata transaction.
 */
export function createTestRemoteStore(): RemoteStore {
  const kind = (process.env.DDO_STORE || 'ipfs').toLowerCase()

  if (kind === 's3') return createS3Store()
  if (kind !== 'ipfs')
    throw new Error(`DDO_STORE must be 'ipfs' or 's3', got '${kind}'.`)

  const uploadUrl = process.env.IPFS_UPLOAD_URL

  if (!uploadUrl)
    throw new Error(
      'IPFS_UPLOAD_URL is not set. The integration suite stores DDOs on IPFS, e.g. http://127.0.0.1:5001/api/v0/add or https://api.pinata.cloud/pinning/pinFileToIPFS (or set DDO_STORE=s3).'
    )

  const jwt = process.env.IPFS_JWT
  const gatewayUrl = process.env.IPFS_GATEWAY_URL

  return new IpfsRemoteStore({
    uploadUrl,
    ...(jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {}),
    ...(gatewayUrl ? { gatewayUrl } : {}),
    probe: 'upload'
  })
}

function createS3Store(): S3RemoteStore {
  const env = (name: string) => {
    const value = process.env[name]
    if (!value) throw new Error(`DDO_STORE=s3 needs ${name}.`)
    return value
  }

  return new S3RemoteStore({
    endpoint: env('S3_ENDPOINT'),
    nodeEndpoint: process.env.S3_NODE_ENDPOINT || undefined,
    region: process.env.S3_REGION || undefined,
    bucket: env('S3_BUCKET'),
    prefix: process.env.S3_PREFIX ?? 'ddo/',
    forcePathStyle: /^(1|true|yes)$/i.test(
      process.env.S3_FORCE_PATH_STYLE || ''
    ),
    writeCredentials: {
      accessKeyId: env('S3_WRITE_ACCESS_KEY_ID'),
      secretAccessKey: env('S3_WRITE_SECRET_ACCESS_KEY')
    },
    readCredentials: {
      accessKeyId: env('S3_READ_ACCESS_KEY_ID'),
      secretAccessKey: env('S3_READ_SECRET_ACCESS_KEY')
    }
  })
}

/** A Nautilus instance wired with the test remote store, ready to publish. */
export async function createPublisher(signer?: Signer): Promise<Nautilus> {
  const account = signer || getSigner(1)
  const config = await getTestConfig(account)

  return Nautilus.create(account, {
    config,
    remoteStore: createTestRemoteStore()
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

/**
 * How often the suite polls the node while it waits for indexing, in ms:
 * `INTEGRATION_INDEXER_INTERVAL_MS`, default 1000. The SDK's own default (7 s) keeps a wait
 * under ocean-node's default `MAX_REQ_PER_MINUTE` of 30; a local node that indexes every
 * second and allows more requests answers much sooner than that, and about 40 tests wait
 * for indexing. Set it to 7000 against a node with the default rate limit.
 */
export const indexerIntervalMs = readIndexerInterval()

/** How long the suite waits for indexing before failing: generous, for a slow node. */
export const indexerTimeoutMs = 600_000

function readIndexerInterval(): number {
  const raw = process.env.INTEGRATION_INDEXER_INTERVAL_MS?.trim()
  if (!raw) return 1000

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0)
    throw new Error(
      `INTEGRATION_INDEXER_INTERVAL_MS must be a number of milliseconds (0 or more), got '${raw}'.`
    )

  return value
}

/** The `waitForIndexer` options every indexing wait in the suite uses. */
export function indexerWait(
  overrides: Partial<WaitForIndexerOptions> = {}
): WaitForIndexerOptions {
  return {
    intervalMs: indexerIntervalMs,
    timeoutMs: indexerTimeoutMs,
    ...overrides
  }
}

/**
 * The node's success record for an asset, after checking it filed no failure for `txId`.
 *
 * ocean-node 4.2 files a success under the `did:ope:` DID (no `nft`, blank `txId`) and a
 * failure under `did:op:` with the real `txId`, which stays after a later success. So success is
 * read by `{ did }` and failure by `{ txId }`. The node writes the DDO first and the state
 * record right after, so on a fast local chain the asset can resolve a moment before its
 * record exists; hence the polling, every `indexerIntervalMs` for up to `timeoutMs`.
 */
export async function settledIndexingState(
  nautilus: Nautilus,
  asset: { did: string; txId: string },
  timeoutMs = 15_000,
  intervalMs = indexerIntervalMs
) {
  const node = nautilus.getNodeClient()
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const failure = await node.getIndexingState({ txId: asset.txId })

    if (failure?.txId?.trim().toLowerCase() === asset.txId.toLowerCase())
      throw new Error(
        `The node recorded a failure for ${asset.txId}: ${failure.error}`
      )

    const state = await node.getIndexingState({ did: asset.did })
    if (state) return state

    if (Date.now() >= deadline) break

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`The node recorded no indexing state for ${asset.did}.`)
}

/** Publishes and waits for the indexer, so the result is immediately resolvable. */
export async function publishAndIndex(
  nautilus: Nautilus,
  asset: NautilusAsset
): Promise<PublishResponse> {
  return nautilus.publish(asset, { waitForIndexer: indexerWait() })
}
