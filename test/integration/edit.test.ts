import type { AssetV5 } from '@oceanprotocol/ddo-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { LifecycleStates } from '../../src/@types/Nautilus.js'
import { fromLanguageValue } from '../../src/ddo/language.js'
import {
  getCredentials,
  getLifecycleState,
  getMetadata,
  getServices
} from '../../src/ddo/read.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  AssetBuilder,
  type FileTypes,
  type Nautilus,
  ServiceBuilder,
  type ServiceTypes
} from '../../src/index.js'
import { datasetFile } from '../fixtures/AssetConfig.js'
import { getNodeUri } from '../fixtures/Config.js'
import { getConsumerParameters } from '../fixtures/ConsumerParameters.js'
import {
  computeService,
  createPublisher,
  freeAlgorithm,
  freeDataset,
  integrationEnabled,
  publishAndIndex
} from './helpers.js'

/**
 * The edit suite is the richest behavioural contract in the repo, and the best regression
 * net for the migration: every case republishes a real asset and re-resolves it, so a
 * projection bug shows up as a wrong field rather than a type error.
 */
describe('edit', () => {
  if (!integrationEnabled) {
    it.skip('needs PRIVATE_KEY_TESTS_1/2 and NODE_URL to run', () => {})
    return
  }

  let nautilus: Nautilus
  let asset: AssetV5
  let serviceId: string

  /**
   * Polls until the indexer reports the expected lifecycle state.
   *
   * Deliberately not `waitForIndexer(did, txid)`: that waits for
   * `indexedMetadata.event.txid` to equal the hash, and the indexer only writes
   * that field for MetadataCreated/Updated. A MetadataState change never
   * updates it, so passing the hash here waits forever. Without a hash the call
   * returns the currently-indexed DDO immediately, which is the pre-change one.
   * So poll the thing we actually care about.
   */
  async function settleLifecycleState(
    did: string,
    expected: number,
    attempts = 30,
    intervalMs = 2000
  ): Promise<AssetV5> {
    let latest: AssetV5 | undefined

    for (let attempt = 0; attempt < attempts; attempt++) {
      latest = await nautilus.waitForIndexer(did)

      if (latest && getLifecycleState(latest) === expected) return latest

      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(
      `Indexer never reported lifecycle state ${expected} for ${did} ` +
        `(last saw ${latest ? getLifecycleState(latest) : 'no asset'}).`
    )
  }

  /** Republishes and re-resolves, so every assertion reads what the indexer actually has. */
  async function apply(
    mutate: (builder: AssetBuilder) => AssetBuilder
  ): Promise<AssetV5> {
    const builder = mutate(new AssetBuilder(asset))
    const result = await nautilus.edit(builder.build())

    const indexed = await nautilus.waitForIndexer(
      result.ddo.id as string,
      result.setMetadataTxReceipt.hash
    )

    asset = indexed || (await nautilus.getAsset(result.ddo.id as string))

    return asset
  }

  beforeAll(async () => {
    nautilus = await createPublisher()

    const published = await publishAndIndex(nautilus, freeDataset())

    asset = await nautilus.getAsset(published.ddo.id as string)
    serviceId = getServices(asset)[0].id
  })

  describe('metadata', () => {
    it('renames the asset without losing the other fields', async () => {
      const before = getMetadata(asset)
      const edited = await apply((builder) =>
        builder.setName('Renamed Dataset')
      )
      const after = getMetadata(edited)

      expect(after.name).to.equal('Renamed Dataset')
      // A shallow top-level merge would have dropped these.
      expect(after.author).to.equal(before.author)
      expect(after.providedBy).to.equal(before.providedBy)
      expect(after.created).to.equal(before.created)
    })

    it('bumps updated but keeps created', async () => {
      const before = getMetadata(asset)
      const after = getMetadata(
        await apply((builder) => builder.setName('Renamed Again'))
      )

      expect(after.created).to.equal(before.created)
      expect(after.updated).to.not.equal(before.updated)
    })

    it('edits the language-tagged description', async () => {
      const edited = await apply((builder) =>
        builder.setDescription('A new description')
      )

      expect(fromLanguageValue(getMetadata(edited).description)).to.equal(
        'A new description'
      )
    })

    it('edits the structured license', async () => {
      const edited = await apply((builder) =>
        builder.setLicense({ name: 'CC-BY-4.0' })
      )

      expect(getMetadata(edited).license?.name).to.equal('CC-BY-4.0')
    })

    it('edits the author and copyright holder', async () => {
      const edited = await apply((builder) =>
        builder.setAuthor('Someone Else').setCopyrightHolder('Someone Else Ltd')
      )

      expect(getMetadata(edited).author).to.equal('Someone Else')
      expect(getMetadata(edited).copyrightHolder).to.equal('Someone Else Ltd')
    })

    it('adds tags and categories', async () => {
      const edited = await apply((builder) =>
        builder.addTags(['edited']).addCategories(['integration'])
      )

      expect(getMetadata(edited).tags).to.include('edited')
      expect(getMetadata(edited).categories).to.include('integration')
    })

    it('adds links as the v5 map', async () => {
      const edited = await apply((builder) =>
        builder.addLinks({ docs: 'https://docs.example' })
      )

      expect(getMetadata(edited).links).to.deep.include({
        docs: 'https://docs.example'
      })
    })

    it('adds additional information', async () => {
      const edited = await apply((builder) =>
        builder.addAdditionalInformation({ termsAccepted: true })
      )

      expect(getMetadata(edited).additionalInformation).to.deep.include({
        termsAccepted: true
      })
    })

    it('sets the display title', async () => {
      const edited = await apply((builder) =>
        builder.setDisplayTitle('A nicer title')
      )

      expect(fromLanguageValue(getMetadata(edited).displayTitle)).to.equal(
        'A nicer title'
      )
    })
  })

  describe('credentials', () => {
    const consumer = '0x0000000000000000000000000000000000000001'

    it('adds an allow address', async () => {
      const edited = await apply((builder) =>
        builder.addCredentialAddresses(CredentialListTypes.ALLOW, [consumer])
      )

      expect(JSON.stringify(getCredentials(edited).allow)).to.contain(consumer)
    })

    it('removes an allow address', async () => {
      const edited = await apply((builder) =>
        builder.removeCredentialAddresses(CredentialListTypes.ALLOW, [consumer])
      )

      expect(JSON.stringify(getCredentials(edited).allow)).to.not.contain(
        consumer
      )
    })

    it('adds a deny address', async () => {
      const edited = await apply((builder) =>
        builder.addCredentialAddresses(CredentialListTypes.DENY, [consumer])
      )

      expect(JSON.stringify(getCredentials(edited).deny)).to.contain(consumer)
    })

    it('removes a deny address', async () => {
      const edited = await apply((builder) =>
        builder.removeCredentialAddresses(CredentialListTypes.DENY, [consumer])
      )

      expect(JSON.stringify(getCredentials(edited).deny)).to.not.contain(
        consumer
      )
    })

    it('adds the SSIpolicy block', async () => {
      const edited = await apply((builder) =>
        builder
          .addRequestCredentials(CredentialListTypes.ALLOW, [
            { type: 'VerifiableId', format: 'jwt_vc_json' }
          ])
          .setVcPolicies(CredentialListTypes.ALLOW, ['signature'])
      )

      const ssi = getCredentials(edited).allow?.find(
        (entry) => entry.type === 'SSIpolicy'
      )

      expect(ssi).to.exist
      expect(JSON.stringify(ssi)).to.contain('request_credentials')
    })

    it('sets the match rules', async () => {
      const edited = await apply((builder) =>
        builder.setCredentialMatchRules({ match_allow: 'any' })
      )

      expect(getCredentials(edited).match_allow).to.equal('any')
    })
  })

  describe('lifecycle', () => {
    it('unlists the asset through the builder', async () => {
      const edited = await apply((builder) =>
        builder.setLifecycleState(LifecycleStates.ASSET_UNLISTED)
      )

      expect(getLifecycleState(edited)).to.equal(LifecycleStates.ASSET_UNLISTED)
    })

    it('reactivates the asset through setAssetLifecycleState', async () => {
      await nautilus.setAssetLifecycleState(asset, LifecycleStates.ACTIVE)

      asset = await settleLifecycleState(asset.id, LifecycleStates.ACTIVE)

      expect(getLifecycleState(asset)).to.equal(LifecycleStates.ACTIVE)
    })

    it('is a no-op when the state already matches', async () => {
      expect(
        await nautilus.setAssetLifecycleState(asset, LifecycleStates.ACTIVE)
      ).to.equal(undefined)
    })
  })

  describe('services', () => {
    function editService() {
      return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
        asset,
        serviceId
      })
    }

    it('renames a service', async () => {
      const edited = await apply((builder) =>
        builder.addService(editService().setName('Renamed Service').build())
      )

      expect(getServices(edited)[0].name).to.equal('Renamed Service')
    })

    it('edits the service description and timeout', async () => {
      const edited = await apply((builder) =>
        builder.addService(
          editService()
            .setDescription('What it serves')
            .setTimeout(7200)
            .build()
        )
      )

      const service = getServices(edited)[0]

      expect(service.timeout).to.equal(7200)
      expect(fromLanguageValue(service.description)).to.equal('What it serves')
    })

    it('adds a consumer parameter', async () => {
      const edited = await apply((builder) =>
        builder.addService(
          editService().addConsumerParameter(getConsumerParameters()[0]).build()
        )
      )

      expect(
        getServices(edited)[0].consumerParameters?.length
      ).to.be.greaterThan(0)
    })

    it('replaces the files object, which changes the service id', async () => {
      // The service id is the hash of the encrypted file object, so new files necessarily
      // produce a new id and the old service entry must not survive alongside it.
      const before = getServices(asset)[0].id

      const edited = await apply((builder) =>
        builder.addService(editService().addFile(datasetFile).build())
      )

      expect(getServices(edited)).to.have.length(1)
      expect(getServices(edited)[0].id).to.not.equal(before)

      serviceId = getServices(edited)[0].id
    })

    it('adds a second service', async () => {
      const edited = await apply((builder) =>
        builder.addService(
          computeService().setPricing({ type: 'free' }).build()
        )
      )

      expect(getServices(edited)).to.have.length(2)
    })

    it('removes a service again', async () => {
      const extra = getServices(asset).find(
        (service) => service.id !== serviceId
      )

      const edited = await apply((builder) =>
        builder.removeService(extra?.id as string)
      )

      expect(getServices(edited)).to.have.length(1)
      expect(getServices(edited)[0].id).to.equal(serviceId)
    })
  })

  describe('compute options', () => {
    let computeAsset: AssetV5
    let computeServiceId: string
    let algorithmDid: string

    async function applyCompute(
      mutate: (builder: AssetBuilder) => AssetBuilder
    ): Promise<AssetV5> {
      const result = await nautilus.edit(
        mutate(new AssetBuilder(computeAsset)).build()
      )

      computeAsset =
        (await nautilus.waitForIndexer(
          result.ddo.id as string,
          result.setMetadataTxReceipt.hash
        )) || (await nautilus.getAsset(result.ddo.id as string))

      return computeAsset
    }

    function editComputeService() {
      return new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
        asset: computeAsset,
        serviceId: computeServiceId
      })
    }

    beforeAll(async () => {
      const dataset = new AssetBuilder()
        .setType('dataset')
        .setName('Nautilus Compute Dataset')
        .setDescription('For compute-option edits')
        .setProvidedBy('deltaDAO AG')
        .addService(
          computeService(getNodeUri()).setPricing({ type: 'free' }).build()
        )
        .build()

      const published = await publishAndIndex(nautilus, dataset)
      computeAsset = await nautilus.getAsset(published.ddo.id as string)
      computeServiceId = getServices(computeAsset)[0].id

      const algorithm = await publishAndIndex(nautilus, freeAlgorithm())
      algorithmDid = algorithm.ddo.id as string
    })

    it('allows raw algorithms', async () => {
      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService().allowRawAlgorithms(true).build()
        )
      )

      expect(getServices(edited)[0].compute?.allowRawAlgorithm).to.equal(true)
    })

    it('allows algorithm network access', async () => {
      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService().allowAlgorithmNetworkAccess(true).build()
        )
      )

      expect(getServices(edited)[0].compute?.allowNetworkAccess).to.equal(true)
    })

    it('adds a trusted algorithm publisher', async () => {
      const publisher = await nautilus.getSigner().getAddress()

      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService().addTrustedAlgorithmPublisher(publisher).build()
        )
      )

      expect(
        getServices(edited)[0].compute?.publisherTrustedAlgorithmPublishers
      ).to.include(publisher)
    })

    it('removes a trusted algorithm publisher', async () => {
      const publisher = await nautilus.getSigner().getAddress()

      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService()
            .removeTrustedAlgorithmPublisher(publisher)
            .build()
        )
      )

      expect(
        getServices(edited)[0].compute?.publisherTrustedAlgorithmPublishers
      ).to.not.include(publisher)
    })

    it('trusts an algorithm, pinning it per service', async () => {
      // v5 requires a serviceId on each trusted algorithm; v4 could only pin services[0].
      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService()
            .addTrustedAlgorithms([{ did: algorithmDid }])
            .build()
        )
      )

      const trusted =
        getServices(edited)[0].compute?.publisherTrustedAlgorithms || []

      expect(trusted).to.have.length(1)
      expect(trusted[0].did).to.equal(algorithmDid)
      expect(trusted[0].serviceId).to.be.a('string').and.not.empty
      expect(trusted[0].filesChecksum).to.be.a('string').and.not.empty
      expect(trusted[0].containerSectionChecksum).to.be.a('string').and.not
        .empty
    })

    it('untrusts every algorithm', async () => {
      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService().setAllAlgorithmsUntrusted().build()
        )
      )

      expect(
        getServices(edited)[0].compute?.publisherTrustedAlgorithms
      ).to.deep.equal([])
    })

    it('trusts every algorithm', async () => {
      const edited = await applyCompute((builder) =>
        builder.addService(
          editComputeService().setAllAlgorithmsTrusted().build()
        )
      )

      expect(
        getServices(edited)[0].compute?.publisherTrustedAlgorithms
      ).to.equal(null)
    })
  })

  describe('errors', () => {
    it('refuses to edit an asset that was not built from a resolved DDO', async () => {
      let message = ''
      try {
        await nautilus.edit(freeDataset())
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).to.match(/built from a resolved DDO/)
    })
  })
})
