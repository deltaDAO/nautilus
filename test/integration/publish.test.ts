import { beforeAll, describe, expect, it } from 'vitest'
import { getCredentials, getServices, getVersion } from '../../src/ddo/read.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import { validate } from '../../src/ddo/validate.js'
import { AssetBuilder, Nautilus } from '../../src/index.js'
import { datasetMetadata } from '../fixtures/AssetConfig.js'
import { getConsumerParameters } from '../fixtures/ConsumerParameters.js'
import {
  accessService,
  computeService,
  createPublisher,
  freeAlgorithm,
  freeDataset,
  integrationEnabled,
  publishAndIndex
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
