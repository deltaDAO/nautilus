/**
 * Log snapshots of the public operations (PR 10d): which events a call logs, in order, at
 * `info` and at `debug`, with the transaction hashes, DIDs and durations the milestones
 * carry. A change to what an operation logs fails here, on purpose: update the snapshot
 * together with the event catalogue.
 *
 * The chain writes are stubbed below `Nautilus` (the mint, the datatokens, the metadata
 * write, the lifecycle write), the way PublishPreflight.test.ts stubs them, so the
 * milestones the orchestrator logs are what is pinned here. The steps inside the stubbed
 * functions are pinned in LogCoverageSteps.test.ts.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEvent } from '../../src/log/index.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { writeMetadata } from '../../src/publish/index.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { editPrice, setMetadataState } from '../../src/utils/contracts.js'
import {
  ASSET_DID,
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import { type CapturedLog, captureLog } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'
const SIGNER_ADDRESS = new Wallet(PRIVATE_KEY).address

const MINT_TX = `0x${'a1'.repeat(32)}`
const DATATOKEN_TX = `0x${'a2'.repeat(32)}`
const METADATA_TX = `0x${'a3'.repeat(32)}`
const STATE_TX = `0x${'a4'.repeat(32)}`
const PRICE_TX = `0x${'a5'.repeat(32)}`
const SECOND_DATATOKEN = '0x1111111111111111111111111111111111111111'
const STORED_CID = vi.hoisted(
  () => 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
)

/** The signer's address, which owns the NFT `completePublish()` finishes. */
const SIGNER_ADDRESS_HOISTED = vi.hoisted(() => ({ value: '' }))

/** The NFT as `completePublish()` and `edit()` read it from the chain. */
const nftState = vi.hoisted(() => ({ hasMetadata: false, state: 0 }))

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Nft: class {
      async getMetadata() {
        return [
          'https://node.test.invalid',
          '',
          nftState.state,
          nftState.hasMetadata
        ]
      }
      async getNftOwner() {
        return SIGNER_ADDRESS_HOISTED.value
      }
      async getNftPermissions() {
        return {
          manager: true,
          store: true,
          updateMetadata: true,
          deployERC20: true
        }
      }
    },
    NftFactory: class {
      async checkNFT(nftAddress: string) {
        return nftAddress
      }
    }
  }
})

vi.mock('../../src/utils/contracts.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setMetadataState: vi.fn(),
  editPrice: vi.fn(),
  getMetadataEventsInBlock: vi.fn(async () => [])
}))

// Every chain write is stubbed; what the orchestrator logs around them is under test.
vi.mock('../../src/publish/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createNftWithService: vi.fn(async () => ({
    nftAddress: NFT_ADDRESS,
    datatokenAddress: DATATOKEN_ADDRESS,
    tx: { hash: MINT_TX, blockNumber: 99 }
  })),
  createDatatokenForService: vi.fn(
    async ({ service }: { service: { datatokenAddress?: string } }) => {
      service.datatokenAddress = SECOND_DATATOKEN
      return {
        datatokenAddress: SECOND_DATATOKEN,
        tx: { hash: DATATOKEN_TX, blockNumber: 99 }
      }
    }
  ),
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
  writeMetadata: vi.fn(),
  waitForMetadataPermission: vi.fn(async () => undefined)
}))

function service(name = 'Access Service') {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setName(name)
    .setPricing({ type: 'free' })
    .addFile({
      type: 'url',
      url: 'https://files.test.invalid/a.csv',
      method: 'GET'
    })
    .build()
}

function asset(services = 1) {
  const builder = new AssetBuilder()
    .setType('dataset')
    .setName('Coverage Dataset')
    .setProvidedBy('deltaDAO AG')
    .setDescription('A description')
  for (let index = 0; index < services; index++)
    builder.addService(service(`Service ${index}`))
  return builder.build()
}

/** A store that reads its object back, as the IPFS and S3 stores do. */
const store: RemoteStore = {
  put: async () =>
    ({ type: 'ipfs', hash: STORED_CID }) as unknown as StorageObject,
  verify: async () => undefined
}

