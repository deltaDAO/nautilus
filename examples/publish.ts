import {
  AssetBuilder,
  ConsumerParameterBuilder,
  CredentialListTypes,
  type FileTypes,
  formatValidationErrors,
  getServices,
  type Nautilus,
  type PricingConfigWithoutOwner,
  ServiceBuilder,
  ServiceTypes,
  type UrlFileObject,
  validate
} from '@deltadao/nautilus'
import {
  EXAMPLE_ALGORITHM_URL,
  EXAMPLE_DATASET_URL,
  NODE_CONTAINER
} from './assets'
import type { NetworkConfig } from './config'

/**
 * Publishing examples.
 *
 * Three things changed from nautilus v1, and they show up in every function here:
 *
 *   1. **`setProvidedBy` is required.** DDO v5's schema requires it; v4 had no such field.
 *      Publishing without it fails in `build()`.
 *   2. **File objects were renamed.** `UrlFile` is now `UrlFileObject`. Two v1 types are
 *      gone entirely — `graphql` and `smartcontract` — and `s3`, `ftp` and
 *      `nodePersistentStorage` are new.
 *   3. **The service endpoint is the ocean-node**, which also serves metadata and the
 *      indexer. v1 pointed it at a standalone Provider.
 */

const EXAMPLE_DATASET: UrlFileObject = {
  type: 'url',
  // Any reachable URL or API. See https://docs.oceanprotocol.com/developers/storage
  url: EXAMPLE_DATASET_URL(),
  method: 'GET'
  // headers: { Authorization: 'Basic XXX' } // optional, e.g. for basic access control
}

const EXAMPLE_ALGORITHM: UrlFileObject = {
  type: 'url',
  url: EXAMPLE_ALGORITHM_URL(),
  method: 'GET'
}

const DESCRIPTION =
  '# Nautilus-Example Description \n\nThis asset has been published using the [nautilus examples](https://github.com/deltaDAO/nautilus/tree/main/examples).'

/** Publishes, waits for the indexer, and prints what came back. */
async function publish(
  nautilus: Nautilus,
  asset: Parameters<Nautilus['publish']>[0]
) {
  const result = await nautilus.publish(asset, { waitForIndexer: true })

  console.log('\nPublished')
  console.log(`  DID:      ${result.ddo.id}`) // did:ope: — v4 used did:op:
  console.log(`  NFT:      ${result.nftAddress}`)
  console.log(`  issuer:   ${result.credential?.issuer}`)
  console.log(`  indexed:  ${result.indexed}`)

  for (const service of result.services)
    console.log(
      `  service:  ${service.service.name} -> ${service.datatokenAddress}`
    )

  return result
}

/** A dataset anyone (or a listed address) can download. */
export async function publishAccessDataset(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing an access dataset...')

  const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Data Access Service')
    .setDescription('Downloads the example dataset as JSON')
    .setTimeout(600) // an order stays valid for 10 minutes
    .addFile(EXAMPLE_DATASET)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Data Access Token', 'DAT') // shows up in the explorer
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Access Dataset')
    .setDescription(DESCRIPTION)
    .setAuthor('Company Name')
    .setProvidedBy('Company Name') // required by DDO v5
    .setLicense('MIT')
    .addTags(['nautilus-example'])
    .setNftTokenName('Nautilus Example NFT')
    .setNftTokenSymbol('NAUT-EX')
    .addService(service)
    .setOwner(owner)
    // Optional: restrict access to the owner only.
    .addCredentialAddresses(CredentialListTypes.ALLOW, [owner])
    .build()

  return publish(nautilus, asset)
}

/** A dataset algorithms can run against, without the algorithm seeing the raw data. */
export async function publishComputeDataset(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing a compute dataset...')

  const consumerParameter = new ConsumerParameterBuilder()
    .setType('number')
    .setName('myNumberParam')
    .setLabel('My Param Label')
    .setDescription('A description of my param for the enduser.')
    // v5 keeps the type: v4 required a string here, so `5` became `"5"`.
    .setDefault(5)
    .setRequired(false)
    .build()

  const service = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Compute Service')
    .setTimeout(3600)
    .addFile(EXAMPLE_DATASET)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Compute Access Token', 'CAT')
    .addConsumerParameter(consumerParameter)
    // Without network access an algorithm cannot send your data anywhere. This is what
    // makes the isolation meaningful.
    .allowAlgorithmNetworkAccess(false)
    .allowRawAlgorithms(false)
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Compute Dataset')
    .setDescription(DESCRIPTION)
    .setAuthor('Company Name')
    .setProvidedBy('Company Name')
    .setLicense('MIT')
    .addService(service)
    .setOwner(owner)
    .build()

  return publish(nautilus, asset)
}

/** An algorithm someone can download. */
export async function publishAccessAlgorithm(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing an access algorithm...')

  const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Algorithm Access Service')
    .setTimeout(3600)
    .addFile(EXAMPLE_ALGORITHM)
    .setPricing(
      pricingConfig.FIXED_EURAU ??
        pricingConfig.FIXED_OCEAN ??
        pricingConfig.FREE
    )
    .setDatatokenNameAndSymbol('Algorithm Access Token', 'AAT')
    .build()

  const asset = new AssetBuilder()
    .setType('algorithm')
    .setName('Nautilus-Example: Access Algorithm')
    .setDescription(DESCRIPTION)
    .setAuthor('Your Company Name')
    .setProvidedBy('Your Company Name')
    .setLicense('MIT')
    .setAlgorithm(NODE_CONTAINER)
    .addService(service)
    .setOwner(owner)
    .addCredentialAddresses(CredentialListTypes.ALLOW, [owner])
    .build()

  return publish(nautilus, asset)
}

