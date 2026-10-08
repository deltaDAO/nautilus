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

function signerClient(requestTimeoutMs?: number): OceanNodeClient {
  return new OceanNodeClient({
    nodeUri: 'https://node.test.invalid',
    chainId: 32456,
    auth: Wallet.createRandom(),
    requestTimeoutMs
  })
}

/** A promise with its resolve function, to hold a call in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** The signal ocean.js got: `ProviderInstance.encrypt`'s sixth argument. */
const signalOf = (call: unknown[]) => call[5] as AbortSignal

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

  describe('abort and timeout', () => {
    it('rejects at once with the reason when the signal is already aborted', async () => {
      const spy = vi.spyOn(ProviderInstance, 'encrypt')
      const reason = new Error('caller gave up')

      const error = await signerClient()
        .encrypt({ a: 1 }, undefined, AbortSignal.abort(reason))
        .catch((thrown: unknown) => thrown)

      expect(error).to.equal(reason)
      expect(spy).not.toHaveBeenCalled()
    })

    it('lets a queued call leave the queue on abort, keeping the others in order', async () => {
      const held = deferred<string>()
      let inFlight = 0
      let maxInFlight = 0
      const spy = vi
        .spyOn(ProviderInstance, 'encrypt')
        .mockImplementation(async (data) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          const result =
            (data as { a: number }).a === 1 ? await held.promise : CIPHERTEXT
          inFlight--
          return result
        })
      const client = signerClient()
      const controller = new AbortController()
      const reason = new Error('caller gave up')

      const first = client.encrypt({ a: 1 })
      const second = client
        .encrypt({ a: 2 }, undefined, controller.signal)
        .catch((thrown: unknown) => thrown)
      const third = client.encrypt({ a: 3 })

      controller.abort(reason)
      expect(await second).to.equal(reason)
      expect(spy).toHaveBeenCalledTimes(1)

      held.resolve(CIPHERTEXT)
      expect(await first).to.equal(CIPHERTEXT)
      expect(await third).to.equal(CIPHERTEXT)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(maxInFlight).to.equal(1)
    })

    it('rejects with the reason when the signal aborts during the call', async () => {
      vi.spyOn(ProviderInstance, 'encrypt').mockImplementation(
        () => new Promise(() => undefined)
      )
      const controller = new AbortController()
      const reason = new Error('caller gave up')

      const pending = signerClient()
        .encrypt({ a: 1 }, undefined, controller.signal)
        .catch((thrown: unknown) => thrown)
      await Promise.resolve()
      controller.abort(reason)

      expect(await pending).to.equal(reason)
    })

    it('times out a call that never settles, and the next one runs', async () => {
      const spy = vi
        .spyOn(ProviderInstance, 'encrypt')
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValueOnce(CIPHERTEXT)
      const client = signerClient(20)

      const [first, second] = await Promise.allSettled([
        client.encrypt({ a: 1 }),
        client.encrypt({ a: 2 })
      ])

      expect(first.status).to.equal('rejected')
      const error = (first as PromiseRejectedResult).reason
      expect(error).to.be.instanceOf(OceanNodeError)
      expect(error.message).to.equal(
        '[ocean-node] encrypt: timed out after 20 ms (requestTimeoutMs)'
      )
      expect(second).to.deep.equal({ status: 'fulfilled', value: CIPHERTEXT })
      // The hung call's request is aborted too, not left running.
      expect(signalOf(spy.mock.calls[0]).aborted).to.equal(true)
    })

    it('starts the timeout when the call runs, not while it waits in the queue', async () => {
      vi.spyOn(ProviderInstance, 'encrypt').mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(CIPHERTEXT), 15))
      )
      const client = signerClient(40)

      // Three calls of 15 ms each: the last one finishes 45 ms after it was queued.
      const results = await Promise.all([
        client.encrypt({ a: 1 }),
        client.encrypt({ a: 2 }),
        client.encrypt({ a: 3 })
      ])

      expect(results).to.deep.equal([CIPHERTEXT, CIPHERTEXT, CIPHERTEXT])
    })

    it('applies the timeout to JWT auth too, which is not queued', async () => {
      vi.spyOn(ProviderInstance, 'encrypt').mockImplementation(
        () => new Promise(() => undefined)
      )
      const client = new OceanNodeClient({
        nodeUri: 'https://node.test.invalid',
        chainId: 32456,
        auth: 'jwt',
        consumerAddress: Wallet.createRandom().address,
        requestTimeoutMs: 10
      })

      await expectThrowsAsync(
        () => client.encrypt({ a: 1 }),
        '[ocean-node] encrypt: timed out after 10 ms (requestTimeoutMs)'
      )
    })

    it('refuses a requestTimeoutMs that is not a positive finite number', () => {
      for (const requestTimeoutMs of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY
      ])
        expect(() => signerClient(requestTimeoutMs), String(requestTimeoutMs))
          .to.throw(OceanNodeError)
          .with.property('operation', 'create')
    })

    it('carries requestTimeoutMs over to forEndpoint clients', async () => {
      vi.spyOn(ProviderInstance, 'encrypt').mockImplementation(
        () => new Promise(() => undefined)
      )
      const other = signerClient(10).forEndpoint('https://other.test.invalid')

      await expectThrowsAsync(
        () => other.encrypt({ a: 1 }),
        /timed out after 10 ms/
      )
    })
  })
})
