import { describe, expect, it } from 'vitest'
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import {
  DATATOKEN_ADDRESS,
  getAssetFixture,
  getComputeAssetFixture,
  NFT_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'

type Access = ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>
type Compute = ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>

function accessBuilder(): Access {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setPricing({ type: 'free' })
}

function computeBuilder(): Compute {
  return new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setPricing({ type: 'free' })
}

const urlFile = {
  type: 'url',
  url: 'https://data.example/x.csv',
  method: 'GET'
} as never

describe('ServiceBuilder', () => {
  it('requires a service endpoint', () => {
    expect(() =>
      new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
        serviceType: ServiceTypes.ACCESS
      })
        .setPricing({ type: 'free' })
        .build()
    ).to.throw(/serviceEndpoint/)
  })

  it('requires a pricing config for a new service', () => {
    expect(() =>
      new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
        serviceType: ServiceTypes.ACCESS
      })
        .setServiceEndpoint('https://node.test.invalid')
        .build()
    ).to.throw(/pricing config/)
  })

  it('defaults the name, which DDO v5 requires', () => {
    expect(accessBuilder().build().name).to.equal('Access Service')
    expect(computeBuilder().build().name).to.equal('Compute Service')
  })

  it('sets the v5-only fields', () => {
    const service = accessBuilder()
      .setName('My Service')
      .setDisplayName('My Service, nicely')
      .setDescription('What it serves')
      .setState(1)
      .setDataSchema({
        name: 'schema',
        fileType: 'json',
        sha256: 'abc',
        mirrors: []
      })
      .build()

    expect(service.name).to.equal('My Service')
    expect(service.displayName).to.equal('My Service, nicely')
    expect(service.state).to.equal(1)
    expect(service.dataSchema?.name).to.equal('schema')
  })

  it('does not leak datatoken params between services', () => {
    const first = accessBuilder().setDatatokenNameAndSymbol('A', 'AAA').build()
    const second = accessBuilder().build()

    expect(first.datatokenCreateParams.name).to.equal('A')
    expect(second.datatokenCreateParams.name).to.equal(undefined)
  })

  it('rejects compute-only operations on an access service', () => {
    const builder = accessBuilder() as unknown as Compute

    expect(() => builder.allowRawAlgorithms()).to.throw(
      /only valid on a compute service/
    )
    expect(() => builder.addTrustedAlgorithmPublisher('0x1')).to.throw(
      /only valid on a compute service/
    )
  })

  it('sets compute options', () => {
    const service = computeBuilder()
      .allowRawAlgorithms(true)
      .allowAlgorithmNetworkAccess(true)
      .build()

    expect(service.compute.allowRawAlgorithm).to.equal(true)
    expect(service.compute.allowNetworkAccess).to.equal(true)
  })

  it('stages trusted algorithms and merges their serviceIds', () => {
    // v5 requires a serviceId per trusted algorithm, so serviceIds is finally meaningful.
    const service = computeBuilder()
      .addTrustedAlgorithms([{ did: 'did:ope:a', serviceIds: ['s1'] }])
      .addTrustedAlgorithms([{ did: 'did:ope:a', serviceIds: ['s2'] }])
      .build()

    expect(service.addedPublisherTrustedAlgorithms).to.have.length(1)
    expect(service.addedPublisherTrustedAlgorithms[0].serviceIds).to.deep.equal(
      ['s1', 's2']
    )
  })

  it('rejects an empty trusted-algorithm list', () => {
    expect(() => computeBuilder().addTrustedAlgorithms([])).to.throw(
      /no algorithms/
    )
  })

  it('distinguishes trust-all (null) from trust-none (empty)', () => {
    expect(
      computeBuilder().setAllAlgorithmsTrusted().build().compute
        .publisherTrustedAlgorithms
    ).to.equal(null)

    expect(
      computeBuilder().setAllAlgorithmsUntrusted().build().compute
        .publisherTrustedAlgorithms
    ).to.deep.equal([])
  })

  it('manages trusted publishers case-insensitively', () => {
    const service = computeBuilder()
      .addTrustedAlgorithmPublisher('0xAbC')
      .addTrustedAlgorithmPublisher('0xabc')
      .build()

    expect(service.compute.publisherTrustedAlgorithmPublishers).to.deep.equal([
      '0xAbC'
    ])

    const removed = computeBuilder()
      .addTrustedAlgorithmPublisher('0xAbC')
      .removeTrustedAlgorithmPublisher('0xABC')
      .build()

    expect(removed.compute.publisherTrustedAlgorithmPublishers).to.deep.equal(
      []
    )
  })

  it('adds per-service gating, independent of the asset', () => {
    const service = accessBuilder()
      .addCredentialAddresses(CredentialListTypes.ALLOW, ['0x1'])
      .addRequestCredentials(CredentialListTypes.ALLOW, [
        { type: 'VerifiableId' }
      ])
      .build()

    expect(service.credentials.allow?.map((entry) => entry.type)).to.deep.equal(
      ['address', 'SSIpolicy']
    )
  })
})

