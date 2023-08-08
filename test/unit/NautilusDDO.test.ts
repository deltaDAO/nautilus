import { DDO } from '@oceanprotocol/lib'
import assert from 'assert'
import { FileTypes, NautilusService, ServiceTypes } from '../../src'
import { NautilusDDO } from '../../src/Nautilus/Asset/NautilusDDO'
import { datasetService } from '../fixtures/AssetConfig'

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

  it('creates a DDO correctly from new metadata', async () => {
    const nautilusDDO = new NautilusDDO()
    const { metadata } = oceanDDO

    // remove dates from metadata
    delete metadata.created
    delete metadata.updated

    nautilusDDO.metadata = metadata
    const ddo = await nautilusDDO.getDDO()

    delete ddo.metadata.created
    delete ddo.metadata.updated

    assert.deepEqual(
      ddo.metadata,
      metadata,
      'The created metadata does not match the input'
    )
  })

  it('creates a DDO correctly from new service', async () => {
    const nautilusDDO = new NautilusDDO()
    const service = new NautilusService<ServiceTypes.ACCESS, FileTypes.URL>()

    service.type = datasetService.type as ServiceTypes.ACCESS
    service.files = datasetService.files as any
    service.timeout = datasetService.timeout
    service.datatokenCreateParams = datasetService.datatokenCreateParams
    service.datatokenAddress = '0x1234datatoken1234Address'
    service.serviceEndpoint = oceanDDO.services[0].serviceEndpoint

    nautilusDDO.services = [service]

    const ddo = await nautilusDDO.getDDO(
      true,
      oceanDDO.chainId,
      oceanDDO.nftAddress
    )

    const newService = ddo.services[0]

    assert.equal(
      newService.datatokenAddress,
      service.datatokenAddress,
      'The datatokenAddress does not match the input'
    )
    assert.equal(
      newService.type,
      service.type,
      'The service type does not match the input'
    )
    assert.equal(
      newService.serviceEndpoint,
      service.serviceEndpoint,
      'The serviceEndpoint does not match the input'
    )
    assert.equal(
      newService.timeout,
      service.timeout,
      'The timeout value does not match the input'
    )
    assert.match(
      newService.files,
      /0x.+/,
      'The created files value does not match the given pattern'
    )
    assert.match(
      newService.files,
      /0x.+/,
      'The created files value does not match the given pattern'
    )
    assert(newService.id, 'The new service does not have an id')
  })

  it('overwrites previous DDO services correctly', () => {
    assert(false, 'Test not implemented')
  })

  it('overwrites previous DDO metadata correctly', () => {
    assert(false, 'Test not implemented')
  })
})
