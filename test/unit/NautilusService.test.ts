import assert from 'assert'
import { expect } from 'chai'
import sinon from 'sinon'
import { FileTypes, NautilusService, ServiceTypes, UrlFile } from '../../src'
import * as provider from '../../src/utils/provider'
import { datasetService } from '../fixtures/AssetConfig'

describe('NautilusService', () => {
  let providerMock: sinon.SinonMock
  let encryptedFilesExpectation: sinon.SinonExpectation

  beforeEach(() => {
    providerMock = sinon.mock(provider)
    encryptedFilesExpectation = providerMock.expects('getEncryptedFiles')
  })
  afterEach(() => {
    providerMock.restore()
  })

  it('sets the id correctly if given', async () => {
    assert(false, 'test not implemented')
  })

  it('sets name and description correctly if given', async () => {
    assert(false, 'test not implemented')
  })

  it('sets consumerParameters correctly if given', async () => {
    assert(false, 'test not implemented')
  })

  it('sets additionalInformation correctly if given', async () => {
    assert(false, 'test not implemented')
  })

  describe('when it has a valid files object', async () => {
    const encryptedFiles = '0xencryptedFilesString'
    beforeEach(() => {
      encryptedFilesExpectation.returns(Promise.resolve(encryptedFiles))
    })

    it('correctly creates an access ocean service from given input', async () => {
      const nautilusService = new NautilusService<ServiceTypes, FileTypes.URL>()

      const serviceEndpoint = 'https://my.ocean-provider.com'
      const chainId = 100
      const nftAddress = '0x1234NFT'
      const datatokenAddress = '0x1234DATATOKEN'

      nautilusService.type = ServiceTypes.ACCESS
      nautilusService.files = datasetService.files as UrlFile[]
      nautilusService.timeout = datasetService.timeout
      nautilusService.datatokenCreateParams =
        datasetService.datatokenCreateParams
      nautilusService.datatokenAddress = datatokenAddress
      nautilusService.serviceEndpoint = serviceEndpoint

      encryptedFilesExpectation
        .once()
        .withExactArgs(
          { datatokenAddress, nftAddress, files: datasetService.files },
          chainId,
          serviceEndpoint
        )

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
      expect(oceanService).to.have.property('files').eq(encryptedFiles)

      providerMock.verify()
    })

    it('correctly creates a compute ocean service from given input', async () => {
      const nautilusService = new NautilusService<ServiceTypes, FileTypes.URL>()
      assert(false, 'test not implemented')
    })
  })

  describe('when it does not have a valid files object', () => {
    it('throws an error when trying to create the ocean service', () => {
      assert(false, 'Test not implemented')
    })
  })
})
