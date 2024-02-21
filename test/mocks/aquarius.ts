import * as aquarius from '../../src/utils/aquarius'
import * as AquariusAsset from '../fixtures/AquariusAsset.json'
import sinon from 'sinon'

const RETURNED_ASSET = AquariusAsset
const RETURNED_ASSET_ARRAY = [AquariusAsset, AquariusAsset]

export function mockAquarius(): sinon.SinonMock {
  const aquariusMock = sinon.mock(aquarius)

  aquariusMock.expects('getAsset').returns(Promise.resolve(RETURNED_ASSET))
  aquariusMock
    .expects('getAssets')
    .returns(Promise.resolve(RETURNED_ASSET_ARRAY))

  return aquariusMock
}
