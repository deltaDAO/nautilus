import { describe, expect, it } from 'vitest'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { resolvePublisherTrustedAlgorithms } from '../../src/utils/helpers/trusted-algorithms.js'
import {
  getAlgorithmAssetFixture,
  getAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'

const ALGO_DID = 'did:ope:algorithm'

function computeService() {
  return new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setPricing({ type: 'free' })
}

function algorithmAsset() {
  const asset = getAlgorithmAssetFixture()
  asset.id = ALGO_DID
  return asset
}

describe('resolvePublisherTrustedAlgorithms', () => {
  it('resolves a staged algorithm into a v5 entry carrying a serviceId', async () => {
    // v4 had no serviceId, so v1 could only ever pin services[0] and said so in a TODO.
    const { client } = createNodeMock({
      assets: { [ALGO_DID]: algorithmAsset() },
      fileChecksum: 'the-files-checksum'
    })

    const service = computeService()
      .addTrustedAlgorithms([{ did: ALGO_DID }])
      .build()

    await resolvePublisherTrustedAlgorithms(client, [service])

    expect(service.compute.publisherTrustedAlgorithms).to.have.length(1)
    expect(service.compute.publisherTrustedAlgorithms[0]).to.deep.include({
      did: ALGO_DID,
      serviceId: SERVICE_ID,
      filesChecksum: 'the-files-checksum'
    })
    expect(
      service.compute.publisherTrustedAlgorithms[0].containerSectionChecksum
    ).to.be.a('string').and.not.empty
  })

  it('resolves one entry per named service', async () => {
    const asset = algorithmAsset()
    asset.credentialSubject.services.push({
      ...asset.credentialSubject.services[0],
      id: 'second-compute-service'
    })

    const { client, calls } = createNodeMock({ assets: { [ALGO_DID]: asset } })

    const service = computeService()
      .addTrustedAlgorithms([
        { did: ALGO_DID, serviceIds: [SERVICE_ID, 'second-compute-service'] }
      ])
      .build()

    await resolvePublisherTrustedAlgorithms(client, [service])

    expect(service.compute.publisherTrustedAlgorithms).to.have.length(2)
    expect(
      service.compute.publisherTrustedAlgorithms.map((entry) => entry.serviceId)
    ).to.deep.equal([SERVICE_ID, 'second-compute-service'])
    expect(calls.checkDidFiles).to.have.length(2)
  })

  it('refuses to trust an asset that is not an algorithm', async () => {
    const dataset = getAssetFixture()
    dataset.id = ALGO_DID

    const { client } = createNodeMock({ assets: { [ALGO_DID]: dataset } })
    const service = computeService()
      .addTrustedAlgorithms([{ did: ALGO_DID }])
      .build()

    await expectThrowsAsync(
      () => resolvePublisherTrustedAlgorithms(client, [service]),
      /cannot be trusted as an algorithm/
    )
  })

  it('names the available services when the requested one does not exist', async () => {
    const { client } = createNodeMock({
      assets: { [ALGO_DID]: algorithmAsset() }
    })

    const service = computeService()
      .addTrustedAlgorithms([{ did: ALGO_DID, serviceIds: ['nope'] }])
      .build()

    await expectThrowsAsync(
      () => resolvePublisherTrustedAlgorithms(client, [service]),
      /has no service with id nope/
    )
  })

  it('leaves a trust-all service untouched', async () => {
    const { client } = createNodeMock({
      assets: { [ALGO_DID]: algorithmAsset() }
    })

    const service = computeService()
      .addTrustedAlgorithms([{ did: ALGO_DID }])
      .setAllAlgorithmsTrusted()
      .build()

    // setAllAlgorithmsTrusted clears the staging list, so there is nothing to resolve.
    await resolvePublisherTrustedAlgorithms(client, [service])

    expect(service.compute.publisherTrustedAlgorithms).to.equal(null)
  })

  it('does nothing when no algorithms are staged', async () => {
    const { client, calls } = createNodeMock()

    await resolvePublisherTrustedAlgorithms(client, [computeService().build()])

    expect(calls.resolve).to.have.length(0)
  })

  it('replaces an existing entry whose checksum moved', async () => {
    const { client } = createNodeMock({
      assets: { [ALGO_DID]: algorithmAsset() },
      fileChecksum: 'new-checksum'
    })

    const service = computeService()
      .addTrustedAlgorithms([{ did: ALGO_DID }])
      .build()
    service.compute.publisherTrustedAlgorithms = [
      {
        did: ALGO_DID,
        serviceId: SERVICE_ID,
        filesChecksum: 'stale',
        containerSectionChecksum: 'stale'
      }
    ]

    await resolvePublisherTrustedAlgorithms(client, [service])

    expect(service.compute.publisherTrustedAlgorithms).to.have.length(1)
    expect(
      service.compute.publisherTrustedAlgorithms[0].filesChecksum
    ).to.equal('new-checksum')
  })
})
