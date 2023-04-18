import { Nautilus } from '../../src'
import { getWeb3 } from '../fixtures/Web3'
import assert from 'assert'
import chainConfig from '../fixtures/chainConfig.json'
import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'

describe('Nautilus', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should initialize correctly', async () => {
    const web3 = getWeb3()

    const nautilus = await Nautilus.create(web3, chainConfig)

    // TODO: ignoring errors because of private attributes
    // @ts-ignore
    assert.ok(nautilus.config.chainId === chainConfig.chainId)
    // @ts-ignore
    assert.deepEqual(nautilus.web3, web3)
    // @ts-ignore
    assert.deepEqual(nautilus.config, chainConfig)
  })
})
