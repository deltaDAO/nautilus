import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import { access } from '../src'
import { getConfig } from './fixtures/Config'
import { getWeb3 } from './fixtures/Web3'

describe('Access', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should download a free dataset', async () => {
    const assetDid =
      'did:op:2ca1ddd4af1e3abf92b80ab62e102534baf26816db839310785e540b2837dc27'
    const serialNumber = 'f139a417-fcfb-4059-93aa-ef7656fc4589'

    const fileUrl = await access({
      assetDid,
      web3: getWeb3(),
      config: getConfig(),
      userdata: {
        serialNumber
      }
    })

    LoggerInstance.log(fileUrl)
  })
})
