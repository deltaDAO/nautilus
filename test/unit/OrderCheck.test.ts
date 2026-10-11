/**
 * No silent second payment: when `access()` cannot check whether the consumer already holds
 * a valid order (the previous-order lookup fails, as opposed to finding nothing), it does
 * not buy a service that costs anything. It throws an `OrderCheckError` before any
 * transaction, with a message that says what happened, why it stopped, that nothing was
 * paid, the cause in plain words and what to do. A free service is ordered with one
 * warning; `orderOnLookupFailure: true` orders a paid one, also with a warning.
 *
 * The RPC errors are made by ethers itself, from a `JsonRpcProvider` whose HTTP answers are
 * stubbed, so they carry the request URL (with its token), the payload and ethers' details
 * the way a real failure does.
 */
import type { ComputeEnvironment, Config } from '@oceanprotocol/lib'
import {
  FetchRequest,
  type FetchResponse,
  JsonRpcProvider,
  makeError,
  Network,
  type Provider,
  type Signer,
  toUtf8Bytes
} from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, OrderCheckError } from '../../src/access/index.js'
import { compute } from '../../src/compute/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  findPreviousOrder,
  IncompleteOrderLookupError
} from '../../src/utils/previousOrder.js'
import {
  ASSET_DID,
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAlgorithmAssetFixture,
  getAssetFixture,
  getComputeAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { signedProviderFee } from '../fixtures/ProviderFee.js'
import { captureLog } from '../helpers.js'
import { FAKE, findCredentials, findSecrets } from '../secretScan.js'

// #region stubs

const pricing = vi.hoisted(() => ({
  total: '1.002',
  publishMarketFee: '0',
  /** Thrown by the pricing read when set. */
  fail: undefined as unknown,
  /** The tokens' `symbol()`; throws when undefined. */
  symbol: 'devEURAU' as string | undefined
}))

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkOrder: vi.fn(async () => undefined),
  order: vi.fn(async () => ({ transferTxId: '0xfresh', reused: false })),
  reuseOrder: vi.fn(async () => ({ transferTxId: '0xreused', reused: true }))
}))

vi.mock('../../src/utils/previousOrder.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findPreviousOrder: vi.fn()
}))

vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async (_signer: unknown, datatokenAddress: string) => {
    if (pricing.fail) throw pricing.fail
    const publishMarketFee =
      pricing.publishMarketFee === '0'
        ? {}
        : {
            publishMarketFeeToken: '0x00000000000000000000000000000000000e0a00'
          }
    return pricing.total !== '0'
      ? {
          schema: 'fixed',
          templateId: 1,
          datatokenAddress,
          exchangeId: '0x01',
          baseTokenAddress: '0x00000000000000000000000000000000000e0a00',
          baseTokenDecimals: 18,
          publishMarketFee
        }
      : {
          schema: 'free',
          templateId: 1,
          datatokenAddress,
          publishMarketFee
        }
  }),
  getOrderPrice: vi.fn(async () => ({
    total: pricing.total,
    baseTokenAmount: pricing.total,
    opcFee: '0',
    publishMarketFee: pricing.publishMarketFee,
    consumeMarketFee: '0'
  }))
}))

// The base token's `symbol()`, read for the message.
vi.mock('ethers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Contract: vi.fn(function (this: void) {
    return {
      symbol: async () => {
        if (pricing.symbol === undefined) throw new Error('no symbol()')
        return pricing.symbol
      }
    }
  })
}))

// #endregion

// #region fixtures

const CONSUMER = '0x4C84000000000000000000000000000000004A52'
const SERVICE_NAME = 'Download (JSON)'
const ASSET_NAME = 'Test Dataset'

const signer = {
  getAddress: async () => CONSUMER,
  provider: {} as Provider
} as unknown as Signer
const chainConfig = { chainId: CHAIN_ID } as unknown as Config

/** A service's node with no policy server, quoting a zero provider fee. */
function accessNode() {
  const asset = getAssetFixture()
  asset.credentialSubject.services[0].name = SERVICE_NAME

  const client = {
    nodeUri: 'https://node.test.invalid',
    policySessionAddress: (address: string) => address,
    hasPolicyServer: async () => false,
    forEndpoint: () => client,
    resolve: async () => asset,
    initialize: async () => ({
      datatoken: DATATOKEN_ADDRESS,
      providerFee: signedProviderFee({ providerFeeAmount: '0' })
    }),
    getDownloadUrl: vi.fn(async () => 'https://node.test.invalid/download')
  }

  return client
}

