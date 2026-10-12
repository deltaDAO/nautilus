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
import { inspect } from 'node:util'
import type { StorageObject } from '@oceanprotocol/lib'
import {
  FetchRequest,
  FetchResponse,
  makeError,
  Wallet,
  ZeroAddress
} from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishedNotIndexed } from '../../src/@types/Publish.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  addCredentialAddresses,
  addRequestCredentials
} from '../../src/identity/policy.js'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import {
  createLogger,
  type LogEvent,
  type Logger,
  type LoggingOptions
} from '../../src/log/index.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import { PLACEHOLDER_ADDRESS } from '../../src/Nautilus/Asset/NautilusDDO.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import {
  AssetNotFoundError,
  IndexerNonceStuckError,
  IndexingError,
  isIndexerNonceSignable,
  type OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'
import {
  expectedDid,
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
import {
  getMetadataEventsInBlock,
  readNftLabel,
  setMetadataState
} from '../../src/utils/contracts.js'
import { getPricingInfo } from '../../src/utils/pricing.js'
import {
  ASSET_DID,
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture as getSharedAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import { captureLog, expectThrowsAsync } from '../helpers.js'
import {
  createNodeMock,
  type NodeMock,
  type NodeMockOptions
} from '../mocks/node.js'
import { FAKE } from '../secretScan.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

/** The NFT as `completePublish()` and `edit()` read it from the chain. */
const nftState = vi.hoisted(() => ({
  hasMetadata: false,
  state: 0,
  owner: '',
  /** Thrown by `getNftOwner()` instead of answering, when set. */
  ownerError: undefined as Error | undefined,
  /** The reads made, in order: `getMetadata`, `getNftOwner`, `getNftPermissions:<address>`. */
  calls: [] as string[],
  /** What `ERC721Factory.erc721List(nft)` answers; `''` means "the NFT itself". */
  factoryListed: '',
  /** Thrown by `checkNFT()` and by `getMetadata()` instead of answering, when set. */
  factoryError: undefined as Error | undefined,
  metadataError: undefined as Error | undefined,
  /** Answered by `getMetadata()` instead of the usual tuple, when set. */
  metadataAnswer: undefined as unknown,
  datatokens: [] as string[],
  /** What `getNftPermissions(nft, signer)` answers. */
  permissions: { updateMetadata: true, deployERC20: true },
  /** What `getNftPermissions(nft, address)` answers for other addresses, lower-cased. */
  permissionsOf: {} as Record<
    string,
    { updateMetadata: boolean; deployERC20: boolean }
  >,
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
        nftState.calls.push('getMetadata')
        if (nftState.metadataError) throw nftState.metadataError
        if (nftState.metadataAnswer !== undefined)
          return nftState.metadataAnswer
        return [
          'https://node.test.invalid',
          OWNER_ADDRESS,
          nftState.state,
          nftState.hasMetadata
        ]
      }
      async getNftOwner() {
        nftState.calls.push('getNftOwner')
        if (nftState.ownerError) throw nftState.ownerError
        return nftState.owner
      }
      async getNftPermissions(_nft: string, address: string) {
        nftState.calls.push(`getNftPermissions:${address}`)
        return {
          manager: true,
          store: true,
          ...(nftState.permissionsOf[address.toLowerCase()] ??
            nftState.permissions)
        }
      }
    },
    NftFactory: class {
      async checkNFT(nftAddress: string) {
        nftState.calls.push('checkNFT')
        if (nftState.factoryError) throw nftState.factoryError
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
    readNftLabel: vi.fn(async () => ({
      name: 'Lifecycle NFT',
      symbol: 'LNFT'
    })),
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
/**
 * The shared fixture, issued by this suite's signer: publish and edit refuse a declared
 * issuer the signer is not, before any transaction.
 */
const getAssetFixture = (
  overrides: Parameters<typeof getSharedAssetFixture>[0] = {}
) => getSharedAssetFixture({ issuer: SIGNER_ADDRESS, ...overrides })
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
    logger?: LoggingOptions | Logger
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
    },
    logger: options.logger
  })

  const node = createNodeMock(options.node)
  ;(nautilus as unknown as { node: OceanNodeClient }).node = node.client

  return { nautilus, node }
}

/** A spy on stderr, where the default logger prints. */
function stderrSpy() {
  return vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
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
  nftState.hasMetadata = false
  nftState.state = 0
  nftState.owner = SIGNER_ADDRESS
  nftState.ownerError = undefined
  nftState.calls = []
  nftState.factoryListed = ''
  nftState.factoryError = undefined
  nftState.metadataError = undefined
  nftState.metadataAnswer = undefined
  nftState.datatokens = [DATATOKEN_ADDRESS]
  nftState.permissions = { updateMetadata: true, deployERC20: true }
  nftState.permissionsOf = {}
  // The metadata transaction is alone in its block, unless a test says otherwise.
  nftState.blockEvents = []
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
  it('mints nothing when the declared issuer is not the signer, nor completes on an NFT', async () => {
    const { nautilus } = await createNautilus()
    const asset = () =>
      new AssetBuilder()
        .setType('dataset')
        .setName('Preflight Dataset')
        .setProvidedBy('deltaDAO AG')
        .setDescription('A description')
        .setIssuer('did:jwk:someone-else')
        .addService(service())
        .build()
    const refused =
      /^The DDO declares issuer "did:jwk:someone-else" but it is being signed by "0x[0-9a-fA-F]{40}"\..*Nothing was sent\.$/

    await expectThrowsAsync(() => nautilus.publish(asset()), refused)
    expect(vi.mocked(createNftWithService)).not.toHaveBeenCalled()

    await expectThrowsAsync(
      () => nautilus.completePublish(NFT_ADDRESS, asset()),
      refused
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(prepareMetadataForWrite)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

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
    const log = captureLog()
    const { nautilus } = await createNautilus()
    nftState.nonces = undefined as never

    await nautilus.completePublish(NFT_ADDRESS, validAsset())

    const [warning] = log.named('publish.preflight.pending_unreadable')
    expect(warning.msg).to.match(
      /could not read the signer's pending transaction count/
    )
    expect(warning.fields.nftAddress).to.equal(NFT_ADDRESS)
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

  it('refuses a declared issuer the signer is not, before minting anything', async () => {
    const { nautilus } = await createNautilus()
    // The shared fixture declares did:jwk:test-issuer; this suite signs as SIGNER_ADDRESS.
    const asset = new AssetBuilder(getSharedAssetFixture())
      .addService(service('https://files.test.invalid/b.csv'))
      .build()

    await expectThrowsAsync(
      () => nautilus.edit(asset),
      /^The DDO declares issuer "did:jwk:test-issuer" but it is being signed by "0x[0-9a-fA-F]{40}"\..*setIssuer\(\).*Nothing was sent\.$/
    )
    expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()

    // setIssuer() with the signing identity is the way through.
    await nautilus.edit(
      new AssetBuilder(getSharedAssetFixture())
        .setIssuer(SIGNER_ADDRESS.toLowerCase())
        .addService(service('https://files.test.invalid/b.csv'))
        .build()
    )
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
  })

  it('shows a node-served declared issuer sanitised', async () => {
    const { nautilus } = await createNautilus()
    const thrown = (await nautilus
      .edit(
        new AssetBuilder(
          getSharedAssetFixture({
            issuer: `did:x:abc\n[nautilus] forged log line ${FAKE.rpcUrl}`
          })
        ).build()
      )
      .catch((error) => error)) as Error

    expect(thrown.message).to.match(/^The DDO declares issuer "did:x:abc/)
    expect(thrown.message).not.to.contain('\n')
    expect(thrown.message).not.to.contain(FAKE.rpcQueryToken)
    expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
  })

  describe('the NFT it writes to', () => {
    /** Another NFT, e.g. one an attacker granted the signer roles on. */
    const OTHER_NFT = '0x5eED00000000000000000000000000000000baD1'

    /** The fixture (ASSET_DID) with `subject` changed: what a node may serve for it. */
    function served(subject: Record<string, unknown>) {
      const ddo = getAssetFixture()
      Object.assign(ddo.credentialSubject as unknown as object, subject)
      return new AssetBuilder(ddo)
        .addService(service('https://files.test.invalid/b.csv'))
        .build()
    }

    function nothingSent() {
      expect(nftState.calls).not.to.include('getNftOwner')
      expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
      expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
    }

    it("must be the NFT the DDO's DID names: another NFT served for this DID is refused before its owner is read", async () => {
      nftState.owner = '0xa77ac4E7a77Ac4e7a77AC4E7a77ac4E7A77aC4e7'
      const { nautilus } = await createNautilus()

      await expectThrowsAsync(
        () => nautilus.edit(served({ nftAddress: OTHER_NFT })),
        /^edit: the DDO id "did:ope:7e03.*" is not the DID of its NFT 0x5eED00000000000000000000000000000000baD1 on chain 32456 \(did:ope:[0-9a-f]{64}\).*Nothing was sent\.$/
      )
      nothingSent()
    })

    it('must be on the configured chain', async () => {
      const { nautilus } = await createNautilus()

      await expectThrowsAsync(
        () => nautilus.edit(served({ chainId: 1 })),
        /^edit: the DDO is for chain 1, not the configured chain 32456\. Nothing was sent\.$/
      )
      nothingSent()

      // A string chain id is shown as one, so the message does not contradict itself.
      await expectThrowsAsync(
        () => nautilus.edit(served({ chainId: '32456' as unknown as number })),
        /^edit: the DDO is for chain "32456", not the configured chain 32456\. Nothing was sent\.$/
      )
      nothingSent()
    })

    it('must be an address, shown sanitised when it is not', async () => {
      const { nautilus } = await createNautilus()

      const thrown = (await nautilus
        .edit(served({ nftAddress: `0x12\n${FAKE.rpcUrl}` }))
        .catch((error) => error)) as Error

      expect(thrown.message).to.match(
        /^edit: the DDO's nftAddress "0x12.*" is not an address\. Nothing was sent\.$/
      )
      expect(thrown.message).not.to.contain(FAKE.rpcQueryToken)
      nothingSent()
    })
  })

  describe('the owner of the datatokens it creates', () => {
    /** Holds a role on the NFT, but neither owns it nor signs. */
    // Mixed case: checksummed, so a lower-cased form differs from it.
    const ON_CHAIN_OWNER = '0x3c3D0e4b5A6f7a8B9c0D1e2F3a4B5c6D7E8f9A0b'
    const FOREIGN = '0x4444444444444444444444444444444444444444'

    function withNewService(configure = (builder: AssetBuilder) => builder) {
      // The fixture's DDO says nft.owner is OWNER_ADDRESS: what a node reports after
      // OWNER_ADDRESS wrote the metadata last, or a stale or malicious one.
      return configure(new AssetBuilder(getAssetFixture()))
        .addService(service('https://files.test.invalid/b.csv'))
        .build()
    }

    function ownerPassed(): string | undefined {
      return vi.mocked(createDatatokenForService).mock.calls[0]?.[0].owner
    }

    it("is the NFT's on-chain owner, not the DDO's nft.owner", async () => {
      const { nautilus } = await createNautilus()

      await nautilus.edit(withNewService())

      expect(ownerPassed()).to.equal(SIGNER_ADDRESS)
      expect(ownerPassed()).not.to.equal(OWNER_ADDRESS)
    })

    it('is the on-chain owner for a signer that only holds the roles', async () => {
      nftState.owner = ON_CHAIN_OWNER
      const { nautilus } = await createNautilus()
      const log = captureLog()

      await nautilus.edit(withNewService())

      expect(ownerPassed()).to.equal(ON_CHAIN_OWNER)
      expect(log.named('edit.owner.not_nft_owner')).to.have.length(0)
    })

    it('refuses an owner that is neither the signer nor the on-chain owner, before any transaction', async () => {
      const { nautilus } = await createNautilus()

      for (const named of [FOREIGN, OWNER_ADDRESS, 'not-an-address'])
        await expectThrowsAsync(
          () =>
            nautilus.edit(withNewService((builder) => builder.setOwner(named))),
          /edit: setOwner\(\) names .*neither the signer .* nor the owner of NFT .*Nothing was sent/
        )

      expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
      expect(vi.mocked(createPricingForDatatoken)).not.toHaveBeenCalled()
      expect(vi.mocked(prepareMetadataForWrite)).not.toHaveBeenCalled()
      expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
    })

    it('accepts the signer as owner, and warns that the on-chain owner gets no revenue', async () => {
      nftState.owner = ON_CHAIN_OWNER
      const { nautilus } = await createNautilus()
      const log = captureLog()

      await nautilus.edit(
        withNewService((builder) => builder.setOwner(SIGNER_ADDRESS))
      )

      expect(ownerPassed()).to.equal(SIGNER_ADDRESS)
      const [warning] = log.named('edit.owner.not_nft_owner')
      expect(warning.level).to.equal('warn')
      expect(warning.msg).to.match(
        /minter and payment collector \(it receives the payments for priced services\)/
      )
      expect(warning.fields).to.deep.include({
        owner: SIGNER_ADDRESS,
        nftOwner: ON_CHAIN_OWNER
      })
    })

    it('accepts the on-chain owner as owner, without a warning', async () => {
      nftState.owner = ON_CHAIN_OWNER
      const { nautilus } = await createNautilus()
      const log = captureLog()

      await nautilus.edit(
        withNewService((builder) =>
          builder.setOwner(ON_CHAIN_OWNER.toLowerCase())
        )
      )

      expect(ownerPassed()).to.equal(ON_CHAIN_OWNER)
      expect(log.named('edit.owner.not_nft_owner')).to.have.length(0)
    })

    it('refuses an on-chain owner without deployERC20, pointing to setOwner(signer), before any transaction', async () => {
      nftState.owner = ON_CHAIN_OWNER
      nftState.permissionsOf[ON_CHAIN_OWNER.toLowerCase()] = {
        updateMetadata: false,
        deployERC20: false
      }
      const { nautilus } = await createNautilus()

      for (const configure of [
        (builder: AssetBuilder) => builder,
        (builder: AssetBuilder) => builder.setOwner(ON_CHAIN_OWNER)
      ])
        await expectThrowsAsync(
          () => nautilus.edit(withNewService(configure)),
          new RegExp(
            `^edit: ${ON_CHAIN_OWNER}, the owner of NFT .* lacks the deployERC20 permission.*Nothing was sent\\..*setOwner\\('${SIGNER_ADDRESS}'\\)`
          )
        )
      expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
      expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()

      // Only a boolean true counts: a truthy non-boolean is no permission.
      nftState.permissionsOf[ON_CHAIN_OWNER.toLowerCase()] = {
        updateMetadata: false,
        deployERC20: 'false' as unknown as boolean
      }
      await expectThrowsAsync(
        () => nautilus.edit(withNewService((builder) => builder)),
        /lacks the deployERC20 permission/
      )
      expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()

      // The way out it names.
      await nautilus.edit(
        withNewService((builder) => builder.setOwner(SIGNER_ADDRESS))
      )
      expect(ownerPassed()).to.equal(SIGNER_ADDRESS)
    })

    it('treats a zero-address owner as unreadable', async () => {
      nftState.owner = ZeroAddress
      const { nautilus } = await createNautilus()

      await expectThrowsAsync(
        () => nautilus.edit(withNewService()),
        /edit: the owner of NFT .* could not be read from the chain.*Nothing was sent/
      )
      expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
    })

    it('checks a named owner even when the edit creates no datatoken', async () => {
      const { nautilus } = await createNautilus()

      await expectThrowsAsync(
        () =>
          nautilus.edit(
            new AssetBuilder(getAssetFixture()).setOwner(FOREIGN).build()
          ),
        /neither the signer/
      )
      expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
    })

    it('stops before any transaction when the owner cannot be read, without the RPC detail', async () => {
      nftState.ownerError = Object.assign(
        new Error(`server response 503 (requestUrl="${FAKE.rpcUrl}")`),
        { code: 'SERVER_ERROR' }
      )
      const { nautilus } = await createNautilus()

      const thrown = (await nautilus
        .edit(withNewService())
        .catch((error) => error)) as Error

      expect(thrown.message).to.match(
        /edit: the owner of NFT .* could not be read from the chain.*Nothing was sent/
      )
      expect(thrown.message).not.to.contain(FAKE.rpcPathToken)
      expect(thrown.message).not.to.contain('rpc.example.org')
      expect(vi.mocked(createDatatokenForService)).not.toHaveBeenCalled()
      expect(vi.mocked(writeMetadata)).not.toHaveBeenCalled()
    })

    it('hands the failed owner read to the debug channel, under the rpc topic', async () => {
      const events: DebugEvent[] = []
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      setDebug({
        level: 'sensitive',
        topics: ['rpc'],
        sink: (event) => events.push(event)
      })
      nftState.ownerError = new Error('header not found')
      const { nautilus } = await createNautilus()

      await nautilus.edit(withNewService()).catch(() => undefined)

      const [raw] = events.filter(
        (event) => event.message === 'edit: the NFT owner read failed'
      )
      expect(raw.topic).to.equal('rpc')
      expect(JSON.stringify(raw.data)).to.contain('header not found')
    })
  })

  it('reads the NFT owner only when it mints or setOwner() was called', async () => {
    const { nautilus } = await createNautilus()

    await nautilus.edit(new AssetBuilder(getAssetFixture()).build())

    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
    expect(nftState.calls).not.to.include('getNftOwner')
  })

  it('reads the NFT owner inside the NFT lock, after the permission check', async () => {
    const { nautilus } = await createNautilus()
    vi.mocked(writeMetadata).mockImplementation(async () => {
      nftState.calls.push('write:start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      nftState.calls.push('write:end')
      return { hash: '0xsetmetadata', blockNumber: 100 } as never
    })
    const edit = () =>
      nautilus.edit(
        new AssetBuilder(getAssetFixture())
          .addService(service('https://files.test.invalid/b.csv'))
          .build()
      )

    await Promise.all([edit(), edit()])

    const { calls } = nftState
    const at = (call: string, nth = 0) =>
      calls.flatMap((value, index) => (value === call ? [index] : []))[nth]
    expect(at(`getNftPermissions:${SIGNER_ADDRESS}`)).to.be.below(
      at('getNftOwner')
    )
    expect(at('getMetadata')).to.be.below(at('getNftOwner'))
    // The second edit reads the owner only once the first edit's write has finished.
    expect(at('getNftOwner', 1)).to.be.above(at('write:end'))
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

  it('warns, with the RPC error redacted, and goes on when the block cannot be read', async () => {
    const log = captureLog()
    // The error ethers' JsonRpcProvider throws for a failed request: the URL with its
    // token in `info` and in the message, and the ethers code in the message.
    const request = new FetchRequest(FAKE.rpcUrl)
    vi.mocked(getMetadataEventsInBlock).mockRejectedValueOnce(
      makeError('server response 500 Internal Server Error', 'SERVER_ERROR', {
        request,
        response: new FetchResponse(
          500,
          'Internal Server Error',
          {},
          null,
          request
        ),
        info: {
          requestUrl: FAKE.rpcUrl,
          responseBody: '',
          responseStatus: '500 Internal Server Error'
        }
      })
    )
    const { nautilus } = await createNautilus()

    const response = await nautilus.publish(validAsset())

    expect(response.setMetadataTxReceipt.hash).to.equal('0xsetmetadata')
    const [warning] = log.named('publish.metadata.events_unchecked')
    expect(warning.level).to.equal('warn')
    expect(warning.fields.blockNumber).to.equal(100)
    expect(warning.fields.error).to.contain('https://rpc.example.org')
    expect(warning.fields.error).to.contain('code=SERVER_ERROR')
    expect(JSON.stringify(warning)).not.to.contain(FAKE.rpcPathToken)
    expect(JSON.stringify(warning)).not.to.contain(FAKE.rpcQueryToken)
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
    const warn = stderrSpy()
    const { nautilus } = await createNautilus({
      node: { nodeAddress: SIGNER_ADDRESS }
    })

    await nautilus.publish(validAsset())
    await nautilus.publish(validAsset())

    const printed = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('publish.preflight.publisher_is_node'))
    expect(printed).to.have.length(1)
    expect(printed[0]).to.match(
      /is the node's own address.*nonces collide.*401/
    )
  })

  it('does not warn for a different node key', async () => {
    const warn = stderrSpy()
    const { nautilus } = await createNautilus({
      node: { nodeAddress: OWNER_ADDRESS }
    })

    await nautilus.publish(validAsset())

    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes('publish.preflight.publisher_is_node')
      )
    ).to.deep.equal([])
  })
})

describe('policy server that denies every consumer', () => {
  const DENIES_ALL =
    /has a policy server.*no address allow list.*denies every consumer/

  // What the user sees: the default logger's output on stderr, at the default level.
  const warnSpy = stderrSpy

  function warnings(warn: ReturnType<typeof warnSpy>) {
    return warn.mock.calls.map((call) => String(call[0]))
  }

  it('prints the warning on stderr at the default level, as a catalogued event', async () => {
    const warn = warnSpy()
    const { nautilus } = await createNautilus({ node: { policyServer: true } })

    await nautilus.publish(validAsset())

    const printed = warnings(warn).filter((text) => DENIES_ALL.test(text))
    expect(printed).to.have.length(1)
    expect(printed[0]).to.contain('publish.preflight.denies_all')
  })

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

  it("goes to the instance's own logger when it has one, and to the process-wide one otherwise", async () => {
    const global = captureLog()
    const tenant: LogEvent[] = []
    const { nautilus: own } = await createNautilus({
      node: { policyServer: true },
      logger: { level: 'debug', sink: (event) => tenant.push(event) }
    })
    const { nautilus: shared } = await createNautilus({
      node: { policyServer: true }
    })

    await own.publish(validAsset())
    await shared.publish(validAsset())

    // The instance's level applies to it alone: its debug events, none in the global sink.
    expect(tenant.map((event) => event.event)).to.include.members([
      'chain.config.ready',
      'publish.preflight.denies_all'
    ])
    expect(global.events.map((event) => event.event)).to.deep.equal([
      'publish.preflight.denies_all'
    ])
  })

  it('accepts a logger made with createLogger, which several instances can share', async () => {
    const global = captureLog()
    const tenant: LogEvent[] = []
    const logger = createLogger({
      level: 'debug',
      sink: (event) => tenant.push(event)
    })
    const { nautilus: first } = await createNautilus({
      node: { policyServer: true },
      logger
    })
    const { nautilus: second } = await createNautilus({
      node: { policyServer: true },
      logger
    })

    await first.publish(validAsset())
    await second.publish(validAsset())

    expect(
      tenant.filter((event) => event.event === 'publish.preflight.denies_all')
    ).to.have.length(2)
    expect(tenant.map((event) => event.event)).to.include('chain.config.ready')
    expect(global.events).to.deep.equal([])
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
    nftState.hasMetadata = true
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
    const log = captureLog()
    const { nautilus } = await createNautilus({
      node: { indexerNonce: oneAwayState() }
    })

    await nautilus.publish(validAsset())

    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
    const [warning] = log.named('publish.preflight.indexer_nonce_will_stick')
    expect(warning.msg).to.match(/second decrypt call/)
  })
})

describe('setAssetLifecycleState and getAssetLifecycleState', () => {
  /** Another factory NFT, and the DID it derives on the test chain. */
  const OTHER_NFT = '0x3c3D0e4b5A6f7a8B9c0D1e2F3a4B5c6D7E8f9A0b'

  beforeEach(() => {
    nftState.hasMetadata = true
  })

  /** A node whose `resolve` answers 404, with `state` as the indexing record. */
  async function goneFromNode(state?: Record<string, unknown>) {
    const created = await createNautilus()
    created.node.client.resolve = vi.fn(async (did: string) => {
      throw new AssetNotFoundError(did, state as never)
    }) as never
    return created
  }

  it('sends to an NFT address without resolving, checksummed', async () => {
    const { nautilus, node } = await createNautilus()

    const receipt = await nautilus.setAssetLifecycleState(
      NFT_ADDRESS.toLowerCase(),
      3
    )

    expect(receipt).to.deep.equal({ hash: '0xstate' })
    expect(node.calls.resolve).to.have.length(0)
    expect(vi.mocked(setMetadataState)).toHaveBeenCalledOnce()
    expect(vi.mocked(setMetadataState).mock.calls[0][0]).to.include({
      nftAddress: NFT_ADDRESS,
      state: 3
    })
  })

  it('refuses an address with a wrong checksum, before any read', async () => {
    const { nautilus } = await createNautilus()
    const wrong = NFT_ADDRESS.replace('bB', 'Bb')

    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(wrong, 2),
      /is not an address, or its checksum is wrong\. Nothing was sent\./
    )
    expect(nftState.calls).to.have.length(0)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('refuses a target that is no asset, DID or address', async () => {
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState('my-asset\nINJECTED', 2),
      /must be an asset, its DID or its NFT address; got "my-asset/
    )
    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(1.5 as never, 2),
      /must be an asset, its DID or its NFT address/
    )
    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(NFT_ADDRESS, 1.5 as never),
      /state must be a lifecycle state/
    )
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('refuses an NFT the factory did not create, before reading anything from it', async () => {
    nftState.factoryListed = ZeroAddress
    const { nautilus } = await createNautilus()

    // The label carries no name or symbol: those would come from the contract itself.
    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(OTHER_NFT, 3),
      /setAssetLifecycleState: NFT 0x3c3D\w+ \(did:ope:[0-9a-f]{64}\) was not created by the ERC721 factory .*Nothing was sent\./
    )
    expect(vi.mocked(readNftLabel)).not.toHaveBeenCalled()
    expect(nftState.calls).to.deep.equal(['checkNFT'])
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('refuses a signer without the metadata role, or an NFT without metadata', async () => {
    const { nautilus } = await createNautilus()

    nftState.permissions = { updateMetadata: false, deployERC20: true }
    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(NFT_ADDRESS, 2),
      /lacks the metadata role on NFT 0xBB10.*"Lifecycle NFT", LNFT; did:ope:/
    )

    nftState.permissions = { updateMetadata: true, deployERC20: true }
    nftState.hasMetadata = false
    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(NFT_ADDRESS, 5),
      /carries no metadata, so it is not a published asset/
    )
    await expectThrowsAsync(
      () => nautilus.getAssetLifecycleState(NFT_ADDRESS),
      /carries no metadata/
    )
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('judges "already in that state" from the chain, not the DDO', async () => {
    const { nautilus } = await createNautilus()
    const log = captureLog()
    // The DDO says ACTIVE; the NFT was unlisted since.
    const stale = getAssetFixture()
    nftState.state = 5

    expect(await nautilus.setAssetLifecycleState(stale, 5)).to.equal(undefined)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
    expect(log.named('lifecycle.state.unchanged')).to.have.length(1)

    expect(await nautilus.setAssetLifecycleState(stale, 0)).to.deep.equal({
      hash: '0xstate'
    })
    expect(vi.mocked(setMetadataState).mock.calls[0][0].state).to.equal(0)
  })

  it('reports a revoke at warn, printed by default, naming the NFT', async () => {
    const { nautilus } = await createNautilus()
    // The default level.
    const log = captureLog({ level: 'warn' })

    await nautilus.setAssetLifecycleState(NFT_ADDRESS, 3)

    const [retired] = log.named('lifecycle.state.retired')
    expect(retired.level).to.equal('warn')
    expect(retired.msg).to.match(
      /NFT 0xBB10.* \("Lifecycle NFT", LNFT; did:ope:.*\) moved from lifecycle state 0 to 3 \(tx 0xstate\)/
    )
    expect(retired.did).to.equal(expectedDid(NFT_ADDRESS, CHAIN_ID))
    expect(retired.fields).to.include({ nftAddress: NFT_ADDRESS, previous: 0 })
    expect(log.named('lifecycle.state.set')).to.have.length(0)
  })

  it('reports a deprecation at warn, and a reversible change at info', async () => {
    const { nautilus } = await createNautilus()
    const log = captureLog({ level: 'info' })

    nftState.state = 0
    await nautilus.setAssetLifecycleState(NFT_ADDRESS, 5)
    nftState.state = 5
    await nautilus.setAssetLifecycleState(NFT_ADDRESS, 2)

    const [set] = log.named('lifecycle.state.set')
    expect(set.level).to.equal('info')
    expect(set.msg).to.match(/moved from lifecycle state 0 to 5/)
    const [retired] = log.named('lifecycle.state.retired')
    expect(retired.level).to.equal('warn')
    expect(retired.msg).to.match(/moved from lifecycle state 5 to 2/)
  })

  it('resolves a DID and uses the NFT it is derived from', async () => {
    const { nautilus, node } = await createNautilus({
      node: { assets: { [ASSET_DID]: getAssetFixture() } }
    })

    await nautilus.setAssetLifecycleState(ASSET_DID, 2)

    expect(node.calls.resolve).to.deep.equal([ASSET_DID])
    expect(vi.mocked(setMetadataState).mock.calls[0][0].nftAddress).to.equal(
      NFT_ADDRESS
    )
  })

  it('refuses a DID whose served DDO derives another DID, before any read', async () => {
    const otherDid = expectedDid(OTHER_NFT, CHAIN_ID)
    // Self-consistent, but another asset's DDO, served for the victim's DID.
    const forged = getAssetFixture({ id: otherDid })
    ;(
      forged as unknown as { credentialSubject: { nftAddress: string } }
    ).credentialSubject.nftAddress = OTHER_NFT
    const { nautilus } = await createNautilus({
      node: { assets: { [ASSET_DID]: forged } }
    })

    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(ASSET_DID, 3),
      /the node answered did:ope:.* with the DDO of did:ope:.* \(NFT 0x3c3D.*\)\. Refused/
    )
    expect(nftState.calls).to.have.length(0)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it("refuses an asset object whose NFT is not its id's", async () => {
    const forged = getAssetFixture()
    ;(
      forged as unknown as { credentialSubject: { nftAddress: string } }
    ).credentialSubject.nftAddress = OTHER_NFT
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(forged, 3),
      /is not the DID of its NFT 0x3c3D/
    )
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('on a 404, takes the NFT from the indexing record, checked against the DID', async () => {
    const { nautilus } = await goneFromNode({
      did: ASSET_DID,
      chainId: CHAIN_ID,
      nft: NFT_ADDRESS.toLowerCase(),
      valid: true,
      error: 'Schema for version deprecated not found'
    })

    await nautilus.setAssetLifecycleState(ASSET_DID, 3)

    expect(vi.mocked(setMetadataState).mock.calls[0][0].nftAddress).to.equal(
      NFT_ADDRESS
    )
  })

  it('on a 404, refuses a record naming another NFT or chain', async () => {
    for (const record of [
      { nft: OTHER_NFT, chainId: CHAIN_ID },
      { nft: NFT_ADDRESS, chainId: CHAIN_ID + 1 },
      { nft: 'not-an-address\nINJECTED' }
    ]) {
      const { nautilus } = await goneFromNode({ valid: false, ...record })

      await expectThrowsAsync(
        () => nautilus.setAssetLifecycleState(ASSET_DID, 3),
        /the NFT its indexing record names, ".*", is not that DID's NFT .*pass the asset's NFT address instead/
      )
    }
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('on a 404 whose record names no NFT (ocean-node 4.2.2), asks for the NFT address', async () => {
    const { nautilus } = await goneFromNode({
      did: ASSET_DID,
      chainId: CHAIN_ID,
      nft: null,
      valid: true,
      error: 'Schema for version deprecated not found'
    })

    const error = await nautilus
      .setAssetLifecycleState(ASSET_DID, 3)
      .catch((e: Error) => e)

    expect(String(error)).to.match(
      /does not serve did:ope:.* \(HTTP 404\), and its indexing record names no NFT.*pass the asset's NFT address instead/
    )
    expect((error as Error).cause).to.be.instanceOf(AssetNotFoundError)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('getAssetLifecycleState reads the chain for every kind of target', async () => {
    const { nautilus } = await createNautilus({
      node: { assets: { [ASSET_DID]: getAssetFixture() } }
    })
    nftState.state = 2

    expect(await nautilus.getAssetLifecycleState(NFT_ADDRESS)).to.equal(2)
    expect(await nautilus.getAssetLifecycleState(ASSET_DID)).to.equal(2)
    // The DDO says ACTIVE.
    expect(await nautilus.getAssetLifecycleState(getAssetFixture())).to.equal(2)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  /**
   * The error ethers' JsonRpcProvider throws for a refused request (401, as from a rate
   * limit or an expired key): `FetchResponse.assertOk()`'s own, with the request URL and the
   * response body in `info` and in the message.
   */
  function rpcRefusal(): Error {
    const request = new FetchRequest(FAKE.rpcUrl)
    const response = new FetchResponse(
      401,
      'Unauthorized',
      {},
      new TextEncoder().encode(
        `{"error":"rate limited, apikey=${FAKE.rpcQueryToken}"}`
      ),
      request
    )
    try {
      response.assertOk()
    } catch (error) {
      return error as Error
    }
    throw new Error('assertOk() did not throw')
  }

  /** Asserts that the RPC's error, with its key, reached neither the message nor the error. */
  function expectNoRpcDetail(error: Error) {
    for (const text of [error.message, inspect(error, { depth: 12 })]) {
      expect(text).not.to.contain(FAKE.rpcPathToken)
      expect(text).not.to.contain(FAKE.rpcQueryToken)
      expect(text).not.to.contain('rpc.example.org')
    }
  }

  it('stops without the RPC detail when the factory cannot be read', async () => {
    // The real error carries the key: the test would prove nothing otherwise.
    expect(rpcRefusal().message).to.contain(FAKE.rpcPathToken)
    expect(rpcRefusal().message).to.contain(FAKE.rpcQueryToken)
    const events: DebugEvent[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    setDebug({
      level: 'sensitive',
      topics: ['rpc'],
      sink: (event) => events.push(event)
    })
    nftState.factoryError = rpcRefusal()
    const { nautilus } = await createNautilus()

    const error = (await nautilus
      .setAssetLifecycleState(NFT_ADDRESS, 3)
      .catch((e: Error) => e)) as Error

    expect(error.message).to.match(
      /^setAssetLifecycleState: whether NFT 0xBB10\w+ \(did:ope:[0-9a-f]{64}\) was created by the ERC721 factory .* could not be read from the chain\. Nothing was sent\. Try again, or check the RPC\.$/
    )
    expectNoRpcDetail(error)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
    const [raw] = events.filter((event) =>
      event.message.includes("the factory's erc721List read failed")
    )
    expect(raw.topic).to.equal('rpc')
    expect(JSON.stringify(raw.data)).to.contain('401')
  })

  it('stops without the RPC detail when the state cannot be read', async () => {
    nftState.metadataError = rpcRefusal()
    const { nautilus } = await createNautilus()

    const set = (await nautilus
      .setAssetLifecycleState(NFT_ADDRESS, 3)
      .catch((e: Error) => e)) as Error
    expect(set.message).to.match(
      /^setAssetLifecycleState: the lifecycle state of NFT 0xBB10.* could not be read from the chain\. Nothing was sent\. Try again, or check the RPC\.$/
    )
    expectNoRpcDetail(set)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()

    const get = (await nautilus
      .getAssetLifecycleState(NFT_ADDRESS)
      .catch((e: Error) => e)) as Error
    expect(get.message).to.match(
      /^Could not read the metadata state of NFT 0xBB10\w+: the getMetaData call failed/
    )
    expectNoRpcDetail(get)
  })

  it("shows getMetaData's odd answer sanitised and bounded", async () => {
    nftState.metadataAnswer = [`\u001b[31mMy NFT\nINJECTED ${'x'.repeat(500)}`]
    const { nautilus } = await createNautilus()

    const error = (await nautilus
      .getAssetLifecycleState(NFT_ADDRESS)
      .catch((e: Error) => e)) as Error

    expect(error.message).to.match(
      /^Could not read the metadata state of NFT 0xBB10\w+ \(getMetaData returned /
    )
    expect(error.message).not.to.contain('\u001b')
    expect(error.message).not.to.contain('\n')
    expect(error.message.length).to.be.below(400)

    // An answer that is no state at all (an EOA's empty answer decodes to nothing).
    nftState.metadataAnswer = ['uri', OWNER_ADDRESS, 'not a state', true]
    await expectThrowsAsync(
      () => nautilus.getAssetLifecycleState(NFT_ADDRESS),
      /Could not read the metadata state of NFT/
    )
  })

  it('refuses a state outside LifecycleStates, saying nothing was sent', async () => {
    const { nautilus } = await createNautilus()

    for (const [state, shown] of [
      [7, 'got 7\\.'],
      [255, 'got 255\\.'],
      [-1, 'got -1\\.'],
      [Number.NaN, 'got NaN\\.'],
      [3n, 'got 3n, a bigint\\.'],
      ['3', 'got "3"\\.'],
      [{}, 'got an object\\.'],
      [Object.create(null), 'got an object\\.']
    ] as const)
      await expectThrowsAsync(
        () => nautilus.setAssetLifecycleState(NFT_ADDRESS, state as never),
        new RegExp(
          `state must be a lifecycle state, a number from 0 to 5 \\(see LifecycleStates\\); ${shown} Nothing was sent\\.$`
        )
      )
    expect(nftState.calls).to.have.length(0)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('refuses a malformed DID or an object that is no DDO locally, saying nothing was sent', async () => {
    const { nautilus, node } = await createNautilus()

    for (const did of [
      'did:ope:zz',
      `did:ope:${'a'.repeat(63)}`,
      `did:ope:${'a'.repeat(65)}`,
      `did:web:${'a'.repeat(64)}`
    ])
      await expectThrowsAsync(
        () => nautilus.setAssetLifecycleState(did, 3),
        /is not an asset DID \(did:ope: and 64 hexadecimal digits\)\. Nothing was sent\./
      )
    expect(node.calls.resolve).to.have.length(0)

    for (const target of [{}, { id: 5 }, []])
      await expectThrowsAsync(
        () => nautilus.setAssetLifecycleState(target as never, 3),
        /the object given is not a DDO .*Nothing was sent\./
      )
    await expectThrowsAsync(
      () => nautilus.getAssetLifecycleState({} as never),
      /the object given is not a DDO/
    )
    expect(nftState.calls).to.have.length(0)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('says "name unreadable" when the NFT does not answer name()', async () => {
    vi.mocked(readNftLabel).mockResolvedValueOnce({ symbol: 'LNFT' })
    nftState.permissions = { updateMetadata: false, deployERC20: true }
    const { nautilus } = await createNautilus()

    await expectThrowsAsync(
      () => nautilus.setAssetLifecycleState(NFT_ADDRESS, 3),
      /lacks the metadata role on NFT 0xBB10\w+ \(name unreadable, LNFT; did:ope:/
    )
  })

  it('tells an unknown DID (404, no indexing record) from a dropped one', async () => {
    const { nautilus } = await goneFromNode(undefined)

    const error = (await nautilus
      .setAssetLifecycleState(ASSET_DID, 3)
      .catch((e: Error) => e)) as Error

    expect(error.message).to.match(
      /does not serve did:ope:.* \(HTTP 404\) and has no indexing record of it, so it knows no asset with that DID\. Check the DID.*Nothing was sent\./
    )
    expect(error.message).not.to.contain('DEPRECATED')
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })

  it('a revoke by DID runs before an edit started after it', async () => {
    const { nautilus } = await createNautilus({
      node: { assets: { [ASSET_DID]: getAssetFixture() } }
    })
    const order: string[] = []
    vi.mocked(setMetadataState).mockImplementationOnce(async () => {
      order.push('revoke')
      nftState.state = 3
      return { hash: '0xstate' } as never
    })
    vi.mocked(writeMetadata).mockImplementation((async () => {
      order.push('edit-write')
      return { hash: '0xedit', blockNumber: 100 }
    }) as never)

    const [revoke, edit] = await Promise.allSettled([
      nautilus.setAssetLifecycleState(ASSET_DID, 3),
      nautilus.edit(new AssetBuilder(getAssetFixture()).build())
    ])

    expect(revoke.status).to.equal('fulfilled')
    expect(order).to.deep.equal(['revoke'])
    expect(edit.status).to.equal('rejected')
    expect(String((edit as PromiseRejectedResult).reason)).to.match(
      /lifecycle state 3/
    )
  })

  it('a revoke by DID that is refused does not hold up the edit after it', async () => {
    const { nautilus } = await goneFromNode(undefined)

    const [revoke, edit] = await Promise.allSettled([
      nautilus.setAssetLifecycleState(ASSET_DID, 3),
      nautilus.edit(new AssetBuilder(getAssetFixture()).build())
    ])

    expect(revoke.status).to.equal('rejected')
    expect(edit.status).to.equal('fulfilled')
    expect(vi.mocked(writeMetadata)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setMetadataState)).not.toHaveBeenCalled()
  })
})
