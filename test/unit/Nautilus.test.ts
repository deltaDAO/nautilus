import { Nautilus } from '../../src'
import { getSigner } from '../fixtures/Web3'
import assert from 'assert'
import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'

describe('Nautilus', () => {
  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should initialize correctly', async () => {
    const signer = getSigner()
    const nautilus = await Nautilus.create(signer)

    // TODO: ignoring errors because of private attributes
    // @ts-ignore
    assert.deepEqual(nautilus.signer, signer)
    // @ts-ignore
    assert(nautilus.config)
  })
})
