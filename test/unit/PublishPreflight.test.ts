/**
 * What `publish()` checks before it spends anything.
 *
 * The promise nautilus makes is that a document is validated locally *before* any gas is
 * spent. It was only half true: a missing remote store or an unreachable endpoint were
 * caught up front, but the document's own shape was checked in `writeAsset()` — after the
 * NFT and every datatoken had been minted. A misshapen DDO therefore cost gas and left
 * orphaned tokens behind.
 *
 * The pre-transaction pass runs on a projection with stand-in addresses, so these tests
 * also pin the thing that makes it affordable: it costs no extra node round trip.
 */
import { Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import {
  createDatatokenForService,
  createNftWithService,
  prepareMetadata
} from '../../src/publish/index.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import {
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock, type NodeMock } from '../mocks/node.js'

// Every chain write is stubbed; the point of these tests is which of them happen at all.
vi.mock('../../src/publish/index.js', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    createNftWithService: vi.fn(async () => ({
      nftAddress: NFT_ADDRESS,
      datatokenAddress: DATATOKEN_ADDRESS,
      tx: { hash: '0xnft' }
    })),
    createDatatokenForService: vi.fn(async () => ({
      datatokenAddress: DATATOKEN_ADDRESS,
      tx: { hash: '0xdatatoken' }
    })),
    prepareMetadata: vi.fn(async () => ({
      credential: { issuer: OWNER_ADDRESS },
      remote: { type: 'url', url: 'https://store.test.invalid/ddo' }
    })),
    writeMetadata: vi.fn(async () => ({ hash: '0xsetmetadata' })),
    waitForMetadataPermission: vi.fn(async () => undefined)
  }
})

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

function service(url = 'https://files.test.invalid/a.csv') {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setName('Access Service')
    .setPricing({ type: 'free' })
    .addFile({ type: 'url', url, method: 'GET' })
    .build()
}

async function createNautilus(): Promise<{
  nautilus: Nautilus
  node: NodeMock
}> {
  const wallet = new Wallet(PRIVATE_KEY)
  const signer = wallet.connect({
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) })
  } as never)

  const nautilus = await Nautilus.create(signer, {
    remoteStore: {
      put: async () => ({
        type: 'url',
        url: 'https://store.test.invalid/ddo',
        method: 'GET'
      })
    } as unknown as RemoteStore,
    config: {
      oceanNodeUri: 'https://node.test.invalid',
      nftFactoryAddress: NFT_ADDRESS,
      fixedRateExchangeAddress: DATATOKEN_ADDRESS,
      dispenserAddress: OWNER_ADDRESS
    }
  })

  const node = createNodeMock()
  ;(nautilus as unknown as { node: OceanNodeClient }).node = node.client

  return { nautilus, node }
}

function validAsset() {
  return new AssetBuilder()
    .setType('dataset')
    .setName('Preflight Dataset')
    .setProvidedBy('deltaDAO AG')
    .setDescription('A description')
    .addService(service())
    .build()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('publish pre-transaction validation', () => {
  it('mints nothing when the document does not validate', async () => {
    const { nautilus } = await createNautilus()

    const asset = validAsset()

    // `build()` enforces the required fields at build time, so break the state afterwards
    // — which is also how this reaches a publisher in practice: a builder held across
    // calls, or metadata assembled from somewhere else.
    delete asset.ddo.metadata.providedBy

    await expectThrowsAsync(() => nautilus.publish(asset), /providedBy/i)

    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(prepareMetadata)).not.toHaveBeenCalled()
  })

  it('publishes a valid asset, encrypting each service exactly once', async () => {
    // The pre-transaction pass projects with a stand-in for the ciphertext precisely so it
    // does not have to encrypt: doing it the obvious way would send every file object to
    // the node twice on every publish.
    const { nautilus, node } = await createNautilus()

    const response = await nautilus.publish(validAsset())

    expect(vi.mocked(createNftWithService)).toHaveBeenCalledTimes(1)
    expect(node.calls.encrypt).to.have.lengthOf(1)
    expect(response.nftAddress).to.equal(NFT_ADDRESS)
  })

  it('validates the real addresses too, not just the stand-ins', async () => {
    // The pre-transaction document carries placeholder addresses, so it cannot be the last
    // word — `writeAsset()` still validates the document that actually gets signed.
    const { nautilus } = await createNautilus()

    const response = await nautilus.publish(validAsset())
    const subject = response.ddo.credentialSubject as Record<string, unknown>

    expect(subject.nftAddress).to.equal(NFT_ADDRESS)
    expect(subject.chainId).to.equal(CHAIN_ID)
  })
})
