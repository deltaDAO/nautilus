import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import { access } from '../src'
import chainConfig from './fixtures/chainConfig.json'
import { getWeb3 } from './fixtures/Web3'

describe('Access', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should download a free dataset', async () => {
    const assetDid =
      'did:op:8e3f2acad2b9d856038f23c86190c7052ba9f7472675e302bd44867d6bb974e0'

    const fileUrl = await access({
      assetDid,
      web3: getWeb3(),
      config: chainConfig
    })

    LoggerInstance.log(fileUrl)
  })
})
