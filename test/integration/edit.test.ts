import assert from 'assert'
import { Signer } from 'ethers'
import {
  AssetBuilder,
  ConsumerParameterBuilder,
  CredentialListTypes,
  FileTypes,
  LifecycleStates,
  LogLevel,
  Nautilus,
  NautilusAsset,
  NautilusService,
  ServiceBuilder,
  ServiceTypes,
  getPublisherTrustedAlgorithms
} from '../../src'
import { algorithmMetadata, datasetService } from '../fixtures/AssetConfig'
import { MUMBAI_NODE_URI, getSigner } from '../fixtures/Ethers'
import { NautilusDDO } from '../../src/Nautilus/Asset/NautilusDDO'

const nodeUri = MUMBAI_NODE_URI

describe('Edit Integration tests', function () {
  // set timeout for this describe block
  this.timeout(100000)

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

  it('edit asset metadata fields', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:5c7a3b65a01240b5b18e6cc7ca0d652a4932a032111c2b7a98149a4602354296', // use algo for algo metadata
      nautilus
    )

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder
      .setAuthor('Company Name')
      .setDescription(
        `# Nautilus-Example Description \n\nThis asset has been published using the [nautilus-examples](https://github.com/deltaDAO/nautilus-examples) repository.`
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
    const { nautilusDDO, aquariusAsset } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder
      .addCredentialAddresses(CredentialListTypes.ALLOW, [
        '0x6432956a98E522F1B8a73a45245a5C6ff2c7f8f1'
      ])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - add address DENY', async () => {
    const { nautilusDDO, aquariusAsset } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder
      .addCredentialAddresses(CredentialListTypes.DENY, [
        '0x0000000000000000000000000000000000000000'
      ])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - add remove address ALLOW', async () => {
    const { nautilusDDO, aquariusAsset } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder
      .removeCredentialAddresses(CredentialListTypes.ALLOW, [
        '0x6432956a98E522F1B8a73a45245a5C6ff2c7f8f1'
      ])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit credentials - add remove address DENY', async () => {
    const { nautilusDDO, aquariusAsset } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder
      .removeCredentialAddresses(CredentialListTypes.DENY, [
        '0x0000000000000000000000000000000000000000'
      ])
      .build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit lifecycleState static function', async () => {
    const { aquariusAsset } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    // TODO decide if we want to support both routes to set lifecycle state
    // static function is required to reactivate revoked assets where aquarius id providing not enough data to use builder route
    const tx = await NautilusAsset.setLifecycleState(
      signer,
      aquariusAsset.nft.address,
      signerAddress,
      LifecycleStates.ASSET_UNLISTED
    )

    assert(tx)
  })

  it('edit lifecycleState AssetBuilder', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.setLifecycleState(LifecycleStates.ACTIVE).build()
    const result = await nautilus.edit(asset)

    assert(result)
  })

  // TODO this is experimental, pretty buggy regarding caching, maybe not even possible with this stack
  it.skip('edit services - change price replacing service', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:f92be296bfd36e99f0e7ce7583dcb8a3846f10f0b71a40e5dcac8ab6624a2548',
      nautilus
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

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit service - editPrice static function', async () => {
    const did =
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772'
    const serviceId =
      '54260888bafb4b7193d7e6e8c9def23e4154052f594b741ce619eb9272ac06e9'
    const newPrice = '0.1'

    const txReceipt = await NautilusService.editPrice(
      nautilus,
      signer,
      did,
      serviceId,
      newPrice
    )
    console.log(txReceipt)

    assert(txReceipt)
  })

  it('edit services - name, description, timeout', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '54260888bafb4b7193d7e6e8c9def23e4154052f594b741ce619eb9272ac06e9'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)

    const service = serviceBuilder
      .setName('TestServiceName')
      .setDescription('TestServiceDescription')
      .setTimeout(1000)
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - files', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        'be1704b43fa63e7f736571bc9be38778f585d7643ddad0b752fabb39e2691398'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)

    const service = serviceBuilder
      .addFile(datasetService.files[0]) // TODO should be named replaceFile() for edit function, future UX improvement
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })

    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - add consumerParameter', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        'eb51ea8c17ed2f4bab2394b1a232ee342954fdd4cc0f2a31b9d007fbba205a04'
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

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - serviceEndpoint', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        'cb2883a3868c73ddde137d453f1fcde770ce2ec87ddbe7e9e46f5b73fd15d8d4'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setServiceEndpoint('https://v4.provider.oceanprotocol.com/')
      .addFile(datasetService.files[0]) // we have to add files since serviceEndpoint is in encrypted files
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute add trusted algos based on dids', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:94a2c281b6b0a09067310c77c5d49c3610b5ead5a31157f65f2c84022a1bc32e',
      nautilus
    )

    const trustedAlgorithms = await getPublisherTrustedAlgorithms(
      [
        'did:op:02961b8c52b0273bac94f776a88ed13833cbc50bc2bc666ab7495751941546dc'
      ],
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '975a3647318a5a865c5030dc8cb16b9ef91dc82b490dd2440ffa059c7d8d7c0f'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .addTrustedAlgorithms(trustedAlgorithms)
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute add trusted algos and publishers', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:94a2c281b6b0a09067310c77c5d49c3610b5ead5a31157f65f2c84022a1bc32e',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '975a3647318a5a865c5030dc8cb16b9ef91dc82b490dd2440ffa059c7d8d7c0f'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .addTrustedAlgorithmPublisher(
        '0x6432956a98E522F1B8a73a45245a5C6ff2c7f8f1'
      )
      .addTrustedAlgorithmPublisher(
        '0x6432956a98E522F1B8a73a45245a5C6ff2c7f8f1'
      )
      .addTrustedAlgorithms([
        {
          did: 'did:op:b39190deee2d92b74a02fbb01381599ae03b6630ceec362339a136c8fe1e413e',
          containerSectionChecksum:
            'b7862dd501b091347db86fd009fc8c9cb7bb23347c40271d30063a3e1f2fe1a4',
          filesChecksum:
            'cbd7b9964fa887f5f3acd48d2312435da2e351fa0c4689169b53ae2ec2014173'
        },
        {
          did: 'did:op:b39190deee2d92b74a02fbb01381599ae03b6630ceec362339a136c8fe1e413e',
          containerSectionChecksum:
            'b7862dd501b091347db86fd009fc8c9cb7bb23347c40271d30063a3e1f2fe555',
          filesChecksum:
            'cbd7b9964fa887f5f3acd48d2312435da2e351fa0c4689169b53ae2ec2014173'
        }
      ])
      .allowAlgorithmNetworkAccess()
      .allowRawAlgorithms()
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute trust all publishers and algos', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:94a2c281b6b0a09067310c77c5d49c3610b5ead5a31157f65f2c84022a1bc32e',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '975a3647318a5a865c5030dc8cb16b9ef91dc82b490dd2440ffa059c7d8d7c0f'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setAllAlgorithmsTrusted()
      .setAllAlgorithmPublishersTrusted()
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute remove publishers and algos', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:94a2c281b6b0a09067310c77c5d49c3610b5ead5a31157f65f2c84022a1bc32e',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '975a3647318a5a865c5030dc8cb16b9ef91dc82b490dd2440ffa059c7d8d7c0f'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .removeTrustedAlgorithm(
        'did:op:b39190deee2d92b74a02fbb01381599ae03b6630ceec362339a136c8fe1e413e'
      )
      .removeTrustedAlgorithmPublisher(
        '0x6432956a98E522F1B8a73a45245a5C6ff2c7f8f1'
      )
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute untrust publishers and algos', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:94a2c281b6b0a09067310c77c5d49c3610b5ead5a31157f65f2c84022a1bc32e',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        '975a3647318a5a865c5030dc8cb16b9ef91dc82b490dd2440ffa059c7d8d7c0f'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .setAllAlgorithmsUntrusted()
      .setAllAlgorithmPublishersUntrusted()
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - compute do not allow', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        'a25b6ef33d518b9908540fbf34d6ce2b77a09539c01988f1ba6a156d97980ab7'
    }

    const serviceBuilder = new ServiceBuilder(serviceBuilderConfig)
    const service = serviceBuilder
      .allowAlgorithmNetworkAccess(false)
      .allowRawAlgorithms(false)
      .build()

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - add additionalInfo', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:bd1efbfe5efc527c0371f0db2d9302837cab242b951a15a624b7c792ba470f8e',
      nautilus
    )

    const serviceBuilderConfig = {
      aquariusAsset,
      serviceId:
        'de18fb14a671ffad7c3f67bd6d44222b64f265dc4a4a28806b30f00b01f7158a'
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

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - add another service', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
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

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.addService(service).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })

  it('edit services - remove service', async () => {
    const { aquariusAsset, nautilusDDO } = await NautilusDDO.createFromDID(
      'did:op:2ce1394d3ed258d5bcc00d2ee432fcc9dc05f2d3ef9069c57ba5319da7a03772',
      nautilus
    )

    const serviceId =
      '363bd9d775897509ac70a542747f22320aadc387fb0b07f404a128500838eb04'

    const assetBuilder = new AssetBuilder({ aquariusAsset, nautilusDDO })
    const asset = assetBuilder.removeService(serviceId).build()

    const result = await nautilus.edit(asset)

    assert(result)
  })
})
