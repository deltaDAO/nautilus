import { DDO, Service } from '@oceanprotocol/lib'
import assert from 'assert'
import { FileTypes, NautilusService, ServiceTypes } from '../../src'
import { NautilusDDO } from '../../src/Nautilus/Asset/NautilusDDO'
import { datasetService } from '../fixtures/AssetConfig'
import { metadataFixture } from '../fixtures/DDOData'

describe('NautilusDDO', () => {
  let oceanDDO: DDO
  beforeEach(async () => {
    oceanDDO = (await import('../fixtures/OceanDDO.json')) as DDO
  })

  it('sets a new created date if needed', async () => {
    const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
    const ddo = await nautilusDDO.getDDO(true)

    const oldCreated = new Date(oceanDDO.metadata.created).getTime()
    const newCreated = new Date(ddo.metadata.created).getTime()

    assert(
      newCreated > oldCreated,
      'The new created value is not greater than the previous one'
    )
  })

  it('creates an id for the ddo', async () => {
    const nautilusDDO = new NautilusDDO()
    const ddo = await nautilusDDO.getDDO(
      true,
      oceanDDO.chainId,
      oceanDDO.nftAddress
    )

    assert(ddo.id, 'The ddo does not contain an id')
  })

  it('sets a new created date if needed', async () => {
    const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
    const ddo = await nautilusDDO.getDDO(true)

    assert(ddo.metadata.created, 'The created value does not exist')
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

    const service = getNautilusService(oceanDDO.services[0].serviceEndpoint)
    nautilusDDO.services = [service]

    const ddo = await nautilusDDO.getDDO(
      true,
      oceanDDO.chainId,
      oceanDDO.nftAddress
    )

    const newService = ddo.services[0]

    assertNewDDOService(newService, service)
  })

  it('overwrites previous DDO metadata correctly', async () => {
    const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO)

    const { name, description, author } = metadataFixture

    nautilusDDO.metadata.name = name
    nautilusDDO.metadata.description = description
    nautilusDDO.metadata.author = author

    const ddo = await nautilusDDO.getDDO()

    assert.equal(
      ddo.metadata.name,
      name,
      'metadata.name does not match the input'
    )
    assert.equal(
      ddo.metadata.author,
      author,
      'metadata.author does not match the input'
    )
    assert.equal(
      ddo.metadata.description,
      description,
      'metadata.description does not match the input'
    )
    assert.equal(ddo.id, oceanDDO.id, 'The id does not match the previous id')
  })

  it('adds services to existing DDO correctly', async () => {
    const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO)
    const service = getNautilusService(oceanDDO.services[0].serviceEndpoint)

    nautilusDDO.services = [service]

    const ddo = await nautilusDDO.getDDO()

    console.log(ddo.services)

    assert(
      ddo.services.length === 2,
      'The length of the services array does not match the expected number: 2'
    )

    const oldServiceIndex = ddo.services.findIndex(
      (s) => s.id === oceanDDO.services[0].id
    )

    assert.deepEqual(
      ddo.services[oldServiceIndex],
      oceanDDO.services[0],
      'The previous service does not match and was altered'
    )
    assert(
      ddo.services.length === 2,
      'The length of the services array does not match the expected number: 2'
    )

    assertNewDDOService(ddo.services[oldServiceIndex === 0 ? 1 : 0], service)
  })
})

function assertNewDDOService(
  actual: Service,
  expected: NautilusService<ServiceTypes, FileTypes>
) {
  assert.equal(
    actual.datatokenAddress,
    expected.datatokenAddress,
    'The datatokenAddress does not match the input'
  )
  assert.equal(
    actual.type,
    expected.type,
    'The service type does not match the input'
  )
  assert.equal(
    actual.serviceEndpoint,
    expected.serviceEndpoint,
    'The serviceEndpoint does not match the input'
  )
  assert.equal(
    actual.timeout,
    expected.timeout,
    'The timeout value does not match the input'
  )
  assert.match(
    actual.files,
    /0x.+/,
    'The created files value does not match the given pattern'
  )
  assert(actual.id, 'The new service does not have an id')
}

function getNautilusService(
  serviceEndpoint: string
): NautilusService<ServiceTypes, FileTypes> {
  const service = new NautilusService<ServiceTypes.ACCESS, FileTypes.URL>()

  service.type = datasetService.type as ServiceTypes.ACCESS
  service.files = datasetService.files as any
  service.timeout = datasetService.timeout
  service.datatokenCreateParams = datasetService.datatokenCreateParams
  service.datatokenAddress = '0x1234datatoken1234Address'
  service.serviceEndpoint = serviceEndpoint

  return service
}
