import { Aquarius, ComputeJob, LoggerInstance } from '@oceanprotocol/lib'
import assert from 'assert'
import {
  AssetBuilder,
  FileTypes,
  LogLevel,
  Nautilus,
  ServiceBuilder,
  ServiceTypes
} from '../../src'
import {
  algorithmMetadata,
  algorithmService,
  datasetService,
  getPricing
} from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { getWeb3 } from '../fixtures/Web3'

const nodeUri = 'https://matic-mumbai.chainstacklabs.com'

describe.only('Nautilus compute flow integration test', async () => {
  // PRIVATE_KEY_TESTS_1 (algorithm publisher)
  const web3AlgoPublisher = getWeb3(1, nodeUri)

  // PRIVATE_KEY_TESTS_2 (dataset publisher)
  const web3DatasetPublisher = getWeb3(1, nodeUri)

  let nautilusDatasetPublisher: Nautilus
  let nautilusAlgoPublisher: Nautilus

  let computeDatasetDid: string =
    'did:op:e50994e0cf70d187c086044d9dff3e4eea669e3e6a63b37349f0f0b57c40fb1b'
  let computeAlgorithmDid: string =
    'did:op:5e889af9bb5dccc6ec4c3380e3f4c43c1af5f7973f170d69fddf8b2e8c473215'
  let computeJobId: string = '687e6116ef1543c1926bb23d5543d758'

  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)

    nautilusAlgoPublisher = await Nautilus.create(
      web3AlgoPublisher,
      await getTestConfig(web3AlgoPublisher)
    )

    nautilusDatasetPublisher = await Nautilus.create(
      web3DatasetPublisher,
      await getTestConfig(web3DatasetPublisher)
    )
  })

  it.skip('publishes a compute algorithm asset', async () => {
    // serviceEndpoint to use for the test asset
    const { providerUri } = nautilusAlgoPublisher.getOceanConfig()

    // Create the "compute" service
    const serviceBuilder = new ServiceBuilder(
      ServiceTypes.COMPUTE,
      FileTypes.URL
    )
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(algorithmService.timeout)
      .addFile(algorithmService.files[0])
      .build()

    // configure the asset
    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A compute algorithm publishing test')
      .setLicense('MIT')
      .setName('Test Publish Compute Algorithm')
      .setOwner(web3AlgoPublisher.defaultAccount)
      .setType('algorithm')
      .setPricing(await getPricing(web3AlgoPublisher, 'free'))
      .setNftData(nftParams)
      .addService(service)
      .setAlgorithm(algorithmMetadata.algorithm)
      .build()

    // publish
    const result = await nautilusAlgoPublisher.publish(asset)

    assert(result)

    computeAlgorithmDid = result.DID
  }).timeout(30000)

  it.skip('publishes a compute dataset asset', async () => {
    // serviceEndpoint to use for the test asset
    const { providerUri } = nautilusDatasetPublisher.getOceanConfig()

    // Create the "compute" service
    const serviceBuilder = new ServiceBuilder(
      ServiceTypes.COMPUTE,
      FileTypes.URL
    )
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .build()

    // configure the asset
    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A compute dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Compute Dataset')
      .setOwner(web3DatasetPublisher.defaultAccount)
      .setType('dataset')
      .setPricing(await getPricing(web3DatasetPublisher, 'free'))
      .setNftData(nftParams)
      .addService(service)
      .build()

    // publish
    const result = await nautilusDatasetPublisher.publish(asset)

    assert(result)

    computeDatasetDid = result.DID
  }).timeout(30000)

  it.skip('starts a compute job', async () => {
    // wait until DDOs are found in metadata cache
    const aquarius = new Aquarius(
      nautilusDatasetPublisher.getOceanConfig().metadataCacheUri
    )
    await aquarius.waitForAqua(computeAlgorithmDid)
    await aquarius.waitForAqua(computeDatasetDid)

    const startedJob = await nautilusDatasetPublisher.compute({
      dataset: {
        did: computeDatasetDid
      },
      algorithm: {
        did: computeAlgorithmDid
      }
    })

    const computeJob = Array.isArray(startedJob) ? startedJob[0] : startedJob

    assert(computeJob)

    computeJobId = computeJob.jobId
  }).timeout(90000)

  it('should get compute status', async () => {
    const status = await getStatusHelper(nautilusDatasetPublisher, computeJobId)
    assert(status)
  })

  it('should get download url for compute result', async () => {
    await waitUntilJobFinishes(nautilusDatasetPublisher, computeJobId)

    const { providerUri } = nautilusDatasetPublisher.getOceanConfig()

    const resultUrl = await nautilusDatasetPublisher.getComputeResult({
      jobId: computeJobId,
      providerUri
    })

    assert(resultUrl)
  }).timeout(120000)
})

async function getStatusHelper(nautilus: Nautilus, jobId: string) {
  const { providerUri } = nautilus.getOceanConfig()

  const status = await nautilus.getComputeStatus({
    jobId,
    providerUri
  })

  return status
}

async function waitUntilJobFinishes(
  nautilus: Nautilus,
  jobId: string
): Promise<ComputeJob> {
  LoggerInstance.log(`Waiting until compute job finishes...`)
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const status = await getStatusHelper(nautilus, jobId)
      LoggerInstance.log(
        `Waiting until compute job finishes... (Current status: ${status.status} - ${status.statusText})`
      )
      if (status?.status === 70) {
        clearInterval(interval)
        resolve(status)
      }
    }, 10000)
  })
}
