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
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  addCredentialAddresses,
  addRequestCredentials
} from '../../src/identity/policy.js'
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
import { readExistingPricing } from '../../src/publish/reuse.js'
import { NodePersistentRemoteStore } from '../../src/remote/NodePersistentRemoteStore.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { setMetadataState } from '../../src/utils/contracts.js'
import { getPricingInfo } from '../../src/utils/pricing.js'
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
  /** What `getNftPermissions(nft, signer)` answers. */
  permissions: { updateMetadata: true, deployERC20: true },
  /** Metadata events in the receipt's block, for the same-block check. */
  blockEvents: undefined as
    | { transactionHash: string; index: number }[]
    | undefined,
  /** The signer's transaction counts, `getTransactionCount(signer, tag)`. */
  nonces: { pending: 4, latest: 4 },
  /** Mined transactions, by hash. */
  receipts: {} as Record<string, { status: number; blockNumber: number }>,
  /** Transactions the RPC knows but has not mined. */
  pendingTxs: [] as string[]
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
      async getNftPermissions() {
        return { manager: true, store: true, ...nftState.permissions }
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
    setMetadataState: vi.fn(async () => ({ hash: '0xstate' })),
    getMetadataEventsInBlock: vi.fn(async () => {
      if (!nftState.blockEvents) throw new Error('no logs in this test')
      return nftState.blockEvents
    })
  }
})

/** A dispenser as `publish()` creates it for a `{ type: 'free' }` service. */
const freeDispenser = vi.hoisted(() => ({
  schema: 'free' as const,
  active: true,
  owner: '',
  maxTokens: '1.0',
  maxBalance: '100000000.0',
  allowedSwapper: '0x0000000000000000000000000000000000000000',
  isMinter: true,
  paymentCollector: ''
}))

vi.mock('../../src/publish/reuse.js', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    readExistingPricing: vi.fn(async () => freeDispenser)
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
    // Like the real one, it records the datatoken on the service.
    createDatatokenForService: vi.fn(
      async ({ service }: { service: { datatokenAddress?: string } }) => {
        service.datatokenAddress = DATATOKEN_ADDRESS
        return {
          datatokenAddress: DATATOKEN_ADDRESS,
          tx: { hash: '0xdatatoken' }
        }
      }
    ),
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
/** A metadata transaction an earlier, failed attempt sent. */
const EARLIER_TX = `0xe4${'11'.repeat(31)}`
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
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }),
    getTransactionCount: async (_address: string, tag: 'pending' | 'latest') =>
      nftState.nonces[tag],
    getTransactionReceipt: async (hash: string) =>
      nftState.receipts[hash] ? { hash, ...nftState.receipts[hash] } : null,
    getTransaction: async (hash: string) =>
      nftState.pendingTxs.includes(hash) ? { hash, blockNumber: null } : null
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
  nftState.permissions = { updateMetadata: true, deployERC20: true }
  nftState.blockEvents = undefined
  nftState.nonces = { pending: 4, latest: 4 }
  nftState.receipts = {}
  nftState.pendingTxs = []
  freeDispenser.owner = SIGNER_ADDRESS
  freeDispenser.paymentCollector = SIGNER_ADDRESS
  vi.mocked(writeMetadata).mockImplementation(
    async () => ({ hash: '0xsetmetadata', blockNumber: 100 }) as never
  )
  vi.mocked(getPricingInfo).mockImplementation(
    async () => ({ schema: 'free' }) as never
  )
  vi.mocked(readExistingPricing).mockImplementation(async () => ({
    ...freeDispenser
  }))
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

  it('records the hash of a metadata transaction that may still land', async () => {
    const { nautilus } = await createNautilus()

    vi.mocked(writeMetadata).mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.('sent', EARLIER_TX)
      throw new Error('wait for transaction timeout')
    })

    const thrown = (await nautilus
      .publish(validAsset())
      .catch((error) => error)) as PublishIncompleteError

    expect(thrown).to.be.instanceOf(PublishIncompleteError)
    expect(thrown.stored?.cleanup).to.equal('kept')
    expect(thrown.stored?.txHash).to.equal(EARLIER_TX)
    expect(thrown.message).to.contain(`metadata transaction ${EARLIER_TX}`)
    expect(thrown.message).to.match(
      /Wait until it is mined or dropped.*metadataTxHash.*still pending/
    )
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

  it('reports indexed: true once the indexer has it, polling as asked', async () => {
    const { nautilus, node } = await createNautilus()
    const signal = new AbortController().signal

    const response = await nautilus.publish(validAsset(), {
      waitForIndexer: { intervalMs: 10, timeoutMs: 1000, signal }
    })

    expect(response.indexed).to.equal(true)
    expect(node.calls.waitForIndexer).to.have.length(1)
    expect(node.calls.waitForIndexer[0]).to.deep.equal({
      did: ASSET_DID,
      txid: '0xsetmetadata',
      options: { intervalMs: 10, timeoutMs: 1000, signal }
    })
    expect(node.calls.waitForIndexer[0].options?.signal).to.equal(signal)
  })

  it('polls with the client defaults for waitForIndexer: true', async () => {
    const { nautilus, node } = await createNautilus()

    await nautilus.edit(new AssetBuilder(getAssetFixture()).build(), {
      waitForIndexer: true
    })

    expect(node.calls.waitForIndexer).to.deep.equal([
      { did: ASSET_DID, txid: '0xsetmetadata', options: {} }
    ])
  })

  it('carries the result on an abort reason that cannot take it', async () => {
    // An AbortSignal's default reason is a DOMException, whose message is a getter; a
    // string reason is no object at all. Neither may lose error.published.
    for (const reason of [
      new DOMException('This operation was aborted', 'AbortError'),
      'stopped by the caller'
    ]) {
      const { nautilus } = await createNautilus({
        node: { indexingError: reason as unknown as Error }
      })

      const thrown = (await nautilus
        .publish(validAsset(), { waitForIndexer: true })
        .catch((error) => error)) as PublishedNotIndexed

      expect(thrown).to.be.instanceOf(Error)
      expect(thrown.cause).to.equal(reason)
      expect(thrown.message).to.match(
        /(aborted|stopped by the caller).*0xsetmetadata was mined.*error\.published/
      )
      expect(thrown.published.nftAddress).to.equal(NFT_ADDRESS)
    }
  })
})

