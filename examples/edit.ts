import {
  AssetBuilder,
  CredentialListTypes,
  type FileTypes,
  fromLanguageValue,
  getCredentials,
  getLifecycleState,
  getMetadata,
  getServiceByType,
  getServices,
  LifecycleStates,
  type Nautilus,
  ServiceBuilder,
  ServiceTypes
} from '@deltadao/nautilus'
import { EXAMPLE_DATASET_URL } from './assets'
import { explainIndexingFailure } from './indexing'
import { recordPublish } from './ledger'
import { indexerOptions } from './nautilus'
import { publishSession } from './publish'

/**
 * Editing examples.
 *
 * The pattern is always the same: resolve what is published, change it with a builder, and
 * republish. What changed from v1:
 *
 *   - **`getAsset` replaces `getAquariusAsset`**, and `ServiceBuilder` takes `{ asset,
 *     serviceId }` instead of `{ aquariusAsset, serviceId }`. Aquarius no longer exists as a
 *     separate service.
 *   - **DDO v5 nests everything under `credentialSubject`**, so these examples read through
 *     the exported helpers (`getMetadata`, `getServices`, ...) rather than indexing into the
 *     document. They go through a version-aware manager, so they survive a future DDO
 *     version moving fields.
 *   - **The merge is structural**: setting one field leaves the rest of the published
 *     document intact, so you never resupply metadata you are not changing.
 *
 * And what changed in 2.0.0-beta.1:
 *
 *   - **One metadata change per asset per block.** ocean-node indexes only the first
 *     metadata event of an asset in a block. A `Nautilus` instance runs its
 *     own writes to one asset one after the other, and each waits for its receipt, so they
 *     never share a block. A write from another instance or process can; `edit()` then
 *     throws a `MetadataConflictError` after the receipt (the result is on
 *     `error.published`), and writing again resolves it. `applyEdit()` also waits for the
 *     indexer, so a re-read right after sees the change.
 *   - **Each edit stores a new envelope.** The old version stays in the store, so the
 *     pointer that is on chain keeps working until the edit lands. Intermediate versions can
 *     be cleaned up with `store:remove` (the CIDs and object keys are in `PUBLISH_LOG`), but
 *     never the creation envelope (from the publish) or the current one: a node reindex
 *     replays the asset from its creation event and drops it without that envelope. An edit
 *     that fails before its transaction is sent removes the envelope it stored itself.
 *   - **DEPRECATED and REVOKED are final.** The indexer replaces the DDO with a stub, so
 *     `edit()` refuses an asset in either state before sending anything.
 *   - **`waitForIndexer` throws** on failure or timeout instead of returning `undefined`.
 */

/**
 * Sends the edit, prints what came back, and waits for the indexer so a re-read sees the
 * change. Returns the asset as the node indexed it.
 */
async function applyEdit(
  nautilus: Nautilus,
  asset: Parameters<Nautilus['edit']>[0]
) {
  const result = await nautilus.edit(asset)
  const did = result.ddo.id as string

  recordPublish('edit', result, publishSession)

  console.log(`Edited ${did}`)
  console.log(`  tx: ${result.setMetadataTxReceipt.hash}`)

  /**
   * Passing the transaction hash matters: without it, waitForIndexer is satisfied by the
   * asset merely existing, which it already did. With it, it also reads the node's
   * indexing state for that transaction, and throws an `IndexingError` with the node's
   * message as soon as the node records that it rejected the update.
   */
  try {
    const indexed = await nautilus.waitForIndexer(
      did,
      result.setMetadataTxReceipt.hash,
      indexerOptions()
    )

    console.log('  indexed: true')

    return indexed
  } catch (error) {
    explainIndexingFailure(error)
    throw error
  }
}

/** Renames an asset, leaving everything else as published. */
export async function editMetadata(
  nautilus: Nautilus,
  did: string,
  newName: string
) {
  const asset = await nautilus.getAsset(did)
  const before = getMetadata(asset)

  const edited = new AssetBuilder(asset).setName(newName).build()
  const after = getMetadata(await applyEdit(nautilus, edited))

  console.log(`  name:        ${before.name} -> ${after.name}`)
  // Untouched fields survive the merge.
  console.log(`  author:      ${after.author}`)
  console.log(`  providedBy:  ${after.providedBy}`)
  console.log(`  created:     ${after.created} (unchanged)`)
  console.log(`  updated:     ${after.updated} (bumped)`)
}

/**
 * Changes the description, which is language-tagged in DDO v5.
 *
 * You still pass a plain string; nautilus wraps it. `setContentLanguage` picks the tag.
 */
