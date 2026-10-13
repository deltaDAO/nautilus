/**
 * D1 (found during the fix plan): nautilus's publish preflight refused a next indexer nonce
 * whose decrypt-message hash starts with a zero byte, on every node. ocean-node 4.2.2
 * accepts that signature form (oe-ocean-node c69ddd4e, `nonceHandler.ts`), so the refusal
 * now depends on the node's version from `GET /`; an unknown or older version keeps it.
 */
import { Wallet } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../src/log/logger.js'
import type { LogEvent } from '../../src/log/types.js'
import {
  isIndexerNonceSignable,
  nodeAcceptsZeroByteNonce,
  OceanNodeClient
} from '../../src/node/OceanNodeClient.js'

describe('isIndexerNonceSignable (D1: version-aware)', () => {
  const NODE = '0xbcE5A3468386C64507D30136685A99cFD5603135'
  /** The first nonce whose decrypt-message hash starts with a zero byte. */
  const zeroByteNonce = (() => {
    for (let nonce = 1; ; nonce++)
      if (!isIndexerNonceSignable(NODE, nonce)) return nonce
  })()

  it('refuses a zero-byte nonce for an unknown or older node, accepts it from 4.2.2', () => {
    expect(isIndexerNonceSignable(NODE, zeroByteNonce)).to.equal(false)
    for (const version of [
      undefined,
      '',
      'x',
      '4.2.0',
      '4.2.1',
      '4.2.2-rc1',
      '3.9.9'
    ])
      expect(
        isIndexerNonceSignable(NODE, zeroByteNonce, version),
        String(version)
      ).to.equal(false)
    for (const version of ['4.2.2', 'v4.2.2', '4.2.3', '4.3.0', '5.0.0'])
      expect(
        isIndexerNonceSignable(NODE, zeroByteNonce, version),
        version
      ).to.equal(true)
    expect(nodeAcceptsZeroByteNonce('4.10.0')).to.equal(true)
    // Build metadata is no pre-release.
    expect(nodeAcceptsZeroByteNonce('4.2.2+oe.35b864f6')).to.equal(true)
    expect(nodeAcceptsZeroByteNonce('4.2.2-rc1+oe')).to.equal(false)
  })

  it("getIndexerNonceState reads the node's version: a 4.2.2 node is not stuck on a zero-byte nonce", async () => {
    for (const [version, stuck] of [
      ['4.2.2', false],
      ['4.2.0', true],
      [undefined, true]
    ] as const) {
      const fetchMock = vi.fn(async (url: string) => {
        const body = url.endsWith('/')
          ? { providerAddress: NODE, ...(version ? { version } : {}) }
          : { nonce: String(zeroByteNonce - 1) }
        return new Response(JSON.stringify(body), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      try {
        const client = new OceanNodeClient({
          nodeUri: 'https://node.test.invalid',
          chainId: 8996,
          auth: Wallet.createRandom()
        })
        const state = await client.getIndexerNonceState()
        expect(state?.nextNonce).to.equal(zeroByteNonce)
        expect(state?.stuck, String(version)).to.equal(stuck)
        expect(state?.nodeVersion).to.equal(version)
      } finally {
        vi.unstubAllGlobals()
      }
    }
  })

  it('reports the skipped refusal at info, with the version sanitised (D9)', async () => {
    const events: LogEvent[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/')
          ? { providerAddress: NODE, version: '4.2.2\u001b[31m' }
          : { nonce: String(zeroByteNonce - 1) }
        return new Response(JSON.stringify(body), { status: 200 })
      })
    )
    try {
      const client = new OceanNodeClient({
        nodeUri: 'https://node.test.invalid',
        chainId: 8996,
        auth: Wallet.createRandom(),
        logger: createLogger({
          level: 'info',
          sink: (event) => events.push(event)
        })
      })
      const state = await client.getIndexerNonceState()

      expect(state?.stuck).to.equal(false)
      expect(state?.nodeVersion).to.equal('4.2.2')
      const skipped = events.find(
        (event) => event.event === 'node.indexer_nonce.zero_byte_accepted'
      )
      expect(skipped?.level).to.equal('info')
      expect(skipped?.msg).to.match(/self-reported/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
