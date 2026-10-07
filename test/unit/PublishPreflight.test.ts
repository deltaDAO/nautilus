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
import { LoggerInstance, type StorageObject } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishedNotIndexed } from '../../src/@types/Publish.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import { PLACEHOLDER_ADDRESS } from '../../src/Nautilus/Asset/NautilusDDO.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import {
  IndexerNonceStuckError,
  IndexingError,
  isIndexerNonceSignable,
  type OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'
import {
  maxDecryptableJwsLength,
  maxJwsLengthFor
} from '../../src/publish/envelope.js'
import {
  createDatatokenForService,
  createNftWithService,
  createPricingForDatatoken,
  MetadataConflictError,
  PublishIncompleteError,
  prepareMetadataForWrite,
  writeMetadata
} from '../../src/publish/index.js'
import { NodePersistentRemoteStore } from '../../src/remote/NodePersistentRemoteStore.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { resetWarnings } from '../../src/utils/warn.js'
import {
  ASSET_DID,
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import {
  createNodeMock,
  type NodeMock,
  type NodeMockOptions
} from '../mocks/node.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

/** The NFT as `completePublish()` and `edit()` read it from the chain. */
const nftState = vi.hoisted(() => ({
  hasMetadata: false,
  state: 0,
  owner: '',
  /** What `ERC721Factory.erc721List(nft)` answers; `''` means "the NFT itself". */
  factoryListed: '',
  datatokens: [] as string[],
  /** Metadata events in the receipt's block, for the same-block check. */
  blockEvents: undefined as
    | { transactionHash: string; index: number }[]
    | undefined
}))

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Nft: class {
      async getMetadata() {
        return [
          'https://node.test.invalid',
          OWNER_ADDRESS,
          nftState.state,
          nftState.hasMetadata
        ]
      }
      async getNftOwner() {
        return nftState.owner
      }
    },
    NftFactory: class {
      async checkNFT(nftAddress: string) {
        return nftState.factoryListed || nftAddress
      }
    }
  }
})

vi.mock('../../src/utils/contracts.js', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    getNftDatatokens: vi.fn(async () => nftState.datatokens),
    getMetadataEventsInBlock: vi.fn(async () => {
      if (!nftState.blockEvents) throw new Error('no logs in this test')
      return nftState.blockEvents
    })
  }
})

vi.mock('../../src/utils/pricing.js', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    getPricingInfo: vi.fn(async () => ({ schema: 'free' }))
  }
})

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
    createPricingForDatatoken: vi.fn(async () => ({ hash: '0xpricing' })),
    // The real `PreparedWrite` shape; the format itself is covered by RemoteFormat.test.ts.
    prepareMetadataForWrite: vi.fn(async () => ({
      written: {
        metadata: '0xc1a55e',
        metadataHash: `0x${'ab'.repeat(32)}`,
        flags: 0x02,
        credential: { jwt: 'header.claims.signature', issuer: OWNER_ADDRESS },
        pointer: { remote: { type: 'ipfs', hash: STORED_CID } },
        stored: {
          pointer: { type: 'ipfs', hash: STORED_CID },
          metadataHash: `0x${'ab'.repeat(32)}`
        },
        encryptedBy: 'https://node.test.invalid'
      },
      storedPointer: { type: 'ipfs', hash: STORED_CID },
      pointerPlaintext: JSON.stringify({
        remote: { type: 'ipfs', hash: STORED_CID }
      })
    })),
    writeMetadata: vi.fn(async () => ({
      hash: '0xsetmetadata',
      blockNumber: 100
    })),
    waitForMetadataPermission: vi.fn(async () => undefined)
  }
})

const STORED_CID = vi.hoisted(
  () => 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
)
const SIGNER_ADDRESS = new Wallet(PRIVATE_KEY).address
const SECOND_DATATOKEN = '0x1111111111111111111111111111111111111111'
const FOREIGN_DATATOKEN = '0x2222222222222222222222222222222222222222'

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