export async function editDescription(
  nautilus: Nautilus,
  did: string,
  description: string,
  language = 'en'
) {
  const asset = await nautilus.getAsset(did)

  const edited = new AssetBuilder(asset)
    .setContentLanguage(language)
    .setDescription(description)
    .build()

  const after = getMetadata(await applyEdit(nautilus, edited))

  console.log(`  description: ${fromLanguageValue(after.description)}`)
}

/**
 * Sets a new price on a fixed-rate service.
 *
 * Done outside the builder deliberately: a new pricing config would mint a new datatoken and
 * so change the service id. This just sets the rate on the existing exchange.
 */
export async function editServicePrice(
  nautilus: Nautilus,
  did: string,
  newPrice: string
) {
  const asset = await nautilus.getAsset(did)
  const serviceId = getServices(asset)[0].id

  const receipt = await nautilus.setServicePrice(asset, serviceId, newPrice)

  console.log(`Set price of service ${serviceId} to ${newPrice}`)
  console.log(`  tx: ${receipt.hash}`)
}

/** Turns an asset into a SaaS offering by adding the redirect metadata. */
export async function editToSaas(
  nautilus: Nautilus,
  did: string,
  redirectUrl: string,
  paymentMode: 'payperuse' | 'subscription'
) {
  const asset = await nautilus.getAsset(did)

  // DDO v5 narrowed additionalInformation to primitives, so the SaaS block is serialised.
  // In v1 it went in as a nested object.
  const edited = new AssetBuilder(asset)
    .addAdditionalInformation({
      saas: JSON.stringify({ redirectUrl, paymentMode })
    })
    .build()

  const after = getMetadata(await applyEdit(nautilus, edited))

  console.log('  saas:', after.additionalInformation?.saas)
}

/**
 * Updates which algorithms and publishers a compute service trusts.
 *
 * DDO v5 requires a `serviceId` on each trusted algorithm, so `serviceIds` is finally
 * meaningful — omit it and nautilus pins the algorithm's first compute service. nautilus
 * resolves the container and file checksums from the live DDOs at publish time, so a
 * publisher cannot swap the container out afterwards.
 */
export async function editTrustedAlgorithms(
  nautilus: Nautilus,
  did: string,
  trustedAlgorithms: { did: string; serviceIds?: string[] }[],
  trustedPublishers: string[]
) {
  const asset = await nautilus.getAsset(did)
  const computeService = getServiceByType(asset, 'compute')

  if (!computeService)
    throw new Error(`Asset ${did} has no compute service to configure.`)

  const serviceBuilder = new ServiceBuilder<
    ServiceTypes.COMPUTE,
    FileTypes.URL
  >({
    asset,
    serviceId: computeService.id
  })

  for (const publisher of trustedPublishers)
    serviceBuilder.addTrustedAlgorithmPublisher(publisher)

  if (trustedAlgorithms.length > 0)
    serviceBuilder.addTrustedAlgorithms(trustedAlgorithms)

  const edited = new AssetBuilder(asset)
    .addService(serviceBuilder.build())
    .build()
  const after = await applyEdit(nautilus, edited)

  const compute = getServiceByType(after, 'compute')?.compute

  console.log('  trusted algorithms:', compute?.publisherTrustedAlgorithms)
  console.log(
    '  trusted publishers:',
    compute?.publisherTrustedAlgorithmPublishers
  )
}

/** Updates an algorithm's container image tag and checksum. */
export async function editAlgoMetadata(
  nautilus: Nautilus,
  did: string,
  tag: string,
  checksum: string
) {
  const asset = await nautilus.getAsset(did)
  const algorithm = getMetadata(asset).algorithm

  if (!algorithm?.container)
    throw new Error(
      `Asset ${did} has no algorithm container metadata to update.`
    )

  const edited = new AssetBuilder(asset)
    .setAlgorithm({
      ...algorithm,
      container: { ...algorithm.container, tag, checksum }
    })
    .build()

  const after = getMetadata(await applyEdit(nautilus, edited))

  console.log('  container:', after.algorithm?.container)
}

/** Adds a compute service to an asset that only had a download service. */
export async function addComputeService(
  nautilus: Nautilus,
  did: string,
  oceanNodeUri: string
) {
  const asset = await nautilus.getAsset(did)

  const service = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(oceanNodeUri)
    .setName('Compute Access')
    .setTimeout(86400)
    .addFile({
      type: 'url',
      url: EXAMPLE_DATASET_URL(),
      method: 'GET'
    })
    // A genuinely new service needs its own datatoken, hence its own pricing.
    .setPricing({ type: 'free' })
    .setDatatokenNameAndSymbol('Compute Token', 'COMP')
    .build()

  const edited = new AssetBuilder(asset).addService(service).build()
  const after = await applyEdit(nautilus, edited)

  for (const entry of getServices(after))
    console.log(`  ${entry.type.padEnd(8)} ${entry.name} (${entry.id})`)
}