describe('ServiceBuilder in edit mode', () => {
  it('loads a published service', () => {
    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      asset: getAssetFixture(),
      serviceId: SERVICE_ID
    }).build()

    expect(service.editExistingService).to.equal(true)
    expect(service.id).to.equal(SERVICE_ID)
    expect(service.datatokenAddress).to.equal(DATATOKEN_ADDRESS)
    expect(service.existingEncryptedFiles).to.equal('encrypted-files-blob')
  })

  it('recovers the datatoken name and symbol from the indexed list', () => {
    // These are not on the DDO's service object, only in indexedMetadata.datatokens.
    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      asset: getAssetFixture(),
      serviceId: SERVICE_ID
    }).build()

    expect(service.datatokenCreateParams.name).to.equal('Test Access Token')
    expect(service.datatokenCreateParams.symbol).to.equal('TEST-AT')
  })

  it('carries the published compute options forward', () => {
    const service = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
      asset: getComputeAssetFixture(),
      serviceId: SERVICE_ID
    }).build()

    expect(service.compute).to.exist
    expect(service.type).to.equal('compute')
  })

  it('throws for an unknown service id, naming the asset', () => {
    expect(
      () =>
        new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
          asset: getAssetFixture(),
          serviceId: 'nope'
        })
    ).to.throw(/No service with id nope/)
  })

  it('refuses to change pricing, pointing at setServicePrice instead', () => {
    const builder = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      asset: getAssetFixture(),
      serviceId: SERVICE_ID
    })

    expect(() => builder.setPricing({ type: 'free' })).to.throw(
      /setServicePrice/
    )
  })

  it('needs no pricing config to build', () => {
    expect(() =>
      new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
        asset: getAssetFixture(),
        serviceId: SERVICE_ID
      }).build()
    ).to.not.throw()
  })

  it('reset() replays the loaded service rather than emptying it', () => {
    const builder = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      asset: getAssetFixture(),
      serviceId: SERVICE_ID
    })

    builder.setTimeout(1)
    builder.reset()

    const service = builder.build()

    expect(service.id).to.equal(SERVICE_ID)
    expect(service.timeout).to.equal(86400)
  })

  // The seeding path must deep-copy: `getService()` hands back the resolved asset's own
  // objects, and the compute/credential mutators write in place. Aliasing them
  // contaminated the caller's asset — and survived reset(), which re-seeds from it.
  describe('does not alias the resolved asset', () => {
    it('keeps compute mutations out of the source asset', () => {
      const asset = getComputeAssetFixture()
      const source = asset.credentialSubject.services[0]

      new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
        asset,
        serviceId: SERVICE_ID
      })
        .allowRawAlgorithms(true)
        .addTrustedAlgorithmPublisher('0xAbC')

      expect(source.compute?.allowRawAlgorithm).to.equal(false)
      expect(source.compute?.publisherTrustedAlgorithmPublishers).to.deep.equal(
        []
      )
    })

    it('keeps credential mutations out of the source service', () => {
      const asset = getAssetFixture()
      const source = asset.credentialSubject.services[0]
      source.credentials = {
        allow: [{ type: 'address', values: [{ address: '0x1' }] }]
      } as never

      new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
        asset,
        serviceId: SERVICE_ID
      }).addCredentialAddresses(CredentialListTypes.ALLOW, ['0x2'])

      expect(
        (source.credentials as unknown as { allow: { values: unknown[] }[] })
          .allow[0].values
      ).to.deep.equal([{ address: '0x1' }])
    })

    it('keeps added consumer parameters out of the source service', () => {
      const asset = getAssetFixture()
      const source = asset.credentialSubject.services[0] as {
        consumerParameters?: unknown[]
      }
      source.consumerParameters = [
        { name: 'a', type: 'text', label: 'A', required: false } as never
      ]

      new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
        asset,
        serviceId: SERVICE_ID
      }).addConsumerParameter({
        name: 'b',
        type: 'text',
        label: 'B',
        required: false
      } as never)

      expect(source.consumerParameters).to.have.length(1)
    })

    it('reset() discards compute mutations instead of replaying them', () => {
      const builder = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
        asset: getComputeAssetFixture(),
        serviceId: SERVICE_ID
      })

      builder.allowRawAlgorithms(true).addTrustedAlgorithmPublisher('0xAbC')
      builder.reset()

      const service = builder.build()

      expect(service.compute.allowRawAlgorithm).to.equal(false)
      expect(service.compute.publisherTrustedAlgorithmPublishers).to.deep.equal(
        []
      )
    })
  })
})

