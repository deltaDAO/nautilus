import assert from 'assert'
import Web3 from 'web3'
import {
  AssetBuilder,
  ConsumerParameterBuilder,
  FileTypes,
  LogLevel,
  Nautilus,
  ServiceBuilder,
  ServiceTypes
} from '../../src'
import {
  algorithmMetadata,
  algorithmService,
  datasetService,
  getPricing
} from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { MUMBAI_NODE_URI, getWeb3 } from '../fixtures/Web3'

const nodeUri = MUMBAI_NODE_URI

describe('Publish Integration tests', () => {
  let web3: Web3
  let nautilus: Nautilus
  let providerUri: string

  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)
    web3 = getWeb3(1, nodeUri)
    nautilus = await Nautilus.create(web3)
    providerUri = (await getTestConfig(web3)).providerUri
  })

  it('publishes a free access asset', async () => {
    const serviceBuilder = new ServiceBuilder(
      ServiceTypes.ACCESS,
      FileTypes.URL
    )
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .setPricing(await getPricing(web3, 'free'))
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Free')
      .setOwner(web3.defaultAccount)
      .setType('dataset')
      .addService(service)
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  }).timeout(90000)

  //   it('publishes a fixed price access asset', async () => {
  //     const serviceBuilder = new ServiceBuilder(
  //       ServiceTypes.ACCESS,
  //       FileTypes.URL
  //     )
  //     const service = serviceBuilder
  //       .setServiceEndpoint(providerUri)
  //       .setTimeout(datasetService.timeout)
  //       .addFile(datasetService.files[0])
  //       .build()

  //     const assetBuilder = new AssetBuilder()
  //     const asset = assetBuilder
  //       .setAuthor('testAuthor')
  //       .setDescription('A dataset publishing test')
  //       .setLicense('MIT')
  //       .setName('Test Publish Dataset Fixed')
  //       .setOwner(web3.defaultAccount)
  //       .setType('dataset')
  //       .setPricing(await getPricing(web3, 'fixed'))
  //       .addService(service)
  //       .build()

  //     const result = await nautilus.publish(asset)

  //     assert(result)
  //   })

  //   it('publishes an asset with service consumerParamters', async () => {
  //     const serviceBuilder = new ServiceBuilder(
  //       ServiceTypes.ACCESS,
  //       FileTypes.URL
  //     )
  //     const {
  //       textParameter,
  //       numberParameter,
  //       booleanParameter,
  //       selectParameter
  //     } = getConsumerParameters()

  //     const service = serviceBuilder
  //       .setServiceEndpoint(providerUri)
  //       .setTimeout(datasetService.timeout)
  //       .addFile(datasetService.files[0])
  //       .addConsumerParameter(textParameter)
  //       .addConsumerParameter(numberParameter)
  //       .addConsumerParameter(booleanParameter)
  //       .addConsumerParameter(selectParameter)
  //       .setPricing(await getPricing(web3, 'free'))
  //       .build()

  //     const assetBuilder = new AssetBuilder()
  //     const asset = assetBuilder
  //       .setAuthor('testAuthor')
  //       .setDescription('A dataset publishing test')
  //       .setLicense('MIT')
  //       .setName('Test Publish Dataset Service Params Free')
  //       .setOwner(web3.defaultAccount)
  //       .setType('dataset')
  //       .addService(service)
  //       .build()

  //     const result = await nautilus.publish(asset)

  //     assert(result)
  //   })

  //   it('publishes an asset with algorithm metadata consumerParamters', async () => {
  //     const serviceBuilder = new ServiceBuilder(
  //       ServiceTypes.COMPUTE,
  //       FileTypes.URL
  //     )
  //     const {
  //       textParameter,
  //       numberParameter,
  //       booleanParameter,
  //       selectParameter
  //     } = getConsumerParameters()

  //     const service = serviceBuilder
  //       .setServiceEndpoint(providerUri)
  //       .setTimeout(algorithmService.timeout)
  //       .addFile(algorithmService.files[0])
  //       .build()

  //     const assetBuilder = new AssetBuilder()
  //     const asset = assetBuilder
  //       .setAuthor('testAuthor')
  //       .setDescription('A dataset publishing test')
  //       .setLicense('MIT')
  //       .setName('Test Publish Algorithm Params Fixed')
  //       .setOwner(web3.defaultAccount)
  //       .setType('algorithm')
  //       .setPricing(await getPricing(web3, 'fixed'))
  //       .addService(service)
  //       .setAlgorithm({
  //         ...algorithmMetadata.algorithm,
  //         consumerParameters: [
  //           textParameter,
  //           numberParameter,
  //           booleanParameter,
  //           selectParameter
  //         ]
  //       })
  //       .build()

  //     const result = await nautilus.publish(asset)

  //     assert(result)
  //   })
})

function getConsumerParameters() {
  const customParamBuilder = new ConsumerParameterBuilder()
  const numberParameter = customParamBuilder
    .setType('number')
    .setName('numberParameter')
    .setLabel('Number Parameter')
    .setDescription('A cool description for a test number parameter')
    .setDefault('12')
    .setRequired(false)
    .build()

  customParamBuilder.reset()
  const selectParameter = customParamBuilder
    .setType('select')
    .setName('selectParameter')
    .setLabel('Test Select Parameter')
    .setDescription('A cool description for a test select parameter')
    .setDefault('myValue')
    .addOption({ myValue: 'My Label' })
    .addOption({ myOtherValue: 'My Other Label' })
    .setRequired(true)
    .build()

  customParamBuilder.reset()
  const textParameter = customParamBuilder
    .setType('text')
    .setName('textParameter')
    .setLabel('Text Parameter')
    .setDescription('A cool description for a test text parameter')
    .setDefault('default-text')
    .setRequired(true)
    .build()

  customParamBuilder.reset()
  const booleanParameter = customParamBuilder
    .setType('boolean')
    .setName('booleanParameter')
    .setLabel('Boolean Parameter')
    .setDescription('A cool description for a test boolean parameter')
    .setDefault('false')
    .setRequired(false)
    .build()

  return {
    textParameter,
    numberParameter,
    booleanParameter,
    selectParameter
  }
}
