import { Nautilus, LogLevel } from '../../src/nautilus'
import { getWeb3 } from '../fixtures/Web3'

describe('Compute to Data Integration Test', () => {
  it('starts a compute job via nautilus instance on mumbai', async () => {
    const web3 = getWeb3()
    Nautilus.setLogLevel(LogLevel.Verbose)
    const nautilus = await Nautilus.create(web3)

    const computeJob = await nautilus.compute({
      dataset: {
        did: 'did:op:d1d267c886f0159c6d313bd65f125d84e83111b2c0d0bef1f031a616891aa5d6'
      },
      algorithm: {
        did: 'did:op:9422c781bda5e4a3d64c0d92f14d0f1e3db4939907e8dab3852618b2fecb3696'
      }
    })

    console.log(computeJob)
  }).timeout(40000)
})
