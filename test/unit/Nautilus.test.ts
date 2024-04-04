import assert from 'node:assert'
import { LogLevel, LoggerInstance } from '@oceanprotocol/lib'
import { Nautilus } from '../../src/Nautilus'
import { getSigner } from '../fixtures/Ethers'

describe('Nautilus', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  // TODO: mock wallet for unit test
  it.skip('should initialize correctly', async () => {
    const signer = getSigner()
    const nautilus = await Nautilus.create(signer)

    // TODO: ignoring errors because of private attributes
    // @ts-ignore
    assert.deepEqual(nautilus.signer, signer)
    // @ts-ignore
    assert(nautilus.config)
  })
})