function download(options: { orderOnLookupFailure?: boolean } = {}) {
  const client = accessNode()
  const running = access(
    { assetDid: ASSET_DID, ...options },
    { node: client as unknown as OceanNodeClient, signer, chainConfig }
  )
  return { running, client }
}

/**
 * The error ethers throws for a `getLogs` whose HTTP exchange is `answer`: a response, or
 * a thrown network error. The request goes to `FAKE.rpcUrl`, token and all.
 */
async function rpcFailure(
  answer: () => Promise<Partial<FetchResponse> | object>
): Promise<unknown> {
  const request = new FetchRequest(FAKE.rpcUrl)
  request.setThrottleParams({ maxAttempts: 2, slotInterval: 1 })
  request.getUrlFunc = answer as unknown as typeof request.getUrlFunc

  const provider = new JsonRpcProvider(request, Network.from(CHAIN_ID), {
    staticNetwork: true,
    batchMaxCount: 1
  })

  try {
    await provider.getLogs({
      address: DATATOKEN_ADDRESS,
      fromBlock: 1,
      toBlock: 2000
    })
  } catch (error) {
    return error
  } finally {
    provider.destroy()
  }
  throw new Error('the stubbed RPC answered')
}

const httpAnswer =
  (statusCode: number, body: unknown, headers: Record<string, string> = {}) =>
  async () => ({
    statusCode,
    statusMessage: statusCode === 429 ? 'Too Many Requests' : 'OK',
    headers: { 'content-type': 'application/json', ...headers },
    body: toUtf8Bytes(JSON.stringify(body))
  })

const rpcAnswer = (error: { code: number; message: string }) =>
  httpAnswer(200, { jsonrpc: '2.0', id: 1, error })

/** One RPC failure of each class, as the lookup would see it. */
const FAILURES = {
  'HTTP 429 with Retry-After': {
    reason: 'rate-limited',
    cause: 'the RPC rate-limited the check (HTTP 429)',
    error: () =>
      rpcFailure(
        httpAnswer(
          429,
          { jsonrpc: '2.0', id: 1, error: { code: 429, message: 'slow down' } },
          { 'retry-after': '1' }
        )
      )
  },
  'HTTP 429 without Retry-After': {
    reason: 'rate-limited',
    cause: 'the RPC rate-limited the check (HTTP 429)',
    error: () => rpcFailure(httpAnswer(429, 'Too Many Requests'))
  },
  '"too many requests" in the RPC answer': {
    reason: 'rate-limited',
    cause: 'the RPC rate-limited the check',
    error: () =>
      rpcFailure(
        rpcAnswer({ code: -32000, message: 'Too many requests, slow down' })
      )
  },
  'JSON-RPC -32005': {
    reason: 'rate-limited',
    cause: 'the RPC rate-limited the check (error -32005)',
    error: () =>
      rpcFailure(
        rpcAnswer({
          code: -32005,
          message: 'daily request count exceeded, request rate limited'
        })
      )
  },
  'a refused connection': {
    reason: 'unreachable',
    cause: 'the RPC did not answer',
    error: () =>
      rpcFailure(async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(
            new Error('connect ECONNREFUSED 10.0.0.7:8545'),
            {
              code: 'ECONNREFUSED'
            }
          )
        })
      })
  },
  'a timeout': {
    reason: 'unreachable',
    cause: 'the RPC did not answer',
    error: async () =>
      makeError('timeout', 'TIMEOUT', {
        operation: 'request.send',
        reason: 'timeout',
        request: new FetchRequest(FAKE.rpcUrl)
      })
  },
  'an incomplete scan': {
    reason: 'incomplete',
    cause:
      'the check covered only the last 16 of the 24 hours an order stays valid',
    error: async () => new IncompleteOrderLookupError(16.4, 23.8)
  },
  'another RPC error': {
    reason: 'rpc-error',
    cause: 'the RPC returned an error: header not found',
    error: () =>
      rpcFailure(rpcAnswer({ code: -32000, message: 'header not found' }))
  }
} as const

