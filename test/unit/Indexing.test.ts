/**
 * `waitForIndexer` and the node's indexing state.
 *
 * 2.0.0-beta.0 delegated to ocean.js: 30 s × 100 polls with every error swallowed, so an
 * asset the node had already rejected kept a caller waiting for 50 minutes and then came
 * back `undefined`. The node records the rejection; these tests pin that it is read.
 *
 * The state records below are the ones ocean-node 4.2 writes (`Indexer/utils.ts`,
 * `BaseProcessor.createOrUpdateDDO`, `MetadataEventProcessor`), not idealized ones:
 *
 *   - success: under the `did:ope:` DID, no `nft`, `txId: ' '`, `error: ' '`;
 *   - failure before the DID is known: under `did:op:`, with `nft` and the real `txId`;
 *   - failure after it is known: under `did:ope:`, with `nft` and the real `txId`;
 *   - a DDO dropped at the database write (SHACL): `valid: true` plus an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IndexingError,
  isIndexerNonceSignable,
  OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'
import { resetWarnings } from '../../src/utils/warn.js'
import { ASSET_DID, CHAIN_ID, NFT_ADDRESS } from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'

const NODE = 'https://node.test.invalid/'
const TX = `0x${'12'.repeat(32)}`
const OTHER_TX = `0x${'34'.repeat(32)}`
const DID_OP = ASSET_DID.replace('did:ope:', 'did:op:')

/** The records a 4.2 node actually returns. */
const RECORDS = {
  success: {
    did: ASSET_DID,
    chainId: CHAIN_ID,
    txId: ' ',
    valid: true,
    error: ' '
  },
  failureBeforeDid: {
    did: DID_OP,
    chainId: CHAIN_ID,
    nft: NFT_ADDRESS,
    txId: TX,
    valid: false,
    error:
      'Provider exception on decrypt DDO. Status: Hash check failed: decrypted ddo hash=0x01 metadata hash=0x02'
  },
  failureAfterDid: {
    did: ASSET_DID,
    chainId: CHAIN_ID,
    nft: NFT_ADDRESS,
    txId: TX,
    valid: false,
    error: 'Decrypted DDO ID does not match generated DID.'
  },
  shaclDrop: {
    did: ASSET_DID,
    chainId: CHAIN_ID,
    nft: NFT_ADDRESS,
    txId: TX,
    valid: true,
    error: "Cannot read properties of null (reading 'id')"
  }
}

const indexedAsset = (txid = TX) => ({
  id: ASSET_DID,
  indexedMetadata: { event: { txid, block: 100 } }
})

type Answer =
  | {
      status: number
      body?: unknown
      headers?: Record<string, string>
      /** Answer only after this long (fake timers), unless aborted first. */
      delayMs?: number
    }
  | Error
  | 'hang'

/**
 * A node: `lookups` answer `GET /api/aquarius/assets/ddo/<did>` in turn (the last one
 * repeats), `state` answers `GET /api/aquarius/state/ddo`.
 */
function stubNode(options: { lookups?: Answer[]; state?: Answer } = {}) {
  const lookups = [...(options.lookups ?? [{ status: 404 }])]

  const respond = (answer: Answer, signal?: AbortSignal) => {
    if (answer instanceof Error) return Promise.reject(answer)
    if (answer === 'hang')
      return new Promise<Response>((_, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      )

    const response = () =>
      new Response(
        answer.body === undefined
          ? 'Not found'
          : typeof answer.body === 'string'
            ? answer.body
            : JSON.stringify(answer.body),
        { status: answer.status, headers: answer.headers }
      )

    if (!answer.delayMs) return Promise.resolve(response())

    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(response()), answer.delayMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      })
    })
  }

  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/state/ddo'))
      return respond(
        options.state ?? { status: 404 },
        init?.signal ?? undefined
      )

    const answer = lookups.length > 1 ? lookups.shift() : lookups[0]
    return respond(answer as Answer, init?.signal ?? undefined)
  })

  vi.stubGlobal('fetch', fetch)

  return fetch
}

function client(nodeUri = NODE) {
  return new OceanNodeClient({
    nodeUri,
    chainId: CHAIN_ID,
    auth: 'token',
    consumerAddress: NFT_ADDRESS
  })
}

const urls = (fetch: ReturnType<typeof stubNode>) =>
  fetch.mock.calls.map((call) => String(call[0]))

