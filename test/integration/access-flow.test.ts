import { Aquarius } from '@oceanprotocol/lib'
import assert from 'assert'
import { AssetBuilder, LogLevel, Nautilus } from '../../src'
import {
  FileTypes,
  ServiceBuilder,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service'
import {
  algorithmMetadata,
  algorithmService,
  getPricing
} from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { nftParams } from '../fixtures/NftCreateData'
import { MUMBAI_NODE_URI, getSigner } from '../fixtures/Ethers'
import { expect } from 'chai'

describe('Access Flow Integration', function () {
  let downloadAssetDid: string
  let serviceEndpoint: string

  this.timeout(70000)

  before(() => {
    Nautilus.setLogLevel(LogLevel.Verbose)
  })

  // 1. Publish Download Asset -> store did
  it('publishes a download asset', async () => {
    // Setup Nautilus instance for publisher (PRIVATE_KEY_TESTS_1)
    const signer = getSigner(1, MUMBAI_NODE_URI)
    const nautilus = await Nautilus.create(signer, await getTestConfig(signer))

    const { providerUri } = nautilus.getOceanConfig()
    serviceEndpoint = providerUri

    const serviceBuilder = new ServiceBuilder({
      serviceType: ServiceTypes.ACCESS,
      fileType: FileTypes.URL
    })
    const service = serviceBuilder
      .setServiceEndpoint(serviceEndpoint)
      .setTimeout(algorithmService.timeout)
      .addFile(algorithmService.files[0])
      .setPricing(await getPricing(signer, 'free'))
      .build()

    const assetBuilder = new AssetBuilder()
    const asset = assetBuilder
      .setAuthor('testAuthor')
      .setDescription('A publishing test with custom userdata')
      .setLicense('MIT')
      .setName('Test Publish Algorithm')
      .setOwner(await signer.getAddress())
      .setType('algorithm')
      .setNftData(nftParams)
      .addService(service)
      .setAlgorithm(algorithmMetadata.algorithm)
      .build()

    const result = await nautilus.publish(asset)

    assert(result)

    downloadAssetDid = result.ddo.id
  })

  // 2. Access the Download Asset (1.)
  it('accesses a download asset', async () => {
    // Setup Nautilus instance for consumer (PRIVATE_KEY_TESTS_2)
    const signer = getSigner(2, MUMBAI_NODE_URI)
    const nautilus = await Nautilus.create(signer, await getTestConfig(signer))

    // wait until ddo is found in metadata cache
    const aquarius = new Aquarius(nautilus.getOceanConfig().metadataCacheUri)
    console.log(
      `Waiting for aquarius at ${aquarius.aquariusURL} to access ${downloadAssetDid}`
    )
    await aquarius.waitForAqua(downloadAssetDid)

    const accessUrl = await nautilus.access({
      assetDid: downloadAssetDid
    })

    expect(accessUrl).to.match(new RegExp(serviceEndpoint))
  })
})
