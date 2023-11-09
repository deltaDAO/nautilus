import assert from 'assert'
import { Signer } from 'ethers'
import {
  AssetBuilder,
  ConsumerParameterBuilder,
  CredentialListTypes,
  FileTypes,
  LogLevel,
  Nautilus,
  NautilusConsumerParameter,
  ServiceBuilder,
  ServiceTypes
} from '../../src'
import {
  algorithmMetadata,
  algorithmService,
  datasetService,
  getPricing
} from '../fixtures/AssetConfig'
import { MUMBAI_NODE_URI, getSigner } from '../fixtures/Ethers'

const nodeUri = MUMBAI_NODE_URI

describe('Publish Integration tests', function () {
  // set timeout for this describe block considering tsx will happen
  this.timeout(50000)

  let signer: Signer
  let signerAddress: string
  let nautilus: Nautilus
  let providerUri: string

  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)
    signer = getSigner(1, nodeUri)
    signerAddress = await signer.getAddress()

    console.log('Testing with signer:', signerAddress)

    nautilus = await Nautilus.create(signer, {
      metadataCacheUri: process.env.METADATA_CACHE_URI_TEST
    })

    providerUri =
      process.env.PROVIDER_URI_TEST || nautilus.getOceanConfig().providerUri

    console.log('Testing with signer:', signerAddress)
  })

  it('publishes a free access asset', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.ACCESS,
      fileType: FileTypes.URL
    })
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .setPricing(await getPricing(signer, 'free'))
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Free')
      .setOwner(signerAddress)
      .setType('dataset')
      .addService(service)
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  })

  it('publishes a fixed price access asset', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.ACCESS,
      fileType: FileTypes.URL
    })
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .setPricing(await getPricing(signer, 'fixed'))
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Fixed')
      .setOwner(signerAddress)
      .setType('dataset')
      .addService(service)
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  })

  it('publishes an asset with credentials', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.ACCESS,
      fileType: FileTypes.URL
    })
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .setPricing(await getPricing(signer, 'free'))
      .addFile(datasetService.files[0])
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Service Credentials Free')
      .setOwner(signerAddress)
      .setType('dataset')
      .addService(service)
      .addCredentialAddresses(CredentialListTypes.ALLOW, [signerAddress])
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  })

  it('publishes an asset with service consumerParameters', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.ACCESS,
      fileType: FileTypes.URL
    })
    const {
      textParameter,
      numberParameter,
      booleanParameter,
      selectParameter
    } = getConsumerParameters()

    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .addConsumerParameter(textParameter)
      .addConsumerParameter(numberParameter)
      .addConsumerParameter(booleanParameter)
      .addConsumerParameter(selectParameter)
      .setPricing(await getPricing(signer, 'free'))
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Service Params Free')
      .setOwner(signerAddress)
      .setType('dataset')
      .addService(service)
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  })

  it('publishes an asset with algorithm metadata consumerParameters', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.COMPUTE,
      fileType: FileTypes.URL
    })
    const {
      textParameter,
      numberParameter,
      booleanParameter,
      selectParameter
    } = getConsumerParameters()

    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(algorithmService.timeout)
      .setPricing(await getPricing(signer, 'fixed'))
      .addFile(algorithmService.files[0])
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Algorithm Params Fixed')
      .setOwner(signerAddress)
      .setType('algorithm')
      .addService(service)
      .setAlgorithm({
        ...algorithmMetadata.algorithm,
        consumerParameters: [
          textParameter.getConfig(),
          numberParameter.getConfig(),
          booleanParameter.getConfig(),
          selectParameter.getConfig()
        ]
      })
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  })
})

function getConsumerParameters(): { [key: string]: NautilusConsumerParameter } {
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
