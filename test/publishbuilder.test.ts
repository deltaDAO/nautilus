import { LoggerInstance } from '@oceanprotocol/lib'
import { AssetBuilder } from '../src'
import { datasetService } from './fixtures/AssetConfig'
import { datatokenParams } from './fixtures/DatatokenParams'
import { nftParams } from './fixtures/NftCreateData'
import { getWeb3 } from './fixtures/Web3'
import chainConfig from './fixtures/chainConfig.json'
import { NautilusBuilder } from '../src/nautilus/builder'

describe('PublishBuilder', () => {
  it('builds a dataset asset', async () => {
    const builder = new AssetBuilder()

    const web3 = getWeb3()
    const owner = web3.defaultAccount

    const asset = builder
      .setAuthor('testAuthor')
      .setDescription('A publish asset building test on GEN-X')
      .setNftData({
        ...nftParams,
        owner
      })
      .setDatatokenData({
        ...datatokenParams,
        minter: owner,
        paymentCollector: owner
      })
      .setPricing({ type: 'free' })
      .addService(datasetService)
      .build()

    LoggerInstance.log(asset)

    const nautilus = new NautilusBuilder()
      .setWeb3(getWeb3())
      .setConfig(100, chainConfig)
      .build()

    const res = await nautilus.publish(asset)

    LoggerInstance.log(res)
  })
})