/** What no message may contain: an RPC URL, a credential, a stack, raw hex, a line break. */
function expectNothingRaw(text: string) {
  expect(text).not.to.match(/https?:\/\//)
  expect(text).not.to.contain('rpc.example.org')
  expect(findSecrets(text)).to.deep.equal([])
  expect(findCredentials(text)).to.deep.equal([])
  for (const secret of [FAKE.rpcPathToken, FAKE.rpcQueryToken, FAKE.sessionId])
    expect(text).not.to.contain(secret)
  expect(text).not.to.match(/\n|\bat \S+ \(|\.ts:\d+/)
  expect(text).not.to.match(/0x[0-9a-f]{12,}/i)
  expect(text).not.to.contain(ASSET_DID)
  expect(text).not.to.contain('code=')
}

// #endregion

beforeEach(() => {
  vi.clearAllMocks()
  pricing.total = '1.002'
  pricing.publishMarketFee = '0'
  pricing.fail = undefined
  pricing.symbol = 'devEURAU'
})

describe('access() on a paid service whose previous order cannot be checked', () => {
  for (const [name, failure] of Object.entries(FAILURES))
    it(`does not order, and throws an OrderCheckError, for ${name}`, async () => {
      vi.mocked(findPreviousOrder).mockRejectedValue(await failure.error())
      const log = captureLog()

      const { running, client } = download()
      const thrown = await running.catch((caught) => caught)

      // Nothing was sent or downloaded.
      expect(vi.mocked(order)).not.toHaveBeenCalled()
      expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
      expect(client.getDownloadUrl).not.toHaveBeenCalled()
      expect(log.named('access.order.lookup_failed')).to.deep.equal([])

      expect(thrown).to.be.instanceOf(OrderCheckError)
      expect(thrown).to.include({
        name: 'OrderCheckError',
        code: 'ORDER_CHECK_FAILED',
        reason: failure.reason,
        retryable: true,
        did: ASSET_DID,
        serviceId: SERVICE_ID,
        consumer: CONSUMER
      })
      expect(thrown.price).to.deep.equal({
        amount: '1.002',
        symbol: 'devEURAU'
      })

      // The message, in the order it must answer the user's questions.
      const { message } = thrown as Error
      expect(message).to.contain('access() stopped before paying')
      expect(message).to.contain(`service "${SERVICE_NAME}"`)
      expect(message).to.contain(`asset "${ASSET_NAME}"`)
      expect(message).to.contain('did:ope:7e033810…')
      expect(message).to.contain('0x4C84…4A52 already holds a valid order')
      expect(message).to.contain('pay twice (1.002 devEURAU)')
      expect(message).to.contain(
        'Nothing was ordered or paid; it is safe to retry.'
      )
      expect(message).to.contain(`Cause: ${failure.cause}.`)
      expect(message).to.contain(
        failure.reason === 'incomplete'
          ? 'Use another RPC, or retry.'
          : 'Retry in a minute or use another RPC.'
      )
      expect(message).to.contain('pass `orderOnLookupFailure: true`')
      expect(
        message.indexOf('stopped before paying') <
          message.indexOf('pay twice') &&
          message.indexOf('pay twice') <
            message.indexOf('Nothing was ordered') &&
          message.indexOf('Nothing was ordered') < message.indexOf('Cause:') &&
          message.indexOf('Cause:') < message.indexOf('To buy anyway')
      ).to.equal(true)
      expectNothingRaw(message)

      // The cause is kept, redacted.
      const cause = (thrown as Error).cause as Error
      expect(cause).to.be.instanceOf(Error)
      expectNothingRaw(cause.message)
      expect(cause.message.length).to.be.at.most(201)
    })

  it('names the hours checked of an incomplete scan, as fields too', async () => {
    vi.mocked(findPreviousOrder).mockRejectedValue(
      new IncompleteOrderLookupError(16.4, 23.8)
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(thrown).to.include({
      reason: 'incomplete',
      checkedHours: 16.4,
      windowHours: 23.8
    })
    expect(thrown.message).to.contain(
      'covered only the last 16 of the 24 hours an order stays valid'
    )
  })

  it('leaves the hours out for the other reasons', async () => {
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['another RPC error'].error()
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(thrown.checkedHours).to.equal(undefined)
    expect(thrown.windowHours).to.equal(undefined)
  })

  it('shows only the first line of an RPC error, redacted and bounded', async () => {
    const hostile = [
      `internal error 0x${'ab'.repeat(32)} at ${FAKE.rpcUrl} sessionId=${FAKE.sessionId} ${'x'.repeat(400)}`,
      '    at handler (/srv/rpc/server.ts:42:7)'
    ].join('\n')
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await rpcFailure(rpcAnswer({ code: -32603, message: hostile }))
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(thrown.reason).to.equal('rpc-error')
    expect(thrown.message).to.contain(
      'Cause: the RPC returned an error: internal error 0xabab…abab at <url>'
    )
    expect(thrown.message).not.to.contain('x'.repeat(201))
    expect(thrown.message).not.to.contain('handler')
    expectNothingRaw(thrown.message)
    expect(thrown.cause.message.length).to.be.at.most(201)
  })

  it('hands the raw error to the debug channel, under the order topic', async () => {
    const events: DebugEvent[] = []
    setDebug({
      level: 'sensitive',
      topics: ['order'],
      sink: (e) => events.push(e)
    })
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['another RPC error'].error()
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(thrown.reason).to.equal('rpc-error')
    const [raw] = events.filter(
      (event) =>
        event.message === 'previous-order lookup error before redaction'
    )
    expect(raw.topic).to.equal('order')
    expect(JSON.stringify(raw.data)).to.contain('header not found')
    expect(JSON.stringify(raw.data)).to.contain('could not coalesce error')
    // Errors and messages do not change with the channel on.
    expectNothingRaw(thrown.message)
  })
})

describe('access() orders without the check', () => {
  /** The `access.order.lookup_failed` lines written to stderr while `run` runs. */
  async function stderrWarnings(run: () => Promise<unknown>) {
    const lines: string[] = []
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(String(chunk))
        return true
      })
    try {
      await run()
    } finally {
      write.mockRestore()
    }
    return lines.filter((line) => line.includes('access.order.lookup_failed'))
  }

  it('orders a free service when the lookup fails, and warns once', async () => {
    pricing.total = '0'
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['HTTP 429 with Retry-After'].error()
    )

    let result: Awaited<ReturnType<typeof access>> | undefined
    const warnings = await stderrWarnings(async () => {
      result = await download().running
    })

    expect(result?.transferTxId).to.equal('0xfresh')
    expect(vi.mocked(order)).toHaveBeenCalledOnce()
    expect(warnings).to.have.length(1)
    expect(warnings[0]).to.contain(
      `Could not check whether 0x4C84…4A52 already holds an order for service \\"${SERVICE_NAME}\\" of asset \\"${ASSET_NAME}\\" (did:ope:7e033810…): the RPC rate-limited the check (HTTP 429). A new order will be placed. The service is free: this costs only gas.`
    )
    expect(warnings[0]).not.to.contain(FAKE.rpcPathToken)
    expect(warnings[0]).not.to.contain('rpc.example.org')
  })

  it('orders with no warning when there is no previous order', async () => {
    vi.mocked(findPreviousOrder).mockResolvedValue(undefined)
    const log = captureLog({ level: 'debug' })

    const result = await download().running

    expect(result.transferTxId).to.equal('0xfresh')
    expect(vi.mocked(order)).toHaveBeenCalledOnce()
    expect(log.events.filter((event) => event.level === 'warn')).to.deep.equal(
      []
    )
  })

  it('orders a paid service with orderOnLookupFailure, and still warns', async () => {
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['a timeout'].error()
    )

    let result: Awaited<ReturnType<typeof access>> | undefined
    const warnings = await stderrWarnings(async () => {
      result = await download({ orderOnLookupFailure: true }).running
    })

    expect(result?.transferTxId).to.equal('0xfresh')
    expect(vi.mocked(order)).toHaveBeenCalledOnce()
    expect(warnings).to.have.length(1)
    expect(warnings[0]).to.contain(
      ': the RPC did not answer. A new order will be placed, as `orderOnLookupFailure` allows: if the account already holds one, this will pay twice (1.002 devEURAU).'
    )
  })

  it('reuses an order the lookup finds, paying nothing', async () => {
    vi.mocked(findPreviousOrder).mockResolvedValue({
      orderTxId: '0xorder',
      usableTxId: '0xorder'
    })

    const result = await download().running

    expect(result).to.include({ transferTxId: '0xorder', reusedOrder: true })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })
})

