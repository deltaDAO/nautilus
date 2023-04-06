import { Nautilus } from '../../src'
import { getWeb3 } from '../fixtures/Web3'
import assert from 'assert'
import chainConfig from '../fixtures/chainConfig.json'
import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'

describe('Nautilus', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should initialize correctly', () => {
    const web3 = getWeb3()
    const { chainId, ...config } = chainConfig

    const nautilus = new Nautilus(web3, chainId, config)

    // TODO: ignoring errors because of private attributes
    // @ts-ignore
    assert.ok(nautilus.config.chainId === chainId)
    // @ts-ignore
    assert.deepEqual(nautilus.web3, web3)
    // @ts-ignore
    assert.deepEqual(nautilus.config, chainConfig)
  })
})
