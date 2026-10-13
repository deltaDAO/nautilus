/**
 * How `OceanNodeClient` reports what the node answered.
 *
 * ocean.js reads every node answer with `response.json()`. ocean-node sends many errors as
 * plain text, so a refused call failed with `Unexpected token 'U', "Use the in"... is not
 * valid JSON`, and a JSON string body came back quoted. `initialize` and the compute logs
 * are now sent by nautilus itself over HTTP; the other calls still go through ocean.js and
 * have their message unwrapped. Whatever the node says is redacted, stripped of control
 * characters and bounded before it reaches a message.
 */
import {
  Aquarius,
  LoggerInstance,
  LogLevel,
  ProviderInstance
} from '@oceanprotocol/lib'
import {
  hexlify,
  id,
  solidityPackedKeccak256,
  toBeArray,
  toUtf8Bytes,
  verifyMessage,
  Wallet
} from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SECRET_KEYS } from '../../src/log/keys.js'
import { redactKeyValues } from '../../src/log/keyValues.js'
import { configureLogging } from '../../src/log/logger.js'
import {
  redactError,
  redactFields,
  redactMessage
} from '../../src/log/redact.js'
import type { NodeAuth } from '../../src/node/auth.js'
import { nodeText, redactSecrets, sanitize } from '../../src/node/messages.js'
import {
  AssetNotFoundError,
  OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'
import { ASSET_DID, CHAIN_ID, NFT_ADDRESS } from '../fixtures/Asset.js'
import { cpuBudget, cpuTime, INVISIBLE_CODES } from '../helpers.js'
import { FAKE } from '../secretScan.js'

const NODE = 'https://node.test.invalid'
const PEER = '16Uiu2HAmPeerIdOnly'
const DID_OP = ASSET_DID.replace('did:ope:', 'did:op:')
const TX = `0x${'12'.repeat(32)}`
const JOB = `0x${'ab'.repeat(32)}-${'cd'.repeat(32)}`

const ACCESS_DENIED = `Error: Access to asset ${DID_OP} was denied`

type Answer = { status: number; body: string; statusText?: string }

/** Answers each request with the first route whose key is part of its URL. */
function stubFetch(routes: Record<string, Answer>) {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    const key = Object.keys(routes).find((part) => href.includes(part))
    if (!key) throw new Error(`unexpected request ${href}`)

    const { status, body, statusText } = routes[key]
    return new Response(body, { status, statusText })
  })

  vi.stubGlobal('fetch', fetch)
  return fetch
}

const urls = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map((call) => String(call[0]))

const SIGNED = {
  consumerAddress: NFT_ADDRESS,
  nonce: '1',
  signature: '0xsigned'
}

/** A client; `consumerAddress: null` leaves it out. */
function client(
  nodeUri = NODE,
  auth: NodeAuth = SIGNED,
  consumerAddress: string | null = NFT_ADDRESS
) {
  return new OceanNodeClient({
    nodeUri,
    chainId: CHAIN_ID,
    auth,
    consumerAddress: consumerAddress ?? undefined
  })
}