describe('NautilusService projection', () => {
  it('reuses the published ciphertext when nothing changed', async () => {
    const { client, calls } = createNodeMock()

    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      asset: getAssetFixture(),
      serviceId: SERVICE_ID
    }).build()

    const projected = await service.getOceanService(client, NFT_ADDRESS)

    expect(projected.files).to.equal('encrypted-files-blob')
    expect(projected.id).to.equal(SERVICE_ID)
    expect(calls.encrypt).to.have.length(0)
  })

  it('re-encrypts and takes a new id when the files change', async () => {
    const { client, calls } = createNodeMock({ encrypted: 'new-ciphertext' })

    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      asset: getAssetFixture(),
      serviceId: SERVICE_ID
    })
      .addFile(urlFile)
      .build()

    const projected = await service.getOceanService(client, NFT_ADDRESS)

    expect(calls.encrypt).to.have.length(1)
    expect(projected.files).to.equal('new-ciphertext')
    // The id is the hash of the ciphertext, so new files necessarily mean a new id.
    expect(projected.id).to.not.equal(SERVICE_ID)
  })

  it('binds the nft and datatoken into the encrypted file object', async () => {
    const { client, calls } = createNodeMock()

    const service = accessBuilder().addFile(urlFile).build()
    service.datatokenAddress = DATATOKEN_ADDRESS

    await service.getOceanService(client, NFT_ADDRESS)

    expect(calls.encrypt[0]).to.deep.include({
      nftAddress: NFT_ADDRESS,
      datatokenAddress: DATATOKEN_ADDRESS
    })
  })

  it('projects the v5 service shape', async () => {
    const { client } = createNodeMock()

    const service = accessBuilder()
      .setName('My Service')
      .setDescription('What it serves')
      .setTimeout(3600)
      .addFile(urlFile)
      .build()

    const projected = await service.getOceanService(
      client,
      NFT_ADDRESS,
      DATATOKEN_ADDRESS
    )

    expect(projected).to.include({
      type: 'access',
      name: 'My Service',
      datatokenAddress: DATATOKEN_ADDRESS,
      timeout: 3600,
      state: 0
    })
    expect(projected.description).to.deep.equal({
      '@value': 'What it serves',
      '@language': 'en',
      '@direction': 'ltr'
    })
    expect(projected).to.have.property('credentials')
  })

  it('only emits compute options for a compute service', async () => {
    const { client } = createNodeMock()

    const access = accessBuilder().addFile(urlFile).build()
    const compute = computeBuilder().addFile(urlFile).build()

    expect(
      await access.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS)
    ).to.not.have.property('compute')
    expect(
      await compute.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS)
    ).to.have.property('compute')
  })

  it('needs a datatoken address', async () => {
    const { client } = createNodeMock()
    const service = accessBuilder().addFile(urlFile).build()

    await expectThrowsAsync(
      () => service.getOceanService(client, NFT_ADDRESS),
      /datatokenAddress is required/
    )
  })

  it('needs at least one file when there is nothing to reuse', async () => {
    const { client } = createNodeMock()
    const service = accessBuilder().build()

    await expectThrowsAsync(
      () => service.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS),
      /no files were added/
    )
  })

  it('rejects an endpoint that does not answer as an ocean-node', async () => {
    const { client } = createNodeMock({ validNode: false })
    const service = accessBuilder().addFile(urlFile).build()

    await expectThrowsAsync(
      () => service.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS),
      /does not answer as an ocean-node/
    )
  })

  it('says which file the node could not read', async () => {
    // v1 reported only "some of the provided files could not be validated".
    const { client } = createNodeMock({ fileInfoValid: false })
    const service = accessBuilder().setName('Broken').addFile(urlFile).build()

    await expectThrowsAsync(
      () => service.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS),
      /could not read file 0 of service Broken/
    )
  })
})
