import assert from 'node:assert'
import {
  Aquarius,
  type Config,
  type ConsumerParameter
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { CredentialListTypes } from '../../src/@types'
import {
  AssetBuilder,
  ConsumerParameterBuilder,
  FileTypes,
  LogLevel,
  Nautilus,
  ServiceBuilder,
  ServiceTypes
} from '../../src/Nautilus'
import {
  algorithmMetadata,
  algorithmService,
  datasetService,
  getPricing
} from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { TESTING_NODE_URI, getSigner } from '../fixtures/Ethers'

const nodeUri = TESTING_NODE_URI

describe('Publish Integration tests', function () {
  // set timeout for this describe block considering tsx will happen
  this.timeout(100000)

  let aquarius: Aquarius
  let config: Config
  let signer: Signer
  let signerAddress: string
  let nautilus: Nautilus
  let providerUri: string

  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)
    signer = getSigner(1, nodeUri)
    signerAddress = await signer.getAddress()
    config = await getTestConfig(signer)

    console.log('Testing with signer:', signerAddress)

    nautilus = await Nautilus.create(signer, {
      metadataCacheUri: process.env.METADATA_CACHE_URI_TEST
    })

    providerUri =
      process.env.PROVIDER_URI_TEST || nautilus.getOceanConfig().providerUri

    console.log('Testing with signer:', signerAddress)

    aquarius = new Aquarius(
      process.env.METADATA_CACHE_URI_TEST || config?.metadataCacheUri
    )
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

  it('publishes a multi service compute type dataset', async () => {
    const assetBuilder = new AssetBuilder()

    const pricing = await getPricing(signer, 'fixed')
    const services = [
      {
        name: 'test service 1',
        serviceEndpoint: providerUri,
        timeout: datasetService.timeout,
        pricing,
        file: datasetService.files[0]
      },
      {
        name: 'test service 2',
        serviceEndpoint: providerUri,
        timeout: datasetService.timeout,
        pricing,
        file: datasetService.files[0]
      }
    ]

    for (const service of services) {
      const serviceBuilder = new ServiceBuilder({
        serviceType: ServiceTypes.COMPUTE,
        fileType: FileTypes.URL
      })

      const builtService = serviceBuilder
        .setName(service.name)
        .setServiceEndpoint(service.serviceEndpoint)
        .setTimeout(service.timeout)
        .setPricing(pricing)
        .addFile(service.file)
        .build()

      assetBuilder.addService(builtService)
    }

    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Fixed')
      .setOwner(signerAddress)
      .setType('dataset')
      .build()

    const result = await nautilus.publish(asset)
    const fixedPriceComputeDataset = result?.ddo
    console.log(
      `asset published (${fixedPriceComputeDataset?.id}), waiting for aquarius indexing...`
    )
    await aquarius.waitForIndexer(fixedPriceComputeDataset?.id)

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
          textParameter,
          numberParameter,
          booleanParameter,
          selectParameter
        ]
      })
      .build()

    const result = await nautilus.publish(asset)

    assert(result)
  })

  // TODO use published algo did for addTrustedAlgorithms
  it('publishes a fixed price compute dataset with trusted algorithm', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.COMPUTE,
      fileType: FileTypes.URL
    })
    const service = serviceBuilder
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .addFile(datasetService.files[0])
      .setPricing(await getPricing(signer, 'fixed'))
      .addTrustedAlgorithms([
        {
          did: 'did:op:02961b8c52b0273bac94f776a88ed13833cbc50bc2bc666ab7495751941546dc'
        }
      ])
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
})

function getConsumerParameters(): { [key: string]: ConsumerParameter } {
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