/** The service to edit: by id, or the first one when `serviceId` is omitted or `first`. */
function pickService(
  asset: Awaited<ReturnType<Nautilus['getAsset']>>,
  did: string,
  serviceId?: string
) {
  const services = getServices(asset)
  const service =
    !serviceId || serviceId === 'first'
      ? services[0]
      : services.find((candidate) => candidate.id === serviceId)

  if (!service)
    throw new Error(
      `Asset ${did} has no service ${serviceId}. It has: ${services.map((entry) => entry.id).join(', ') || 'none'}.`
    )

  return service
}

/** A `ServiceBuilder` loaded with a published service, ready to change. */
function loadService(
  asset: Awaited<ReturnType<Nautilus['getAsset']>>,
  serviceId: string
) {
  // Loading by `{ asset, serviceId }` keeps everything you do not touch: files (still
  // encrypted), endpoint, datatoken, pricing, credentials, compute settings. Pricing is
  // locked here; reprice with setServicePrice (edit:price).
  return new ServiceBuilder<ServiceTypes, FileTypes.URL>({ asset, serviceId })
}

/**
 * Changes a service's general fields — name, description and timeout — and nothing else.
 *
 * The rebuilt service keeps its id, because its files and endpoint are unchanged, so it
 * replaces the published one and existing orders stay valid.
 */
export async function editService(
  nautilus: Nautilus,
  did: string,
  serviceId: string | undefined,
  name: string,
  description?: string,
  timeoutSeconds?: string
) {
  const asset = await nautilus.getAsset(did)
  const before = pickService(asset, did, serviceId)
  const builder = loadService(asset, before.id).setName(name)

  if (description) builder.setDescription(description)

  if (timeoutSeconds !== undefined) {
    const timeout = Number(timeoutSeconds)

    if (!Number.isInteger(timeout) || timeout < 0)
      throw new Error(
        `timeout must be a whole number of seconds (0 = no expiry), not '${timeoutSeconds}'.`
      )

    builder.setTimeout(timeout)
  }

  const edited = new AssetBuilder(asset).addService(builder.build()).build()
  const after = pickService(await applyEdit(nautilus, edited), did, before.id)

  console.log(`  service:     ${after.id} (unchanged id)`)
  console.log(`  name:        ${before.name} -> ${after.name}`)
  console.log(
    `  description: ${fromLanguageValue(before.description) ?? '—'} -> ${fromLanguageValue(after.description) ?? '—'}`
  )
  console.log(`  timeout:     ${before.timeout} -> ${after.timeout}`)
}

/**
 * Replaces a service's files, and optionally its endpoint.
 *
 * The id of a service is the hash of its encrypted files, so this gives the service a **new
 * id**; nautilus drops the old entry. Consumers holding an order against the old id keep it,
 * but new orders go to the new one. The endpoint changes only together with the files: a
 * different node has to encrypt them, and nautilus cannot re-encrypt files it only has in
 * the old node's ciphertext.
 */
export async function editServiceFiles(
  nautilus: Nautilus,
  did: string,
  serviceId: string,
  url: string,
  serviceEndpoint?: string
) {
  const asset = await nautilus.getAsset(did)
  const before = pickService(asset, did, serviceId)
  const builder = loadService(asset, before.id).addFile({
    type: 'url',
    url,
    method: 'GET'
  })

  if (serviceEndpoint) builder.setServiceEndpoint(serviceEndpoint)

  const edited = new AssetBuilder(asset).addService(builder.build()).build()
  const services = getServices(await applyEdit(nautilus, edited))

  console.log(`  old service: ${before.id} (${before.serviceEndpoint})`)
  for (const entry of services)
    console.log(
      `  now:         ${entry.id} ${entry.name} (${entry.serviceEndpoint})`
    )
}

/**
 * Restricts one service to a list of addresses, independently of the asset-level list.
 *
 * Gating is per service as well as per asset in DDO v5, and the node checks both. This adds
 * to whatever allow list the service already has.
 */
