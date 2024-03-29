import { expect } from 'chai'
import type sinon from 'sinon'
import {
  type FileTypes,
  NautilusService,
  ServiceTypes,
  type UrlFile
} from '../../src/Nautilus'
import { datasetService } from '../fixtures/AssetConfig'
import { getConsumerParameters } from '../fixtures/ConsumerParameters'
import { mockProvider } from '../mocks/provider'
import { expectThrowsAsync } from '../utils.test'

describe('NautilusService', () => {
  let providerMock: sinon.SinonMock

  const serviceEndpoint = 'https://my.ocean-provider.com'
  const chainId = 100
  const nftAddress = '0x1234NFT'
  const datatokenAddress = '0x1234DATATOKEN'

  before(() => {
    providerMock = mockProvider()
  })

  after(() => {
    providerMock.restore()
  })

  // TODO: re-activate tests (fix provider mock)
  describe.skip('when it has a valid serviceEndpoint', async () => {
    describe('when it has no files', async () => {
      it('throws an error', async () => {
        const nautilusService = new NautilusService<
          ServiceTypes,
          FileTypes.URL
        >()

        await expectThrowsAsync(() =>
          nautilusService.getOceanService(chainId, nftAddress, datatokenAddress)
        )
      })
    })

    describe('when it has a valid files object', async () => {
      let nautilusService: NautilusService<ServiceTypes, FileTypes.URL>
      const encryptedFiles = '0xencryptedFilesString'
      let encryptedFilesExpectation: sinon.SinonExpectation

      beforeEach(() => {
        nautilusService = new NautilusService<ServiceTypes, FileTypes.URL>()
        nautilusService.files = datasetService.files as UrlFile[]

        encryptedFilesExpectation = providerMock.expects('getEncryptedFiles')
        encryptedFilesExpectation.returns(Promise.resolve(encryptedFiles))
        providerMock.expects('isValidProvider').returns(Promise.resolve(true))
        providerMock
          .expects('getFileInfo')
          .returns(Promise.resolve([{ valid: true }]))
      })

      afterEach(() => {
        providerMock.verify()
      })

      it('sets the id correctly if given', async () => {
        const preDefinedId = 'my-pre-defined-id'
        nautilusService.id = preDefinedId

        const service = await nautilusService.getOceanService(
          chainId,
          nftAddress,
          datatokenAddress
        )

        expect(service.id).to.eq(preDefinedId)
      })

      it('sets name and description correctly if given', async () => {
        const name = 'My Service Name'
        const description = 'My Service Description'
        nautilusService.name = name
        nautilusService.description = description

        const service = await nautilusService.getOceanService(
          chainId,
          nftAddress,
          datatokenAddress
        )

        expect(service.name).to.eq(name)
        expect(service.description).to.eq(description)
      })

      it('sets consumerParameters correctly if given', async () => {
        const {
          textParameter,
          numberParameter,
          booleanParameter,
          selectParameter
        } = getConsumerParameters()

        const consumerParameters = [
          textParameter,
          numberParameter,
          booleanParameter,
          selectParameter
        ]

        nautilusService.consumerParameters = consumerParameters

        const service = await nautilusService.getOceanService(
          chainId,
          nftAddress,
          datatokenAddress
        )

        expect(service)
          .to.have.property('consumerParameters')
          .eq(consumerParameters)
      })

      it('sets additionalInformation correctly if given', async () => {
        const additionalInformation = {
          customInfo: {
            some: 'custom info'
          }
        }

        nautilusService.additionalInformation = additionalInformation

        const service = await nautilusService.getOceanService(
          chainId,
          nftAddress,
          datatokenAddress
        )

        expect(service)
          .to.have.property('additionalInformation')
          .eq(additionalInformation)
      })

      it('sets datatokenAddress correctly, when set via getOceanService', async () => {
        const service = await nautilusService.getOceanService(
          chainId,
          nftAddress,
          datatokenAddress
        )

        expect(service)
          .to.have.property('datatokenAddress')
          .eq(datatokenAddress)
      })

      it('throws an error if no datatokenAddress is provided', async () => {
        await expectThrowsAsync(
          () => nautilusService.getOceanService(chainId, nftAddress),
          /datatokenAddress is required/
        )
      })

      it('correctly calls provider.encrypt', async () => {
        nautilusService.datatokenAddress = datatokenAddress
        nautilusService.serviceEndpoint = serviceEndpoint

        const oceanService = await nautilusService.getOceanService(
          chainId,
          nftAddress
        )

        encryptedFilesExpectation
          .once()
          .withExactArgs(
            { datatokenAddress, nftAddress, files: datasetService.files },
            chainId,
            serviceEndpoint
          )

        expect(oceanService).to.have.property('files').eq(encryptedFiles)
      })

      it('creates a valid access ocean service', async () => {
        const nautilusService = new NautilusService<
          ServiceTypes.ACCESS,
          FileTypes.URL
        >()

        nautilusService.type = ServiceTypes.ACCESS
        nautilusService.files = datasetService.files as UrlFile[]
        nautilusService.timeout = datasetService.timeout
        nautilusService.datatokenCreateParams =
          datasetService.datatokenCreateParams
        nautilusService.datatokenAddress = datatokenAddress
        nautilusService.serviceEndpoint = serviceEndpoint

        const oceanService = await nautilusService.getOceanService(
          chainId,
          nftAddress
        )

        expect(oceanService).to.have.all.keys(
          'id',
          'type',
          'files',
          'datatokenAddress',
          'serviceEndpoint',
          'timeout'
        )
      })

      it('creates a valid compute ocean service', async () => {
        const nautilusService = new NautilusService<
          ServiceTypes.COMPUTE,
          FileTypes.URL
        >()

        nautilusService.type = ServiceTypes.COMPUTE
        nautilusService.files = datasetService.files as UrlFile[]
        nautilusService.timeout = datasetService.timeout
        nautilusService.datatokenCreateParams =
          datasetService.datatokenCreateParams
        nautilusService.datatokenAddress = datatokenAddress
        nautilusService.serviceEndpoint = serviceEndpoint

        const oceanService = await nautilusService.getOceanService(
          chainId,
          nftAddress
        )

        expect(oceanService).to.have.all.keys(
          'id',
          'type',
          'files',
          'datatokenAddress',
          'serviceEndpoint',
          'timeout',
          'compute'
        )
      })
    })

    describe('when it contains an invalid files object', async () => {
      beforeEach(() => {
        providerMock
          .expects('getFileInfo')
          .returns(Promise.resolve([{ valid: false }]))
      })

      it('throws an error when trying to create the ocean service', async () => {
        const nautilusService = new NautilusService<ServiceTypes, FileTypes>()
        nautilusService.files = datasetService.files

        await expectThrowsAsync(
          () =>
            nautilusService.getOceanService(
              chainId,
              nftAddress,
              datatokenAddress
            ),
          /files could not be validated/
        )
      })
    })
  })

  describe('when it has an invalid serviceEndpoint', async () => {
    beforeEach(() => {
      providerMock.expects('isValidProvider').returns(Promise.resolve(false))
    })

    it('throws an error when trying to create the ocean service', async () => {
      const nautilusService = new NautilusService<ServiceTypes, FileTypes>()

      await expectThrowsAsync(
        () =>
          nautilusService.getOceanService(
            chainId,
            nftAddress,
            datatokenAddress
          ),
        /serviceEndpoint is not a valid Ocean Provider/
      )
    })
  })
})
