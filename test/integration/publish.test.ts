import assert from 'assert'
import { AssetBuilder, Nautilus } from '../../src'
import { ConsumerParameterBuilder } from '../../src/nautilus/asset/consumerParameters'
import {
  FileTypes,
  ServiceBuilder,
  ServiceTypes
} from '../../src/nautilus/asset/service'
import { algorithmMetadata, algorithmService } from '../fixtures/AssetConfig'
import { getConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { getWeb3 } from '../fixtures/Web3'

describe('Publishing Integration Test', () => {
  it('publishes an asset built with AssetBuilder and Nautilus instance', async () => {
    const web3 = getWeb3()
    const nautilus = await Nautilus.create(web3, getConfig())

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
      .setServiceEndpoint(algorithmService.serviceEndpoint)
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

    console.log('Published!', result)
    assert(result)
  })
})