function urlStore(
  check?: () => Promise<void>,
  verify?: RemoteStore['verify']
): RemoteStore {
  return {
    put: async () =>
      ({
        type: 'url',
        url: 'https://store.test.invalid/ddo',
        method: 'GET'
      }) as unknown as StorageObject,
    ...(check ? { check } : {}),
    ...(verify ? { verify } : {})
  }
}

async function createNautilus(
  options: {
    remoteStore?: RemoteStore
    node?: NodeMockOptions
    config?: Record<string, unknown>
  } = {}
): Promise<{
  nautilus: Nautilus
  node: NodeMock
}> {
  const wallet = new Wallet(PRIVATE_KEY)
  const signer = wallet.connect({
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) })
  } as never)

  const nautilus = await Nautilus.create(signer, {
    remoteStore: options.remoteStore ?? urlStore(),
    config: {
      oceanNodeUri: 'https://node.test.invalid',
      nftFactoryAddress: NFT_ADDRESS,
      fixedRateExchangeAddress: DATATOKEN_ADDRESS,
      dispenserAddress: OWNER_ADDRESS,
      ...options.config
    }
  })

  const node = createNodeMock(options.node)
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
  vi.restoreAllMocks()
  resetWarnings()
  nftState.hasMetadata = false
  nftState.state = 0
  nftState.owner = SIGNER_ADDRESS
  nftState.factoryListed = ''
  nftState.datatokens = [DATATOKEN_ADDRESS]
  nftState.blockEvents = undefined
  vi.mocked(writeMetadata).mockImplementation(
    async () => ({ hash: '0xsetmetadata', blockNumber: 100 }) as never
  )
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
    expect(vi.mocked(prepareMetadataForWrite)).not.toHaveBeenCalled()
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

describe('publish before the first transaction', () => {
  it('mints nothing for a DDO too large for the node to decrypt', async () => {
    // The node accepts decrypt requests up to 100 KB.
    const { nautilus, node } = await createNautilus()
    const asset = validAsset()
    asset.ddo.metadata.description = 'x'.repeat(30_000)

    await expectThrowsAsync(
      () => nautilus.publish(asset),
      /too large for the node to index/
    )

    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
    expect(node.calls.metadataEncrypt).to.have.length(0)
  })

  it('checks the largest envelope the signed DDO can give, not the DDO alone', async () => {
    const asset = validAsset()
    const preflight = (length: number) => {
      asset.ddo.metadata.description = 'x'.repeat(length)
      const ddo = asset.ddo.getPreflightDDO({
        create: true,
        chainId: CHAIN_ID,
        nftAddress: PLACEHOLDER_ADDRESS,
        datatokenAddress: PLACEHOLDER_ADDRESS
      })
      ddo.issuer = SIGNER_ADDRESS
      return ddo
    }

    // The longest description whose largest signed JWS still fits.
    let low = 0
    let high = 30_000
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (
        maxJwsLengthFor(preflight(mid), SIGNER_ADDRESS) <=
        maxDecryptableJwsLength()
      )
        low = mid
      else high = mid - 1
    }

    // One character more is refused before the mint, although the DDO's own JSON in
    // base64url is well within the limit.
    const tooLarge = preflight(low + 1)
    expect(
      Buffer.from(JSON.stringify(tooLarge)).toString('base64url').length
    ).to.be.below(maxDecryptableJwsLength() - 1_000)

    const { nautilus, node } = await createNautilus()
    await expectThrowsAsync(
      () => nautilus.publish(asset),
      /too large for the node to index/
    )
    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
    expect(node.calls.encrypt).to.have.length(0)

    // At the bound itself, it publishes.
    preflight(low)
    await nautilus.publish(asset)
    expect(vi.mocked(createNftWithService)).toHaveBeenCalledTimes(1)
  })

  it('rejects encrypt: false', async () => {
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () => nautilus.publish(validAsset(), { encrypt: false } as never),
      'encrypt: false is not supported: DDO pointers and envelopes are always node-encrypted.'
    )

    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
  })

  it('rejects NodePersistentRemoteStore as the DDO store, pointing to IPFS', async () => {
    const { nautilus, node } = await createNautilus()
    const remoteStore = new NodePersistentRemoteStore(node.client)

    await expectThrowsAsync(
      () => nautilus.publish(validAsset(), { remoteStore }),
      /NodePersistentRemoteStore cannot hold DDOs.*Use an IpfsRemoteStore or an S3RemoteStore/
    )

    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
  })

  it('mints nothing when the store check fails', async () => {
    const check = vi.fn(async () => {
      throw new Error('IPFS upload failed: 403 Forbidden NO_SCOPES_FOUND')
    })
    const { nautilus } = await createNautilus({ remoteStore: urlStore(check) })

    await expectThrowsAsync(
      () => nautilus.publish(validAsset()),
      /NO_SCOPES_FOUND/
    )

    expect(check).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
  })
})