export async function editServiceAllowlist(
  nautilus: Nautilus,
  did: string,
  serviceId: string,
  addresses: string[]
) {
  if (addresses.length === 0)
    throw new Error('Pass at least one address to allow.')

  const asset = await nautilus.getAsset(did)
  const before = pickService(asset, did, serviceId)
  const service = loadService(asset, before.id)
    .addCredentialAddresses(CredentialListTypes.ALLOW, addresses)
    .build()

  const edited = new AssetBuilder(asset).addService(service).build()
  const after = pickService(await applyEdit(nautilus, edited), did, before.id)

  console.log(`  service ${after.id} credentials:`)
  console.log(JSON.stringify(after.credentials, null, 2))
}

/** Removes a service from a published asset. */
export async function removeService(
  nautilus: Nautilus,
  did: string,
  serviceId: string
) {
  const asset = await nautilus.getAsset(did)

  const edited = new AssetBuilder(asset).removeService(serviceId).build()
  const after = await applyEdit(nautilus, edited)

  console.log(`  remaining services: ${getServices(after).length}`)
}

/**
 * Retires an asset.
 *
 * One transaction, no republish — the state lives on the NFT, not in the DDO. Returns without
 * sending anything if the asset is already in that state.
 *
 * **One-way.** ocean-node replaces a revoked asset's DDO with a stub, and nautilus refuses to
 * write metadata for it again: no edit, no `completePublish`.
 */
export async function revokeAsset(nautilus: Nautilus, did: string) {
  const asset = await nautilus.getAsset(did)

  const receipt = await nautilus.setAssetLifecycleState(
    asset,
    LifecycleStates.REVOKED_BY_PUBLISHER
  )

  if (!receipt) {
    console.log('Asset is already revoked; nothing to do.')
    return
  }

  console.log(`Revoked ${did}`)
  console.log(`  tx: ${receipt.hash}`)

  await waitForLifecycleState(
    nautilus,
    did,
    LifecycleStates.REVOKED_BY_PUBLISHER
  )
}

/**
 * Polls the asset until the node shows the new lifecycle state.
 *
 * Not `waitForIndexer(did, receipt.hash)`: that waits for the indexed transaction id to be
 * the hash, but the indexer only records it for MetadataCreated/Updated. A MetadataState
 * change never touches it, so the wait would only end with a timeout error. So this reads
 * `getAsset` + `getLifecycleState`, with the same INDEXER_TIMEOUT_MS / INDEXER_INTERVAL_MS
 * timing as the other waits.
 */
async function waitForLifecycleState(
  nautilus: Nautilus,
  did: string,
  expected: LifecycleStates
) {
  const { timeoutMs = 300_000, intervalMs = 7_000 } = indexerOptions()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const state = await nautilus
      .getAsset(did)
      .then(getLifecycleState)
      .catch(() => undefined)

    if (state === expected) {
      console.log(`  state: ${state}`)
      return
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  console.log(
    `  the indexer has not shown state ${expected} within ${Math.round(timeoutMs / 1000)}s; check later with asset:inspect`
  )
}

/** Unlists an asset from markets while keeping it accessible by DID. */
export async function unlistAsset(nautilus: Nautilus, did: string) {
  const asset = await nautilus.getAsset(did)

  const receipt = await nautilus.setAssetLifecycleState(
    asset,
    LifecycleStates.ASSET_UNLISTED
  )

  if (!receipt) {
    console.log('Asset is already unlisted.')
    return
  }

  // Reversible, unlike revoking: set the state back to ACTIVE to list it again.
  console.log(`Unlisted ${did}`)
  console.log(`  tx: ${receipt.hash}`)

  await waitForLifecycleState(nautilus, did, LifecycleStates.ASSET_UNLISTED)
}

/** Prints an asset's current metadata, services and credentials. */
export async function inspectAsset(nautilus: Nautilus, did: string) {
  const asset = await nautilus.getAsset(did)
  const metadata = getMetadata(asset)

  console.log(`\n${did}`)
  console.log(`  name:        ${metadata.name}`)
  console.log(`  type:        ${metadata.type}`)
  console.log(`  description: ${fromLanguageValue(metadata.description)}`)
  console.log(`  author:      ${metadata.author}`)
  console.log(`  providedBy:  ${metadata.providedBy}`)
  console.log(`  license:     ${metadata.license?.name}`)
  console.log(`  state:       ${getLifecycleState(asset)}`)
  console.log(`  issuer:      ${asset.issuer}`)

  console.log('  services:')
  for (const service of getServices(asset))
    console.log(
      `    ${service.type.padEnd(8)} ${service.name} (${service.id}) timeout=${service.timeout}`
    )

  console.log('  credentials:', JSON.stringify(getCredentials(asset), null, 2))
}
