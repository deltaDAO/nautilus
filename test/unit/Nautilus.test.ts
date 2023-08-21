import { Nautilus } from '../../src'
import { getWallet } from '../fixtures/Web3'
import assert from 'assert'
import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'

describe('Nautilus', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should initialize correctly', async () => {
    const wallet = getWallet()
    const nautilus = await Nautilus.create(wallet)

    // TODO: ignoring errors because of private attributes
    // @ts-ignore
    assert.deepEqual(nautilus.signer, wallet)
    // @ts-ignore
    assert(nautilus.config)
  })
})