describe('publish after the mint', () => {
  it('reports a failure as PublishIncompleteError, and completePublish finishes it', async () => {
    const { nautilus } = await createNautilus()
    const asset = validAsset()

    vi.mocked(writeMetadata).mockRejectedValueOnce(new Error('rpc went away'))

    let error: unknown
    try {
      await nautilus.publish(asset)
    } catch (thrown) {
      error = thrown
    }

    expect(error).to.be.instanceOf(PublishIncompleteError)
    expect((error as PublishIncompleteError).nftAddress).to.equal(NFT_ADDRESS)
    expect((error as PublishIncompleteError).datatokens).to.deep.equal([
      DATATOKEN_ADDRESS
    ])
    expect((error as Error).message).to.match(/rpc went away/)

    const response = await nautilus.completePublish(NFT_ADDRESS, asset)

    // The NFT and its datatoken are reused, not minted again.
    expect(vi.mocked(createNftWithService)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(2)
    expect(response.nftAddress).to.equal(NFT_ADDRESS)
    expect(response.stored.pointer).to.deep.equal({
      type: 'ipfs',
      hash: STORED_CID
    })
    expect(response.services).to.have.length(1)
    expect(response.services[0]).to.deep.include({
      datatokenAddress: DATATOKEN_ADDRESS,
      reused: true
    })
  })

  it('refuses to complete an NFT that already has metadata', async () => {
    const { nautilus } = await createNautilus()
    nftState.hasMetadata = true

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /already has metadata.*edit\(\)/
    )

    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('passes an indexing failure through, carrying the publish result', async () => {
    const indexingError = new IndexingError(ASSET_DID, {
      valid: false,
      error: 'Provider exception on decrypt DDO. Status: Hash check failed'
    })
    const { nautilus } = await createNautilus({ node: { indexingError } })

    const thrown = (await nautilus
      .publish(validAsset(), { waitForIndexer: true })
      .catch((error) => error)) as PublishedNotIndexed

    expect(thrown).to.equal(indexingError)
    expect(thrown.message).to.match(
      /could not index .*Hash check failed.*0xsetmetadata was mined.*error\.published/
    )
    expect(thrown.published.nftAddress).to.equal(NFT_ADDRESS)
    expect(thrown.published.ddo.id).to.equal(ASSET_DID)
    expect(thrown.published.stored.pointer).to.deep.equal({
      type: 'ipfs',
      hash: STORED_CID
    })
  })

  it('attaches the result to a timeout from completePublish and edit too', async () => {
    const timeout = new OceanNodeError(
      'waitForIndexer',
      'not indexed within 1s'
    )
    const { nautilus } = await createNautilus({
      node: { indexingError: timeout }
    })

    const fromComplete = (await nautilus
      .completePublish(NFT_ADDRESS, validAsset(), { waitForIndexer: true })
      .catch((error) => error)) as PublishedNotIndexed
    expect(fromComplete.published.setMetadataTxReceipt.hash).to.equal(
      '0xsetmetadata'
    )

    const fromEdit = (await nautilus
      .edit(new AssetBuilder(getAssetFixture()).build(), {
        waitForIndexer: true
      })
      .catch((error) => error)) as PublishedNotIndexed
    expect(fromEdit).to.be.instanceOf(OceanNodeError)
    expect(fromEdit.published.nftAddress).to.equal(NFT_ADDRESS)
  })

  it('reports indexed: true once the indexer has it', async () => {
    const { nautilus, node } = await createNautilus()

    const response = await nautilus.publish(validAsset(), {
      waitForIndexer: { intervalMs: 10, timeoutMs: 1000 }
    })

    expect(response.indexed).to.equal(true)
    expect(node.calls.waitForIndexer).to.deep.equal([
      { did: ASSET_DID, txid: '0xsetmetadata' }
    ])
  })
})

describe('completePublish before any transaction', () => {
  it('refuses an NFT the signer does not own', async () => {
    const { nautilus } = await createNautilus()
    nftState.owner = OWNER_ADDRESS

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /owned by 0x0DB8.*not by the signer/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('refuses an NFT the configured factory did not create', async () => {
    const { nautilus } = await createNautilus()
    nftState.factoryListed = '0x0000000000000000000000000000000000000000'

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /was not created by the ERC721 factory/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it("refuses a service whose datatoken is not one of the NFT's", async () => {
    const { nautilus } = await createNautilus()
    const asset = validAsset()
    asset.ddo.services[0].datatokenAddress = FOREIGN_DATATOKEN

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset),
      /names datatoken 0x2222.*not a datatoken of NFT/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('reuses the datatokens of a rebuilt asset, and creates only the missing ones', async () => {
    // The process crashed: the asset is rebuilt from code, so no service carries a
    // datatoken. The one bundled at mint must be reused, not orphaned.
    const { nautilus } = await createNautilus()
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Two services')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
      .addService(service())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()

    const response = await nautilus.completePublish(NFT_ADDRESS, asset)

    expect(asset.ddo.services[0].datatokenAddress).to.equal(DATATOKEN_ADDRESS)
    expect(vi.mocked(createDatatokenForService)).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(createDatatokenForService).mock.calls[0][0].service
    ).to.equal(asset.ddo.services[1])
    expect(response.services.map((entry) => entry.reused)).to.deep.equal([
      true,
      undefined
    ])
  })

  it('reuses a datatoken whose pricing failed, and prices it', async () => {
    const { getPricingInfo } = await import('../../src/utils/pricing.js')
    vi.mocked(getPricingInfo).mockResolvedValueOnce({
      schema: 'none'
    } as never)
    nftState.datatokens = [DATATOKEN_ADDRESS, SECOND_DATATOKEN]

    const { nautilus } = await createNautilus()
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Two services')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
      .addService(service())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()
    asset.ddo.services[1].datatokenAddress = SECOND_DATATOKEN

    const response = await nautilus.completePublish(NFT_ADDRESS, asset)

    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(createPricingForDatatoken)).toHaveBeenCalledTimes(1)
    expect(
      response.services.map((entry) => entry.datatokenAddress)
    ).to.deep.equal([DATATOKEN_ADDRESS, SECOND_DATATOKEN])
  })

  it('refuses when the NFT has more unclaimed datatokens than services need', async () => {
    nftState.datatokens = [DATATOKEN_ADDRESS, SECOND_DATATOKEN]
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /2 datatoken\(s\) no service names.*Set datatokenAddress on each service/
    )
  })
})

describe('reading the store back before the transaction', () => {
  it('verifies the stored object against the metadata hash, then writes', async () => {
    const order: string[] = []
    const verify = vi.fn(async () => {
      order.push('verify')
    })
    vi.mocked(writeMetadata).mockImplementationOnce(async () => {
      order.push('write')
      return { hash: '0xsetmetadata' } as never
    })
    const { nautilus } = await createNautilus({
      remoteStore: urlStore(undefined, verify)
    })

    await nautilus.publish(validAsset())

    expect(verify).toHaveBeenCalledWith(
      { type: 'ipfs', hash: STORED_CID },
      `0x${'ab'.repeat(32)}`
    )
    expect(order).to.deep.equal(['verify', 'write'])
  })

  it('writes nothing on chain when verification fails', async () => {
    const verify = vi.fn(async () => {
      throw new Error('Verifying it failed: it hashes to 0x01')
    })
    const { nautilus } = await createNautilus({
      remoteStore: urlStore(undefined, verify)
    })

    await expectThrowsAsync(
      () => nautilus.publish(validAsset()),
      /Verifying it failed/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })
})

describe('the stored envelope after a failed write', () => {
  function removableStore(verify?: RemoteStore['verify']) {
    const remove = vi.fn(async (_pointer: StorageObject) => undefined)
    return { remove, store: { ...urlStore(undefined, verify), remove } }
  }

  it('removes it when publish fails before the metadata transaction is sent', async () => {
    const { remove, store } = removableStore()
    const { nautilus } = await createNautilus({ remoteStore: store })
    vi.mocked(writeMetadata).mockRejectedValueOnce(
      new Error('Caller is not Metadata updater')
    )

    const error = (await nautilus
      .publish(validAsset())
      .catch((thrown) => thrown)) as PublishIncompleteError

    expect(error).to.be.instanceOf(PublishIncompleteError)
    expect(remove).toHaveBeenCalledWith({ type: 'ipfs', hash: STORED_CID })
    expect(error.stored).to.deep.include({
      cleanup: 'removed',
      pointer: { type: 'ipfs', hash: STORED_CID }
    })
    expect(error.message).to.match(/has no metadata yet/)
  })

  it('keeps it once the transaction was sent, and says the NFT may have metadata', async () => {
    const { remove, store } = removableStore()
    const { nautilus } = await createNautilus({ remoteStore: store })
    vi.mocked(writeMetadata).mockImplementationOnce(async (params) => {
      params.onSent?.()
      throw new Error('setMetadata failed: ocean.js returned no transaction.')
    })

    const error = (await nautilus
      .publish(validAsset())
      .catch((thrown) => thrown)) as PublishIncompleteError

    expect(remove).not.toHaveBeenCalled()
    expect(error.stored?.cleanup).to.equal('kept')
    expect(error.message).to.match(
      /after its metadata transaction was sent.*may still be mined/
    )
  })

  it('removes it when edit fails verification, and leaves a store without remove() alone', async () => {
    const verify = vi.fn(async () => {
      throw new Error('it hashes to 0x01')
    })
    const { remove, store } = removableStore(verify)
    const { nautilus } = await createNautilus({ remoteStore: store })

    const removed = (await nautilus
      .edit(new AssetBuilder(getAssetFixture()).build())
      .catch((thrown) => thrown)) as Error & { stored: { cleanup: string } }

    expect(removed.message).to.match(/^it hashes to 0x01 .*removed again/)
    expect(removed.stored.cleanup).to.equal('removed')
    expect(remove).toHaveBeenCalledTimes(1)

    const { nautilus: withoutRemove } = await createNautilus({
      remoteStore: urlStore(undefined, verify)
    })
    const kept = (await withoutRemove
      .edit(new AssetBuilder(getAssetFixture()).build())
      .catch((thrown) => thrown)) as Error & { stored: { cleanup: string } }

    expect(kept.stored.cleanup).to.equal('not-removed')
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('never touches it after the metadata transaction was mined', async () => {
    const { remove, store } = removableStore()
    const { nautilus } = await createNautilus({
      remoteStore: store,
      node: {
        indexingError: new OceanNodeError('waitForIndexer', 'not indexed')
      }
    })

    await expectThrowsAsync(() =>
      nautilus.publish(validAsset(), { waitForIndexer: true })
    )
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('edit', () => {
  it('checks the store before minting a datatoken for a newly priced service', async () => {
    const check = vi.fn(async () => {
      throw new Error('S3 PUT with the write key: access denied')
    })
    const { nautilus } = await createNautilus({ remoteStore: urlStore(check) })
    const asset = new AssetBuilder(getAssetFixture())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()

    await expectThrowsAsync(() => nautilus.edit(asset), /access denied/)

    expect(check).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
  })

  it('does not wait for the indexer between sequential writes', async () => {
    const { nautilus, node } = await createNautilus()

    await nautilus.publish(validAsset())
    await nautilus.edit(new AssetBuilder(getAssetFixture()).build())

    expect(node.calls.waitForIndexer).to.have.length(0)
  })
})

describe('one asset, one metadata transaction at a time', () => {
  it('serializes concurrent edits of one NFT', async () => {
    const { nautilus } = await createNautilus()
    let running = 0
    let overlapped = false

    vi.mocked(writeMetadata).mockImplementation(async () => {
      running++
      if (running > 1) overlapped = true
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return { hash: '0xsetmetadata' } as never
    })

    const results = await Promise.allSettled([
      nautilus.edit(new AssetBuilder(getAssetFixture()).build()),
      nautilus.edit(new AssetBuilder(getAssetFixture()).build())
    ])

    expect(results.map((result) => result.status)).to.deep.equal([
      'fulfilled',
      'fulfilled'
    ])

    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(2)
    expect(overlapped).to.equal(false)
  })

  it('throws a MetadataConflictError when another metadata event shares the block', async () => {
    nftState.blockEvents = [
      { transactionHash: '0xother', index: 1 },
      { transactionHash: '0xsetmetadata', index: 2 }
    ]
    const { nautilus } = await createNautilus()

    const thrown = (await nautilus
      .edit(new AssetBuilder(getAssetFixture()).build())
      .catch((error) => error)) as MetadataConflictError

    expect(thrown).to.be.instanceOf(MetadataConflictError)
    expect(thrown.message).to.match(
      /landed in block 100 together with 0xother.*ignores this one/
    )
    expect(thrown.indexedFirst).to.equal(false)
    expect(thrown.conflictingTxIds).to.deep.equal(['0xother'])
    expect(thrown.published.setMetadataTxReceipt.hash).to.equal('0xsetmetadata')
  })

  it('says when this transaction is the one the node keeps', async () => {
    nftState.blockEvents = [
      { transactionHash: '0xsetmetadata', index: 1 },
      { transactionHash: '0xother', index: 2 }
    ]
    const { nautilus } = await createNautilus()

    const thrown = (await nautilus
      .publish(validAsset())
      .catch((error) => error)) as MetadataConflictError

    expect(thrown.indexedFirst).to.equal(true)
    expect(thrown.message).to.match(/keeps this one and ignores the other/)
  })

  it('goes on when this is the only metadata event in its block', async () => {
    nftState.blockEvents = [{ transactionHash: '0xsetmetadata', index: 3 }]
    const { nautilus } = await createNautilus()

    const response = await nautilus.publish(validAsset())

    expect(response.setMetadataTxReceipt.hash).to.equal('0xsetmetadata')
  })
})

describe('setup', () => {
  it("refuses a config.chainId other than the signer's chain", async () => {
    await expectThrowsAsync(
      () => createNautilus({ config: { chainId: 1 } }),
      /config.chainId is 1, but the signer's provider is on chain 32456/
    )
  })

  it('refuses a plain-http node URI on a remote host', async () => {
    await expectThrowsAsync(
      () =>
        createNautilus({ config: { oceanNodeUri: 'http://node.example.org' } }),
      /oceanNodeUri uses plain http:\/\/.*allowInsecureTransport/
    )
  })

  it('accepts plain http on loopback hosts', async () => {
    for (const oceanNodeUri of [
      'http://127.0.0.1:8001',
      'http://localhost:8000',
      'http://[::1]:8000',
      'http://node.localhost'
    ])
      await createNautilus({ config: { oceanNodeUri } })
  })

  it("warns once when the publisher is the node's own key", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { nautilus } = await createNautilus({
      node: { nodeAddress: SIGNER_ADDRESS }
    })

    await nautilus.publish(validAsset())
    await nautilus.publish(validAsset())

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).to.match(
      /is the node's own address.*nonces collide.*401/
    )
  })

  it('does not warn for a different node key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { nautilus } = await createNautilus({
      node: { nodeAddress: OWNER_ADDRESS }
    })

    await nautilus.publish(validAsset())

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('lifecycle state', () => {
  it('refuses to publish an asset built as DEPRECATED', async () => {
    const { nautilus } = await createNautilus()
    const asset = validAsset()
    asset.lifecycleState = 2

    await expectThrowsAsync(() => nautilus.publish(asset), /lifecycle state 2/)
    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
  })

  it('refuses to edit an asset that is REVOKED on chain, before any transaction', async () => {
    const { nautilus } = await createNautilus()
    nftState.state = 3

    await expectThrowsAsync(
      () => nautilus.edit(new AssetBuilder(getAssetFixture()).build()),
      /NFT 0x.* is in lifecycle state 3/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })
})

describe('indexer nonce preflight', () => {
  const NODE_ADDRESS = '0x00000000000000000000000000000000000b1b1b'

  /** The node's state with `nextNonce` the first one from `from` that it does not accept. */
  function nonceState(from = 0, stuck = true) {
    let next = from + 1
    while (isIndexerNonceSignable(NODE_ADDRESS, next) === stuck) next++
    return {
      nodeAddress: NODE_ADDRESS,
      storedNonce: next - 1,
      nextNonce: next,
      stuck
    }
  }

  /** A state that is not stuck now, but whose next-but-one nonce is not accepted. */
  function oneAwayState() {
    for (let stored = 0; ; stored++)
      if (
        isIndexerNonceSignable(NODE_ADDRESS, stored + 1) &&
        !isIndexerNonceSignable(NODE_ADDRESS, stored + 2)
      )
        return {
          nodeAddress: NODE_ADDRESS,
          storedNonce: stored,
          nextNonce: stored + 1,
          stuck: false
        }
  }

  it('refuses to publish on a stuck indexer before the mint', async () => {
    const { nautilus, node } = await createNautilus({
      node: { indexerNonce: nonceState() }
    })

    const thrown = await nautilus
      .publish(validAsset())
      .catch((caught) => caught)

    expect(thrown).to.be.instanceOf(IndexerNonceStuckError)
    expect(thrown.message).to.match(
      /stuck.*Nothing was spent.*checkIndexerNonce: false/s
    )
    expect(thrown.state.stuck).to.equal(true)
    expect(node.calls.getIndexerNonceState).to.equal(1)
    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()
  })

  it('refuses edit() and completePublish() the same way', async () => {
    const { nautilus } = await createNautilus({
      node: { indexerNonce: nonceState() }
    })

    await expectThrowsAsync(
      () => nautilus.edit(new AssetBuilder(getAssetFixture()).build()),
      /indexer nonce of this node is stuck/
    )
    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /indexer nonce of this node is stuck/
    )

    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('publishes when the node accepts the next indexer nonces', async () => {
    const { nautilus, node } = await createNautilus({
      node: { indexerNonce: nonceState(0, false) }
    })

    await nautilus.publish(validAsset())

    expect(node.calls.getIndexerNonceState).to.equal(1)
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
  })

  it('goes on silently when the node does not serve the check', async () => {
    for (const indexerNonce of [
      undefined,
      new OceanNodeError('getIndexerNonceState', '404 Not Found')
    ]) {
      vi.mocked(writeMetadata).mockClear()
      const { nautilus } = await createNautilus({ node: { indexerNonce } })

      await nautilus.publish(validAsset())

      expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
    }
  })

  it('can be switched off', async () => {
    const { nautilus, node } = await createNautilus({
      node: { indexerNonce: nonceState() }
    })

    await nautilus.publish(validAsset(), { checkIndexerNonce: false })

    expect(node.calls.getIndexerNonceState).to.equal(0)
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
  })

  it('warns when this publish would be the one that gets it stuck', async () => {
    const warn = vi
      .spyOn(LoggerInstance, 'warn')
      .mockImplementation(() => undefined)
    const { nautilus } = await createNautilus({
      node: { indexerNonce: oneAwayState() }
    })

    await nautilus.publish(validAsset())

    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
    expect(
      warn.mock.calls.some((call) =>
        /second decrypt call/.test(String(call[0]))
      )
    ).to.equal(true)
  })
})