async function createNautilus() {
  const signer = new Wallet(PRIVATE_KEY).connect({
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }),
    getTransactionCount: async () => 4
  } as never)

  const nautilus = await Nautilus.create(signer, {
    remoteStore: store,
    config: {
      oceanNodeUri: 'https://node.test.invalid',
      nftFactoryAddress: NFT_ADDRESS,
      fixedRateExchangeAddress: DATATOKEN_ADDRESS,
      dispenserAddress: OWNER_ADDRESS
    }
  })
  const node = createNodeMock()
  ;(nautilus as unknown as { node: OceanNodeClient }).node = node.client
  return nautilus
}

/** `level event` of each event, in order: the snapshot. */
function story(log: CapturedLog): string[] {
  return log.events.map((event) => `${event.level} ${event.event}`)
}

function only(log: CapturedLog, name: string): LogEvent {
  const found = log.events.filter((event) => event.event === name)
  expect(found, name).to.have.length(1)
  return found[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  SIGNER_ADDRESS_HOISTED.value = SIGNER_ADDRESS
  nftState.hasMetadata = false
  nftState.state = 0
  vi.mocked(writeMetadata).mockImplementation(async ({ onProgress }) => {
    onProgress?.('sent', METADATA_TX)
    return { hash: METADATA_TX, blockNumber: 100, status: 1 } as never
  })
  vi.mocked(setMetadataState).mockResolvedValue({
    hash: STATE_TX,
    blockNumber: 101
  } as never)
  vi.mocked(editPrice).mockResolvedValue({
    hash: PRICE_TX,
    blockNumber: 102
  } as never)
})

describe('publish() log', () => {
  it('tells the whole story at info in 6-8 lines, with tx hashes, the DID and durations', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'info' })

    await nautilus.publish(asset(), { waitForIndexer: true })

    expect(story(log)).toEqual([
      'info publish.tokens.created',
      'info publish.ddo.stored',
      'info publish.ddo.verified',
      'info publish.metadata.sent',
      'info publish.metadata.confirmed',
      'info publish.indexer.indexed',
      'info publish.operation.finished'
    ])
    expect(log.events.length).to.be.within(6, 8)

    expect(only(log, 'publish.tokens.created')).toMatchObject({
      txHash: MINT_TX,
      fields: { nftAddress: NFT_ADDRESS, datatokenAddress: DATATOKEN_ADDRESS }
    })
    expect(only(log, 'publish.ddo.stored')).toMatchObject({
      did: ASSET_DID,
      fields: { pointer: { type: 'ipfs', hash: STORED_CID } }
    })
    expect(only(log, 'publish.metadata.sent').txHash).to.equal(METADATA_TX)
    expect(only(log, 'publish.metadata.confirmed')).toMatchObject({
      txHash: METADATA_TX,
      fields: { blockNumber: 100 }
    })
    expect(only(log, 'publish.indexer.indexed').did).to.equal(ASSET_DID)
    expect(only(log, 'publish.operation.finished')).toMatchObject({
      did: ASSET_DID,
      txHash: METADATA_TX,
      fields: { nftAddress: NFT_ADDRESS }
    })

    // Every milestone but the send carries how long its step took.
    for (const event of log.events)
      if (event.event !== 'publish.metadata.sent')
        expect(event.durationMs, event.event).to.be.a('number')
    // One operation, so one opId on every line.
    expect(new Set(log.events.map((event) => event.opId)).size).to.equal(1)
  })

  it('stays within the budget for a two-service publish without the indexer wait', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'info' })

    await nautilus.publish(asset(2))

    expect(story(log)).toEqual([
      'info publish.tokens.created',
      'info publish.datatoken.created',
      'info publish.ddo.stored',
      'info publish.ddo.verified',
      'info publish.metadata.sent',
      'info publish.metadata.confirmed',
      'info publish.operation.finished'
    ])
    expect(only(log, 'publish.datatoken.created')).toMatchObject({
      txHash: DATATOKEN_TX,
      fields: { datatokenAddress: SECOND_DATATOKEN }
    })
  })

  it('logs each step at debug', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'debug' })

    await nautilus.publish(asset(), { waitForIndexer: true })

    expect(story(log)).toEqual([
      'debug publish.operation.started',
      'debug publish.preflight.passed',
      'info publish.tokens.created',
      'info publish.ddo.stored',
      'info publish.ddo.verified',
      'info publish.metadata.sent',
      'info publish.metadata.confirmed',
      'debug publish.indexer.waiting',
      'info publish.indexer.indexed',
      'info publish.operation.finished'
    ])
  })

  it('logs nothing at the default level', async () => {
    const nautilus = await createNautilus()
    const log = captureLog()

    await nautilus.publish(asset(), { waitForIndexer: true })

    expect(log.events).toEqual([])
  })

  it('names the failure, after the milestones that happened', async () => {
    const nautilus = await createNautilus()
    vi.mocked(writeMetadata).mockRejectedValueOnce(new Error('rpc went away'))
    const log = captureLog({ level: 'info' })

    await expect(nautilus.publish(asset())).rejects.toThrow()

    expect(story(log)).toEqual([
      'info publish.tokens.created',
      'info publish.ddo.stored',
      'info publish.ddo.verified',
      'info publish.operation.failed'
    ])
  })
})

