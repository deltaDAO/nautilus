import {
  AssetBuilder,
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
 */

/** Prints what came back, and waits for the indexer so a re-read sees the change. */
async function applyEdit(
  nautilus: Nautilus,
  asset: Parameters<Nautilus['edit']>[0]
) {
  const result = await nautilus.edit(asset)

  console.log(`Edited ${result.ddo.id}`)
  console.log(`  tx: ${result.setMetadataTxReceipt.hash}`)

  // Passing the transaction hash matters: without it, waitForIndexer is satisfied by the
  // asset merely existing, which it already did.
  const indexed = await nautilus.waitForIndexer(
    result.ddo.id as string,
    result.setMetadataTxReceipt.hash
  )

  console.log(`  indexed: ${Boolean(indexed)}`)

  return indexed ?? (await nautilus.getAsset(result.ddo.id as string))
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

  /**
   * Poll the state rather than `waitForIndexer(did, receipt.hash)`.
   *
   * That overload waits for `indexedMetadata.event.txid` to equal the hash, but
   * the indexer only writes that field for MetadataCreated/Updated. A
   * MetadataState change never touches it, so passing the hash here polls for
   * 100 x 30s and then gives up — it looks exactly like a hang.
   */
  for (let attempt = 0; attempt < 15; attempt++) {
    const after = await nautilus.waitForIndexer(did)
    const state = after && getLifecycleState(after)

    if (state === LifecycleStates.REVOKED_BY_PUBLISHER) {
      console.log(`  state: ${state}`)
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  console.log('  the indexer has not picked up the revocation yet')
}

/** Unlists an asset from markets while keeping it accessible by DID. */
export async function unlistAsset(nautilus: Nautilus, did: string) {
  const asset = await nautilus.getAsset(did)

  const receipt = await nautilus.setAssetLifecycleState(
    asset,
    LifecycleStates.ASSET_UNLISTED
  )

  console.log(receipt ? `Unlisted ${did}` : 'Asset is already unlisted.')
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
