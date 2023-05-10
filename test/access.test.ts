import { LoggerInstance } from '@oceanprotocol/lib'
import { Nautilus, LogLevel } from '../src'
import { getWeb3 } from './fixtures/Web3'
import assert from 'assert'

describe('Access', () => {
  let nautilus: Nautilus
  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)
    nautilus = await Nautilus.create(getWeb3())
  })

  it('should download a free dataset', async () => {
    const assetDid =
      'did:op:9422c781bda5e4a3d64c0d92f14d0f1e3db4939907e8dab3852618b2fecb3696'

    const fileUrl = await nautilus.access({
      assetDid
    })

    LoggerInstance.log(fileUrl)
    assert(fileUrl)
  })
})
