import { beforeAll, describe, expect, it } from 'vitest'
import {
  getCredentials,
  getIndexedMetadata,
  getServices,
  getVersion
} from '../../src/ddo/read.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import { validate } from '../../src/ddo/validate.js'
import {
  AssetBuilder,
  IndexingError,
  Nautilus,
  NodePersistentRemoteStore,
  type PublishedNotIndexed,
  type RemoteStore
} from '../../src/index.js'
import { datasetMetadata } from '../fixtures/AssetConfig.js'
import { getConsumerParameters } from '../fixtures/ConsumerParameters.js'
import {
  accessService,
  computeService,
  createPublisher,
  createTestRemoteStore,
  freeAlgorithm,
  freeDataset,
  integrationEnabled,
  publishAndIndex,
  settledIndexingState
} from './helpers.js'

describe('publish', () => {
  if (!integrationEnabled) {
    it.skip('needs PRIVATE_KEY_TESTS_1/2 and NODE_URL to run', () => {})
    return
  }

  let nautilus: Nautilus

  beforeAll(async () => {
    nautilus = await createPublisher()
  })

  it('publishes a free dataset and returns a v5 DDO', async () => {
    const result = await publishAndIndex(nautilus, freeDataset())

    expect(result.nftAddress).to.be.a('string')
    expect(result.services).to.have.length(1)
    expect(result.services[0].datatokenAddress).to.be.a('string')
    expect(result.setMetadataTxReceipt.status).to.equal(1)

    expect(getVersion(result.ddo)).to.equal('5.0.0')
    expect(result.ddo.id).to.match(/^did:ope:/)
    expect(result.indexed).to.equal(true)
  })

  it('resolves through getAsset, and the node records the event as valid', async () => {
    const result = await publishAndIndex(nautilus, freeDataset())

    const asset = await nautilus.getAsset(result.ddo.id as string)
    expect(asset.id).to.equal(result.ddo.id)
    expect(getIndexedMetadata(asset)?.event?.txid).to.equal(
      result.setMetadataTxReceipt.hash
    )

    const state = await settledIndexingState(nautilus, {
      did: result.ddo.id as string,
      txId: result.setMetadataTxReceipt.hash
    })
    expect(state.did).to.equal(result.ddo.id)
    expect(state.valid).to.equal(true)
    expect((state.error ?? '').trim()).to.equal('')

    // ocean-node 4.2's success record: filed under the did:ope: DID, no nft, blank txId.
    expect(state.nft).to.equal(undefined)
    expect((state.txId ?? '').trim()).to.equal('')

    // What went to the store is what the chain hashes, and the pointer handed back carries
    // no secret.
    const store = (process.env.DDO_STORE || 'ipfs').toLowerCase()
    expect(result.stored.pointer.type).to.equal(store)
    expect(result.stored.metadataHash).to.match(/^0x[0-9a-f]{64}$/)
    if (store === 's3')
      expect(
        (result.stored.pointer as { s3Access: { secretAccessKey: string } })
          .s3Access.secretAccessKey
      ).to.equal('<redacted>')
  })

  it("fails fast with the node's IndexingError when the stored DDO is broken", async () => {
    // A store that changes what it is given: the node's hash check rejects it. The
    // failure must surface from the node's state record, well before the timeout.
    const inner = createTestRemoteStore()
    const tampering: RemoteStore = {
      put: (payload, hint) =>
        inner.put(
          JSON.stringify({ ...JSON.parse(payload), tampered: true }),
          hint
        )
    }

    const timeoutMs = 600_000
    const started = Date.now()

    let error: unknown
    try {
      await nautilus.publish(freeDataset(), {
        remoteStore: tampering,
        waitForIndexer: { timeoutMs }
      })
    } catch (thrown) {
      error = thrown
    }

    expect(error).to.be.instanceOf(IndexingError)
    expect((error as Error).message).to.match(/Hash check failed/)
    expect(Date.now() - started).to.be.lessThan(timeoutMs)

    // ocean-node 4.2's failure record for a MetadataCreated: the tx is in it.
    const failure = (error as IndexingError).state
    expect(failure.valid).to.equal(false)
    expect(failure.txId?.toLowerCase()).to.equal(
      (error as IndexingError).txId?.toLowerCase()
    )

    // The metadata is on chain, so the result is not lost.
    const { published } = error as PublishedNotIndexed
    expect(published.nftAddress).to.be.a('string')
    expect(published.setMetadataTxReceipt.hash).to.equal(
      (error as IndexingError).txId
    )
  })

  it('refuses NodePersistentRemoteStore for DDOs before any transaction', async () => {
    const before = await nautilus.getSigner().getNonce()

    let message = ''
    try {
      await nautilus.publish(freeDataset(), {
        remoteStore: new NodePersistentRemoteStore(nautilus.getNodeClient())
      })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).to.match(/Use an IpfsRemoteStore or an S3RemoteStore/)
    expect(await nautilus.getSigner().getNonce()).to.equal(before)
  })

  it('signs the DDO as a verifiable credential', async () => {
    const result = await publishAndIndex(nautilus, freeDataset())

    expect(result.credential?.jwt.split('.')).to.have.length(3)
    expect(result.credential?.issuer).to.be.a('string')
  })

  it('produces a DDO that passes local validation', async () => {
    const result = await publishAndIndex(nautilus, freeDataset())
    const { valid, errors } = await validate(result.ddo)

    expect(errors).to.deep.equal({})
    expect(valid).to.equal(true)
  })

  it('publishes a fixed-price dataset', async () => {
    const config = nautilus.getOceanConfig()

    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Nautilus Fixed Price Dataset')
      .setDescription(datasetMetadata.description as string)
      .setProvidedBy('deltaDAO AG')
      .setAuthor('deltaDAO')
      .addService(
        accessService()
          .setPricing({
            type: 'fixed',
            freCreationParams: {
              fixedRateAddress: config.fixedRateExchangeAddress as string,
              baseTokenAddress: config.oceanTokenAddress as string,
              marketFeeCollector: await nautilus.getSigner().getAddress(),
              baseTokenDecimals: 18,
              datatokenDecimals: 18,
              fixedRate: '1',
              marketFee: '0',
              withMint: true
            }
          })
          .build()
      )
      .build()

    const result = await publishAndIndex(nautilus, asset)

    expect(result.services).to.have.length(1)
  })

  it('publishes a multi-service asset', async () => {
    // The bundle transaction covers the first service; each further one gets its own
    // datatoken on the same NFT.
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Nautilus Multi-Service Dataset')
      .setDescription('Two services on one NFT')
      .setProvidedBy('deltaDAO AG')
      .addService(accessService().setPricing({ type: 'free' }).build())
      .addService(computeService().setPricing({ type: 'free' }).build())
      .build()

    const result = await publishAndIndex(nautilus, asset)

    expect(result.services).to.have.length(2)
    expect(getServices(result.ddo)).to.have.length(2)
    expect(
      getServices(result.ddo).map((service) => service.type)
    ).to.have.members(['access', 'compute'])
  })

  it('publishes an algorithm', async () => {
    const result = await publishAndIndex(nautilus, freeAlgorithm())

    expect(result.ddo.id).to.match(/^did:ope:/)
  })

  it('publishes consumer parameters as a structured array', async () => {
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Nautilus Dataset With Parameters')
      .setDescription('Carries consumer parameters')
      .setProvidedBy('deltaDAO AG')
      .addService(
        (() => {
          const builder = accessService().setPricing({ type: 'free' })
          for (const parameter of getConsumerParameters())
            builder.addConsumerParameter(parameter)
          return builder.build()
        })()
      )
      .build()

    const result = await publishAndIndex(nautilus, asset)
    const parameters = getServices(result.ddo)[0].consumerParameters

    expect(parameters).to.have.length(4)
    // v5 keeps options structured; v4 encoded them as a JSON string.
    const select = parameters?.find((parameter) => parameter.type === 'select')
    expect(select?.options).to.be.an('array')
  })

  it('publishes address-gated credentials', async () => {
    const consumer = await nautilus.getSigner().getAddress()

    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Nautilus Gated Dataset')
      .setDescription('Restricted to one address')
      .setProvidedBy('deltaDAO AG')
      .addCredentialAddresses(CredentialListTypes.ALLOW, [consumer])
      .addService(accessService().setPricing({ type: 'free' }).build())
      .build()

    const result = await publishAndIndex(nautilus, asset)
    expect(getCredentials(result.ddo).allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: consumer }]
    })
  })

  it('publishes an SSI-gated asset in the shape the policy server parses', async () => {
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Nautilus SSI Dataset')
      .setDescription('Requires a verifiable credential')
      .setProvidedBy('deltaDAO AG')
      .addRequestCredentials(CredentialListTypes.ALLOW, [
        { type: 'VerifiableId', format: 'jwt_vc_json' }
      ])
      .setVcPolicies(CredentialListTypes.ALLOW, ['signature'])
      .addService(accessService().setPricing({ type: 'free' }).build())
      .build()

    const result = await publishAndIndex(nautilus, asset)
    const ssi = getCredentials(result.ddo).allow?.find(
      (entry) => entry.type === 'SSIpolicy'
    )

    expect(ssi).to.exist
    // Assert on the serialized form: these are the exact snake_case keys the policy
    // server parses, and a rename would silently disable gating.
    expect(JSON.stringify(ssi)).to.contain('"type":"VerifiableId"')
    expect(JSON.stringify(ssi)).to.contain('"vc_policies":["signature"]')
  })

  it('refuses to publish without a remote store, naming the fix', async () => {
    const withoutStore = await Nautilus.create(nautilus.getSigner(), {
      config: nautilus.getOceanConfig()
    })

    let message = ''
    try {
      await withoutStore.publish(freeDataset())
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).to.match(/remote store/i)
  })
})
