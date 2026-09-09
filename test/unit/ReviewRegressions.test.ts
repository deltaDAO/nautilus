/**
 * Regressions from the 2.0.0 review pass.
 *
 * Each test here pins a behaviour that was wrong in a way the type checker could not see:
 * state shared between instances, a baseline silently dropped, a fallback that answered the
 * wrong question. They live together because they are one review's worth of findings; the
 * behaviours themselves belong to the modules named in each `describe`.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import { describe, expect, it } from 'vitest'
import {
  getDatatokenForService,
  getStatsForService
} from '../../src/ddo/read.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import {
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'

function computeBuilder(endpoint = 'https://node.test.invalid') {
  return new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(endpoint)
    .setName('Compute Service')
    .setPricing({ type: 'free' })
    .addFile({
      type: 'url',
      url: 'https://files.test.invalid/a.csv',
      method: 'GET'
    })
}

describe('NautilusService compute state', () => {
  it('does not share trusted-algorithm lists between services', () => {
    // The compute block used to be spread from one module-level constant, which copied the
    // object but not its arrays — so every service pushed into the same two lists and
    // silently widened each other's execution policy.
    const first = computeBuilder()
      .addTrustedAlgorithmPublisher(
        '0x1111111111111111111111111111111111111111'
      )
      .build()

    const second = computeBuilder().build()

    expect(first.compute.publisherTrustedAlgorithmPublishers).to.deep.equal([
      '0x1111111111111111111111111111111111111111'
    ])
    expect(second.compute.publisherTrustedAlgorithmPublishers).to.deep.equal([])
    expect(second.compute.publisherTrustedAlgorithms).to.deep.equal([])
  })
})

describe('NautilusService projection', () => {
  it('encrypts and file-checks on the node the service advertises', async () => {
    // Node encryption keys are node-local: ciphertext from the configured node is one the
    // advertised node cannot decrypt, which makes the published service dead on arrival.
    const { client, calls } = createNodeMock()

    const service = computeBuilder('https://other-node.test.invalid').build()

    await service.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS)

    expect(calls.encryptTargets).to.deep.equal([
      'https://other-node.test.invalid'
    ])
    expect(calls.fileInfoTargets).to.deep.equal([
      'https://other-node.test.invalid'
    ])
  })

  it('runs the endpoint and file checks once, however often it is asked', async () => {
    // The publish preflight and the projection that follows it must not each pay for the
    // same round trips.
    const { client, calls } = createNodeMock()

    const service = computeBuilder().build()

    await service.assertPublishable(client)
    await service.getOceanService(client, NFT_ADDRESS, DATATOKEN_ADDRESS)

    expect(calls.getFileInfo).to.have.length(1)
  })

  it('rejects an unreadable file before anything is encrypted', async () => {
    const { client, calls } = createNodeMock({ fileInfoValid: false })

    const service = computeBuilder().build()

    await expectThrowsAsync(
      () => service.assertPublishable(client),
      /could not read file/i
    )

    expect(calls.encrypt).to.have.length(0)
  })

  it('rejects an endpoint that does not answer as an ocean-node', async () => {
    const { client } = createNodeMock({ validNode: false })

    await expectThrowsAsync(
      () => computeBuilder().build().assertPublishable(client),
      /does not answer as an ocean-node/i
    )
  })
})

describe('AssetBuilder edits', () => {
  /** The DDO an edit would publish, with the file object already encrypted. */
  async function editedDdo(build: (builder: AssetBuilder) => AssetBuilder) {
    const { client } = createNodeMock()
    const asset = build(new AssetBuilder(getAssetFixture())).build()

    return asset.ddo.getDDO(client, { create: false })
  }

  it('extends the published tags rather than replacing them', async () => {
    // The builder's own metadata started empty, so `addTags` appended to nothing and the
    // projection then assigned that over the baseline — dropping every existing tag.
    const ddo = await editedDdo((builder) => builder.addTags(['new']))

    const { metadata } = (ddo as unknown as AssetV5).credentialSubject

    expect(metadata.tags).to.deep.equal(['test', 'new'])
  })

  it('extends the published categories rather than replacing them', async () => {
    const ddo = await editedDdo((builder) => builder.addCategories(['extra']))

    const { metadata } = (ddo as unknown as AssetV5).credentialSubject

    expect(metadata.categories).to.deep.equal(['testing', 'extra'])
  })

  it('keeps the published tags when the edit does not touch them', async () => {
    const ddo = await editedDdo((builder) => builder.setAuthor('someone else'))

    const { metadata } = (ddo as unknown as AssetV5).credentialSubject

    expect(metadata.tags).to.deep.equal(['test'])
    expect(metadata.author).to.equal('someone else')
  })
})

describe('getStatsForService', () => {
  it('answers for the service that was asked about', () => {
    expect(
      getStatsForService(getAssetFixture(), SERVICE_ID)?.datatokenAddress
    ).to.equal(DATATOKEN_ADDRESS)
  })

  it('returns undefined rather than another service’s stats', () => {
    // Falling back to stats[0] handed back whichever service the indexer listed first,
    // which then resolved the wrong datatoken and ordered the wrong service.
    expect(getStatsForService(getAssetFixture(), 'not-a-service-id')).to.equal(
      undefined
    )
  })

  it('does not resolve a datatoken for an unknown service', () => {
    const asset = getAssetFixture()

    // Strip the per-service datatoken so the lookup has to fall through to stats.
    const { services } = (asset as unknown as AssetV5).credentialSubject
    for (const service of services)
      (service as { datatokenAddress?: string }).datatokenAddress = undefined

    expect(getDatatokenForService(asset, 'not-a-service-id')).to.equal(
      undefined
    )
  })
})

// `getOrderPrice` and the fee routing around it live in PricingRouting.test.ts, together
// with the exchange selection they depend on.
