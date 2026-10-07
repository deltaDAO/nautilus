/**
 * `OceanNodeClient.encrypt` against node rejections.
 *
 * ocean.js 9.2 returns the encrypt response body without checking the HTTP status, so a
 * 401 `nonce: 1 is not a valid nonce` came back as if it were ciphertext and was stored in
 * the DDO as the service's encrypted files. The asset indexed, and consume failed later.
 */

import { ProviderInstance } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OceanNodeClient,
  OceanNodeError
} from '../../src/node/OceanNodeClient.js'
import { expectThrowsAsync } from '../helpers.js'

const CIPHERTEXT = `0x${'ab'.repeat(120)}`
const NONCE_ERROR = 'nonce: 1 is not a valid nonce'

function signerClient(): OceanNodeClient {
  return new OceanNodeClient({
    nodeUri: 'https://node.test.invalid',
    chainId: 32456,
    auth: Wallet.createRandom()
  })
}

describe('OceanNodeClient.encrypt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0x-prefixed hex ciphertext as is', async () => {
    vi.spyOn(ProviderInstance, 'encrypt').mockResolvedValue(CIPHERTEXT)

    expect(await signerClient().encrypt({ a: 1 })).to.equal(CIPHERTEXT)
  })

  it('rejects an error body instead of returning it as ciphertext', async () => {
    const spy = vi
      .spyOn(ProviderInstance, 'encrypt')
      .mockResolvedValue('Error: Encrypt for 0xabc was denied')

    await expectThrowsAsync(
      () => signerClient().encrypt({ a: 1 }),
      '[ocean-node] encrypt: the node did not return ciphertext: Error: Encrypt for 0xabc was denied'
    )
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('rejects hex without the 0x prefix, odd-length hex and an empty 0x', async () => {
    for (const body of ['abcd', '0xabc', '0x']) {
      vi.spyOn(ProviderInstance, 'encrypt').mockResolvedValue(body)

      await expectThrowsAsync(
        () => signerClient().encrypt({ a: 1 }),
        /\[ocean-node\] encrypt: the node (did not return ciphertext|returned an empty ciphertext)/
      )
    }
  })

  it('bounds the node message to 200 characters', async () => {
    vi.spyOn(ProviderInstance, 'encrypt').mockResolvedValue('x'.repeat(5000))

    let error: unknown
    try {
      await signerClient().encrypt({ a: 1 })
    } catch (thrown) {
      error = thrown
    }

    expect(error).to.be.instanceOf(OceanNodeError)
    const message = (error as Error).message
    expect(message).to.contain(`${'x'.repeat(200)}…`)
    expect(message).not.to.contain('x'.repeat(201))
  })

  it('retries once when the node rejects the nonce, and returns the second result', async () => {
    const spy = vi
      .spyOn(ProviderInstance, 'encrypt')
      .mockResolvedValueOnce(NONCE_ERROR)
      .mockResolvedValueOnce(CIPHERTEXT)

    expect(await signerClient().encrypt({ a: 1 })).to.equal(CIPHERTEXT)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('throws when the retry is rejected too, without a third attempt', async () => {
    const spy = vi
      .spyOn(ProviderInstance, 'encrypt')
      .mockResolvedValue(NONCE_ERROR)

    await expectThrowsAsync(
      () => signerClient().encrypt({ a: 1 }),
      `[ocean-node] encrypt: the node did not return ciphertext: ${NONCE_ERROR}`
    )
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not retry a nonce rejection with a pre-computed signature', async () => {
    const spy = vi
      .spyOn(ProviderInstance, 'encrypt')
      .mockResolvedValue(NONCE_ERROR)
    const client = new OceanNodeClient({
      nodeUri: 'https://node.test.invalid',
      chainId: 32456,
      auth: {
        consumerAddress: Wallet.createRandom().address,
        nonce: '1',
        signature: '0x00'
      }
    })

    await expectThrowsAsync(() => client.encrypt({ a: 1 }), /not a valid nonce/)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('runs concurrent calls one at a time, so they never share a nonce', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const spy = vi
      .spyOn(ProviderInstance, 'encrypt')
      .mockImplementation(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return CIPHERTEXT
      })
    const client = signerClient()

    const results = await Promise.all([
      client.encrypt({ a: 1 }),
      client.encrypt({ a: 2 }),
      client.encrypt({ a: 3 })
    ])

    expect(results).to.deep.equal([CIPHERTEXT, CIPHERTEXT, CIPHERTEXT])
    expect(spy).toHaveBeenCalledTimes(3)
    expect(maxInFlight).to.equal(1)
  })

  it('keeps the queue going after a failed call', async () => {
    vi.spyOn(ProviderInstance, 'encrypt')
      .mockRejectedValueOnce(new Error('HTTP request failed calling Provider'))
      .mockResolvedValueOnce(CIPHERTEXT)
    const client = signerClient()

    const [first, second] = await Promise.allSettled([
      client.encrypt({ a: 1 }),
      client.encrypt({ a: 2 })
    ])

    expect(first.status).to.equal('rejected')
    expect(second).to.deep.equal({ status: 'fulfilled', value: CIPHERTEXT })
  })
})