/** An algorithm that can run inside a compute job. */
export async function publishComputeAlgorithm(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing a compute algorithm...')

  const service = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Algorithm Compute Service')
    .setTimeout(86400)
    .addFile(EXAMPLE_ALGORITHM)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Algorithm Compute Token', 'ACT')
    .build()

  const asset = new AssetBuilder()
    .setType('algorithm')
    .setName('Nautilus-Example: Compute Algorithm')
    .setDescription(DESCRIPTION)
    .setAuthor('Your Company Name')
    .setProvidedBy('Your Company Name')
    .setLicense('MIT')
    .setAlgorithm(NODE_CONTAINER)
    .addService(service)
    .setOwner(owner)
    .build()

  return publish(nautilus, asset)
}

/**
 * A SaaS offering: the asset sells access to a hosted app rather than to a file.
 *
 * The dummy file still has to be reachable, because the node validates it. The redirect
 * lives in `additionalInformation`.
 */
export async function publishSaaSOffer(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing a SaaS offer...')

  const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('SaaS Access Service')
    // With paymentMode 'subscription' this timeout is the subscription period.
    .setTimeout(3600)
    .addFile(EXAMPLE_DATASET) // dummy file, must be reachable
    .setPricing(
      pricingConfig.FIXED_EURAU ??
        pricingConfig.FIXED_OCEAN ??
        pricingConfig.FREE
    )
    .setDatatokenNameAndSymbol('SaaS Access Token', 'SaaS-AT')
    .build()

  const asset = new AssetBuilder()
    .setType('dataset') // SaaS offerings use 'dataset'
    .setName('Nautilus-Example: SaaS')
    .setDescription(DESCRIPTION)
    .setAuthor('Company Name')
    .setProvidedBy('Company Name')
    .setLicense('MIT')
    // DDO v5 narrowed additionalInformation to primitives — string, number or boolean.
    // In v1 this was a nested object; it now has to be serialised.
    .addAdditionalInformation({
      saas: JSON.stringify({
        redirectUrl: 'https://your-saas-app.com/login',
        paymentMode: 'subscription' // or 'payperuse'
      })
    })
    .addService(service)
    .setOwner(owner)
    .addCredentialAddresses(CredentialListTypes.ALLOW, [owner])
    .build()

  return publish(nautilus, asset)
}

/**
 * One asset, two services: an open preview and a paid full download.
 *
 * The first service is created in the same transaction as the NFT; each further one gets its
 * own datatoken on that NFT. In v1 this cost three transactions per service.
 */
export async function publishMultiServiceDataset(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing a dataset with two services...')

  const preview = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Free Preview')
    .setDescription('A free sample of the dataset')
    .setTimeout(600)
    .addFile(EXAMPLE_DATASET)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Preview Token', 'PREV')
    .build()

  const full = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Compute Access')
    .setDescription('Run algorithms against the full dataset')
    .setTimeout(86400)
    .addFile(EXAMPLE_DATASET)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Compute Token', 'COMP')
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Preview and Compute')
    .setDescription(DESCRIPTION)
    .setAuthor('Company Name')
    .setProvidedBy('Company Name')
    .setLicense('MIT')
    .addService(preview)
    .addService(full)
    .setOwner(owner)
    .build()

  const result = await publish(nautilus, asset)

  console.log('\nServices on the published asset:')
  for (const service of getServices(result.ddo))
    console.log(`  ${service.type.padEnd(8)} ${service.name} (${service.id})`)

  return result
}

/**
 * Validating a DDO before publishing it.
 *
 * New in v2. The *validation* is entirely local — ddo-js runs SHACL in process, no network —
 * so a malformed asset is caught before any transaction and costs no gas. `publish()` does
 * this for you; this example exists to show you can run it yourself and see the field errors.
 *
 * Note it is not a fully offline check: **building** the DDO asks the node to encrypt each
 * service's file object, so a reachable ocean-node is still required. Run `checkNode()` first
 * if this fails with "does not answer as an ocean-node".
 */
export async function validateBeforePublishing(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Access Service')
    .setTimeout(600)
    .addFile(EXAMPLE_DATASET)
    .setPricing(pricingConfig.FREE)
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Validation')
    .setProvidedBy('Company Name')
    .addService(service)
    .setOwner(owner)
    .build()

  /**
   * Nothing is on chain yet, so both addresses have to be supplied: the DID
   * derives from the NFT address, and a service cannot be built without a
   * datatoken. Any well-formed addresses will do for a dry run — none of this
   * is published, and it costs nothing.
   */
  const ddo = await asset.ddo.getDDO(nautilus.getNodeClient(), {
    create: true,
    chainId: networkConfig.chainId,
    nftAddress: '0xBB1081DbF3227bbB233Db68f7117114baBb43656',
    datatokenAddress: '0x7905cC9C2c0DE0F5b0F3a1F1a1E8C3f24f61b8f0'
  })

  const { valid, errors } = await validate(ddo)

  if (valid) console.log('The DDO conforms to the DDO v5 schema.')
  else console.log('The DDO is invalid:', formatValidationErrors(errors))

  return { valid, errors }
}
