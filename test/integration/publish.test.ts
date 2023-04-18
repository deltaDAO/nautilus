import assert from 'assert'
import { AssetBuilder, Nautilus } from '../../src'
import { ServiceConfig } from '../../src/@types/Publish'
import { ConsumerParameterBuilder } from '../../src/nautilus/asset/consumerParameters'
import { datasetService } from '../fixtures/AssetConfig'
import { getConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { getWeb3 } from '../fixtures/Web3'

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

    const service: ServiceConfig = {
      ...datasetService,
      files: [
        {
          type: 'url',
          method: 'GET',
          url: 'https://642ef38e2b883abc641b2d94.mockapi.io/sockets'
        }
      ],
      consumerParameters: [serialNumberParam]
    }

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
