import assert from 'assert'
import {
  AssetBuilder,
  FileTypes,
  Nautilus,
  ServiceBuilder,
  ServiceTypes,
  LogLevel
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
import { Aquarius } from '@oceanprotocol/lib'

const nodeUri = 'https://matic-mumbai.chainstacklabs.com'

describe('Nautilus compute flow integration test', () => {
  let computeDatasetDid =
    'did:op:5bef6f0f8fa196c7737d52872bb59fced444e35c42a30fd792cfcde9047b71d8'
  let computeAlgorithmDid =
    'did:op:41e0a72f659611bd645c67cbf71999a7cc61bf381a85a8c48def3b792b1e6255'

  before(() => {
    Nautilus.setLogLevel(LogLevel.Verbose)
  })

  it('publishes a compute algorithm asset', async () => {
    // PRIVATE_KEY_TESTS_1
    const web3 = getWeb3(1, nodeUri)
    const nautilus = await Nautilus.create(web3, await getTestConfig(web3))

    // serviceEndpoint to use for the test asset
    const { providerUri } = nautilus.getOceanConfig()

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
      .setOwner(web3.defaultAccount)
      .setType('algorithm')
      .setPricing(await getPricing(web3, 'free'))
      .setNftData(nftParams)
      .addService(service)
      .setAlgorithm(algorithmMetadata.algorithm)
      .build()

    // publish
    const result = await nautilus.publish(asset)

    assert(result)

    computeAlgorithmDid = result.DID
  }).timeout(30000)

  it('publishes a compute dataset asset', async () => {
    // PRIVATE_KEY_TESTS_2
    const web3 = getWeb3(2, nodeUri)
    const nautilus = await Nautilus.create(web3, await getTestConfig(web3))

    // serviceEndpoint to use for the test asset
    const { providerUri } = nautilus.getOceanConfig()

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
      .setOwner(web3.defaultAccount)
      .setType('dataset')
      .setPricing(await getPricing(web3, 'free'))
      .setNftData(nftParams)
      .addService(service)
      .build()

    // publish
    const result = await nautilus.publish(asset)

    assert(result)

    computeDatasetDid = result.DID
  }).timeout(30000)

  it('starts a compute job', async () => {
    // PRIVATE_KEY_TESTS_2 (dataset publisher)
    const web3 = getWeb3(2, nodeUri)
    const nautilus = await Nautilus.create(web3, await getTestConfig(web3))

    // wait until DDOs are found in metadata cache
    const aquarius = new Aquarius(nautilus.getOceanConfig().metadataCacheUri)
    await aquarius.waitForAqua(computeAlgorithmDid)
    await aquarius.waitForAqua(computeDatasetDid)

    const computeJob = await nautilus.compute({
      dataset: {
        did: computeDatasetDid
      },
      algorithm: {
        did: computeAlgorithmDid
      }
    })

    assert(computeJob)
  }).timeout(90000)
})
