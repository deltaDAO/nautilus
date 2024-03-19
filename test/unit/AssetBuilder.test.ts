import { expect } from 'chai'
import { AssetBuilder } from '../../src/Nautilus'
import {
  FileTypes,
  ServiceBuilder,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service'
import { algorithmMetadata, fixedPricing } from '../fixtures/AssetConfig'
import { nftParams } from '../fixtures/NftCreateData'
import * as AquariusAsset from '../fixtures/AquariusAsset.json'
import { Asset } from '@oceanprotocol/lib'

describe('AssetBuilder', () => {
  it('builds asset.metadata correctly', async () => {
    const builder = new AssetBuilder()

    const { type, name, author, description, license, algorithm } =
      algorithmMetadata

    const asset = builder
      .setType(type)
      .setName(name)
      .setAuthor(author)
      .setDescription(description)
      .setLicense(license)
      .setAlgorithm(algorithm)
      .build()

    expect(asset.ddo.metadata).to.deep.equal(algorithmMetadata)
  })

  describe('when building from given aquariusAsset', async () => {
    const aquariusAsset = AquariusAsset as Asset
    const builder = new AssetBuilder(aquariusAsset)
    const asset = builder.build()
    const ddo = await asset.ddo.getDDO()

    it('builds asset metadata correctly from aquariusAsset', async () => {
      // remove updated value, as it gets calculated with getDDO
      delete ddo.metadata.updated
      delete aquariusAsset.metadata.updated

      expect(ddo.metadata).to.deep.equal(aquariusAsset.metadata)
    })

    it('builds asset services correctly from aquariusAsset', async () => {
      expect(ddo.services).to.deep.equal(aquariusAsset.services)
    })
  })

  it('builds asset.pricing correctly', async () => {
    const builder = new ServiceBuilder({
      serviceType: ServiceTypes.ACCESS,
      fileType: FileTypes.URL
    })

    const service = builder.setPricing(fixedPricing).build()

    expect(service.pricing).to.deep.equal(fixedPricing)
  })

  // TODO: move to service tests
  //   it('builds asset.datatokenCreateParams correctly', async () => {
  //     const builder = new AssetBuilder()

  //     const { name, symbol, ...params } = datatokenParams

  //     const asset = builder

  //       .setDatatokenNameAndSymbol(name, symbol)
  //       .build()

  //     assert.deepEqual(
  //       asset.datatokenCreateParams,
  //       datatokenParams,
  //       `asset.datatokenCreateParams does not equal the given input datatokenParams`
  //     )
  //   })

  it('builds asset.nftCreateData correctly', async () => {
    const builder = new AssetBuilder()

    const asset = builder.setNftData(nftParams).build()

    expect(asset.nftCreateData).to.deep.equal(nftParams)
  })

  it('builds asset.owner correctly', async () => {
    const builder = new AssetBuilder()

    const owner = 'owner'

    const asset = builder.setOwner(owner).build()

    expect(asset.owner).to.equal(owner)
  })

  it('builds with default nft values', async () => {
    const builder = new AssetBuilder()

    const asset = builder.build()

    const { nftCreateData } = asset

    // Default NftCreateData
    expect(nftCreateData.name).to.be.a('string')
    expect(nftCreateData.symbol).to.be.a('string')
    expect(nftCreateData.templateIndex).to.be.a('number')
    expect(nftCreateData.tokenURI).to.be.a('string')
    expect(nftCreateData.transferable).to.be.a('boolean')

    // TODO: move to service tests
    // // Default DatatokenCreateParams
    // assert.ok(typeof datatokenCreateParams.cap === 'string')
    // assert.ok(typeof datatokenCreateParams.feeAmount === 'string')
    // assert.ok(datatokenCreateParams.feeToken === ZERO_ADDRESS)
    // assert.ok(datatokenCreateParams.mpFeeAddress === ZERO_ADDRESS)
    // assert.ok(typeof datatokenCreateParams.templateIndex === 'number')
    // // Datatoken name and symbol are undefined by default
    // assert.ok(typeof datatokenCreateParams.name === 'undefined')
    // assert.ok(typeof datatokenCreateParams.symbol === 'undefined')
  })
})