describe('completePublish() log', () => {
  it('logs the reuse plan at debug and the same milestones', async () => {
    const nautilus = await createNautilus()
    const contracts = await import('../../src/utils/contracts.js')
    vi.spyOn(contracts, 'getNftDatatokens').mockResolvedValue([])
    const log = captureLog({ level: 'debug' })

    await nautilus.completePublish(NFT_ADDRESS, asset())

    expect(story(log)).toEqual([
      'debug publish.operation.started',
      'debug publish.reuse.planned',
      'debug publish.preflight.passed',
      'info publish.datatoken.created',
      'info publish.ddo.stored',
      'info publish.ddo.verified',
      'info publish.metadata.sent',
      'info publish.metadata.confirmed',
      'info publish.operation.finished'
    ])
    expect(only(log, 'publish.reuse.planned').fields).toEqual({
      nftAddress: NFT_ADDRESS,
      steps: [{ service: 'Service 0', action: 'create' }]
    })
  })
})

describe('edit() log', () => {
  it('ends with the DID and the metadata transaction', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'debug' })

    await nautilus.edit(new AssetBuilder(getAssetFixture()).build())

    expect(story(log)).toEqual([
      'debug edit.operation.started',
      'debug publish.preflight.passed',
      'info publish.ddo.stored',
      'info publish.ddo.verified',
      'info publish.metadata.sent',
      'info publish.metadata.confirmed',
      'info edit.operation.finished'
    ])
    expect(only(log, 'edit.operation.finished')).toMatchObject({
      did: ASSET_DID,
      txHash: METADATA_TX
    })
  })

  it('ends setServicePrice() with its transaction', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'info' })

    await nautilus.setServicePrice(getAssetFixture(), 'any', '2')

    expect(story(log)).toEqual(['info edit.operation.finished'])
    expect(only(log, 'edit.operation.finished')).toMatchObject({
      txHash: PRICE_TX
    })
  })
})

describe('setAssetLifecycleState() log', () => {
  it('logs the change at debug and ends with the DID, the state and its transaction', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'debug' })

    await nautilus.setAssetLifecycleState(getAssetFixture(), 2)

    expect(story(log)).toEqual([
      'debug lifecycle.operation.started',
      'debug lifecycle.state.sending',
      'info lifecycle.operation.finished'
    ])
    expect(only(log, 'lifecycle.state.sending').fields).toEqual({
      nftAddress: NFT_ADDRESS,
      from: 0,
      to: 2
    })
    expect(only(log, 'lifecycle.operation.finished')).toMatchObject({
      did: ASSET_DID,
      txHash: STATE_TX,
      fields: { state: 2 }
    })
  })

  it('names no transaction when nothing was sent', async () => {
    const nautilus = await createNautilus()
    const log = captureLog({ level: 'info' })

    await nautilus.setAssetLifecycleState(getAssetFixture(), 0)

    expect(story(log)).toEqual([
      'warn lifecycle.state.unchanged',
      'info lifecycle.operation.finished'
    ])
    expect(only(log, 'lifecycle.operation.finished').txHash).to.equal(undefined)
  })
})