/** An unsigned JWT with `claims`, shaped like the tokens ocean-node issues. */
function jwt(claims: object): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.c2ln`
}

async function rejection(
  call: () => Promise<unknown>
): Promise<OceanNodeError> {
  const error = await call().then(
    () => undefined,
    (thrown: unknown) => thrown
  )

  expect(error).to.be.instanceOf(OceanNodeError)
  return error as OceanNodeError
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  let text = ''
  for await (const chunk of stream) text += new TextDecoder().decode(chunk)
  return text
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('initialize', () => {
  it('sends the query itself and returns the fees', async () => {
    const fetch = stubFetch({
      '/api/services/initialize': {
        status: 200,
        body: JSON.stringify({ datatoken: NFT_ADDRESS })
      }
    })

    const result = await client().initialize(DID_OP, 'svc', {
      fileIndex: 1,
      userdata: { q: 'a b' },
      computeEnv: 'env-1',
      validUntil: 99
    })

    expect(result).to.deep.equal({ datatoken: NFT_ADDRESS })
    const url = new URL(urls(fetch)[0])
    expect(url.pathname).to.equal('/api/services/initialize')
    expect(Object.fromEntries(url.searchParams)).to.deep.equal({
      documentId: DID_OP,
      serviceId: 'svc',
      fileIndex: '1',
      consumerAddress: NFT_ADDRESS,
      userdata: '{"q":"a b"}',
      environment: 'env-1',
      validUntil: '99'
    })
  })

  it('surfaces a plain-text refusal with its status', async () => {
    stubFetch({
      '/api/services/initialize': {
        status: 400,
        statusText: 'Bad Request',
        body: 'Use the initializeCompute endpoint to initialize compute jobs'
      }
    })

    const error = await rejection(() => client().initialize(DID_OP, 'svc'))

    expect(error.message).to.equal(
      '[ocean-node] initialize: HTTP 400 Bad Request: Use the initializeCompute endpoint to initialize compute jobs'
    )
    expect(error.operation).to.equal('initialize')
    expect(error.status).to.equal(400)
  })

  it('surfaces the access refusal', async () => {
    stubFetch({
      '/api/services/initialize': { status: 403, body: ACCESS_DENIED }
    })

    const error = await rejection(() => client().initialize(DID_OP, 'svc'))

    expect(error.message).to.equal(
      `[ocean-node] initialize: HTTP 403: ${ACCESS_DENIED}`
    )
  })

  it('unquotes a JSON string body and reads the error of a JSON object', async () => {
    stubFetch({
      'serviceId=quoted': {
        status: 403,
        body: JSON.stringify(ACCESS_DENIED)
      },
      'serviceId=object': {
        status: 400,
        body: JSON.stringify({ error: 'Invalid fileIndex' })
      }
    })
    const node = client()

    expect(
      (await rejection(() => node.initialize(DID_OP, 'quoted'))).message
    ).to.equal(`[ocean-node] initialize: HTTP 403: ${ACCESS_DENIED}`)
    expect(
      (await rejection(() => node.initialize(DID_OP, 'object'))).message
    ).to.equal('[ocean-node] initialize: HTTP 400: Invalid fileIndex')
  })

  it('redacts a signature the node echoes', async () => {
    stubFetch({
      '/api/services/initialize': {
        status: 400,
        body: 'Bad request /api/services/download?nonce=2&signature=0xdeadbeef&fileIndex=0'
      }
    })

    const error = await rejection(() => client().initialize(DID_OP, 'svc'))

    expect(error.message).not.to.contain('0xdeadbeef')
    expect(error.message).to.contain('signature=<redacted>&fileIndex=0')
  })

  it('does not follow a redirect: the query carries the consumer address and userdata', async () => {
    const fetch = stubFetch({
      '/api/services/initialize': { status: 307, body: '' }
    })
    fetch.mockImplementationOnce(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://elsewhere.example/collect' }
        })
    )

    const error = await rejection(() =>
      client().initialize(DID_OP, 'svc', { userdata: { secret: 'x' } })
    )

    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.redirect).to.equal('manual')
    expect(error.message).to.match(
      /^\[ocean-node\] initialize: https:\/\/node\.test\.invalid answered with a redirect \(307\) to https:\/\/elsewhere\.example\./
    )
    expect(error.message).not.to.contain(NFT_ADDRESS)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('goes through ocean.js over P2P, with its message unquoted', async () => {
    const spy = vi
      .spyOn(ProviderInstance, 'initialize')
      .mockRejectedValue(new Error(JSON.stringify(ACCESS_DENIED)))

    const error = await rejection(() => client(PEER).initialize(DID_OP, 'svc'))

    expect(spy).toHaveBeenCalledOnce()
    expect(error.message).to.equal(`[ocean-node] initialize: ${ACCESS_DENIED}`)
    expect(error.status).to.equal(undefined)
  })
})

describe('getComputeLogs', () => {
  it('streams the logs', async () => {
    stubFetch({
      '/api/services/computeStreamableLogs': { status: 200, body: 'line 1\n' }
    })

    expect(await collect(await client().getComputeLogs(JOB))).to.equal(
      'line 1\n'
    )
  })

  it('surfaces a plain-text refusal with its status', async () => {
    stubFetch({
      '/api/services/computeStreamableLogs': {
        status: 404,
        body: 'Job not found or not running'
      }
    })

    const error = await rejection(() => client().getComputeLogs(JOB))

    expect(error.message).to.equal(
      '[ocean-node] computeStreamableLogs: HTTP 404: Job not found or not running'
    )
    expect(error.status).to.equal(404)
  })

  it('signs the request as ocean.js does', async () => {
    // Fixed wallets, not random ones: for 1 in 256 addresses the hash starts with a zero
    // byte, which ocean.js drops (`toBeArray`), and this test once failed by chance. Seed
    // 398's hash is such a one.
    for (const seed of ['signer 0', 'signer 398']) {
      const wallet = new Wallet(id(seed))
      const fetch = stubFetch({
        '/api/services/nonce': { status: 200, body: '{"nonce":"4"}' },
        '/api/services/computeStreamableLogs': { status: 200, body: '' }
      })

      await client(NODE, wallet).getComputeLogs(JOB)

      const url = new URL(urls(fetch)[1])
      const query = Object.fromEntries(url.searchParams)
      expect(query.jobId).to.equal(JOB)
      expect(query.consumerAddress).to.equal(wallet.address)
      expect(query.nonce).to.equal('5')
      // ocean.js's signRequest: the keccak256 of the message bytes, signed as the bytes of
      // its number, so without leading zero bytes.
      const hash = solidityPackedKeccak256(
        ['bytes'],
        [hexlify(toUtf8Bytes(`${wallet.address}5getComputeStreamableLogs`))]
      )
      expect(verifyMessage(toBeArray(hash), query.signature), seed).to.equal(
        wallet.address
      )
    }
  })

  it("sends a JWT as Authorization, without a signature, naming the token's address", async () => {
    const wallet = Wallet.createRandom()
    const token = jwt({ address: wallet.address, nonce: '1', createdAt: 1 })
    const fetch = stubFetch({
      '/api/services/computeStreamableLogs': { status: 200, body: '' }
    })

    // No consumerAddress: the address comes from the token, as ocean.js reads it.
    await client(NODE, token, null).getComputeLogs(JOB)

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const query = new URL(url).searchParams
    expect(query.get('consumerAddress')).to.equal(wallet.address)
    expect(query.has('signature')).to.equal(false)
    expect(query.has('nonce')).to.equal(false)
    expect((init.headers as Record<string, string>).Authorization).to.equal(
      token
    )
  })

  it('needs consumerAddress for a token without an address claim', async () => {
    stubFetch({})

    const error = await rejection(() =>
      client(NODE, 'opaque-token', null).getComputeLogs(JOB)
    )

    expect(error.message).to.match(/no address claim/)
  })

  /**
   * A node that checks nonces as ocean-node does: a signed command must carry the stored
   * nonce + 1, which then becomes the stored nonce. `reject` rejects the next logs requests.
   */
  function nonceCheckingNode(reject = 0) {
    let stored = 0
    let inFlight = 0
    let maxInFlight = 0
    const answers: number[] = []

    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/services/nonce')
        return new Response(JSON.stringify({ nonce: String(stored) }))

      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--

      const nonce = Number(url.searchParams.get('nonce'))
      if (reject > 0 || nonce !== stored + 1) {
        reject--
        answers.push(401)
        return new Response(`nonce: ${nonce} is not a valid nonce`, {
          status: 401
        })
      }
      stored = nonce
      answers.push(200)
      return new Response(`logs ${nonce}`)
    })
    vi.stubGlobal('fetch', fetch)

    return { answers, maxInFlight: () => maxInFlight }
  }

  it('serializes signed requests, so concurrent calls do not reuse a nonce', async () => {
    const node = nonceCheckingNode()
    const logs = client(NODE, Wallet.createRandom())

    const streams = await Promise.all([
      logs.getComputeLogs(JOB),
      logs.getComputeLogs(JOB),
      logs.getComputeLogs(JOB)
    ])

    expect(node.answers).to.deep.equal([200, 200, 200])
    expect(node.maxInFlight()).to.equal(1)
    expect(await Promise.all(streams.map(collect))).to.deep.equal([
      'logs 1',
      'logs 2',
      'logs 3'
    ])
  })

  it('retries once when the node rejects the nonce', async () => {
    const node = nonceCheckingNode(1)

    const stream = await client(NODE, Wallet.createRandom()).getComputeLogs(JOB)

    expect(node.answers).to.deep.equal([401, 200])
    expect(await collect(stream)).to.equal('logs 1')
  })

  it('gives up after the one retry', async () => {
    const node = nonceCheckingNode(2)

    const error = await rejection(() =>
      client(NODE, Wallet.createRandom()).getComputeLogs(JOB)
    )

    expect(node.answers).to.deep.equal([401, 401])
    expect(error.status).to.equal(401)
    expect(error.message).to.match(/is not a valid nonce$/)
  })

  it('does not retry a pre-computed signature, whose nonce is fixed', async () => {
    const node = nonceCheckingNode(1)

    await rejection(() => client().getComputeLogs(JOB))

    expect(node.answers).to.deep.equal([401])
  })

  /** A node whose log route answers only when `answer` is called, or rejects on abort. */
  function quietNode() {
    const pending: {
      init: RequestInit
      answer: (body: string) => void
    }[] = []
    const fetch = vi.fn(
      (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(String(input))
        if (url.pathname === '/api/services/nonce')
          return Promise.resolve(new Response('{"nonce":"0"}'))

        return new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          )
          pending.push({ init, answer: (body) => resolve(new Response(body)) })
        })
      }
    )
    vi.stubGlobal('fetch', fetch)

    return pending
  }

  const withTimeout = (auth: NodeAuth = SIGNED) =>
    new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth,
      consumerAddress: NFT_ADDRESS,
      requestTimeoutMs: 1_000
    })

  it('waits past requestTimeoutMs for a quiet job’s first output', async () => {
    // ocean-node sends no headers until the job's container writes.
    vi.useFakeTimers()
    try {
      const requests = quietNode()
      const logs = withTimeout().getComputeLogs(JOB)

      await vi.advanceTimersByTimeAsync(60_000)
      requests[0].answer('line 1\n')

      expect(await collect(await logs)).to.equal('line 1\n')
      expect(requests[0].init.signal?.aborted).to.equal(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds the signed-call queue for a quiet job at most 10 s, without aborting it', async () => {
    vi.useFakeTimers()
    try {
      const requests = quietNode()
      const logs = client(NODE, Wallet.createRandom())
      const stop = new AbortController()

      const first = logs.getComputeLogs(JOB, stop.signal).catch(() => 'stopped')
      const second = logs
        .getComputeLogs(JOB, stop.signal)
        .catch(() => 'stopped')

      await vi.advanceTimersByTimeAsync(9_999)
      expect(requests).to.have.length(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(requests).to.have.length(2)
      expect(requests[0].init.signal?.aborted).to.equal(false)

      stop.abort(new Error('done'))
      expect(await Promise.all([first, second])).to.deep.equal([
        'stopped',
        'stopped'
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops waiting when the caller aborts, with its reason', async () => {
    const requests = quietNode()
    const stop = new AbortController()
    const reason = new Error('stop')

    const logs = withTimeout().getComputeLogs(JOB, stop.signal)
    await vi.waitFor(() => expect(requests).to.have.length(1))
    stop.abort(reason)

    expect(await logs.catch((error: unknown) => error)).to.equal(reason)
    expect(requests[0].init.signal?.aborted).to.equal(true)
  })

  it('sends nothing for a signature that arrives after requestTimeoutMs', async () => {
    vi.useFakeTimers()
    try {
      const requests = quietNode()
      const wallet = Wallet.createRandom()
      const signer = Object.assign(Object.create(wallet), {
        signMessage: async (message: Uint8Array) => {
          await new Promise((resolve) => setTimeout(resolve, 1_500))
          return wallet.signMessage(message)
        }
      }) as Wallet

      const error = rejection(() => withTimeout(signer).getComputeLogs(JOB))
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await error).message).to.match(/\(requestTimeoutMs\)/)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(requests).to.have.length(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still bounds the signing by requestTimeoutMs, sending nothing', async () => {
    vi.useFakeTimers()
    try {
      const requests = quietNode()
      const wallet = Wallet.createRandom()
      const signer = Object.assign(Object.create(wallet), {
        signMessage: () => new Promise<string>(() => {})
      }) as Wallet

      const logs = withTimeout(signer).getComputeLogs(JOB)
      const error = rejection(() => logs)
      await vi.advanceTimersByTimeAsync(1_000)

      expect((await error).message).to.match(
        /timed out after 1000 ms \(requestTimeoutMs\)/
      )
      expect(requests).to.have.length(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('calls that stay on ocean.js', () => {
  const freeCompute = (node: OceanNodeClient) =>
    node.freeComputeStart({
      computeEnv: 'env',
      datasets: [{ documentId: DID_OP, serviceId: 'svc' }],
      algorithm: { documentId: DID_OP, serviceId: 'algo' }
    })

  it('unquote a JSON string body', async () => {
    stubFetch({
      '/api/services/freeCompute': {
        status: 403,
        body: JSON.stringify(ACCESS_DENIED)
      }
    })
    // ocean.js's error lines, captured as events: kept off stderr (the suite's tap still scans them).
    configureLogging({ sink: () => {} })

    const error = await rejection(() => freeCompute(client()))

    expect(error.message).to.equal(
      `[ocean-node] freeComputeStart: ${ACCESS_DENIED}`
    )
  })

  it('read the error of a JSON object body', async () => {
    stubFetch({
      '/api/services/initializeCompute': {
        status: 400,
        body: JSON.stringify({ error: 'Missing algorithm' })
      }
    })
    // ocean.js's error lines, captured as events: kept off stderr (the suite's tap still scans them).
    configureLogging({ sink: () => {} })

    const error = await rejection(() =>
      client().initializeCompute({
        datasets: [],
        algorithm: { documentId: DID_OP, serviceId: 'algo' },
        computeEnv: 'env',
        paymentToken: NFT_ADDRESS,
        validUntil: 1,
        resources: []
      })
    )

    expect(error.message).to.equal(
      '[ocean-node] initializeCompute: Missing algorithm'
    )
  })

  it('keep the JSON parse fragment of a plain-text body out of the message', async () => {
    stubFetch({
      '/api/services/freeCompute': {
        status: 500,
        body: 'Internal Server Error'
      }
    })

    const error = await rejection(() => freeCompute(client()))

    expect(error.message).to.equal(
      "[ocean-node] freeComputeStart: the node's error answer is not JSON, and ocean.js passes on neither its status nor its text (see cause)"
    )
    expect((error.cause as Error).message).to.match(/not valid JSON/)
  })
})

describe('resolve', () => {
  const ddo = `/api/aquarius/assets/ddo/${encodeURIComponent(ASSET_DID)}`
  const state = (did: string) =>
    `/api/aquarius/state/ddo?did=${encodeURIComponent(did)}`

  it('returns the asset', async () => {
    stubFetch({
      [ddo]: { status: 200, body: JSON.stringify({ id: ASSET_DID }) }
    })

    expect(await client().resolve(ASSET_DID)).to.deep.equal({ id: ASSET_DID })
  })

  it('throws an AssetNotFoundError on a 404 without an indexing record', async () => {
    const fetch = stubFetch({
      [ddo]: { status: 404, body: 'DDO not found' },
      '/api/aquarius/state/ddo': { status: 404, body: 'Not found' }
    })

    const error = await rejection(() => client().resolve(ASSET_DID))

    expect(error).to.be.instanceOf(AssetNotFoundError)
    expect(error.message).to.equal(
      `[ocean-node] resolve: no asset found for ${ASSET_DID} (HTTP 404). An asset the node has not indexed yet is not found either; waitForIndexer() waits for it.`
    )
    expect(error.status).to.equal(404)
    expect((error as AssetNotFoundError).did).to.equal(ASSET_DID)
    expect((error as AssetNotFoundError).state).to.equal(undefined)
    // Both forms the node files a failure under, the given one first.
    expect(urls(fetch)).to.deep.equal([
      `${NODE}${ddo}`,
      `${NODE}${state(ASSET_DID)}`,
      `${NODE}${state(DID_OP)}`
    ])
  })

  it('includes the indexing error the node recorded for the DID', async () => {
    const record = {
      did: DID_OP,
      chainId: CHAIN_ID,
      nft: NFT_ADDRESS,
      txId: TX,
      valid: true,
      error: "Cannot read properties of null (reading 'id')"
    }
    stubFetch({
      [ddo]: { status: 404, body: 'DDO not found' },
      [state(ASSET_DID)]: {
        status: 200,
        body: JSON.stringify({
          did: ASSET_DID,
          chainId: CHAIN_ID,
          txId: ' ',
          valid: true,
          error: ' '
        })
      },
      [state(DID_OP)]: { status: 200, body: JSON.stringify(record) }
    })

    const error = await rejection(() => client().resolve(ASSET_DID))

    expect(error).to.be.instanceOf(AssetNotFoundError)
    expect(error.message).to.equal(
      `[ocean-node] resolve: no asset found for ${ASSET_DID} (HTTP 404); the node recorded an indexing error for tx ${TX}: Cannot read properties of null (reading 'id')`
    )
    expect((error as AssetNotFoundError).state).to.deep.equal(record)
  })

  it('still reports the 404 when the indexing state cannot be read', async () => {
    stubFetch({
      [ddo]: { status: 404, body: 'DDO not found' },
      '/api/aquarius/state/ddo': { status: 500, body: 'Internal Server Error' }
    })

    const error = await rejection(() => client().resolve(ASSET_DID))

    expect(error).to.be.instanceOf(AssetNotFoundError)
    expect((error as AssetNotFoundError).state).to.equal(undefined)
  })

  it('reads no indexing state for any other failure', async () => {
    const fetch = stubFetch({
      [ddo]: { status: 500, body: 'Internal Server Error' }
    })

    const error = await rejection(() => client().resolve(ASSET_DID))

    expect(error).not.to.be.instanceOf(AssetNotFoundError)
    expect(error.message).to.equal(
      '[ocean-node] resolve: HTTP 500: Internal Server Error'
    )
    expect(error.status).to.equal(500)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reads both indexing states at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/assets/ddo/'))
          return new Response('DDO not found', { status: 404 })

        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight--
        return new Response('Not found', { status: 404 })
      })
    )

    await rejection(() => client().resolve(ASSET_DID))

    expect(maxInFlight).to.equal(2)
  })

  it('names the tx of an indexing record only when it is a transaction hash', async () => {
    stubFetch({
      [ddo]: { status: 404, body: 'DDO not found' },
      [state(ASSET_DID)]: {
        status: 200,
        body: JSON.stringify({
          did: ASSET_DID,
          txId: '\u001b[31mhttps://internal.example/x?token=abc',
          valid: false,
          error: 'boom'
        })
      },
      [state(DID_OP)]: { status: 404, body: '' }
    })

    const error = await rejection(() => client().resolve(ASSET_DID))

    expect(error.message).to.equal(
      `[ocean-node] resolve: no asset found for ${ASSET_DID} (HTTP 404); the node recorded an indexing error: boom`
    )
  })

  it('refuses a redirect to an internal host and relays none of its answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = new Response('{"AccessKeyId":"AKIA-SECRET"}', {
          status: 403
        })
        Object.defineProperty(response, 'url', {
          value: 'https://10.0.0.5/latest/meta-data/iam'
        })
        return response
      })
    )

    const error = await rejection(() => client().resolve(ASSET_DID))

    expect(error).not.to.be.instanceOf(AssetNotFoundError)
    expect(error.message).to.contain(
      'redirected to a loopback, private or link-local host'
    )
    expect(error.message).not.to.contain('SECRET')
  })

  it("throws an AssetNotFoundError over P2P on the node's Not found", async () => {
    const notFound = new Error('P2P command error: Not found', {
      cause: new Error('Not found')
    })
    vi.spyOn(Aquarius.prototype, 'resolve').mockRejectedValueOnce(notFound)

    const error = await rejection(() => client(PEER).resolve(ASSET_DID))

    expect(error).to.be.instanceOf(AssetNotFoundError)
    expect((error as AssetNotFoundError).state).to.equal(undefined)
    expect(error.status).to.equal(404)
  })

  it('reports any other P2P failure as it is', async () => {
    vi.spyOn(Aquarius.prototype, 'resolve').mockRejectedValueOnce(
      new Error('P2P command error: Gateway node error: no response from peer')
    )

    const error = await rejection(() => client(PEER).resolve(ASSET_DID))

    expect(error).not.to.be.instanceOf(AssetNotFoundError)
    expect(error.message).to.equal(
      '[ocean-node] resolve: P2P command error: Gateway node error: no response from peer'
    )
  })

  it('reads no indexing state for an id that is not a did:op:/did:ope: hash', async () => {
    const fetch = stubFetch({
      '/api/aquarius/assets/ddo/': { status: 404, body: 'DDO not found' }
    })

    await rejection(() => client().resolve('did:op:unknown'))

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('ocean.js logging', () => {
  it('keeps the level ocean.js has', () => {
    // ocean.js's default, untouched by loading nautilus.
    expect(
      (LoggerInstance as unknown as { logLevel: LogLevel }).logLevel
    ).to.equal(LogLevel.Error)
  })

  it('is not triggered by a refused initialize or compute-logs request', async () => {
    // nautilus sends these requests itself, not through ocean.js: ocean.js's logger is
    // not called at all, whatever the oceanjs mode.
    const oceanJsError = vi.spyOn(LoggerInstance, 'error')
    stubFetch({
      '/api/services/initialize': {
        status: 403,
        body: JSON.stringify(ACCESS_DENIED)
      },
      '/api/services/computeStreamableLogs': {
        status: 404,
        body: JSON.stringify({ error: 'Job not found' })
      }
    })
    const node = client()

    await rejection(() => node.initialize(DID_OP, 'svc'))
    await rejection(() => node.getComputeLogs(JOB))

    expect(oceanJsError).not.toHaveBeenCalled()
  })
})

describe("the node's text in a message", () => {
  it('redacts credentials in queries, prose, JSON and escaped JSON', () => {
    for (const [text, kept] of [
      ['bad ?signature=0xabc&x=1', 'signature=<redacted>&x=1'],
      ['bad signature=0xabc, retry', 'signature=<redacted>, retry'],
      ['consumerSignature=0xabc', 'consumerSignature=<redacted>'],
      ['vp_token=abc&id_token=def', 'vp_token=<redacted>&id_token=<redacted>'],
      [
        'request_uri=urn:x&code=123&nonce=7',
        'request_uri=<redacted>&code=<redacted>&nonce=<redacted>'
      ],
      [
        'password=hunter2 apiKey=k1 api_key=k2',
        'password=<redacted> apiKey=<redacted> api_key=<redacted>'
      ],
      [
        '{"password":"hunter2","nonce":7}',
        '{"password":"<redacted>","nonce":"<redacted>"}'
      ],
      [
        '{"apiKey":"k","consumerSignature":"0xabc"}',
        '{"apiKey":"<redacted>","consumerSignature":"<redacted>"}'
      ],
      [
        'raw {\\"signature\\":\\"0xabc\\"} end',
        'raw {\\"signature\\":\\"<redacted>\\"} end'
      ],
      [
        'invalid signature: 0xdeadbeef for 0x1',
        'invalid signature: <redacted> for 0x1'
      ],
      [
        'password: hunter2, apiKey: k1',
        'password: <redacted>, apiKey: <redacted>'
      ],
      ['Authorization: Bearer abc.def', 'Authorization: Bearer <redacted>']
    ]) {
      expect(nodeText(text), text).to.contain(kept)
    }
  })

  it('redacts S3 secret keys, OAuth client secrets and refresh tokens, and private keys', () => {
    for (const [text, kept] of [
      [
        'secretAccessKey=wJalr/K7MDENG secret_access_key=s2',
        'secretAccessKey=<redacted> secret_access_key=<redacted>'
      ],
      ['aws_secret_access_key=s3x', 'aws_secret_access_key=<redacted>'],
      [
        'secretKey=minio1 secret_key=minio2',
        'secretKey=<redacted> secret_key=<redacted>'
      ],
      [
        'client_secret=cs1&refresh_token=rt1',
        'client_secret=<redacted>&refresh_token=<redacted>'
      ],
      [
        'privateKey=0x12 private_key=0x34',
        'privateKey=<redacted> private_key=<redacted>'
      ],
      [
        '{"secretAccessKey":"wJalr","client_secret":"cs1","private_key":"0x12"}',
        '{"secretAccessKey":"<redacted>","client_secret":"<redacted>","private_key":"<redacted>"}'
      ],
      [
        'secretAccessKey: wJalr, aws_secret_access_key: s3x, client_secret: cs1',
        'secretAccessKey: <redacted>, aws_secret_access_key: <redacted>, client_secret: <redacted>'
      ],
      [
        'refresh_token: rt1 privateKey: 0x12 x-api-key: k9',
        'refresh_token: <redacted> privateKey: <redacted> x-api-key: <redacted>'
      ]
    ]) {
      expect(nodeText(text), text).to.contain(kept)
    }
  })

  it('keeps a code that reads as an error code, and redacts an authorization code', () => {
    for (const [text, kept] of [
      [
        'server response 500 (code=SERVER_ERROR, version=6.16.0)',
        'code=SERVER_ERROR'
      ],
      [
        'could not coalesce error (error={ "code": -32005, "message": "range" })',
        '"code": -32005,'
      ],
      [
        'raw {\\"code\\":\\"SERVER_ERROR\\"}',
        '{\\"code\\":\\"SERVER_ERROR\\"}'
      ],
      ['raw {\\"code\\":\\"s3cr3t\\"}', '{\\"code\\":\\"<redacted>\\"}'],
      ['{"code":"CALL_EXCEPTION"}', '{"code":"CALL_EXCEPTION"}'],
      ['callback?x code=SplxlOBeZQQYbYS6WxSbIA', 'code=<redacted>'],
      ['code=123', 'code=<redacted>'],
      ['{"code":"abc-def"}', '{"code":"<redacted>"}']
    ]) {
      expect(redactSecrets(text), text).to.contain(kept)
    }
  })

  it('redacts every key the field redaction does, in every form (round 3)', () => {
    // Keys from both round-2 reviews; the value is never kept.
    const keys = [
      'accessToken',
      'refreshToken',
      'clientSecret',
      'sid',
      'cookie',
      'Set-Cookie',
      'sessionToken',
      'aws_session_token',
      'X-Amz-Security-Token',
      'passphrase',
      'mnemonic',
      'credential',
      'presentation',
      'signedTx',
      'rawTx',
      'pre-authorized_code',
      'authorization_code',
      'x-api-key',
      'apiToken',
      'csrfToken',
      'privKey',
      'seedPhrase',
      'hmac',
      'sessionId',
      'nonce',
      'signature',
      'authorization'
    ]
    for (const key of keys) {
      const value = `val-${key.length}-x9`
      for (const text of [
        `${key}=${value}`,
        `failed: ${key}: ${value}, retry`,
        `{ ${key}: '${value}' }`,
        `{ '${key}': "${value}" }`,
        `{"${key}":"${value}","ok":1}`,
        `{"${key}": 123456}`,
        `body="{\\"${key}\\":\\"${value}\\"}"`
      ]) {
        const out = redactSecrets(text)
        expect(out, text).not.to.contain(value)
        expect(out, text).not.to.contain('123456')
        expect(out, text).to.contain('<redacted>')
      }
    }
  })

  it('redacts every cookie of a header whose values are quoted, inside JSON too (round 2)', () => {
    const session = 'quoted-cookie-session-x9'
    for (const [text, kept] of [
      [`Cookie: theme="dark"; session=${session}`, 'Cookie: <redacted>'],
      [`Cookie: theme='dark'; session=${session}`, 'Cookie: <redacted>'],
      [`Cookie: a=1; theme="dark"; session=${session}\nnext`, '<redacted>'],
      [
        `{"msg":"Cookie: theme=\\"dark\\"; session=${session}","other":"keep"}`,
        '{"msg":"Cookie: <redacted>","other":"keep"}'
      ]
    ]) {
      for (const out of [
        sanitize(text, 2000, null),
        redactSecrets(text),
        String(redactFields({ error: text }).error)
      ]) {
        expect(out, text).to.contain(kept)
        expect(out, text).not.to.contain(session)
      }
    }
    // A quote after `=` that is no cookie value still ends the JSON string around it.
    expect(redactSecrets('{"msg":"Cookie: a=","other":"keep"}')).to.equal(
      '{"msg":"Cookie: <redacted>","other":"keep"}'
    )
  })

  it('redacts Basic credentials, and an authorization value after its scheme', () => {
    for (const [text, kept] of [
      ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic <redacted>'],
      ['authorization=Basic dXNlcjpwYXNz', 'authorization=Basic <redacted>'],
      ['sent Basic dXNlcjpwYXNz to it', 'sent Basic <redacted> to it'],
      ['proxy-authorization: Bearer abc.def', 'Bearer <redacted>']
    ]) {
      expect(redactSecrets(text), text).to.contain(kept)
      expect(redactSecrets(text), text).not.to.match(/dXNlcjpwYXNz|abc\.def/)
    }
  })

  it('keeps a token address, an error code, a status and other …code keys, and redacts the rest', () => {
    const address = '0x1B3fC2A9e4d5E6f708192a3b4C5d6E7f80912a3B'
    for (const [text, expected] of [
      [`paymentToken=${address}`, `paymentToken=${address}`],
      [`{"baseToken":"${address}"}`, `{"baseToken":"${address}"}`],
      ['paymentToken=0xabc', 'paymentToken=<redacted>'],
      ['code=TIMEOUT code=CANCELLED', 'code=TIMEOUT code=CANCELLED'],
      ['errorCode: ECONNREFUSED', 'errorCode: ECONNREFUSED'],
      ['statusCode: 503', 'statusCode: 503'],
      ['statusCode: 777', 'statusCode: 777'],
      // Only `code` and one-time codes are secret: an exit code or bytecode stays readable.
      [
        'exitCode=0 bytecode: 0x6080604052',
        'exitCode=0 bytecode: 0x6080604052'
      ],
      [
        'otpCode=JBSWY3DP recoveryCode: abcd-efgh',
        'otpCode=<redacted> recoveryCode: <redacted>'
      ],
      // An upper-case base32 one-time code is not an error code.
      ['code=JBSWY3DPEHPK3PXP', 'code=<redacted>'],
      ['otp: 123456, pin: 1234', 'otp: <redacted>, pin: <redacted>'],
      // Readable keys stay readable, also when a secret key is part of a longer word.
      ['decryptNonce=7 consideration: x', 'decryptNonce=7 consideration: x']
    ]) {
      expect(redactSecrets(text), text).to.equal(expected)
    }
  })

  it('decodes JSON escapes in keys and URLs, nested JSON strings included (PR #213 review)', () => {
    const sessionId = 'val-sid-u0049-x9'
    const pathToken = 'rpc-path-escaped-x9'
    const raw = [
      // `I` is `I`: the key is `sessionId`, as a JSON parser reads it.
      `{"session\\u0049d":"${sessionId}"}`,
      `{"session\\u0000Id":"${sessionId}"}`,
      // JSON may escape `/`: the URL is a URL all the same.
      `{"requestUrl":"https:\\/\\/rpc.example.org\\/v3\\/${pathToken}"}`,
      `{"note":"see https:\\u002f\\u002frpc.example.org\\u002fv3\\u002f${pathToken}"}`
    ]
    for (const body of raw) {
      // As it is, inside a JSON string (ethers' `responseBody`), and two levels deep.
      const once = JSON.stringify(body)
      const twice = JSON.stringify(JSON.stringify({ body }))
      for (const text of [
        body,
        `body=${once}`,
        `info={ "responseBody": ${once} }`,
        twice
      ]) {
        const out = redactSecrets(text)
        expect(out, text).not.to.contain(sessionId)
        expect(out, text).not.to.contain(pathToken)
        expect(nodeText(text), text).not.to.match(/val-sid|rpc-path/)
      }
    }
    expect(redactSecrets(raw[0])).to.equal('{"sessionId":"<redacted>"}')
    expect(redactSecrets(raw[2])).to.equal(
      '{"requestUrl":"https://rpc.example.org"}'
    )
    expect(
      redactSecrets(JSON.stringify(JSON.stringify({ body: raw[0] })))
    ).to.equal(
      JSON.stringify(JSON.stringify({ body: '{"sessionId":"<redacted>"}' }))
    )
  })

  it('keeps an escaped quote or delimiter inside a secret value from cutting it short', () => {
    for (const text of [
      '{"sessionId":"head\\u0022tail-x9"}',
      'sessionId=head\\u0027tail-x9',
      'sessionId=head\\u0026tail-x9',
      'password: head\\u002ctail-x9',
      JSON.stringify(JSON.stringify({ sessionId: 'head"tail-x9' })),
      JSON.stringify(JSON.stringify({ sessionId: 'head\\"tail-x9' })),
      JSON.stringify(
        JSON.stringify(JSON.stringify({ sessionId: 'head"\\tail-x9' }))
      )
    ]) {
      const out = redactSecrets(text)
      expect(out, text).not.to.contain('tail-x9')
      expect(out, text).to.contain('<redacted>')
    }
  })

  it('catches a key split by a control character, an escape or a line break', () => {
    for (const text of [
      'session\u0000Id=val-sid-x9',
      'session\u001b[0mId: val-sid-x9',
      'session​Id: val-sid-x9',
      '{"access\u0000Token":"val-sid-x9"}',
      'password\n=\nval-sid-x9'
    ]) {
      const out = nodeText(text)
      expect(out, JSON.stringify(text)).not.to.contain('val-sid-x9')
      expect(out, JSON.stringify(text)).to.contain('<redacted>')
    }
  })

  it('redacts a bare JWT and a bare 65-byte signature', () => {
    const token = jwt({ address: NFT_ADDRESS })
    const signature = `0x${'ab'.repeat(65)}`

    expect(nodeText(`token ${token} expired`)).to.equal(
      'token <redacted> expired'
    )
    expect(nodeText(`mismatch for ${signature}.`)).to.equal(
      'mismatch for <redacted>.'
    )
  })

  it('redacts a raw signed transaction, as ethers quotes it in a failed send', () => {
    // A signed EIP-1559 transaction and a legacy one: whoever holds one that was never
    // mined can still send it.
    const typed = `0x02f8${'5a'.repeat(110)}`
    const legacy = `0xf86c${'0b'.repeat(108)}`
    const hash = `0x${'ab'.repeat(32)}`

    expect(
      redactSecrets(
        `insufficient funds for intrinsic transaction cost (transaction="${typed}", info={ "error": { "code": -32000 } }, code=INSUFFICIENT_FUNDS, version=6.16.0)`
      )
    ).to.equal(
      'insufficient funds for intrinsic transaction cost (transaction="<redacted>", info={ "error": { "code": -32000 } }, code=INSUFFICIENT_FUNDS, version=6.16.0)'
    )
    expect(
      redactSecrets(
        `{"method":"eth_sendRawTransaction","params":["${legacy}"]}`
      )
    ).to.equal('{"method":"eth_sendRawTransaction","params":["<redacted>"]}')
    // A transaction hash stays.
    expect(redactSecrets(`tx ${hash} reverted`)).to.equal(`tx ${hash} reverted`)
  })

  it('redacts a short signed transaction: a minimal legacy transfer, a contract creation', async () => {
    // Real signatures by a fake key. A legacy transfer at chain 1 with nonce, gas price
    // and value 1 is 97 bytes; a contract creation without data, 77. Both can be sent.
    const wallet = new Wallet(`0x${'11'.repeat(32)}`)
    const transfer = await wallet.signTransaction({
      type: 0,
      chainId: 1,
      nonce: 0,
      gasPrice: 1,
      gasLimit: 21_000,
      to: `0x${'22'.repeat(20)}`,
      value: 1
    })
    const creation = await wallet.signTransaction({
      type: 0,
      chainId: 1,
      nonce: 0,
      gasPrice: 1,
      gasLimit: 53_000
    })
    expect((transfer.length - 2) / 2).to.equal(97)

    for (const raw of [transfer, creation]) {
      const message = `replacement fee too low (transaction="${raw}", code=REPLACEMENT_UNDERPRICED)`
      const error = Object.assign(new Error(message), {
        code: 'REPLACEMENT_UNDERPRICED'
      })
      expect(redactSecrets(message), raw).to.equal(
        'replacement fee too low (transaction="<redacted>", code=REPLACEMENT_UNDERPRICED)'
      )
      expect(sanitize(message, 2_000, null), raw).not.to.contain(raw.slice(2))
      expect(redactError(error), raw).not.to.contain(raw.slice(2))
      expect(redactSecrets(raw.toUpperCase().replace('0X', '0x'))).to.equal(
        '<redacted>'
      )
    }
  })

  it('keeps short hex that is not a whole RLP list', () => {
    // An RLP list prefix whose length byte does not match what follows: a 32-byte hash
    // and other short blobs that merely start with `f8` stay readable.
    const hash = `0xf8${'ab'.repeat(31)}`
    const blob = `0xf860${'cd'.repeat(60)}`
    expect(redactSecrets(`tx ${hash} reverted`)).to.equal(`tx ${hash} reverted`)
    expect(redactSecrets(`data ${blob}`)).to.equal(`data ${blob}`)
  })

  it("keeps a URL's origin only", () => {
    expect(
      nodeText(
        'redirect to openid4vp://authorize?request_uri=https%3A%2F%2Fverifier.internal%2Fx&state=s1, or see https://user:pw@policy.internal:8443/api/initiate?session=abc.'
      )
    ).to.equal(
      'redirect to openid4vp://authorize, or see https://policy.internal:8443.'
    )
  })

  it('strips ANSI escapes and control characters', () => {
    expect(
      nodeText('\u001b[31mError\u001b[0m:\r\nline 2\tend\u0007\u202e')
    ).to.equal('Error: line 2 end')
  })

  it('keeps the message of an unwrapped JSON answer to one line', () => {
    expect(nodeText(JSON.stringify({ error: 'a\nb' }))).to.equal('a b')
  })

  it('redacts and bounds the cause of a wrapped ocean.js error', () => {
    const raw = new Error(
      `failed: /api/services/download?signature=0xsecret ${'x'.repeat(500)}`
    )
    raw.name = 'TypeError'

    const error = OceanNodeError.from('download', raw)
    const cause = error.cause as Error

    expect(cause).not.to.equal(raw)
    expect(cause.name).to.equal('TypeError')
    expect(cause.message).not.to.contain('0xsecret')
    expect(cause.message.length).to.be.at.most(201)
  })
  it('keeps a URL whole across a backslash in its path, and ends it at a quote', () => {
    const token = FAKE.rpcPathToken
    for (const [text, expected] of [
      [
        `see https://rpc.example.org/x\\y/v3/${token} now`,
        'see https://rpc.example.org now'
      ],
      [
        `see https://rpc.example.org\\v3\\${token}.`,
        'see https://rpc.example.org.'
      ],
      [
        `see https://rpc.example.org/x\\/v3/${token} now`,
        'see https://rpc.example.org now'
      ],
      // A quote ends the URL (`\"` as well): the JSON after it is kept.
      [
        '{"u":"https://h.example/p?apikey=1","next":"kept"}',
        '{"u":"https://h.example","next":"kept"}'
      ],
      [
        '{\\"u\\":\\"https://h.example/p?a=1\\",\\"next\\":\\"kept\\"}',
        '{\\"u\\":\\"https://h.example\\",\\"next\\":\\"kept\\"}'
      ]
    ])
      expect(redactSecrets(text), text).to.equal(expected)
  })

  it('shows no part of a URL token split by an invisible character (D28)', () => {
    const token = FAKE.rpcPathToken
    const [head, tail] = [token.slice(0, 15), token.slice(15)]
    const failures: string[] = []
    for (const code of INVISIBLE_CODES) {
      const c = String.fromCharCode(code)
      for (const text of [
        `see https://${c}rpc.example.org/v3/${token} now`,
        `see https:/${c}/rpc.example.org/v3/${token} now`,
        `see https://rpc.example.org/v3/${c}${token} now`,
        `see https://rpc.example.org/v3/${head}${c}${tail} now`
      ]) {
        const shown = sanitize(text, 200, null)
        if ([token, head, tail].some((part) => shown.includes(part)))
          failures.push(`U+${code.toString(16)}: ${JSON.stringify(shown)}`)
      }
    }
    // A BOM is whitespace to `\s`: it used to end the URL, and once deleted, joined the
    // token to the origin (`https://rpc.example.org<token>`).
    expect(failures).to.deep.equal([])
    expect(
      sanitize(`see https://rpc.example.org/v3/\ufeff${token} now`)
    ).to.equal('see https://rpc.example.org now')
  })

  it('keeps only the host and port of a URL without a scheme on an IP address, localhost or [IPv6] (D28)', () => {
    const token = FAKE.rpcPathToken
    for (const [text, expected] of [
      [`rpc 127.0.0.1:8545/v3/${token} down`, 'rpc 127.0.0.1:8545 down'],
      [`rpc localhost:8545/${token}.`, 'rpc localhost:8545.'],
      [`rpc [::1]:8545/${token}, retry`, 'rpc [::1]:8545, retry'],
      [`rpc LOCALHOST:8545/${token}`, 'rpc LOCALHOST:8545'],
      [`rpc 10.0.0.7/v3/${token}?apikey=1`, 'rpc 10.0.0.7'],
      [`(rpc http://10.0.0.7:8545/v3/${token})`, '(rpc http://10.0.0.7:8545)'],
      // ethers' "could not detect network" names the URL as it was configured.
      [
        `connect ECONNREFUSED 10.0.0.7:8545`,
        'connect ECONNREFUSED 10.0.0.7:8545'
      ]
    ])
      expect(sanitize(text), text).to.equal(expected)

    // Prose with a colon and a slash, and host names without a scheme, are left alone.
    for (const prose of [
      'ratio a:b/c is fine',
      'see note:12/3',
      'time 10:30/11:00',
      'path c:/x/y',
      'version 4.2.2:8080/x',
      'v1.2.3.4/x',
      'node.example.org:8000/api'
    ])
      expect(redactSecrets(prose), prose).to.equal(prose)
  })

  it('keeps the punctuation after a URL in linear time (security regression)', async () => {
    // Text built to be slow: a run of punctuation inside a URL, which a regular expression
    // anchored at its end used to rescan from each character (about 150 ms at 16,000).
    for (const text of [
      `https://h.example/${';'.repeat(15_000)}a`,
      `127.0.0.1:1/${')'.repeat(15_000)}a`
    ]) {
      let clean = ''
      const elapsed = await cpuTime(() => {
        clean = redactMessage(text)
      })
      expect(elapsed, text.slice(0, 12)).to.be.below(cpuBudget(30))
      expect(clean).to.match(/^(https:\/\/h\.example|127\.0\.0\.1:1)$/)
    }
  })

  it('reads a long backslash run in linear time, at every tier (security regression)', async () => {
    // A run of backslashes followed by neither an escape nor a quote: the JSON-escape decoder
    // and the escaped-key form were retried from each backslash (about 650 ms at 40,000), at
    // the log window and in the sensitive tier's unbounded mask.
    const marker = 'api-key-marker-7c41'
    const runs = [
      `api\\u004bey=${marker} ${'\\'.repeat(40_000)}x`,
      `${'\\'.repeat(40_000)}"apiKey"`
    ]
    for (const text of runs) {
      let clean = ''
      const elapsed = await cpuTime(() => {
        clean = redactKeyValues(redactSecrets(text), SECRET_KEYS)
      })
      expect(elapsed).to.be.below(cpuBudget(50))
      expect(clean).not.to.contain(marker)
    }
    // Still decoded and redacted at any depth.
    expect(
      redactSecrets('\\\\\\"api\\u004bey\\\\\\": \\\\\\"v4lue\\\\\\"')
    ).to.equal('\\\\\\"apiKey\\\\\\": \\\\\\"<redacted>\\\\\\"')
  })

  it('redacts a megabyte of hostile text in no time (security regression)', async () => {
    // Text built to be slow to redact: dotted words (the URL scheme pattern used to rescan
    // from each one) and `0x` runs (the hex patterns). Only the start is read.
    for (const text of ['a.'.repeat(500_000), '0x'.repeat(500_000)]) {
      let clean = ''
      const elapsed = await cpuTime(() => {
        clean = sanitize(text, 1_000, null)
      })
      expect(elapsed, text.slice(0, 4)).to.be.below(cpuBudget(50))
      expect(clean.length).to.be.at.most(1_001)
    }
  })

  it('finds JWTs in linear time, also where one may be glued to a word (PR #219 review)', async () => {
    // Runs a JWT rule without a word boundary in front would rescan from each `eyJ` or
    // `ey` (about 70 ms each at the log window of 16,000, and in the square of the length).
    const slow: string[] = []
    for (const text of [
      'eyJ'.repeat(5_333),
      `${'eyJ'.repeat(2_666)}.${'eyJ'.repeat(2_666)}`,
      `${'ey'.repeat(4_000)}.${'ey'.repeat(4_000)}.`,
      'eyJa.'.repeat(3_200)
    ]) {
      const elapsed = await cpuTime(() => redactMessage(text))
      if (elapsed >= cpuBudget(30))
        slow.push(`${text.slice(0, 6)}: ${elapsed.toFixed(0)} ms`)
    }
    expect(slow).to.deep.equal([])
  })

  it('drops the word the read limit cuts in no time, also at the log window (security regression)', async () => {
    // A run with no separator up to just before the read limit, then one: the word the cut
    // splits used to be found by a regular expression that rescanned the run from each of
    // its characters (about 60 ms at 8,192, 300 ms at 16,000). A run of `a` is hex too, as
    // calldata is, so the hex patterns read it. Read windows: 8,192 for a node's text and a
    // result list, 16,000 for a log message (bound 2,000). Redacting them takes about 8 and
    // 15 ms.
    const hostile = (limit: number) =>
      `${'a'.repeat(limit - 2)} b${' c'.repeat(5_000)}`
    const shapes = [
      [
        'node text',
        8_192,
        200,
        35,
        (text: string) => sanitize(text, 200, null)
      ],
      [
        'result list',
        8_192,
        1_000,
        35,
        (text: string) => sanitize(text, 1_000, null)
      ],
      ['log message', 16_000, 2_000, 60, redactMessage]
    ] as const
    const slow: string[] = []
    for (const [label, limit, maxLength, budget, clean] of shapes) {
      const text = hostile(limit)
      let result = ''
      const elapsed = await cpuTime(() => {
        result = clean(text)
      })

      if (elapsed >= cpuBudget(budget))
        slow.push(`${label}: ${elapsed.toFixed(0)} ms`)
      expect(result, label).to.equal(`${'a'.repeat(maxLength)}…`)
    }
    expect(slow).to.deep.equal([])
  })

  it('reads only the start of a long text, and drops the credential the cut splits', () => {
    // A long URL shrinks to its origin, so what stood far beyond the bound moves into it:
    // a JWT split by the cut would read as no JWT and be shown in part.
    const prefix = `https://h.example/${'p'.repeat(8_150)} `
    expect(prefix.length).to.be.below(8_192)
    expect(prefix.length + FAKE.jwt.length).to.be.above(8_192)

    const clean = sanitize(`${prefix}${FAKE.jwt} and more`, 1_000, null)

    expect(clean).to.equal('https://h.example…')
    // Within the read limit nothing changes: the JWT is whole and redacted.
    expect(
      sanitize(
        `https://h.example/${'p'.repeat(5_000)} ${FAKE.jwt} and more`,
        1_000,
        null
      )
    ).to.equal('https://h.example <redacted> and more')
  })

  it('drops a URL the read limit cuts whole, so no user info is read as its host (security regression)', () => {
    // `,`, `;` and brackets end a word but not a URL: cut at the one before the unseen `@`,
    // what was left of the URL read `user:secret` as its host and kept it.
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    const filler = 'x'.repeat(17_000)
    for (const punctuation of [',', ';', '(', ')', '[', ']', '{', '}', "'"])
      for (const url of [
        `https://user:${secret}${punctuation}${filler}@rpc.example.org/path`,
        `https:\\/\\/user:${secret}${punctuation}${filler}@rpc.example.org/path`
      ]) {
        for (const text of [url, `failed at ${url}`, `{"error":"${url}"}`]) {
          const clean = sanitize(text, 200, null)
          expect(clean, `${punctuation} ${text.slice(0, 40)}`).not.to.contain(
            secret
          )
          expect(redactMessage(text)).not.to.contain(secret)
          expect(nodeText(text)).not.to.contain(secret)
        }
      }
    expect(
      sanitize(`failed at https://user:${secret},${filler}@h/p`, 200, null)
    ).to.equal('failed at…')
    // A quote ends a URL, also in its user info: the user info is dropped up to its `@`.
    for (const end of ["'", '"'])
      expect(
        sanitize(`at https://user:${secret}${end}x@rpc.example.org/path`)
      ).to.equal('at https://rpc.example.org')
    // A space ends it too, and what is left of the user info is no host and port.
    expect(
      sanitize(`at https://user:${secret} x@rpc.example.org/path`)
    ).to.equal('at https://<redacted> x@rpc.example.org/path')
    for (const url of [
      'https://h.example',
      'https://h.example:8545',
      'http://[::1]:8545',
      'http://127.0.0.1:'
    ])
      expect(sanitize(`at ${url}/path`)).to.equal(`at ${url}`)
    // A URL that ends before the cut keeps its origin, as in a text read whole.
    expect(
      sanitize(`failed at https://h.example/p, then ${'y '.repeat(9_000)}`)
    ).to.match(/^failed at https:\/\/h\.example, then y y .*…$/)
  })

  it('shows no part of user info a quote stands in, after a numeric prefix too (security regression)', () => {
    // The URL pattern ends at the quote: `user:12345` read as a host and port and was kept,
    // and the rest of the password after the quote, the path and the query with it.
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    for (const quote of ["'", '"', '\\"', '<', '>'])
      for (const prefix of ['user:12345', '12345', 'user:', 'user'])
        for (const url of [
          `https://${prefix}${quote}${secret}@rpc.example.org/p?key=${secret}`,
          `https:\\/\\/${prefix}${quote}${secret}@rpc.example.org\\/p`
        ])
          for (const text of [url, `failed at ${url}`, `{"error":"${url}"}`]) {
            const label = `${quote} ${text}`
            expect(sanitize(text, 200, null), label).not.to.contain(secret)
            expect(sanitize(text, 200, null), label).not.to.contain('12345')
            expect(sanitize(text, 200, null), label).to.contain(
              'https://rpc.example.org'
            )
            expect(redactMessage(text), label).not.to.contain(secret)
            expect(nodeText(text), label).not.to.contain(secret)
          }
    expect(
      sanitize(`https://user:12345'${secret}@rpc.example.org/p`, 200, null)
    ).to.equal('https://rpc.example.org')
    // Cut after the quote, before the `@`: the URL is dropped whole.
    for (const quote of ["'", '"'])
      for (const pad of ['x', `x${quote}`]) {
        const text = `at https://user:12345${quote}${secret}${pad.repeat(17_000)}@h/p`
        expect(sanitize(text, 200, null), `${quote}${pad}`).to.equal('at…')
        expect(redactMessage(text)).not.to.contain('12345')
      }
    // A URL in quotes with an address after it stays as it was.
    for (const prose of [
      `connect "https://host.example:8545" failed, mail ops@example.org`,
      `see 'https://localhost:8545' or 'ops@example.org'`
    ])
      expect(sanitize(prose, 200, null)).to.equal(prose)
  })

  it('reads user info with quotes in linear time (security regression)', async () => {
    for (const text of [
      `https://${"a'".repeat(100_000)}`,
      `https://${'\\'.repeat(200_000)}x`,
      `${'a'.repeat(50_000)}://${"'b".repeat(50_000)}`,
      `https://x${"\\'".repeat(100_000)}`
    ]) {
      const elapsed = await cpuTime(() => {
        redactMessage(text)
        sanitize(text, 200, null)
      })
      expect(elapsed, text.slice(0, 12)).to.be.below(cpuBudget(100))
    }
  })

  it('shows no part of user info a JSON-escaped quote stands in (security regression)', () => {
    // `\u0027` is left escaped and the URL pattern reads the backslash as the end of the
    // authority: `user:12345` read as a host and port and was kept.
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    for (const quote of [
      '\\u0027',
      '\\u0022',
      '\\u003c',
      '\\u003E',
      '\\\\u0027',
      '\\\\\\u0022'
    ])
      for (const prefix of ['user:12345', '12345', 'user:'])
        for (const url of [
          `https://${prefix}${quote}${secret}@rpc.example.org/p?key=${secret}`,
          `https:\\/\\/${prefix}${quote}${secret}@rpc.example.org\\/p`
        ])
          for (const text of [url, `failed at ${url}`, `{"error":"${url}"}`]) {
            const label = `${quote} ${text}`
            expect(sanitize(text, 200, null), label).not.to.contain(secret)
            expect(sanitize(text, 200, null), label).not.to.contain('12345')
            expect(sanitize(text, 200, null), label).to.contain(
              'https://rpc.example.org'
            )
            expect(redactMessage(text), label).not.to.contain('12345')
            expect(nodeText(text), label).not.to.contain(secret)
          }
    expect(
      sanitize(
        `https://user:12345\\u0027${secret}@rpc.example.org/p`,
        200,
        null
      )
    ).to.equal('https://rpc.example.org')
    // Percent-encoded, a quote ends no URL: it keeps its origin.
    for (const quote of ['%27', '%22', '%3C', '%3e', '%2527', '%5Cu0027'])
      expect(
        sanitize(`at https://user:12345${quote}${secret}@rpc.example.org/p`)
      ).to.equal('at https://rpc.example.org')
    // `encodeURIComponent` leaves a `'`: a URL it encoded into a query keeps no user info.
    const encoded = encodeURIComponent(
      `https://user:12345'${secret}@rpc.example.org/p`
    )
    for (const text of [
      `failed https://h.example/cb?redirect=${encoded}`,
      `failed ${encoded}`
    ]) {
      expect(sanitize(text, 200, null), text).not.to.contain(secret)
      expect(sanitize(text, 200, null), text).not.to.contain('12345')
    }
    // Cut after the escaped quote, before the `@`: the URL is dropped whole.
    const cut = `at https://user:12345\\u0027${secret}${'x'.repeat(17_000)}@h/p`
    expect(sanitize(cut, 200, null)).to.equal('at…')
    // An escaped quote with no `@` after it in the same word: the host stays, so does an
    // address after it.
    expect(
      sanitize(
        'see https://host.example:8545\\u0027 or ops@example.org',
        200,
        null
      )
    ).to.equal('see https://host.example:8545 or ops@example.org')
  })

  it('reads escaped quotes and backslash runs in URLs in linear time (security regression)', async () => {
    for (const text of [
      `https://user:1${'\\u0027'.repeat(50_000)}`,
      `https://x${'\\'.repeat(200_000)}u`,
      `https%3A%2F%2F${"a'".repeat(100_000)}`,
      "a%3A%2F%2F'".repeat(50_000),
      `a://x'%3A%2F%2F\\u0027%2F'\\\\"<`.repeat(10_000)
    ]) {
      const elapsed = await cpuTime(() => {
        redactSecrets(text)
        redactMessage(text)
        sanitize(text, 200, null)
      })
      expect(elapsed, text.slice(0, 12)).to.be.below(cpuBudget(100))
    }
  })
})