describe('publish with datatokens left from an earlier attempt', () => {
  it('mints fresh ones and reports only those, so completePublish can finish', async () => {
    const { nautilus } = await createNautilus()
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Two services')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
      .addService(service())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()

    // Left by an earlier publish() on another NFT, or copied by ServiceBuilder.
    asset.ddo.services[0].datatokenAddress = FOREIGN_DATATOKEN
    asset.ddo.services[1].datatokenAddress = FOREIGN_DATATOKEN

    // The second service's datatoken creation fails: it never gets a new one.
    vi.mocked(createDatatokenForService).mockRejectedValueOnce(
      new Error('rpc went away')
    )

    const error = (await nautilus
      .publish(asset)
      .catch((thrown) => thrown)) as PublishIncompleteError

    expect(error).to.be.instanceOf(PublishIncompleteError)
    expect(error.datatokens).to.deep.equal([DATATOKEN_ADDRESS])
    expect(asset.ddo.services[1].datatokenAddress).to.equal(undefined)

    const response = await nautilus.completePublish(NFT_ADDRESS, asset)

    expect(response.services.map((entry) => entry.reused)).to.deep.equal([
      true,
      undefined
    ])
  })
})

describe('completePublish while an earlier metadata transaction may land', () => {
  it('refuses while the signer has a transaction that is not mined yet', async () => {
    const { nautilus } = await createNautilus()
    nftState.nonces = { pending: 5, latest: 4 }

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /signer 0x.* has 1 transaction\(s\) not mined yet \(nonces 4 to 4\).*write it twice.*Nothing was sent/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
    expect(vi.mocked(prepareMetadataForWrite)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()

    // Once it is mined, and the NFT still has no metadata, completing goes ahead.
    nftState.nonces = { pending: 5, latest: 5 }
    await nautilus.completePublish(NFT_ADDRESS, validAsset())
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
  })

  it('refuses while the given metadata transaction is pending, or once it succeeded', async () => {
    const { nautilus } = await createNautilus()

    nftState.pendingTxs = [EARLIER_TX]
    await expectThrowsAsync(
      () =>
        nautilus.completePublish(NFT_ADDRESS, validAsset(), {
          metadataTxHash: EARLIER_TX
        }),
      /metadata transaction 0xe4.* is still pending.*Nothing was sent/
    )

    nftState.pendingTxs = []
    nftState.receipts = { [EARLIER_TX]: { status: 1, blockNumber: 9 } }
    await expectThrowsAsync(
      () =>
        nautilus.completePublish(NFT_ADDRESS, validAsset(), {
          metadataTxHash: EARLIER_TX
        }),
      /was mined in block 9.*Nothing was sent.*edit\(\)/
    )

    expect(vi.mocked(prepareMetadataForWrite)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('completes after the given transaction reverted or was dropped', async () => {
    const { nautilus } = await createNautilus()

    nftState.receipts = { [EARLIER_TX]: { status: 0, blockNumber: 9 } }
    await nautilus.completePublish(NFT_ADDRESS, validAsset(), {
      metadataTxHash: EARLIER_TX
    })

    // Unknown to the RPC: dropped, or replaced by another transaction with its nonce.
    nftState.receipts = {}
    await nautilus.completePublish(NFT_ADDRESS, validAsset(), {
      metadataTxHash: EARLIER_TX
    })

    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(2)
  })

  it('refuses a metadataTxHash that is not a transaction hash', async () => {
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () =>
        nautilus.completePublish(NFT_ADDRESS, validAsset(), {
          metadataTxHash: '0x1234'
        }),
      /metadataTxHash 0x1234 is not a transaction hash/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('warns and goes on when the transaction counts cannot be read', async () => {
    const warn = vi
      .spyOn(LoggerInstance, 'warn')
      .mockImplementation(() => undefined)
    const { nautilus } = await createNautilus()
    nftState.nonces = undefined as never

    await nautilus.completePublish(NFT_ADDRESS, validAsset())

    expect(String(warn.mock.calls[0]?.[0])).to.match(
      /could not read the signer's pending transaction count/
    )
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
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

  it('refuses two services naming the same datatoken', async () => {
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
    asset.ddo.services[0].datatokenAddress = SECOND_DATATOKEN
    // Same datatoken, other case: still the same one.
    asset.ddo.services[1].datatokenAddress =
      SECOND_DATATOKEN.toUpperCase().replace('0X', '0x')

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset),
      /more than one service names datatoken 0x1111/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('refuses an NFT in a lifecycle state that takes no metadata', async () => {
    const { nautilus } = await createNautilus()
    nftState.state = 3

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /NFT 0x.* is in lifecycle state 3/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('refuses a signer without the permissions the writes need', async () => {
    const { nautilus } = await createNautilus()

    nftState.permissions = { updateMetadata: false, deployERC20: true }
    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /completePublish: 0x.* lacks the updateMetadata permission.*Nothing was sent/
    )

    // A second service needs a new datatoken, so deployERC20 is needed too.
    nftState.permissions = { updateMetadata: true, deployERC20: false }
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('Two services')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
      .addService(service())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()
    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset),
      /lacks the deployERC20 permission/
    )

    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()

    // Reusing the one datatoken as it is creates nothing, so updateMetadata is enough.
    await nautilus.completePublish(NFT_ADDRESS, validAsset())
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
  })

  it('refuses an asset owner other than the signer', async () => {
    const { nautilus } = await createNautilus()
    const asset = validAsset()
    asset.owner = OWNER_ADDRESS

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset),
      /completePublish: the asset's owner 0x0DB8.* is not the signer/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
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

describe('completePublish and the pricing of a reused datatoken', () => {
  const fixedService = () =>
    new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      serviceType: ServiceTypes.ACCESS
    })
      .setServiceEndpoint('https://node.test.invalid')
      .setName('Paid Service')
      .setPricing({
        type: 'fixed',
        freCreationParams: {
          fixedRateAddress: DATATOKEN_ADDRESS,
          baseTokenAddress: OWNER_ADDRESS,
          baseTokenDecimals: 18,
          datatokenDecimals: 18,
          fixedRate: '10',
          marketFee: '0',
          marketFeeCollector: OWNER_ADDRESS
        }
      })
      .addFile({
        type: 'url',
        url: 'https://files.test.invalid/paid.csv',
        method: 'GET'
      })
      .build()

  const assetWith = (...services: ReturnType<typeof service>[]) => {
    const builder = new AssetBuilder()
      .setType('dataset')
      .setName('Priced services')
      .setProvidedBy('deltaDAO AG')
      .setDescription('A description')
    for (const entry of services) builder.addService(entry)
    return builder.build()
  }

  it('reuses a datatoken whose pricing matches the service', async () => {
    const { nautilus } = await createNautilus()

    const response = await nautilus.completePublish(NFT_ADDRESS, validAsset())

    expect(vi.mocked(readExistingPricing)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
    expect(response.services[0]).to.deep.include({
      datatokenAddress: DATATOKEN_ADDRESS,
      reused: true
    })
  })

  it('refuses a named datatoken priced differently, before any transaction', async () => {
    nftState.datatokens = [DATATOKEN_ADDRESS, SECOND_DATATOKEN]
    // The second datatoken got a dispenser; its service wants a fixed rate.
    const { nautilus } = await createNautilus()
    const asset = assetWith(service(), fixedService())
    asset.ddo.services[1].datatokenAddress = SECOND_DATATOKEN

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset),
      /datatoken 0x1111.*which service Paid Service names, is priced differently.*priced 'free', the service 'fixed'.*nothing was sent/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('refuses a dispenser of another owner', async () => {
    vi.mocked(readExistingPricing).mockResolvedValueOnce({
      ...freeDispenser,
      owner: OWNER_ADDRESS
    })
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, validAsset()),
      /the dispenser owner is 0x0DB8.*Set datatokenAddress on each service/
    )
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('does not match by creation order when the pricing says otherwise', async () => {
    // Rebuilt in another order: the fixed-rate service now comes first, but the first
    // datatoken is the free one minted with the NFT.
    nftState.datatokens = [DATATOKEN_ADDRESS, SECOND_DATATOKEN]
    vi.mocked(getPricingInfo).mockImplementation(
      async (_signer, datatoken) =>
        ({
          schema: datatoken === SECOND_DATATOKEN ? 'fixed' : 'free',
          exchangeId: '0x01'
        }) as never
    )
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () =>
        nautilus.completePublish(
          NFT_ADDRESS,
          assetWith(fixedService(), service())
        ),
      /datatoken 0x.* would go to service Paid Service by creation order, but its pricing does not match.*Set datatokenAddress on each service/
    )
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('refuses an unpriced datatoken for a service without a pricing config, before any transaction', async () => {
    vi.mocked(getPricingInfo).mockResolvedValueOnce({ schema: 'none' } as never)
    const { nautilus } = await createNautilus()
    const asset = validAsset()
    asset.ddo.services[0].pricing = undefined

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset),
      /has no pricing, and service .* has no pricing config/
    )
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
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
      params.onProgress?.('sent')
      throw new Error('setMetadata transaction 0xabc timed out')
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

    const thrown = (await nautilus
      .publish(validAsset(), { waitForIndexer: true })
      .catch((error) => error)) as PublishedNotIndexed & { stored?: unknown }

    expect(thrown).to.be.instanceOf(OceanNodeError)
    expect(thrown.message).to.match(
      /not indexed.*0xsetmetadata was mined.*error\.published/
    )
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
    expect(thrown.published.setMetadataTxReceipt.hash).to.equal('0xsetmetadata')
    expect(thrown.published.stored.pointer).to.deep.equal({
      type: 'ipfs',
      hash: STORED_CID
    })
    expect(thrown.stored).to.equal(undefined)
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

  it('names the datatoken it minted when the pricing then fails', async () => {
    const { nautilus } = await createNautilus()
    const asset = new AssetBuilder(getAssetFixture())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()
    const added = asset.ddo.services[asset.ddo.services.length - 1]

    vi.mocked(createDatatokenForService).mockImplementationOnce(
      async ({ service: target }) => {
        target.datatokenAddress = SECOND_DATATOKEN
        throw new Error('execution reverted: dispenser already exists')
      }
    )

    const thrown = (await nautilus
      .edit(asset)
      .catch((error) => error)) as Error & { datatokens: string[] }

    expect(thrown.message).to.match(
      /dispenser already exists edit\(\) had created datatoken\(s\) 0x1111.*error\.datatokens.*no pricing yet/
    )
    expect(thrown.datatokens).to.deep.equal([SECOND_DATATOKEN])
    expect(added.datatokenAddress).to.equal(SECOND_DATATOKEN)
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('names the datatoken it minted when the metadata write then fails', async () => {
    const { nautilus } = await createNautilus()
    vi.mocked(writeMetadata).mockRejectedValueOnce(
      new Error('Caller is not Metadata updater')
    )

    const thrown = (await nautilus
      .edit(
        new AssetBuilder(getAssetFixture())
          .addService(service('https://files.test.invalid/b.csv'))
          .build()
      )
      .catch((error) => error)) as Error & { datatokens: string[] }

    expect(thrown.datatokens).to.deep.equal([DATATOKEN_ADDRESS])
    expect(thrown.message).to.match(
      /Caller is not Metadata updater.*had created datatoken\(s\) 0x/
    )
    expect(thrown.message).not.to.match(/no pricing yet/)
  })

  it('refuses a signer without the permissions the edit needs, before any transaction', async () => {
    const { nautilus } = await createNautilus()

    nftState.permissions = { updateMetadata: false, deployERC20: true }
    await expectThrowsAsync(
      () => nautilus.edit(new AssetBuilder(getAssetFixture()).build()),
      /edit: 0x.* lacks the updateMetadata permission/
    )

    nftState.permissions = { updateMetadata: true, deployERC20: false }
    await expectThrowsAsync(
      () =>
        nautilus.edit(
          new AssetBuilder(getAssetFixture())
            .addService(service('https://files.test.invalid/b.csv'))
            .build()
        ),
      /lacks the deployERC20 permission/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()

    // No newly priced service, no datatoken to create: updateMetadata is enough.
    await nautilus.edit(new AssetBuilder(getAssetFixture()).build())
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
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

describe('policy server that denies every consumer', () => {
  const DENIES_ALL =
    /has a policy server.*no address allow list.*denies every consumer/

  function warnSpy() {
    return vi.spyOn(LoggerInstance, 'warn').mockImplementation(() => undefined)
  }

  function warnings(warn: ReturnType<typeof warnSpy>) {
    return warn.mock.calls.map((call) => String(call[0]))
  }

  it('warns on publish when the node has a policy server and credentials are {}', async () => {
    const warn = warnSpy()
    const { nautilus } = await createNautilus({ node: { policyServer: true } })

    // The builder writes `credentials: {}` unless addresses are added.
    await nautilus.publish(validAsset())

    expect(warnings(warn).some((text) => DENIES_ALL.test(text))).to.equal(true)
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
  })

  it('warns on publish for an allow list with no address entry', async () => {
    const warn = warnSpy()
    const { nautilus } = await createNautilus({ node: { policyServer: true } })

    const asset = validAsset()
    asset.ddo.credentials = addRequestCredentials(
      {},
      CredentialListTypes.ALLOW,
      [{ type: 'VerifiableId' }]
    )

    await nautilus.publish(asset)

    expect(warnings(warn).some((text) => DENIES_ALL.test(text))).to.equal(true)
  })

  it('warns on edit too', async () => {
    const warn = warnSpy()
    const { nautilus } = await createNautilus({ node: { policyServer: true } })

    const fixture = getAssetFixture()
    fixture.credentialSubject.credentials = {} as never

    await nautilus.edit(new AssetBuilder(fixture).build())

    expect(warnings(warn).some((text) => DENIES_ALL.test(text))).to.equal(true)
  })

  it('does not warn when the asset allows addresses', async () => {
    const warn = warnSpy()
    const { nautilus } = await createNautilus({ node: { policyServer: true } })

    const asset = validAsset()
    asset.ddo.credentials = addCredentialAddresses(
      {},
      CredentialListTypes.ALLOW,
      [OWNER_ADDRESS]
    )

    await nautilus.publish(asset)

    expect(warnings(warn).some((text) => DENIES_ALL.test(text))).to.equal(false)
  })

  it('does not warn when no node has a policy server, or says', async () => {
    for (const policyServer of [false, undefined]) {
      const warn = warnSpy()
      const { nautilus, node } = await createNautilus({
        node: { policyServer }
      })

      await nautilus.publish(validAsset())

      expect(warnings(warn).some((text) => DENIES_ALL.test(text))).to.equal(
        false
      )
      expect(node.calls.hasPolicyServer.length).to.be.greaterThan(0)
      warn.mockRestore()
    }
  })
})

describe('lifecycle state', () => {
  it('reads the state for edit() after a revoke this instance started', async () => {
    const { nautilus } = await createNautilus()
    vi.mocked(setMetadataState).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      nftState.state = 3
      return { hash: '0xstate' } as never
    })
    const fixture = getAssetFixture()

    const [revoke, edit] = await Promise.allSettled([
      nautilus.setAssetLifecycleState(fixture, 3),
      nautilus.edit(
        new AssetBuilder(fixture)
          .addService(service('https://files.test.invalid/b.csv'))
          .build()
      )
    ])

    expect(revoke.status).to.equal('fulfilled')
    expect(edit.status).to.equal('rejected')
    expect(String((edit as PromiseRejectedResult).reason)).to.match(
      /lifecycle state 3/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  it('edit() keeps the state on chain unless the builder asks for another', async () => {
    const { nautilus } = await createNautilus()
    // Unlisted on chain after the asset was fetched: the copy still says ACTIVE (0).
    nftState.state = 5
    const fixture = getAssetFixture()

    const inherited = new AssetBuilder(fixture).build()
    expect(inherited.lifecycleState).to.equal(0)
    expect(inherited.hasRequestedLifecycleState).to.equal(false)

    await nautilus.edit(inherited)
    expect(vi.mocked(writeMetadata).mock.calls[0][0].lifecycleState).to.equal(5)

    // setLifecycleState(), or an assignment, is a request and wins over the chain.
    const relisted = new AssetBuilder(fixture).setLifecycleState(0).build()
    expect(relisted.hasRequestedLifecycleState).to.equal(true)
    await nautilus.edit(relisted)
    expect(vi.mocked(writeMetadata).mock.calls[1][0].lifecycleState).to.equal(0)

    const assigned = new AssetBuilder(fixture).build()
    assigned.lifecycleState = 4
    await nautilus.edit(assigned)
    expect(vi.mocked(writeMetadata).mock.calls[2][0].lifecycleState).to.equal(4)
  })

  it('publish() and completePublish() write ACTIVE unless the builder asks for another', async () => {
    const { nautilus } = await createNautilus()

    await nautilus.publish(validAsset())
    expect(vi.mocked(writeMetadata).mock.calls[0][0].lifecycleState).to.equal(0)

    const unlisted = validAsset()
    unlisted.lifecycleState = 5
    await nautilus.completePublish(NFT_ADDRESS, unlisted)
    expect(vi.mocked(writeMetadata).mock.calls[1][0].lifecycleState).to.equal(5)
  })

  it('refuses to publish for an owner other than the signer, before the mint', async () => {
    const { nautilus } = await createNautilus()
    const asset = validAsset()
    asset.owner = OWNER_ADDRESS

    await expectThrowsAsync(
      () => nautilus.publish(asset),
      /publish: the asset's owner 0x0DB8.* is not the signer .*Nothing was sent/
    )
    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()

    // The signer's own address, in any case, is fine.
    asset.owner = SIGNER_ADDRESS.toLowerCase()
    await nautilus.publish(asset)
    expect(vi.mocked(createNftWithService)).toHaveBeenCalledTimes(1)
  })

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
