import assert from 'assert'
import { AssetBuilder, Nautilus, LogLevel } from '../../src'
import { ConsumerParameterBuilder } from '../../src/Nautilus/Asset/ConsumerParameters'
import {
  FileTypes,
  ServiceBuilder,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service'
import { algorithmMetadata, algorithmService } from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { getWeb3 } from '../fixtures/Web3'
import { Aquarius } from '@oceanprotocol/lib'

const nodeUri = 'https://matic-mumbai.chainstacklabs.com'

describe.only('Nautilus access flow integration test', () => {
  let downloadAssetDid: string

  // 1. Publish Download Asset -> store did
  it('publishes a download asset', async () => {
    // Setup Nautilus instance for publisher (PRIVATE_KEY_TESTS_1)
    const web3 = getWeb3(1, nodeUri)
    Nautilus.setLogLevel(LogLevel.Verbose)
    const nautilus = await Nautilus.create(web3, await getTestConfig(web3))

    const { providerUri } = nautilus.getOceanConfig()

    const assetBuilder = new AssetBuilder()

    const customParamBuilder = new ConsumerParameterBuilder()
    const numberParameter = customParamBuilder
      .setType('number')
      .setName('numberParameter')
      .setLabel('Number Parameter')
      .setDescription('A cool description for a test number parameter')
      .setDefault('12')
      .setRequired(false)
      .build()

    customParamBuilder.reset()
    const selectParameter = customParamBuilder
      .setType('select')
      .setName('selectParameter')
      .setLabel('Test Select Parameter')
      .setDescription('A cool description for a test select parameter')
      .setDefault('myValue')
      .addOption({ myValue: 'My Label' })
      .addOption({ myOtherValue: 'My Other Label' })
      .setRequired(true)
      .build()

    customParamBuilder.reset()
    const textParameter = customParamBuilder
      .setType('text')
      .setName('textParameter')
      .setLabel('Text Parameter')
      .setDescription('A cool description for a test text parameter')
      .setDefault('default-text')
      .setRequired(true)
      .build()

    customParamBuilder.reset()
    const booleanParameter = customParamBuilder
      .setType('boolean')
      .setName('booleanParameter')
      .setLabel('Boolean Parameter')
      .setDescription('A cool description for a test boolean parameter')
      .setDefault('false')
      .setRequired(false)
      .build()

    const serviceBuilder = new ServiceBuilder(
      ServiceTypes.ACCESS,
      FileTypes.URL
    )

    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(algorithmService.timeout)
      .addFile(algorithmService.files[0])
      .addConsumerParameter(numberParameter)
      .addConsumerParameter(selectParameter)
      .build()

    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A publishing test with custom userdata')
      .setLicense('MIT')
      .setName('Test Publish Algorithm')
      .setOwner(web3.defaultAccount)
      .setType('algorithm')
      .setPricing({ type: 'free' })
      .setNftData(nftParams)
      .addService(service)
      .setAlgorithm({
        ...algorithmMetadata.algorithm,
        consumerParameters: [textParameter, booleanParameter]
      })
      .build()

    const result = await nautilus.publish(asset)

    assert(result)

    downloadAssetDid = result.DID
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
