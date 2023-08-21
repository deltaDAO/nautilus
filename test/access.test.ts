import { LoggerInstance } from '@oceanprotocol/lib'
import { Nautilus, LogLevel } from '../src'
import { getWallet } from './fixtures/Web3'
import assert from 'assert'

describe('Access', () => {
  let nautilus: Nautilus
  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)
    nautilus = await Nautilus.create(getWallet())
  })

  it('should download a free dataset', async () => {
    const assetDid =
      'did:op:9422c781bda5e4a3d64c0d92f14d0f1e3db4939907e8dab3852618b2fecb3696'

    assert(false, 'Re-activate test')
    // const fileUrl = await nautilus.access({
    //   assetDid
    // })

    // LoggerInstance.log(fileUrl)
    // assert(fileUrl)
  })
})
