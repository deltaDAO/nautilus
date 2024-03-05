import sinon from 'sinon'
import * as provider from '../../src/utils/provider'

export function mockProvider(): sinon.SinonMock {
  const providerMock = sinon.mock(provider)

  return providerMock
}
