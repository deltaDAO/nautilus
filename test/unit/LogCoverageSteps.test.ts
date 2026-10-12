/**
 * Log snapshots of the steps inside an operation (PR 10d): the access path (policy
 * session, provider fee, order lookup and decision, download URL) and the steps of
 * preparing a DDO for the chain. LogCoverage.test.ts pins the milestones `Nautilus` logs
 * around them; the node requests and indexer waits are pinned in Indexing.test.ts, the
 * nonce guard's decisions in NonceGuard.test.ts and compute() in ComputeRegressions.test.ts.
 *
 * At `debug` these lines answer what the beta.2 run needed out-of-band queries for: how
 * long the previous-order lookup took and what it found (N9's 40 s), and which session
 * the policy server opened.
 */
import type { Config, StorageObject } from '@oceanprotocol/lib'
import { type Provider, type Signer, Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, settleOrder } from '../../src/access/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import { runOperation } from '../../src/log/context.js'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import type { LogEvent } from '../../src/log/index.js'
import { log as processLog } from '../../src/log/logger.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { prepareMetadataForWrite } from '../../src/publish/index.js'
import { Eip191VcSigner } from '../../src/signing/vc.js'
import { order } from '../../src/utils/order.js'
import { IncompleteOrderLookupError } from '../../src/utils/previousOrder.js'
import {
  ASSET_DID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import {
  poisonedProviderFee,
  signedProviderFee
} from '../fixtures/ProviderFee.js'
import { type CapturedLog, captureLog } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'
import { FAKE } from '../secretScan.js'

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(async () => ({ transferTxId: ORDER_TX, reused: false }))
}))

vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async (_signer: unknown, datatokenAddress: string) => ({
    schema: 'free',
    templateId: 1,
    datatokenAddress,
    publishMarketFee: {}
  })),
  getOrderPrice: vi.fn(async () => ({
    total: '0',
    consumeMarketFee: '0',
    publishMarketFee: '0'
  }))
}))

const ORDER_TX = vi.hoisted(() => `0x${'0d'.repeat(32)}`)
const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'
const CONSUMER = '0x0000000000000000000000000000000000c05e5a'
const DOWNLOAD_URL = `https://node.test.invalid/api/services/download?signature=${FAKE.signature}&nonce=7`
const chainConfig = {
  chainId: 32456,
  dispenserAddress: '0x0000000000000000000000000000000000d15e45'
} as unknown as Config

/**
 * A chain of 2 s blocks, head at block 10 000, holding no order of the account: the
 * previous-order lookup reads the whole window. `fail` makes `getLogs` throw it instead.
 */
function chain(fail?: Error): Provider {
  const now = Math.floor(Date.now() / 1000)
  const head = 10_000
  return {
    getBlock: async (tag: number | string) => {
      const number = tag === 'latest' ? head : Number(tag)
      return { number, timestamp: now - (head - number) * 2 }
    },
    getLogs: async () => {
      if (fail) throw fail
      return []
    },
    getTransactionReceipt: async () => null
  } as unknown as Provider
}

function consumer(provider?: Provider): Signer {
  return { getAddress: async () => CONSUMER, provider } as unknown as Signer
}

/** A node without a policy server that answers the download path. */
function node(asset: AssetV5 = getAssetFixture(), fees: unknown[] = []) {
  const client = {
    nodeUri: 'https://node.test.invalid',
    policySessionAddress: (address: string) => address,
    hasPolicyServer: async () => false,
    forEndpoint: () => client,
    resolve: async () => asset,
    initialize: async () => ({
      datatoken: DATATOKEN_ADDRESS,
      providerFee:
        fees.length > 1
          ? fees.shift()
          : (fees[0] ?? signedProviderFee({ providerFeeAmount: '0' }))
    }),
    getDownloadUrl: async () => DOWNLOAD_URL
  } as unknown as OceanNodeClient
  return client
}

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
})

