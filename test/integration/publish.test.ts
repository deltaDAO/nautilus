import assert from 'assert'
import { AssetBuilder, Nautilus } from '../../src'
import { ConsumerParameterBuilder } from '../../src/nautilus/asset/consumerParameters'
import {
  FileTypes,
  ServiceTypes,
  ServiceBuilder
} from '../../src/nautilus/asset/service'
import { getConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { getWeb3 } from '../fixtures/Web3'
import { datasetService } from '../fixtures/AssetConfig'

describe('Publishing Integration Test', () => {
  it('publishes an asset built with AssetBuilder and Nautilus instance', async () => {
    const web3 = getWeb3()
    const nautilus = await Nautilus.create(web3, getConfig())

    const assetBuilder = new AssetBuilder()

    const customParamBuilder = new ConsumerParameterBuilder('text')
    const serialNumberParam = customParamBuilder
      .setName('serialNumber')
      .setLabel('Serial Number')
      .setDescription('The serialnumber to retrieve data for')
      .setDefault('')
      .setRequired(false)
      .build()

    const serviceBuilder = new ServiceBuilder(
      ServiceTypes.ACCESS,
      FileTypes.URL
    )

    const service = serviceBuilder
      .setServiceEndpoint(datasetService.serviceEndpoint)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .addConsumerParameter(serialNumberParam)
      .build()

    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A publishing test with custom userdata')
      .setLicense('MIT')
      .setName('API Test Data')
      .setOwner(web3.defaultAccount)
      .setType('dataset')
      .setPricing({ type: 'free' })
      .setNftData(nftParams)
      .addService(service)
      .build()

    const result = await nautilus.publish(asset)

    console.log('Published!', result)
    assert(result)
  })
})
