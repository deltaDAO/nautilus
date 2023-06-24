// import { ZERO_ADDRESS } from '@oceanprotocol/lib'
// import assert from 'assert'
// import { AssetBuilder } from '../../src'
// import {
//   algorithmMetadata,
//   datasetService,
//   fixedPricing
// } from '../fixtures/AssetConfig'
// import { datatokenParams } from '../fixtures/DatatokenParams'
// import { nftParams } from '../fixtures/NftCreateData'
// import {
//   FileTypes,
//   NautilusService,
//   ServiceBuilder,
//   ServiceTypes
// } from '../../src/Nautilus/Asset/Service'

// describe('AssetBuilder', () => {
//   it('builds asset.metadata correctly', async () => {
//     const builder = new AssetBuilder()

//     const { type, name, author, description, license, algorithm } =
//       algorithmMetadata

//     const asset = builder
//       .setType(type)
//       .setName(name)
//       .setAuthor(author)
//       .setDescription(description)
//       .setLicense(license)
//       .setAlgorithm(algorithm)
//       .build()

//     assert.deepEqual(
//       asset.ddo.metadata,
//       algorithmMetadata,
//       `asset.metadata does not equal the given input metadata`
//     )
//   })

//   it('builds asset.pricing correctly', async () => {
//     const builder = new ServiceBuilder(ServiceTypes.ACCESS, FileTypes.URL)

//     const service = builder.setPricing(fixedPricing).build()

//     assert.deepEqual(
//       service.pricing,
//       fixedPricing,
//       `asset.pricing does not equal the given input pricing schema`
//     )
//   })

//   it('builds asset.services correctly', async () => {
//     const builder = new AssetBuilder()
//     const service = datasetService as NautilusService<
//       ServiceTypes.ACCESS,
//       FileTypes.URL
//     >

//     const asset = builder.addService(service).build()

//     assert.ok(
//       asset.services.includes(service),
//       `asset.services does not contain the given input service`
//     )
//   })

//   it('builds asset.datatokenCreateParams correctly', async () => {
//     const builder = new AssetBuilder()

//     const { name, symbol, ...params } = datatokenParams

//     const asset = builder
//       .setDatatokenData(params)
//       .setDatatokenNameAndSymbol(name, symbol)
//       .build()

//     assert.deepEqual(
//       asset.datatokenCreateParams,
//       datatokenParams,
//       `asset.datatokenCreateParams does not equal the given input datatokenParams`
//     )
//   })

//   it('builds asset.nftCreateData correctly', async () => {
//     const builder = new AssetBuilder()

//     const asset = builder.setNftData(nftParams).build()

//     assert.deepEqual(
//       asset.nftCreateData,
//       nftParams,
//       `asset.nftCreateData does not equal the given input nftParams`
//     )
//   })

//   it('builds asset.owner correctly', async () => {
//     const builder = new AssetBuilder()

//     const owner = 'owner'

//     const asset = builder.setOwner(owner).build()

//     assert.equal(
//       asset.owner,
//       owner,
//       'asset.owner does not match the given input owner'
//     )
//   })

//   it('builds with default values', async () => {
//     const builder = new AssetBuilder()

//     const asset = builder.build()

//     const { nftCreateData, datatokenCreateParams } = asset

//     // Default NftCreateData
//     assert.ok(typeof nftCreateData.name === 'string')
//     assert.ok(typeof nftCreateData.symbol === 'string')
//     assert.ok(typeof nftCreateData.templateIndex === 'number')
//     assert.ok(typeof nftCreateData.tokenURI === 'string')
//     assert.ok(typeof nftCreateData.transferable === 'boolean')

//     // Default DatatokenCreateParams
//     assert.ok(typeof datatokenCreateParams.cap === 'string')
//     assert.ok(typeof datatokenCreateParams.feeAmount === 'string')
//     assert.ok(datatokenCreateParams.feeToken === ZERO_ADDRESS)
//     assert.ok(datatokenCreateParams.mpFeeAddress === ZERO_ADDRESS)
//     assert.ok(typeof datatokenCreateParams.templateIndex === 'number')
//     // Datatoken name and symbol are undefined by default
//     assert.ok(typeof datatokenCreateParams.name === 'undefined')
//     assert.ok(typeof datatokenCreateParams.symbol === 'undefined')
//   })
// })
