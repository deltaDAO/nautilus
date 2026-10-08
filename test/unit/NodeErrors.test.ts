/**
 * How `OceanNodeClient` reports what the node answered.
 *
 * ocean.js reads every node answer with `response.json()`. ocean-node sends many errors as
 * plain text, so a refused call failed with `Unexpected token 'U', "Use the in"... is not
 * valid JSON`, and a JSON string body came back quoted. `initialize` and the compute logs
 * are now sent by nautilus itself over HTTP; the other calls still go through ocean.js and
 * have their message unwrapped.
 */
import { LoggerInstance, LogLevel, ProviderInstance } from '@oceanprotocol/lib'
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
const JOB = `${'ab'.repeat(32)}-job-1`

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

function client(nodeUri = NODE, auth: NodeAuth = SIGNED) {
  return new OceanNodeClient({
    nodeUri,
    chainId: CHAIN_ID,
    auth,
    consumerAddress: NFT_ADDRESS
  })
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

  it('sends a JWT as Authorization, without a signature', async () => {
    const fetch = stubFetch({
      '/api/services/computeStreamableLogs': { status: 200, body: '' }
    })

    await client(NODE, 'jwt-token').getComputeLogs(JOB)

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).searchParams.has('signature')).to.equal(false)
    expect((init.headers as Record<string, string>).Authorization).to.equal(
      'jwt-token'
    )
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