describe('access() when the price cannot be read either', () => {
  it('does not order, and throws an OrderCheckError with no RPC detail, when the pricing read fails too', async () => {
    const events: DebugEvent[] = []
    setDebug({
      level: 'sensitive',
      topics: ['order'],
      sink: (e) => events.push(e)
    })
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['HTTP 429 without Retry-After'].error()
    )
    // The same rate-limited RPC fails the pricing read, with its URL in ethers' message.
    pricing.fail = await FAILURES['HTTP 429 without Retry-After'].error()

    const thrown = await download().running.catch((caught) => caught)

    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown).to.include({ reason: 'rate-limited', price: undefined })
    expect(thrown.costs).to.deep.equal([])
    expect(thrown.message).to.contain(
      'could make you pay twice (the price could not be read either)'
    )
    expect(thrown.message).to.contain('Nothing was ordered or paid')
    expectNothingRaw(thrown.message)
    expectNothingRaw(thrown.cause.message)
    expect(JSON.stringify(thrown)).not.to.contain(FAKE.rpcPathToken)
    // The pricing read's own error is kept for diagnosis, unredacted, in the debug channel.
    expect(
      events.some(
        (event) => event.message === 'price read error before redaction'
      )
    ).to.equal(true)
  })
})

describe('access() names every part of what a new order costs', () => {
  it('lists the price and the publish-market fee', async () => {
    pricing.publishMarketFee = '0.5'
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['a timeout'].error()
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(thrown.price).to.deep.equal({ amount: '1.002', symbol: 'devEURAU' })
    expect(thrown.costs).to.deep.equal([
      { amount: '1.002', symbol: 'devEURAU' },
      { amount: '0.5', symbol: 'devEURAU' }
    ])
    expect(thrown.message).to.contain(
      'pay twice (1.002 devEURAU + 0.5 devEURAU)'
    )
  })

  it('treats a publish-market fee alone as paid, naming a token without a symbol by its address', async () => {
    pricing.total = '0'
    pricing.publishMarketFee = '0.25'
    pricing.symbol = undefined
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['a timeout'].error()
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown.price).to.deep.equal({
      amount: '0.25',
      symbol: 'tokens of 0x0000…0a00'
    })
  })

  it('treats a price that is not a number as paid', async () => {
    pricing.total = 'NaN'
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['a timeout'].error()
    )

    const thrown = await download().running.catch((caught) => caught)

    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(thrown).to.be.instanceOf(OrderCheckError)
  })
})