describe('access() steps', () => {
  it('logs the session, the fee, the lookup, the decision and the URL at debug', async () => {
    const log = captureLog({ level: 'debug' })

    await access(
      { assetDid: ASSET_DID },
      { node: node(), signer: consumer(chain()), chainConfig }
    )

    expect(story(log)).toEqual([
      'debug identity.session.resolved',
      'debug access.provider_fee.quoted',
      'debug access.order.lookup_finished',
      'debug access.order.planned',
      'info access.order.settled',
      'debug access.download_url.created'
    ])
    expect(only(log, 'identity.session.resolved').fields).toMatchObject({
      outcome: 'no-policy-server',
      serviceId: SERVICE_ID
    })
    expect(only(log, 'access.order.lookup_finished')).toMatchObject({
      fields: { result: 'none', timeout: 86400 }
    })
    expect(only(log, 'access.order.lookup_finished').durationMs).to.be.a(
      'number'
    )
    expect(only(log, 'access.order.planned').fields).toMatchObject({
      plan: 'order',
      price: '0'
    })
    expect(only(log, 'access.order.settled')).toMatchObject({
      did: ASSET_DID,
      txHash: ORDER_TX,
      fields: { reused: false }
    })
    // The download URL carries the signature: only its node's origin is logged.
    const all = JSON.stringify(log.events)
    expect(all).not.toContain('download?')
    expect(all).not.toContain(FAKE.signature)
    expect(only(log, 'access.download_url.created').fields).toMatchObject({
      nodeUri: 'https://node.test.invalid'
    })
  })

  it('logs each read of the lookup at trace', async () => {
    const log = captureLog({ level: 'trace' })

    await access(
      { assetDid: ASSET_DID },
      { node: node(), signer: consumer(chain()), chainConfig }
    )

    const reads = log.events.filter(
      (event) => event.event === 'access.order.lookup_read'
    )
    expect(reads.length).to.be.greaterThan(0)
    expect(reads[0].fields).toMatchObject({ toBlock: expect.any(Number) })
    expect(reads[0].durationMs).to.be.a('number')
  })

  it("makes a slow lookup visible at debug: beta.2's 40 s (N9) without outside timing", async () => {
    vi.useFakeTimers()
    try {
      const slow = chain()
      const getLogs = slow.getLogs.bind(slow)
      // Every read takes the RPC 4 s: the 10 000 blocks are 5 reads of 2 000.
      ;(slow as unknown as { getLogs: typeof getLogs }).getLogs = async (
        filter
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 4_000))
        return getLogs(filter)
      }
      const log = captureLog({ level: 'trace' })

      const accessing = access(
        { assetDid: ASSET_DID },
        { node: node(), signer: consumer(slow), chainConfig }
      )
      await vi.advanceTimersByTimeAsync(60_000)
      await accessing

      const finished = only(log, 'access.order.lookup_finished')
      expect(finished.durationMs).to.be.at.least(20_000)
      expect(finished.msg).to.match(/took 2\d{4} ms/)
      const reads = log.named('access.order.lookup_read')
      expect(reads).to.have.length(5)
      for (const read of reads) expect(read.durationMs).to.be.at.least(4_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs a failed lookup at debug with its reason, without the RPC URL', async () => {
    const log = captureLog({ level: 'debug' })
    const rateLimited = Object.assign(
      new Error(`429 Too Many Requests from ${FAKE.rpcUrl}`),
      {
        code: 'SERVER_ERROR',
        info: { responseStatus: '429 Too Many Requests' }
      }
    )

    // A free service is ordered anyway, with the warning.
    await access(
      { assetDid: ASSET_DID },
      { node: node(), signer: consumer(chain(rateLimited)), chainConfig }
    )

    expect(story(log)).toContain('warn access.order.lookup_failed')
    const finished = only(log, 'access.order.lookup_finished')
    expect(finished.fields).toMatchObject({ result: 'failed' })
    expect(finished.fields.reason).to.be.a('string')
    expect(JSON.stringify(log.events)).not.toContain(FAKE.rpcPathToken)
  })

  it('logs a re-requested provider fee', async () => {
    vi.useFakeTimers()
    try {
      const log = captureLog({ level: 'debug' })
      const accessing = access(
        { assetDid: ASSET_DID },
        {
          node: node(getAssetFixture(), [
            poisonedProviderFee({ providerFeeAmount: '0' }),
            signedProviderFee({ providerFeeAmount: '0' })
          ]),
          signer: consumer(),
          chainConfig
        }
      )
      await vi.advanceTimersByTimeAsync(2_000)
      await accessing

      expect(only(log, 'access.provider_fee.requested_again').fields).toEqual({
        attempt: 1,
        attempts: 3,
        problem: 'signature',
        delayMs: expect.any(Number)
      })
      expect(vi.mocked(order)).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs reusing an order the node reports as it stands', async () => {
    const log = captureLog({ level: 'debug' })

    await settleOrder({
      signer: consumer(),
      chainConfig,
      datatokenAddress: DATATOKEN_ADDRESS,
      serviceIndex: 0,
      initialized: {
        validOrder: ORDER_TX,
        providerFee: signedProviderFee({ providerFeeAmount: '0' })
      },
      consumer: CONSUMER
    })

    expect(story(log)).toEqual(['debug access.order.planned'])
    expect(only(log, 'access.order.planned').fields).toMatchObject({
      plan: 'reused',
      orderTxId: ORDER_TX
    })
  })
})

describe('prepareMetadataForWrite() steps', () => {
  it('logs signing, both encryptions and the upload at debug', async () => {
    const { indexedMetadata: _indexed, ...ddo } =
      getAssetFixture() as unknown as Record<string, unknown>
    const log = captureLog({ level: 'debug' })

    await prepareMetadataForWrite({
      node: createNodeMock().client,
      ddo: { ...ddo, issuer: new Wallet(PRIVATE_KEY).address },
      signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
      remoteStore: {
        put: async () =>
          ({
            type: 'ipfs',
            hash: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
          }) as unknown as StorageObject
      },
      did: ASSET_DID
    })

    expect(story(log)).toEqual([
      'debug publish.ddo.signed',
      'debug publish.envelope.encrypted',
      'debug store.envelope.stored',
      'debug publish.pointer.encrypted'
    ])
    for (const event of log.events) {
      expect(event.did, event.event).to.equal(ASSET_DID)
      expect(event.durationMs, event.event).to.be.a('number')
    }
    expect(only(log, 'store.envelope.stored').fields).toEqual({ type: 'ipfs' })
  })
})

describe('operation events (10c) as 10d fills them', () => {
  it("puts the call's result on its finished event, and a summary that throws never fails the call", async () => {
    const log = captureLog({ level: 'info' })

    const result = await runOperation(
      processLog,
      'waitForIndexer',
      async () => 'done',
      () => {
        throw new Error('unreadable result')
      }
    )

    expect(result).to.equal('done')
    expect(log.events.map((event) => event.event)).toEqual([
      'node.operation.finished'
    ])
    expect(log.events[0].fields.fieldsError).to.contain('unreadable result')
  })

  it("sends a compute() whose order lookup failed to the debug channel's order topic", async () => {
    captureLog({ level: 'info' })
    const debugged: DebugEvent[] = []
    setDebug({ level: 'sensitive', sink: (event) => debugged.push(event) })

    await runOperation(processLog, 'compute', async () => {
      throw new IncompleteOrderLookupError(1, 24, 'reads')
    }).catch(() => undefined)

    const raw = debugged.filter((event) =>
      event.message.includes('compute.operation.failed')
    )
    expect(raw).to.have.length(1)
    expect(raw[0].topic).to.equal('order')
  })
})