beforeEach(() => {
  resetWarnings()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getIndexingState', () => {
  it('queries by did, txId or nft against the state endpoint', async () => {
    const fetch = stubNode({ state: { status: 200, body: RECORDS.success } })
    const node = client()

    await node.getIndexingState({ did: ASSET_DID })
    await node.getIndexingState({ txId: TX })
    await node.getIndexingState({ nft: NFT_ADDRESS })

    expect(urls(fetch)).to.deep.equal([
      `https://node.test.invalid/api/aquarius/state/ddo?did=${encodeURIComponent(ASSET_DID)}`,
      `https://node.test.invalid/api/aquarius/state/ddo?txId=${TX}`,
      `https://node.test.invalid/api/aquarius/state/ddo?nft=${NFT_ADDRESS}`
    ])
  })

  it('checksums the nft and lower-cases the txId, as the node files them', async () => {
    const fetch = stubNode({ state: { status: 200, body: RECORDS.success } })
    const node = client()

    await node.getIndexingState({ nft: NFT_ADDRESS.toLowerCase() })
    await node.getIndexingState({ txId: TX.toUpperCase().replace('0X', '0x') })

    expect(urls(fetch)).to.deep.equal([
      `https://node.test.invalid/api/aquarius/state/ddo?nft=${NFT_ADDRESS}`,
      `https://node.test.invalid/api/aquarius/state/ddo?txId=${TX}`
    ])
  })

  it('returns the success record as the node files it', async () => {
    stubNode({ state: { status: 200, body: RECORDS.success } })

    expect(await client().getIndexingState({ did: ASSET_DID })).to.deep.equal(
      RECORDS.success
    )
  })

  it('refuses an empty or malformed query', async () => {
    const node = client()

    await expect(node.getIndexingState({ did: ' ' })).rejects.toThrow(
      /pass a did, an nft or a txId/
    )
    await expect(node.getIndexingState({ nft: '0x1234' })).rejects.toThrow(
      /is not an address/
    )
    await expect(node.getIndexingState({ txId: '0xabc' })).rejects.toThrow(
      /32-byte 0x hex/
    )
    await expect(
      node.getIndexingState({ did: 'did:web:example.org' })
    ).rejects.toThrow(/did:op: or did:ope:/)
  })

  it('refuses an answer that is not a state record', async () => {
    stubNode({ state: { status: 200, body: { hits: [] } } })

    await expect(client().getIndexingState({ did: ASSET_DID })).rejects.toThrow(
      /not an indexing state record/
    )
  })

  it('returns undefined when the node has no record', async () => {
    stubNode({ state: { status: 404 } })

    expect(await client().getIndexingState({ nft: NFT_ADDRESS })).to.equal(
      undefined
    )
  })

  it("rejects with the signal's reason when aborted, not with an OceanNodeError", async () => {
    stubNode({ state: 'hang' })
    const controller = new AbortController()
    const reason = new Error('stop')

    const settled = client()
      .getIndexingState({ txId: TX }, controller.signal)
      .catch((thrown: unknown) => thrown)
    controller.abort(reason)

    expect(await settled).to.equal(reason)
  })

  it('is HTTP only', async () => {
    await expect(
      client('16Uiu2HAmPeerIdOnly').getIndexingState({ nft: NFT_ADDRESS })
    ).rejects.toThrow(/only served over HTTP/)
  })
})