describe('access() and orderOnLookupFailure', () => {
  for (const value of ['false', 1, {}, 'true'])
    it(`does not opt in with ${JSON.stringify(value)}, only with true`, async () => {
      vi.mocked(findPreviousOrder).mockRejectedValue(
        await FAILURES['a timeout'].error()
      )

      const thrown = await download({
        orderOnLookupFailure: value as unknown as boolean
      }).running.catch((caught) => caught)

      expect(thrown).to.be.instanceOf(OrderCheckError)
      expect(vi.mocked(order)).not.toHaveBeenCalled()
    })
})

describe('the cause of a failed lookup', () => {
  async function causeOf(error: unknown) {
    vi.mocked(findPreviousOrder).mockImplementation(() => Promise.reject(error))
    return download().running.catch((caught) => caught)
  }

  it('does not call an RPC that answered "query timeout" unreachable', async () => {
    const thrown = await causeOf(
      await rpcFailure(
        rpcAnswer({ code: -32000, message: 'query timeout exceeded' })
      )
    )

    expect(thrown.reason).to.equal('rpc-error')
    expect(thrown.message).to.contain(
      'Cause: the RPC returned an error: query timeout exceeded.'
    )
  })

  it('does not call a 503 with Retry-After a rate limit', async () => {
    const thrown = await causeOf(
      await rpcFailure(
        httpAnswer(503, 'Service Unavailable', { 'retry-after': '30' })
      )
    )

    expect(thrown).to.be.instanceOf(OrderCheckError)
    expect(thrown.reason).not.to.equal('rate-limited')
  })

  it('finds an incomplete scan wrapped as the cause of another error', async () => {
    const thrown = await causeOf(
      new Error('scan failed', {
        cause: new IncompleteOrderLookupError(3.25, 24, 'reads')
      })
    )

    expect(thrown).to.include({
      reason: 'incomplete',
      checkedHours: 3.25,
      windowHours: 24
    })
    expect(thrown.message).to.contain(
      'the check covered only the last 3.2 of the 24 hours an order stays valid'
    )
  })

  it('says so when the scan could not tell how far back it read', async () => {
    const thrown = await causeOf(
      new IncompleteOrderLookupError(Number.NaN, 24, 'reads')
    )

    expect(thrown.message).to.contain(
      'Cause: the check did not cover all of the 24 hours an order stays valid.'
    )
  })

  it('still refuses when the error cannot be read', async () => {
    const getter = new Error('x')
    Object.defineProperty(getter, 'message', {
      get() {
        throw new Error('getter')
      }
    })
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        },
        has() {
          throw new Error('trap')
        }
      }
    )

    for (const error of [getter, trap]) {
      vi.clearAllMocks()
      const thrown = await causeOf(error)

      expect(thrown).to.be.instanceOf(OrderCheckError)
      expect(thrown.reason).to.equal('rpc-error')
      expect(vi.mocked(order)).not.toHaveBeenCalled()
    }
  })

  for (const [name, message, secrets] of [
    [
      'a JSON-escaped URL',
      'upstream {"url":"https:\\/\\/rpc.example.org\\/v3\\/TOKENSECRET1?apikey=T2SECRET"} failed',
      ['TOKENSECRET1', 'T2SECRET', 'rpc.example.org']
    ],
    [
      'a URL without a scheme',
      'upstream rpc.example.org/v3/TOKENSECRET1?apikey=T2SECRET failed',
      ['TOKENSECRET1', 'T2SECRET']
    ],
    [
      'Basic and Bearer credentials',
      'auth Basic dXNlcjpTRUNSRVQ= Bearer abc.TOKENSECRET1 x-api-key: T2SECRET',
      ['dXNlcjpTRUNSRVQ', 'TOKENSECRET1', 'T2SECRET']
    ],
    [
      'keys ending in key or token',
      'bad request dkey=TOKENSECRET1 api_token=T2SECRET',
      ['TOKENSECRET1', 'T2SECRET']
    ]
  ] as const)
    it(`redacts ${name} in the RPC's answer`, async () => {
      const thrown = await causeOf(
        await rpcFailure(rpcAnswer({ code: -32000, message }))
      )

      expect(thrown.reason).to.equal('rpc-error')
      for (const secret of secrets) {
        expect(thrown.message).not.to.contain(secret)
        expect(thrown.cause.message).not.to.contain(secret)
      }
    })
})

