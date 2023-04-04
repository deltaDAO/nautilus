import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import * as dotenv from 'dotenv'
import { publishAsset } from '../src'
import { getAssetConfig } from './fixtures/AssetConfig'
dotenv.config()

describe('Publishing tests', () => {
  LoggerInstance.setLevel(LogLevel.Verbose)

  it('publish a free dataset for download', async () => {
    const assetConfig = getAssetConfig('dataset', 'free', 'access')

    const result = await publishAsset(assetConfig)

    LoggerInstance.log(result)
  })

  it('publish a fixed rate dataset for compute', async () => {
    const assetConfig = getAssetConfig('dataset', 'fixed', 'compute')

    const result = await publishAsset(assetConfig)

    LoggerInstance.log(result)
  })

  it('publish a free algorithm for compute', async () => {
    const assetConfig = getAssetConfig('algorithm', 'free', 'compute')

    const result = await publishAsset(assetConfig)

    LoggerInstance.log(result)
  })
})
