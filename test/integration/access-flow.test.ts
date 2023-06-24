import assert from 'assert'
import { AssetBuilder, Nautilus, LogLevel } from '../../src'
import { ConsumerParameterBuilder } from '../../src/Nautilus/Asset/ConsumerParameters'
import {
  FileTypes,
  ServiceBuilder,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service'
import {
  algorithmMetadata,
  algorithmService,
  getPricing
} from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { getWeb3 } from '../fixtures/Web3'
import { Aquarius } from '@oceanprotocol/lib'

const nodeUri = 'https://matic-mumbai.chainstacklabs.com'

describe('Nautilus access flow integration test', () => {
  let downloadAssetDid: string

  before(() => {
    Nautilus.setLogLevel(LogLevel.Verbose)
  })

  // 1. Publish Download Asset -> store did
  it('publishes a download asset', async () => {
    // Setup Nautilus instance for publisher (PRIVATE_KEY_TESTS_1)
    const web3 = getWeb3(1, nodeUri)
    const nautilus = await Nautilus.create(web3, await getTestConfig(web3))

    const { providerUri } = nautilus.getOceanConfig()

    const serviceBuilder = new ServiceBuilder(
      ServiceTypes.ACCESS,
      FileTypes.URL
    )
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(algorithmService.timeout)
      .addFile(algorithmService.files[0])
      .setPricing(await getPricing(web3, 'free'))
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A publishing test with custom userdata')
      .setLicense('MIT')
      .setName('Test Publish Algorithm')
      .setOwner(web3.defaultAccount)
      .setType('algorithm')
      .setNftData(nftParams)
      .addService(service)
      .setAlgorithm(algorithmMetadata.algorithm)
      .build()

    const result = await nautilus.publish(asset)

    assert(result)

    downloadAssetDid = result.ddo.id
  })

  // 2. Access the Download Asset (1.)
  it('accesses a download asset', async () => {
    // Setup Nautilus instance for consumer (PRIVATE_KEY_TESTS_2)
    const web3 = getWeb3(2, nodeUri)
    const nautilus = await Nautilus.create(web3, await getTestConfig(web3))

    // wait until ddo is found in metadata cache
    const aquarius = new Aquarius(nautilus.getOceanConfig().metadataCacheUri)
    await aquarius.waitForAqua(downloadAssetDid)

    const accessUrl = await nautilus.access({
      assetDid: downloadAssetDid
    })

    assert(accessUrl)
  }).timeout(30000)
})
