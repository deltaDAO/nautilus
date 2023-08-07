import { DDO } from '@oceanprotocol/lib'
import assert from 'assert'
import { NautilusDDO } from '../../src/Nautilus/Asset/NautilusDDO'

describe('NautilusDDO', () => {
  let oceanDDO: DDO
  beforeEach(async () => {
    oceanDDO = (await import('../fixtures/OceanDDO.json')) as DDO
  })

  it('updates the DDO metadata.updated property', async () => {
    const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
    const ddo = await nautilusDDO.getDDO()

    const oldUpdated = new Date(oceanDDO.metadata.updated).getTime()
    const newUpdated = new Date(ddo.metadata.updated).getTime()

    assert(
      newUpdated > oldUpdated,
      'The new updated value is not greater than the previous one'
    )
  })

  it('creates a DDO correctly from previous valid Ocean DDO', async () => {
    const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
    const ddo = await nautilusDDO.getDDO()

    // ignore the updated property, as this expected to be replaced by the NautilusDDO class
    delete oceanDDO.metadata.updated
    delete ddo.metadata.updated

    assert.deepEqual(ddo, oceanDDO, 'The created DDO differs from the input')
  })

  it('creates a DDO correctly from new services and metadata', async () => {
    const nautilusDDO = new NautilusDDO()

    assert(false, 'Test not implemented')
  })

  it('overwrites previous DDO services correctly', () => {
    assert(false, 'Test not implemented')
  })

  it('overwrites previous DDO metadata correctly', () => {
    assert(false, 'Test not implemented')
  })
})
