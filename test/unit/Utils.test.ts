import { Asset, LogLevel, LoggerInstance, getHash } from '@oceanprotocol/lib'
import { ServiceBuilder } from '../../src/Nautilus'
import { resolvePublisherTrustedAlgorithms } from '../../src/utils/helpers/trusted-algorithms'
import * as AquariusAsset from '../fixtures/AquariusAsset.json'
import { expect } from 'chai'
import sinon from 'sinon'
import { mockAquarius } from '../mocks/aquarius'
import { mockProvider } from '../mocks/provider'

describe('Utils', () => {
  let aquariusMock: sinon.SinonMock
  let providerMock: sinon.SinonMock

  before(() => {
    LoggerInstance.setLevel(LogLevel.Verbose)
    aquariusMock = mockAquarius()
    providerMock = mockProvider()
  })

  after(() => {
    aquariusMock.restore()
    providerMock.restore()
  })

  describe('Trusted Algorithms', async () => {
    const containerChecksum = getHash(
      AquariusAsset.metadata.algorithm.container.entrypoint +
        AquariusAsset.metadata.algorithm.container.checksum
    )
    const trustedAlgorithms = {
      did: AquariusAsset.id,
      filesChecksum: 'filesChecksum',
      containerSectionChecksum: containerChecksum
    }

    beforeEach(() => {
      providerMock
        .expects('checkDidFiles')
        .returns(
          Promise.resolve([
            { type: '', valid: true, checksum: trustedAlgorithms.filesChecksum }
          ])
        )
    })

    it('should resolve publisherTrustedAlgorithms correctly', async () => {
      const serviceBuilder = new ServiceBuilder({
        aquariusAsset: AquariusAsset as Asset,
        serviceId: AquariusAsset.services[0].id
      })

      const service = serviceBuilder
        .addTrustedAlgorithms([
          {
            did: AquariusAsset.id
          }
        ])
        .build()

      await resolvePublisherTrustedAlgorithms(
        [service],
        'https://dummy.metadatacache'
      )

      expect(service)
        .to.have.property('compute')
        .to.have.property('publisherTrustedAlgorithms')
        .to.have.lengthOf.above(0)
        .to.deep.include(trustedAlgorithms)
    })
  })
})