describe('waitForIndexer', () => {
  it('returns the asset once it is indexed at the transaction', async () => {
    const fetch = stubNode({
      lookups: [
        { status: 404 },
        { status: 200, body: indexedAsset(OTHER_TX) },
        { status: 200, body: indexedAsset() }
      ]
    })

    const indexed = await client().waitForIndexer(ASSET_DID, TX, {
      intervalMs: 1
    })

    expect(indexed).to.deep.equal(indexedAsset())
    expect(urls(fetch)[0]).to.equal(
      `https://node.test.invalid/api/aquarius/assets/ddo/${encodeURIComponent(ASSET_DID)}`
    )
  })

  it('without a txid returns whatever is indexed and reads no state', async () => {
    const fetch = stubNode({
      lookups: [{ status: 200, body: indexedAsset(OTHER_TX) }],
      state: { status: 200, body: RECORDS.failureBeforeDid }
    })

    expect(await client().waitForIndexer(ASSET_DID)).to.deep.equal(
      indexedAsset(OTHER_TX)
    )
    expect(urls(fetch).some((url) => url.includes('/state/'))).to.equal(false)
  })

  for (const [name, record] of [
    [
      'a failure filed under did:op: (before the DID is known)',
      RECORDS.failureBeforeDid
    ],
    [
      'a failure filed under did:ope: (after the DID is known)',
      RECORDS.failureAfterDid
    ],
    ['a SHACL drop recorded as valid: true with an error', RECORDS.shaclDrop]
  ] as const)
    it(`throws an IndexingError for ${name}`, async () => {
      stubNode({ state: { status: 200, body: record } })

      const thrown = await client()
        .waitForIndexer(ASSET_DID, TX, { intervalMs: 1, timeoutMs: 60_000 })
        .catch((caught) => caught)

      expect(thrown).to.be.instanceOf(IndexingError)
      expect(thrown).to.be.instanceOf(OceanNodeError)
      expect(thrown.message).to.contain(record.error)
      expect(thrown.txId).to.equal(TX)
      expect(thrown.state).to.deep.equal(record)
    })

  it('keeps waiting on the success record and throws on timeout', async () => {
    // The success record has a blank txId, so it is never "the record for this tx".
    stubNode({ state: { status: 200, body: RECORDS.success } })

    await expect(
      client().waitForIndexer(ASSET_DID, TX, { intervalMs: 5, timeoutMs: 30 })
    ).rejects.toThrow(/was not indexed within/)
  })

  it('ignores a stale failure record from another transaction', async () => {
    // A failure record stays after a later success, so one from an earlier tx must not fail
    // this wait.
    stubNode({
      lookups: [
        { status: 404 },
        { status: 404 },
        { status: 200, body: indexedAsset() }
      ],
      state: {
        status: 200,
        body: { ...RECORDS.failureBeforeDid, txId: OTHER_TX }
      }
    })

    expect(
      await client().waitForIndexer(ASSET_DID, TX, { intervalMs: 1 })
    ).to.deep.equal(indexedAsset())
  })

  it('still waits when the state endpoint is unavailable', async () => {
    stubNode({
      lookups: [
        { status: 404 },
        { status: 404 },
        { status: 200, body: indexedAsset() }
      ],
      state: { status: 500, body: 'nope' }
    })

    expect(
      await client().waitForIndexer(ASSET_DID, TX, { intervalMs: 1 })
    ).to.deep.equal(indexedAsset())
  })

  it('names the last state error in the timeout message', async () => {
    stubNode({ state: { status: 500, body: 'state store down' } })

    await expect(
      client().waitForIndexer(ASSET_DID, TX, { intervalMs: 5, timeoutMs: 20 })
    ).rejects.toThrow(/not indexed within .*Last request error: .*500/)
  })

  it('throws the last error after consecutive failed lookups, not a timeout', async () => {
    const fetch = stubNode({
      lookups: [{ status: 500, body: 'Internal Server Error' }]
    })

    const thrown = await client()
      .waitForIndexer(ASSET_DID, TX, {
        intervalMs: 1,
        timeoutMs: 60_000,
        maxConsecutiveFailures: 3
      })
      .catch((caught) => caught)

    expect(thrown).to.be.instanceOf(OceanNodeError)
    expect(thrown).not.to.be.instanceOf(IndexingError)
    expect(thrown.message).to.match(
      /3 lookups of did:ope:.* in a row failed; the last one: GET .* answered 500/
    )
    expect(
      urls(fetch).filter((url) => url.includes('/assets/ddo/'))
    ).to.have.length(3)
  })

  it('counts network errors too, and resets the count on an answer', async () => {
    stubNode({
      lookups: [
        new TypeError('fetch failed'),
        new TypeError('fetch failed'),
        { status: 404 },
        new TypeError('fetch failed'),
        new TypeError('fetch failed'),
        { status: 200, body: indexedAsset() }
      ]
    })

    expect(
      await client().waitForIndexer(ASSET_DID, TX, {
        intervalMs: 1,
        maxConsecutiveFailures: 3
      })
    ).to.deep.equal(indexedAsset())
  })

  it('refuses timing options that are negative or not finite', async () => {
    const fetch = stubNode()

    for (const name of [
      'intervalMs',
      'timeoutMs',
      'requestTimeoutMs',
      'maxConsecutiveFailures'
    ])
      for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -1]) {
        const thrown = await client()
          .waitForIndexer(ASSET_DID, TX, { [name]: value })
          .catch((caught) => caught)

        expect(thrown, `${name}: ${value}`).to.be.instanceOf(OceanNodeError)
        expect(thrown.message).to.contain(
          `waitForIndexer: ${name} must be a finite number, 0 or more`
        )
      }

    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps the beta.0 options and warns about them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubNode()

    await expect(
      client().waitForIndexer(ASSET_DID, TX, {
        interval: 5,
        maxRetries: 4
      } as never)
    ).rejects.toThrow(/not indexed within 0s/)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).to.match(
      /`interval` and `maxRetries` were replaced by `intervalMs` and `timeoutMs`/
    )
  })

  describe('timing (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it("maps maxRetries alone to beta.0's 30 s polls, so the wait is as long as before", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      stubNode()

      let thrown: Error | undefined
      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, { maxRetries: 2 } as never)
        .catch((caught) => {
          thrown = caught
        })

      await vi.advanceTimersByTimeAsync(59_000)
      expect(thrown).to.equal(undefined)

      await vi.advanceTimersByTimeAsync(2_000)
      await waiting
      expect(thrown?.message).to.match(/not indexed within 60s/)
    })

    it('polls once more at the deadline instead of giving up an interval early', async () => {
      const fetch = stubNode({
        lookups: [
          { status: 404 },
          { status: 404 },
          { status: 200, body: indexedAsset() }
        ]
      })

      // Polls at 0 s, 7 s and, at the deadline, 10 s.
      const waiting = client().waitForIndexer(ASSET_DID, TX, {
        intervalMs: 7_000,
        timeoutMs: 10_000
      })
      await vi.advanceTimersByTimeAsync(11_000)

      expect(await waiting).to.deep.equal(indexedAsset())
      expect(
        urls(fetch).filter((url) => url.includes('/assets/ddo/'))
      ).to.have.length(3)
    })

    it('gives the last lookup at least a second after a backoff that ends at the deadline', async () => {
      stubNode({
        lookups: [
          {
            status: 429,
            body: 'Rate limit exceeded. Try again in 20 seconds.'
          },
          { status: 200, body: indexedAsset(), delayMs: 500 }
        ]
      })

      const waiting = client().waitForIndexer(ASSET_DID, TX, {
        intervalMs: 1_000,
        timeoutMs: 10_000
      })
      await vi.advanceTimersByTimeAsync(11_000)

      expect(await waiting).to.deep.equal(indexedAsset())
    })

    it('does not report a lookup error that later answers cleared', async () => {
      stubNode({ lookups: [new TypeError('fetch failed'), { status: 404 }] })

      const waiting = client()
        .waitForIndexer(ASSET_DID, undefined, {
          intervalMs: 1_000,
          timeoutMs: 3_000
        })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(4_000)

      const thrown = await waiting
      expect(thrown.message).to.match(/not indexed within 3s/)
      expect(thrown.message).not.to.match(/Last request error|fetch failed/)
    })

    it('backs off for a Retry-After header, in seconds or as an HTTP date', async () => {
      for (const retryAfter of [
        () => '20',
        () => new Date(Date.now() + 21_000).toUTCString()
      ]) {
        const fetch = stubNode({
          lookups: [
            {
              status: 429,
              body: '',
              headers: { 'retry-after': retryAfter() }
            },
            { status: 200, body: indexedAsset() }
          ]
        })

        const waiting = client().waitForIndexer(ASSET_DID, TX, {
          intervalMs: 1_000,
          timeoutMs: 600_000
        })

        await vi.advanceTimersByTimeAsync(19_000)
        expect(fetch.mock.calls.length).to.equal(1)

        await vi.advanceTimersByTimeAsync(4_000)
        expect(await waiting).to.deep.equal(indexedAsset())
      }
    })

    it('never waits more than 60 s, whatever the node asks', async () => {
      const fetch = stubNode({
        lookups: [
          {
            status: 429,
            body: 'Rate limit exceeded. Try again in 3600 seconds.'
          },
          { status: 200, body: indexedAsset() }
        ]
      })

      const waiting = client().waitForIndexer(ASSET_DID, TX, {
        intervalMs: 1_000,
        timeoutMs: 600_000
      })

      await vi.advanceTimersByTimeAsync(59_000)
      expect(fetch.mock.calls.length).to.equal(1)

      await vi.advanceTimersByTimeAsync(2_000)
      expect(await waiting).to.deep.equal(indexedAsset())
    })

    it('leaves no timer behind once it resolves', async () => {
      stubNode({
        lookups: [
          { status: 404 },
          { status: 404 },
          { status: 200, body: indexedAsset() }
        ]
      })

      const waiting = client().waitForIndexer(ASSET_DID, TX, {
        intervalMs: 1000
      })
      await vi.advanceTimersByTimeAsync(5000)

      expect(await waiting).to.deep.equal(indexedAsset())
      expect(vi.getTimerCount()).to.equal(0)
    })

    it('leaves no timer behind once it times out', async () => {
      stubNode()

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, { intervalMs: 1000, timeoutMs: 3000 })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(5000)

      expect((await waiting).message).to.match(/not indexed within 3s/)
      expect(vi.getTimerCount()).to.equal(0)
    })

    it('times out a hanging request and reports it after repeated failures', async () => {
      stubNode({ lookups: ['hang'] })

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, {
          intervalMs: 100,
          timeoutMs: 600_000,
          requestTimeoutMs: 1000,
          maxConsecutiveFailures: 2
        })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(5000)

      const thrown = await waiting
      expect(thrown).to.be.instanceOf(OceanNodeError)
      expect(thrown.message).to.match(
        /in a row failed.*timed out after 1000 ms/
      )
      expect(vi.getTimerCount()).to.equal(0)
    })

    it('stays below 20 requests a minute by default', async () => {
      // ocean-node's default MAX_REQ_PER_MINUTE is 30 per IP, and one poll is two requests.
      const fetch = stubNode()

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, { timeoutMs: 600_000 })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(60_000)

      expect(fetch.mock.calls.length).to.be.within(2, 18)
      expect(
        urls(fetch).filter((url) => url.includes('/state/ddo'))
      ).to.have.length(fetch.mock.calls.length / 2)

      await vi.advanceTimersByTimeAsync(600_000)
      expect((await waiting).message).to.match(/not indexed within 600s/)
    })

    it('backs off on 429 as long as the node says, instead of failing', async () => {
      const fetch = stubNode({
        lookups: [
          ...Array(6).fill({
            status: 429,
            body: 'Rate limit exceeded. Try again in 20 seconds.'
          }),
          { status: 200, body: indexedAsset() }
        ]
      })

      const waiting = client().waitForIndexer(ASSET_DID, TX, {
        intervalMs: 1_000,
        timeoutMs: 600_000,
        maxConsecutiveFailures: 2
      })

      // No state request after a rate-limited lookup, and 21 s before the next try.
      await vi.advanceTimersByTimeAsync(20_000)
      expect(fetch.mock.calls.length).to.equal(1)

      await vi.advanceTimersByTimeAsync(300_000)
      expect(await waiting).to.deep.equal(indexedAsset())
      expect(
        urls(fetch).filter((url) => url.includes('/state/ddo'))
      ).to.have.length(0)
    })

    it('backs off exponentially on 403 "Too many active connections"', async () => {
      const fetch = stubNode({
        lookups: [
          {
            status: 403,
            body: 'Too many active connections (121/120) in the last minute.'
          }
        ]
      })

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, {
          intervalMs: 1_000,
          timeoutMs: 30_000,
          maxConsecutiveFailures: 2
        })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(31_000)

      const thrown = await waiting
      // Waits of 2, 4, 8 and 16 s: five lookups in 30 s, and a timeout, not "check the URI".
      expect(fetch.mock.calls.length).to.equal(5)
      expect(thrown.message).to.match(/not indexed within 30s/)
      expect(thrown.message).to.match(/rate-limited/)
      expect(thrown.message).not.to.match(/Check the node URI/)
    })

    it('backs off when the state lookup is rate-limited', async () => {
      const fetch = stubNode({
        state: {
          status: 429,
          body: 'Rate limit exceeded. Try again in 30 seconds.'
        }
      })

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, {
          intervalMs: 1_000,
          timeoutMs: 600_000
        })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(30_000)

      // One poll (lookup and state), then a 31 s wait.
      expect(fetch.mock.calls.length).to.equal(2)

      await vi.advanceTimersByTimeAsync(700_000)
      await waiting
    })

    it('still counts a 403 that is not the rate limiter as a failure', async () => {
      stubNode({ lookups: [{ status: 403, body: 'Unauthorized request' }] })

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, {
          intervalMs: 1_000,
          timeoutMs: 600_000,
          maxConsecutiveFailures: 2
        })
        .catch((caught) => caught)
      await vi.advanceTimersByTimeAsync(5_000)

      expect((await waiting).message).to.match(/2 lookups .* in a row failed/)
    })

    it('rejects with the abort reason while sleeping, not with a timeout', async () => {
      stubNode()
      const controller = new AbortController()
      const reason = new Error('caller gave up')

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, {
          intervalMs: 10_000,
          timeoutMs: 10_500,
          signal: controller.signal
        })
        .catch((caught) => caught)

      await vi.advanceTimersByTimeAsync(10)
      controller.abort(reason)

      expect(await waiting).to.equal(reason)
      expect(vi.getTimerCount()).to.equal(0)
    })

    it('rejects with the abort reason during a request', async () => {
      stubNode({ lookups: ['hang'] })
      const controller = new AbortController()
      const reason = new Error('caller gave up')

      const waiting = client()
        .waitForIndexer(ASSET_DID, TX, { signal: controller.signal })
        .catch((caught) => caught)

      await vi.advanceTimersByTimeAsync(10)
      controller.abort(reason)

      expect(await waiting).to.equal(reason)
      expect(vi.getTimerCount()).to.equal(0)
    })
  })
})