describe('compute() and the previous-order lookup', () => {
  const ALGO_DID = 'did:ope:algorithm'

  afterEach(() => {
    vi.mocked(findPreviousOrder).mockReset()
  })

  it('never looks a previous order up on chain, so a failing lookup cannot buy twice', async () => {
    vi.mocked(findPreviousOrder).mockRejectedValue(
      await FAILURES['HTTP 429 with Retry-After'].error()
    )

    const algorithm = getAlgorithmAssetFixture()
    algorithm.id = ALGO_DID
    const assets: Record<string, AssetV5> = {
      [ASSET_DID]: getComputeAssetFixture(),
      [ALGO_DID]: algorithm
    }
    const fee = signedProviderFee({ providerFeeAmount: '0' })
    const node = {
      nodeUri: 'https://node.test.invalid',
      policySessionAddress: (address: string) => address,
      hasPolicyServer: async () => false,
      resolve: async (did: string) => assets[did],
      getComputeEnvironments: async () => [
        {
          id: 'env-1',
          consumerAddress: '0x00000000000000000000000000000000000000C0',
          resources: [{ id: 'cpu', min: 1, max: 4 }],
          fees: {
            [String(CHAIN_ID)]: [
              { feeToken: '0xfee0000000000000000000000000000000000000' }
            ]
          },
          maxJobDuration: 3600
        } as unknown as ComputeEnvironment
      ],
      initializeCompute: async () => ({
        datasets: [{ datatoken: DATATOKEN_ADDRESS, providerFee: fee }],
        algorithm: { providerFee: fee }
      }),
      computeStart: vi.fn(async () => [{ jobId: 'job-1' }])
    }

    await compute(
      { dataset: { did: ASSET_DID }, algorithm: { did: ALGO_DID } },
      {
        node: node as unknown as OceanNodeClient,
        signer,
        chainConfig,
        escrow: '0x00000000000000000000000000000000000e5c40'
      }
    )

    // compute() reuses what the node's `initializeCompute` reports as a valid order; it
    // has no lookup of its own to fail.
    expect(vi.mocked(findPreviousOrder)).not.toHaveBeenCalled()
    expect(node.computeStart).toHaveBeenCalledOnce()
  })
})
