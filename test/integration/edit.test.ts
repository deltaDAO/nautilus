import assert from 'node:assert'
import { Aquarius, type Config, type DDO } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { CredentialListTypes, LifecycleStates } from '../../src/@types'
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
  datasetService,
  getPricing
} from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { MUMBAI_NODE_URI, getSigner } from '../fixtures/Ethers'

const nodeUri = MUMBAI_NODE_URI

describe('Edit Integration tests', function () {
  // set timeout for this describe block
  this.timeout(100000)

  let signer: Signer
  let signerAddress: string
  let nautilus: Nautilus
  let providerUri: string
  let aquarius: Aquarius
  let config: Config

  // test assets
  let fixedPricedAlgoWithCredentials: DDO
  let fixedPriceComputeDataset: DDO

  before(async () => {
    Nautilus.setLogLevel(LogLevel.Verbose)
    signer = getSigner(1, nodeUri)
    signerAddress = await signer.getAddress()
    config = await getTestConfig(signer)

    console.log('Testing with signer:', signerAddress)

    nautilus = await Nautilus.create(signer, {
      metadataCacheUri:
        process.env.METADATA_CACHE_URI_TEST || config?.metadataCacheUri
    })

    providerUri =
      process.env.PROVIDER_URI_TEST || nautilus.getOceanConfig().providerUri

    console.log('Testing with signer:', signerAddress)

    aquarius = new Aquarius(
      process.env.METADATA_CACHE_URI_TEST || config?.metadataCacheUri
    )
  })

  it('publishes an algorithm with fixed price and credentials', async () => {
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
      .setType('algorithm')
      .setAlgorithm({
        ...algorithmMetadata.algorithm
      })
      .addService(service)
      .addCredentialAddresses(CredentialListTypes.ALLOW, [signerAddress])
      .addCredentialAddresses(CredentialListTypes.DENY, [signerAddress])
      .build()

    const result = await nautilus.publish(asset)
    fixedPricedAlgoWithCredentials = result?.ddo
    await aquarius.waitForAqua(fixedPricedAlgoWithCredentials?.id)

    assert(result)
  })

  it('publishes a compute type dataset', async () => {
    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.COMPUTE,
      fileType: FileTypes.URL
    })

    const testServiceOne = serviceBuilder
      .setName('Test service 1')
      .setServiceEndpoint(providerUri)
      .setTimeout(datasetService.timeout)
      .setPricing(await getPricing(signer, 'fixed'))
      .addFile(datasetService.files[0])
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A dataset publishing test')
      .setLicense('MIT')
      .setName('Test Publish Dataset Fixed')
      .setOwner(signerAddress)
      .setType('dataset')
      .addService(testServiceOne)
      .build()

    const result = await nautilus.publish(asset)
    fixedPriceComputeDataset = result?.ddo
    await aquarius.waitForAqua(fixedPricedAlgoWithCredentials?.id)

    assert(result)
  })

  it('edit asset metadata fields', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id // use algo for algo metadata
    )

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder
      .setAuthor('Company Name')
      .setDescription(
        '# Nautilus-Example Description \n\nThis asset has been published using the [nautilus-examples](https://github.com/deltaDAO/nautilus-examples) repository.'
      )
      .setLicense('Edited License')
      .setName('Nautilus edit Example: New name')
      .setCopyrightHolder('TheHolder')
      .addLinks(['https://docs.oceanprotocol.com/'])
      .setContentLanguage('EN')
      .addTags(['edit', 'test'])
      .addCategories(['test'])
      .addAdditionalInformation({
        toplevel: 'random',
        nesting: { nested: 'in the deep' }
      })
      .setAlgorithm({
        ...algorithmMetadata.algorithm
      })
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - add address ALLOW', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder
      .addCredentialAddresses(CredentialListTypes.ALLOW, [
        '0x0000000000000000000000000000000000000000'
      ])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - add address DENY', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder
      .addCredentialAddresses(CredentialListTypes.DENY, [
        '0x0000000000000000000000000000000000000000'
      ])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - remove address ALLOW', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder
      .removeCredentialAddresses(CredentialListTypes.ALLOW, [signerAddress])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - remove address DENY', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder
      .removeCredentialAddresses(CredentialListTypes.DENY, [signerAddress])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit lifecycleState static function', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    // TODO decide if we want to support both routes to set lifecycle state
    // static function is required to reactivate revoked assets where aquarius id providing not enough data to use builder route
    const tx = await nautilus.setAssetLifecycleState(
      aquariusAsset,
      LifecycleStates.ASSET_UNLISTED
    )

    assert(tx)
  })

  it('edit lifecycleState AssetBuilder', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.setLifecycleState(LifecycleStates.ACTIVE).build()
    const result = await nautilus.edit(asset)

    assert(result)
  })

  // TODO this is experimental, pretty buggy regarding caching, maybe not even possible with this stack
  it.skip('edit services - change price replacing service', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      'did:op:f92be296bfd36e99f0e7ce7583dcb8a3846f10f0b71a40e5dcac8ab6624a2548'
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '1accb051fdb757cf5fac7c88a724af82e841bbb3c02fc16e53fb91d45e85e09d'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)

    // create new service with new datatoken and replace the old one
    const service = serviceBuilder
      .addFile(datasetService.files[0]) // a new datatoken requires a new encrypted files field since it's includes in the encrypted data
      .setPricing({
        type: 'fixed',
        freCreationParams: {
          fixedRateAddress: '0x25e1926E3d57eC0651e89C654AB0FA182C6D5CF7',
          baseTokenAddress: '0xd8992Ed72C445c35Cb4A2be468568Ed1079357c8',
          baseTokenDecimals: 18,
          datatokenDecimals: 18,
          fixedRate: '4',
          marketFee: '0',
          marketFeeCollector: '0x0000000000000000000000000000000000000000'
        }
      })
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit service - editPrice static function', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const serviceId = fixedPricedAlgoWithCredentials?.services?.[0]?.id
    const newPrice = '0.1'

    const txReceipt = await nautilus.setServicePrice(
      aquariusAsset,
      serviceId,
      newPrice
    )
    console.log(txReceipt)

    assert(txReceipt)
  })

  it('edit services - name, description, timeout', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPricedAlgoWithCredentials?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)

    const service = serviceBuilder
      .setName('TestServiceName')
      .setDescription('TestServiceDescription')
      .setTimeout(1000)
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - files', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPricedAlgoWithCredentials?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)

    const service = serviceBuilder
      .addFile(datasetService.files[0]) // TODO should be named replaceFile() for edit function, future UX improvement
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)

    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - add consumerParameter', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPricedAlgoWithCredentials?.services?.[0]?.id
    }

    const consumerParameterBuilder = new ConsumerParameterBuilder()
    const numberParameter = consumerParameterBuilder
      .setType('number')
      .setName('numberParameter2')
      .setLabel('Number Parameter2')
      .setDescription('A cool description for a test number parameter')
      .setDefault('12')
      .setRequired(false)
      .build()

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder.addConsumerParameter(numberParameter).build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - serviceEndpoint', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPricedAlgoWithCredentials?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPricedAlgoWithCredentials?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setServiceEndpoint('https://v4.provider.oceanprotocol.com/')
      .addFile(datasetService.files[0]) // we have to add files since serviceEndpoint is in encrypted files
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute add trusted publishers', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .addTrustedAlgorithmPublisher(signerAddress)
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute add trusted algos', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .addTrustedAlgorithms([
        {
          did: fixedPricedAlgoWithCredentials?.id
        },
        {
          did: fixedPricedAlgoWithCredentials?.id
        }
      ])
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute allow algorithm network access', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder.allowAlgorithmNetworkAccess().build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute allow raw algorithm', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder.allowRawAlgorithms().build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute trust all publishers and algos', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setAllAlgorithmsTrusted()
      .setAllAlgorithmPublishersTrusted()
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute remove publishers and algos', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .removeTrustedAlgorithm(fixedPricedAlgoWithCredentials?.id)
      .removeTrustedAlgorithmPublisher(signerAddress)
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute untrust publishers and algos', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setAllAlgorithmsUntrusted()
      .setAllAlgorithmPublishersUntrusted()
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute do not allow', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .allowAlgorithmNetworkAccess(false)
      .allowRawAlgorithms(false)
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - add additionalInfo', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId: fixedPriceComputeDataset?.services?.[0]?.id
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .addAdditionalInformation({
        test: 'SuperInf2',
        number: 6,
        nested: { name: 'nested2' }
      })
      .addAdditionalInformation({
        additional: undefined,
        nested: { name: 'overwritten3' }
      })
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - add another service', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceBuilderConfig = {
      serviceType: ServiceTypes.COMPUTE,
      fileType: FileTypes.URL
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setServiceEndpoint('https://v4.provider.oceanprotocol.com/')
      .addFile(datasetService.files[0])
      .setTimeout(datasetService.timeout)
      .setPricing({ type: 'free' })
      .build()

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  // TODO: reinstate test after fixing publishing with multiple services
  it.skip('edit services - remove service', async () => {
    const aquariusAsset = await nautilus.getAquariusAsset(
      fixedPriceComputeDataset?.id
    )

    const serviceId = fixedPriceComputeDataset?.services?.[1]?.id

    const assetBuilder = new AssetBuilder(aquariusAsset)
    const asset = assetBuilder.removeService(serviceId).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })
})
