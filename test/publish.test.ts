// import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'
// import * as dotenv from 'dotenv'
// import { Nautilus, publishAsset } from '../src'
// import { getAssetConfig } from './fixtures/AssetConfig'
// import { getWeb3 } from './fixtures/Web3'
// dotenv.config()

// describe('Publishing tests', () => {
//   let nautilus: Nautilus
//   before(async () => {
//     nautilus = await Nautilus.create(getWeb3())
//     nautilus.logger.setLevel(LogLevel.Verbose)
//   })

//   it('publish a free dataset for download', async () => {
//     const assetConfig = getAssetConfig('dataset', 'free', 'access')

//     // const result = await publishAsset(assetConfig)

//     LoggerInstance.log(result)
//   })

//   it('publish a fixed rate dataset for compute', async () => {
//     const assetConfig = getAssetConfig('dataset', 'fixed', 'compute')

//     const result = await publishAsset(assetConfig)

//     LoggerInstance.log(result)
//   })

//   it('publish a free algorithm for compute', async () => {
//     const assetConfig = getAssetConfig('algorithm', 'free', 'compute')

//     const result = await publishAsset(assetConfig)

//     LoggerInstance.log(result)
//   })
// })
