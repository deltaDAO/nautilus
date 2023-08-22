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
import { getSigner, MUMBAI_NODE_URI } from '../fixtures/Web3'
import { Signer } from 'ethers'

describe('Nautilus compute flow integration test', async () => {
  // PRIVATE_KEY_TESTS_1 (algorithm publisher)
  let algoPublisherSigner: Signer
  let algoPublisherAddress: string

  // PRIVATE_KEY_TESTS_2 (dataset publisher)
  let datasetPublisherSigner: Signer
  let datasetPublisherAddress: string

  let nautilusDatasetPublisher: Nautilus
  let nautilusAlgoPublisher: Nautilus

  let computeDatasetDid: string
  let computeAlgorithmDid: string
  let computeJobId: string

  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)

    // PRIVATE_KEY_TESTS_1 (algorithm publisher)
    algoPublisherSigner = getSigner(1, MUMBAI_NODE_URI)
    algoPublisherAddress = await algoPublisherSigner.getAddress()

    nautilusAlgoPublisher = await Nautilus.create(
      algoPublisherSigner,
      await getTestConfig(algoPublisherSigner)
    )

    // PRIVATE_KEY_TESTS_2 (dataset publisher)
    datasetPublisherSigner = getSigner(1, MUMBAI_NODE_URI)
    datasetPublisherAddress = await datasetPublisherSigner.getAddress()

    nautilusDatasetPublisher = await Nautilus.create(
      datasetPublisherSigner,
      await getTestConfig(datasetPublisherSigner)
    )
  })

  it('publishes a compute algorithm asset', async () => {
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
      .setPricing(await getPricing(algoPublisherSigner, 'free'))
      .build()

    // configure the asset
    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A compute algorithm publishing test')
      .setLicense('MIT')
      .setName('Test Publish Compute Algorithm')
      .setOwner(algoPublisherAddress)
      .setType('algorithm')
      .setNftData(nftParams)
      .addService(service)
      .setAlgorithm(algorithmMetadata.algorithm)
      .build()

    // publish
    const result = await nautilusAlgoPublisher.publish(asset)

    assert(result)

    computeAlgorithmDid = result.ddo.id
  }).timeout(30000)

  it('publishes a compute dataset asset', async () => {
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
      .setPricing(await getPricing(datasetPublisherSigner, 'free'))
      .build()

    // configure the asset
    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A compute dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Compute Dataset')
      .setOwner(datasetPublisherAddress)
      .setType('dataset')
      .setNftData(nftParams)
      .addService(service)
      .build()

    // publish
    const result = await nautilusDatasetPublisher.publish(asset)

    assert(result)

    computeDatasetDid = result.ddo.id
  }).timeout(30000)

  it('starts a compute job', async () => {
    // wait until DDOs are found in metadata cache
    const aquarius = new Aquarius(
      nautilusDatasetPublisher.getOceanConfig().metadataCacheUri
    )
    await aquarius.waitForAqua(computeAlgorithmDid)
    await aquarius.waitForAqua(computeDatasetDid)

    assert(false, 'Re-activate test')

    // const startedJob = await nautilusDatasetPublisher.compute({
    //   dataset: {
    //     did: computeDatasetDid
    //   },
    //   algorithm: {
    //     did: computeAlgorithmDid
    //   }
    // })

    // const computeJob = Array.isArray(startedJob) ? startedJob[0] : startedJob

    // assert(computeJob)

    // computeJobId = computeJob.jobId
  }).timeout(90000)

  it('should get compute status', async () => {
    const status = await getStatusHelper(nautilusDatasetPublisher, computeJobId)
    assert(status)
  })

  it('should get download url for compute result', async () => {
    await waitUntilJobFinishes(nautilusDatasetPublisher, computeJobId)

    const { providerUri } = nautilusDatasetPublisher.getOceanConfig()

    // const resultUrl = await nautilusDatasetPublisher.getComputeResult({
    //   jobId: computeJobId,
    //   providerUri
    // })

    // assert(resultUrl)

    assert(false, 'Re-activate test')
  })
    // TODO: either increase timeout or introduce different solution to wait for ctd to finish
    // takes longer on live test networks (e.g. Mumbai ~4 minutes)
    .timeout(120000)
})

async function getStatusHelper(nautilus: Nautilus, jobId: string) {
  const { providerUri } = nautilus.getOceanConfig()

  // const status = await nautilus.getComputeStatus({
  //   jobId,
  //   providerUri
  // })

  // return status

  // TODO: Re-activate helper function
  return undefined
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
