import { DDO, Service } from '@oceanprotocol/lib'
import { expect } from 'chai'
import sinon from 'sinon'
import { NautilusService } from '../../src'
import { NautilusDDO } from '../../src/Nautilus/Asset/NautilusDDO'
import { algorithmMetadata, datasetMetadata } from '../fixtures/AssetConfig'
import { metadataFixture } from '../fixtures/DDOData'
import oceanDDOFixture from '../fixtures/OceanDDO.json'
import { expectThrowsAsync } from '../utils.test'

const oceanDDO: DDO = oceanDDOFixture as DDO
const oceanServiceMock = { ...oceanDDO.services[0], id: 'a-new-service-id' }

describe('NautilusDDO', () => {
  let getOceanServiceStub: sinon.SinonStub

  beforeEach(async () => {
    getOceanServiceStub = sinon.stub(
      NautilusService.prototype,
      'getOceanService'
    )
    getOceanServiceStub.returns(Promise.resolve(oceanServiceMock))
  })

  afterEach(() => {
    getOceanServiceStub.restore()
  })

  describe('when it uses a previous ddo as base', () => {
    it('sets a new created date if prompted', async () => {
      const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
      const ddo = await nautilusDDO.getDDO(true)

      const oldCreated = new Date(oceanDDO.metadata.created).getTime()
      const newCreated = new Date(ddo.metadata.created).getTime()

      expect(newCreated).to.be.greaterThan(oldCreated)
    })

    it('updates the DDO metadata.updated property', async () => {
      const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
      const ddo = await nautilusDDO.getDDO()

      const oldUpdated = new Date(oceanDDO.metadata.updated).getTime()
      const newUpdated = new Date(ddo.metadata.updated).getTime()

      expect(newUpdated).to.be.greaterThan(oldUpdated)
    })

    it('creates a DDO correctly from previous valid Ocean DDO', async () => {
      const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO as DDO)
      const ddo = await nautilusDDO.getDDO()

      // ignore the updated property, as this expected to be replaced by the NautilusDDO class
      delete oceanDDO.metadata.updated
      delete ddo.metadata.updated

      expect(ddo).to.deep.eq(oceanDDO)
    })

    it('overwrites previous DDO metadata correctly', async () => {
      const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO)

      const { name, description, author } = metadataFixture

      nautilusDDO.metadata.name = name
      nautilusDDO.metadata.description = description
      nautilusDDO.metadata.author = author

      const ddo = await nautilusDDO.getDDO()

      expect(ddo.id).to.eq(oceanDDO.id)
      expect(ddo.metadata.name).to.eq(name)
      expect(ddo.metadata.author).to.eq(author)
      expect(ddo.metadata.description).to.eq(description)
    })

    it('adds services to existing DDO correctly', async () => {
      const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO)

      nautilusDDO.services = [new NautilusService()]

      const ddo = await nautilusDDO.getDDO()

      expect(ddo.services).to.contain(oceanDDO.services[0])
      expect(ddo.services).to.have.lengthOf(2)
      expect(getOceanServiceStub.callCount).to.eq(1)
      expect(
        getOceanServiceStub.calledWithExactly(
          oceanDDO.chainId,
          oceanDDO.nftAddress
        )
      ).to.eq(true)
      expectAllServicesToBeValid(ddo.services)
    })

    it('overwrites an existing service based on its id', async () => {
      const nautilusDDO = NautilusDDO.createFromDDO(oceanDDO)

      getOceanServiceStub.returns(Promise.resolve(oceanDDO.services[0]))

      nautilusDDO.services = [new NautilusService()]

      const ddo = await nautilusDDO.getDDO()

      expect(ddo.services).to.contain(oceanDDO.services[0])
      expect(ddo.services).to.have.lengthOf(1)
      expect(getOceanServiceStub.callCount).to.eq(1)
      expect(
        getOceanServiceStub.calledWithExactly(
          oceanDDO.chainId,
          oceanDDO.nftAddress
        )
      ).to.eq(true)

      expectAllServicesToBeValid(ddo.services)
    })
  })

  describe('when it creates a ddo from scratch', () => {
    let minimalNautilusDDO: NautilusDDO

    beforeEach(() => {
      minimalNautilusDDO = new NautilusDDO()
      minimalNautilusDDO.metadata = datasetMetadata
      minimalNautilusDDO.services = [new NautilusService()]
    })

    it('sets a created date', async () => {
      const ddo = await minimalNautilusDDO.getDDO(
        true,
        oceanDDO.chainId,
        oceanDDO.nftAddress
      )

      expect(ddo.metadata).to.have.property('created')
    })

    it('creates an id for the ddo', async () => {
      const ddo = await minimalNautilusDDO.getDDO(
        true,
        oceanDDO.chainId,
        oceanDDO.nftAddress
      )

      expect(ddo).to.have.property('id')
    })

    it('creates a valid ocean DDO', async () => {
      const ddo = await minimalNautilusDDO.getDDO(
        true,
        oceanDDO.chainId,
        oceanDDO.nftAddress
      )

      // minimal viable ddo
      expect(ddo).to.have.all.keys(
        '@context',
        'id',
        'version',
        'nftAddress',
        'chainId',
        'metadata',
        'services'
      )
    })

    it('creates valid ocean DDO metadata with minimal input for a dataset', async () => {
      minimalNautilusDDO.metadata = datasetMetadata

      const ddo = await minimalNautilusDDO.getDDO(
        true,
        oceanDDO.chainId,
        oceanDDO.nftAddress
      )

      // minimal viable metadata
      expect(ddo.metadata).to.have.all.keys(
        'created',
        'updated',
        'name',
        'description',
        'type',
        'author',
        'license'
      )
      expect(ddo.metadata.type).to.eq('dataset')

      delete ddo.metadata.created
      delete ddo.metadata.updated

      expect(ddo.metadata).to.deep.eq(datasetMetadata)
    })

    it('creates valid ocean DDO metadata with minimal input for an alogrithm', async () => {
      minimalNautilusDDO.metadata = algorithmMetadata

      const ddo = await minimalNautilusDDO.getDDO(
        true,
        oceanDDO.chainId,
        oceanDDO.nftAddress
      )

      // minimal viable metadata
      expect(ddo.metadata).to.have.all.keys(
        'created',
        'updated',
        'name',
        'description',
        'type',
        'author',
        'license',
        'algorithm'
      )
      expect(ddo.metadata.type).to.eq('algorithm')

      delete ddo.metadata.created
      delete ddo.metadata.updated

      expect(ddo.metadata).to.deep.eq(algorithmMetadata)
    })

    it('creates services using getOceanService once per NautilusService added', async () => {
      minimalNautilusDDO.services = [
        new NautilusService(),
        new NautilusService()
      ]

      const ddo = await minimalNautilusDDO.getDDO(
        true,
        oceanDDO.chainId,
        oceanDDO.nftAddress
      )

      // verify that service was created correctly
      expect(getOceanServiceStub.callCount).to.eq(2)
      expect(
        getOceanServiceStub.calledWithExactly(
          oceanDDO.chainId,
          oceanDDO.nftAddress
        )
      ).to.eq(true)
      expect(ddo.services).to.have.lengthOf(2)
      // matching the return of the getOceanServiceStub
      expectAllServicesToBeValid(ddo.services)
    })

    it('throws an error when missing required metadata', async () => {
      const { name, type, ...incompleteMetadata } = datasetMetadata

      minimalNautilusDDO.metadata = incompleteMetadata

      await expectThrowsAsync(
        () => minimalNautilusDDO.getDDO(true),
        /required attributes are missing/i
      )
    })

    it('throws an error when no chainId is given for creation', async () => {
      await expectThrowsAsync(
        () => minimalNautilusDDO.getDDO(true, undefined, oceanDDO.nftAddress),
        /required attributes are missing/i
      )
    })

    it('throws an error when no nftAddress is given for creation', async () => {
      await expectThrowsAsync(
        () => minimalNautilusDDO.getDDO(true, oceanDDO.chainId),
        /required attributes are missing/i
      )
    })
  })
})

function expectAllServicesToBeValid(services: Service[]) {
  for (const service of services) {
    expect(service).to.have.all.keys(
      'id',
      'type',
      'files',
      'datatokenAddress',
      'serviceEndpoint',
      'timeout'
    )
  }
}