describe('getNodeAddress', () => {
  it("reads providerAddress from the node's root, checksummed", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ providerAddress: NFT_ADDRESS.toLowerCase() }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetch)

    expect(await client().getNodeAddress()).to.equal(NFT_ADDRESS)
    expect(String((fetch.mock.calls[0] as unknown[])[0])).to.equal(
      'https://node.test.invalid/'
    )
  })

  it('is undefined over P2P', async () => {
    expect(await client('16Uiu2HAmPeerIdOnly').getNodeAddress()).to.equal(
      undefined
    )
  })

  it('is undefined when the node reports no valid providerAddress', async () => {
    for (const body of [{}, { providerAddress: 'not-an-address' }, null]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
      )

      expect(await client().getNodeAddress()).to.equal(undefined)
    }
  })

  it('throws an OceanNodeError on a network error', async () => {
    const cause = new TypeError('fetch failed')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw cause
      })
    )

    const error = await client()
      .getNodeAddress()
      .catch((thrown: unknown) => thrown)

    expect(error).to.be.instanceOf(OceanNodeError)
    expect((error as OceanNodeError).operation).to.equal('getNodeAddress')
    expect((error as Error).message).to.equal(
      '[ocean-node] getNodeAddress: fetch failed'
    )
    expect((error as OceanNodeError).cause).to.equal(cause)
  })

  it('throws an OceanNodeError on a non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('upstream down', {
            status: 502,
            statusText: 'Bad Gateway'
          })
      )
    )

    await expectThrowsAsync(
      () => client().getNodeAddress(),
      '[ocean-node] getNodeAddress: 502 Bad Gateway upstream down'
    )
  })

  it('throws an OceanNodeError when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>proxy</html>', { status: 200 }))
    )

    const error = await client()
      .getNodeAddress()
      .catch((thrown: unknown) => thrown)

    expect(error).to.be.instanceOf(OceanNodeError)
    expect((error as Error).message).to.equal(
      '[ocean-node] getNodeAddress: the node answered with something that is not JSON: <html>proxy</html>'
    )
    expect((error as OceanNodeError).cause).to.be.instanceOf(SyntaxError)
  })

  it('throws an OceanNodeError on timeout', async () => {
    vi.useFakeTimers()
    stubNode({ lookups: ['hang'] })

    const settled = client()
      .getNodeAddress()
      .catch((thrown: unknown) => thrown)
    await vi.advanceTimersByTimeAsync(15_000)
    const error = await settled

    expect(error).to.be.instanceOf(OceanNodeError)
    expect((error as Error).message).to.equal(
      '[ocean-node] getNodeAddress: timed out after 15000 ms'
    )
  })

  it("rejects with the signal's reason when aborted", async () => {
    stubNode({ lookups: ['hang'] })
    const controller = new AbortController()
    const reason = new Error('stop')

    const settled = client()
      .getNodeAddress(controller.signal)
      .catch((thrown: unknown) => thrown)
    controller.abort(reason)

    expect(await settled).to.equal(reason)
  })
})

