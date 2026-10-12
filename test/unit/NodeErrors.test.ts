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
  getBytes,
  hexlify,
  solidityPackedKeccak256,
  toUtf8Bytes,
  verifyMessage,
  Wallet
} from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeAuth } from '../../src/node/auth.js'
import { redactError } from '../../src/log/redact.js'
import { nodeText, redactSecrets, sanitize } from '../../src/node/messages.js'
import {
  AssetNotFoundError,
  OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'
import { ASSET_DID, CHAIN_ID, NFT_ADDRESS } from '../fixtures/Asset.js'

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
    const wallet = Wallet.createRandom()
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
    // ocean.js's signRequest: the keccak256 of the message bytes, signed as bytes.
    const hash = solidityPackedKeccak256(
      ['bytes'],
      [hexlify(toUtf8Bytes(`${wallet.address}5getComputeStreamableLogs`))]
    )
    expect(verifyMessage(getBytes(hash), query.signature)).to.equal(
      wallet.address
    )
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
    vi.spyOn(console, 'error').mockImplementation(() => {})

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
    vi.spyOn(console, 'error').mockImplementation(() => {})

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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
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

    expect(consoleError).not.toHaveBeenCalled()
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
})