describe('getIndexerNonceState', () => {
  /** A real node key: its first nonces the node cannot verify are 265 and 399. */
  const NODE_ADDRESS = '0xbcE5A3468386C64507D30136685A99cFD5603135'

  function stubNonce(nonceBody: string, status = 200) {
    const fetch = vi.fn(async (url: string) =>
      String(url).includes('/api/services/nonce')
        ? new Response(nonceBody, { status })
        : new Response(JSON.stringify({ providerAddress: NODE_ADDRESS }), {
            status: 200
          })
    )
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('knows which indexer nonces the node does not accept for its own address', () => {
    expect(isIndexerNonceSignable(NODE_ADDRESS, 264)).to.equal(true)
    expect(isIndexerNonceSignable(NODE_ADDRESS, 265)).to.equal(false)
    expect(isIndexerNonceSignable(NODE_ADDRESS.toLowerCase(), 265)).to.equal(
      false
    )
    expect(isIndexerNonceSignable(NODE_ADDRESS, 266)).to.equal(true)
    expect(isIndexerNonceSignable(NODE_ADDRESS, 399)).to.equal(false)
  })

  it('reports a stuck indexer nonce when the next nonce is not accepted', async () => {
    const fetch = stubNonce('{"nonce":"264"}')

    expect(await client().getIndexerNonceState()).to.deep.equal({
      nodeAddress: NODE_ADDRESS,
      storedNonce: 264,
      nextNonce: 265,
      stuck: true
    })
    expect(urls(fetch as never)).to.deep.equal([
      'https://node.test.invalid/',
      `https://node.test.invalid/api/services/nonce?userAddress=${NODE_ADDRESS}`
    ])
    for (const call of fetch.mock.calls as unknown as [string, RequestInit][])
      expect(call[1].method).to.equal('GET')
  })

  it('reports a healthy indexer, and treats an unseen address as nonce 0', async () => {
    stubNonce('{"nonce":"198"}')
    expect((await client().getIndexerNonceState())?.stuck).to.equal(false)

    stubNonce('{}')
    expect(await client().getIndexerNonceState()).to.deep.equal({
      nodeAddress: NODE_ADDRESS,
      storedNonce: 0,
      nextNonce: 1,
      stuck: false
    })
  })

  it('throws an OceanNodeError on an unusable nonce answer', async () => {
    for (const [body, status, message] of [
      ['<html/>', 200, /not JSON/],
      ['{"nonce":"abc"}', 200, /unusable nonce/],
      ['nope', 500, /getIndexerNonceState: 500/]
    ] as const) {
      stubNonce(body, status)

      await expectThrowsAsync(() => client().getIndexerNonceState(), message)
    }
  })

  it('is undefined over P2P', async () => {
    expect(await client('16Uiu2HAmPeerIdOnly').getIndexerNonceState()).to.equal(
      undefined
    )
  })
})

describe('IndexingError', () => {
  const failure = (error: string) =>
    new IndexingError(ASSET_DID, { ...RECORDS.failureBeforeDid, error }, TX)

  it('explains an envelope decoding error', () => {
    for (const error of [
      'invalid codepoint at offset 1; unexpected continuation byte',
      'UNEXPECTED_CONTINUE',
      'invalid BytesLike value'
    ])
      expect(failure(error).message).to.match(
        /Hint: the node could not decrypt the envelope .*413 .*AUTHORIZED_DECRYPTERS and MAX_REQ_PER_MINUTE$/
      )
  })

  it('explains a refused decrypt call', () => {
    expect(
      failure(
        'Provider exception on decrypt DDO. Status: bProvider exception on decrypt DDO. Status: 401, Unauthorized'
      ).message
    ).to.match(/Hint: the node's decrypt call was refused \(401 Unauthorized\)/)
  })

  it('points to the stuck indexer nonce in the 401 hint', () => {
    const message = failure(
      'Provider exception on decrypt DDO. Status: 401, Unauthorized'
    ).message

    expect(message).to.contain(
      "'consumer address and nonce signature mismatch' for its own address"
    )
    expect(message).to.contain(
      "until the operator advances the stored nonce of the node's address"
    )
  })

  it('adds no hint to other errors', () => {
    expect(failure('Hash check failed').message).not.to.contain('Hint')
  })
})
