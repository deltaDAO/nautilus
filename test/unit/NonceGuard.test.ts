/**
 * The nonce guard `Nautilus.create()` wraps the signer in (PR 4, N5): one send at a time per
 * (chain, address), nonce `max(local next, pending)`, recovery only from nonce refusals of a
 * transaction that is provably this send's, no resend of a money send without proof, and
 * the cause of a failed send named where ocean.js only returns `null`.
 *
 * The chain is a fake provider; the signer is a real ethers `Wallet`, so every refusal
 * carries a real signed transaction, as `eth_sendRawTransaction` errors do.
 */

import { wrapEthersSigner } from '@oasisprotocol/sapphire-ethers-v6'
import {
  Datatoken,
  Dispenser,
  EscrowContract,
  FixedRateExchange,
  Nft,
  NftFactory
} from '@oceanprotocol/lib'
import {
  FetchRequest,
  Interface,
  JsonRpcSigner,
  makeError,
  Transaction,
  type TransactionRequest,
  Wallet
} from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import { Nautilus } from '../../src/index.js'
import {
  isMoneySend,
  NonceGuardError,
  NonceGuardSigner,
  NonceGuardState,
  nonceRefusalOf,
  provenNeverSent,
  withoutSignedTransaction
} from '../../src/utils/nonceGuard.js'
import { confirmTransaction } from '../../src/utils/order.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'
const CHAIN_ID = 8996
const TO = '0x00000000000000000000000000000000000000aa'
/** `ERC721Template.setMetaData`: moves no value. */
const METADATA_CALL = `0x1aa3adf9${'00'.repeat(64)}`
/** `ERC20Template.startOrder`: pays. */
const ORDER_CALL = `0x79d9d7f3${'00'.repeat(64)}`

const LONG_HEX = /0x[0-9a-f]{130,}/i

type Broadcast = (raw: string, tx: Transaction) => Promise<unknown>

/** A mined transaction as a block lists it. */
type MinedTx = { from: string; nonce: number; hash: string }

/**
 * A chain with `latest` mined transactions of the wallet, a pending count that may lag
 * (`stale`), and known transactions by hash. `broadcast` decides each send. Blocks from
 * `head` on list the transactions `blocks` puts in them; a broadcast adds none.
 */
function fakeChain(options: {
  latest?: number
  stale?: number
  broadcast?: Broadcast
  known?: Set<string>
  head?: number
}) {
  const known = options.known ?? new Set<string>()
  const broadcasts: Transaction[] = []
  let latest = options.latest ?? 10
  let head = options.head ?? 100
  const blocks = new Map<number, MinedTx[]>()
  const reads: string[] = []

  const provider = {
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async (number: number) =>
      number > head
        ? null
        : { number, prefetchedTransactions: blocks.get(number) ?? [] }
    ),
    getFeeData: async () => ({
      gasPrice: 1n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n
    }),
    estimateGas: async () => 21000n,
    getTransactionCount: vi.fn(async (_address: string, tag: string) => {
      reads.push(tag)
      return tag === 'pending' ? latest - (options.stale ?? 0) : latest
    }),
    getTransaction: vi.fn(async (hash: string) =>
      known.has(hash) ? response(hash) : null
    ),
    getTransactionReceipt: vi.fn(async () => null),
    broadcastTransaction: vi.fn(async (raw: string) => {
      const tx = Transaction.from(raw)
      broadcasts.push(tx)
      const result = options.broadcast
        ? await options.broadcast(raw, tx)
        : undefined
      latest = Math.max(latest, tx.nonce + 1)
      known.add(tx.hash as string)
      return result ?? response(tx.hash as string, tx.nonce)
    })
  }

  return {
    provider,
    broadcasts,
    known,
    reads,
    mine: (count: number) => {
      latest += count
    },
    setLatest: (count: number) => {
      latest = count
    },
    /** Mines `txs` in a new block at the head. */
    mineBlock: (...txs: MinedTx[]) => {
      head += 1
      blocks.set(head, txs)
    }
  }
}

/** A second RPC on the chain: its own mined count, and the hashes it knows. */
function secondRpc(latest: number, known = new Set<string>()) {
  return {
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }),
    getTransactionCount: vi.fn(async () => latest),
    getTransaction: vi.fn(async (hash: string) =>
      known.has(hash) ? response(hash) : null
    ),
    getTransactionReceipt: vi.fn(async () => null),
    getBlockNumber: async () => {
      throw new Error('not asked in these tests')
    }
  }
}

/** Another transaction of the wallet with `nonce`, as another process would send it. */
async function otherTx(nonce: number): Promise<MinedTx> {
  const wallet = new Wallet(PRIVATE_KEY)
  const signed = Transaction.from(
    await wallet.signTransaction({
      ...request(`0xc0ffee00${'00'.repeat(32)}`),
      nonce,
      chainId: CHAIN_ID
    })
  )
  return { from: wallet.address, nonce, hash: signed.hash as string }
}

function response(hash: string, nonce = 0) {
  return { hash, nonce, wait: async () => ({ hash, status: 1 }) }
}

function guard(
  chain: ReturnType<typeof fakeChain>,
  options: ConstructorParameters<typeof NonceGuardSigner>[1] = {}
) {
  const wallet = new Wallet(PRIVATE_KEY).connect(chain.provider as never)
  return new NonceGuardSigner(wallet, {
    state: new NonceGuardState(),
    sleep: async () => undefined,
    ...options
  })
}

const request = (data = METADATA_CALL): TransactionRequest => ({
  to: TO,
  data,
  gasLimit: 100000n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n
})

/** An ethers `eth_sendRawTransaction` refusal, as `getRpcError` builds it. */
function refusal(code: string, rpcMessage: string, raw: string) {
  if (code === 'UNKNOWN_ERROR')
    return makeError('could not coalesce error', 'UNKNOWN_ERROR', {
      error: { code: -32000, message: rpcMessage },
      payload: {
        method: 'eth_sendRawTransaction',
        params: [raw],
        id: 1,
        jsonrpc: '2.0'
      }
    } as never)

  return makeError(
    code === 'NONCE_EXPIRED'
      ? 'nonce has already been used'
      : 'replacement fee too low',
    code as never,
    {
      transaction: raw,
      info: { error: { code: -32003, message: rpcMessage } }
    } as never
  )
}

/** Refuses the first `times` broadcasts with `code`, then accepts. */
function refuseFirst(
  times: number,
  code: string,
  rpcMessage: string
): Broadcast {
  let left = times
  return async (raw) => {
    if (left-- > 0) throw refusal(code, rpcMessage, raw)
    return undefined
  }
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: Error) => error
  )
}

describe('NonceGuardSigner: prevention', () => {
  it('sends concurrent transactions one at a time with contiguous nonces', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)

    await Promise.all(
      [1, 2, 3, 4, 5].map(() => signer.sendTransaction(request()))
    )

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([
      10, 11, 12, 13, 14
    ])
  })

  it('collides without the guard: the same nonce twice (control)', async () => {
    // ethers' own populate reads `pending` per send; nothing orders the reads.
    const chain = fakeChain({ latest: 10 })
    const wallet = new Wallet(PRIVATE_KEY).connect(chain.provider as never)

    await Promise.all([
      wallet.sendTransaction(request()),
      wallet.sendTransaction(request())
    ])

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 10])
  })

  it('takes max(local next, pending): a stale pending read after a send is masked', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)
    await signer.sendTransaction(request())

    chain.provider.getTransactionCount.mockResolvedValueOnce(3) // stale pending
    await signer.sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 11])
  })

  it('does not advance the counter when the broadcast fails', async () => {
    let first = true
    const chain = fakeChain({
      latest: 10,
      broadcast: async (raw) => {
        if (first) {
          first = false
          throw makeError('insufficient funds', 'INSUFFICIENT_FUNDS', {
            transaction: raw
          } as never)
        }
        return undefined
      }
    })
    const signer = guard(chain)

    const error = await failure(signer.sendTransaction(request()))
    expect(error.message).to.match(/insufficient funds/)
    await signer.sendTransaction(request())

    // Nonce 10 again, not 11: a failed broadcast leaves no gap.
    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 10])
  })

  it('falls back to the pending count when the last transaction was dropped', async () => {
    let now = 0
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain, { now: () => now })
    await signer.sendTransaction(request())

    // The transaction with nonce 10 was dropped: a minute later, pending and latest are 10
    // again and the hash is unknown on both reads.
    now = 61_000
    chain.known.clear()
    chain.setLatest(10)
    await signer.sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 10])
  })

  it('keeps the counter while an RPC that lags right after the broadcast forgets the transaction', async () => {
    // Code review M1: a load-balanced RPC answers pending and the hash lookup from a backend
    // that has not seen the broadcast yet. Resetting would reuse the in-flight nonce.
    let now = 0
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain, { now: () => now })
    await signer.sendTransaction(request())

    now = 2_000
    chain.known.clear()
    chain.setLatest(10)
    await signer.sendTransaction(request(ORDER_CALL))

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 11])
  })

  it('keeps the counter after the grace period when the account mined past its nonce', async () => {
    // Security review m2: a stale pending count and a lagging hash index, but the mined
    // count shows the slot used.
    let now = 0
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain, { now: () => now })
    await signer.sendTransaction(request())

    now = 61_000
    chain.known.clear()
    chain.provider.getTransactionCount.mockImplementation(
      async (_address: string, tag: string) => (tag === 'pending' ? 10 : 11)
    )
    await signer.sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 11])
  })

  it('keeps the counter after the grace period when the verification provider knows the transaction', async () => {
    let now = 0
    const chain = fakeChain({ latest: 10 })
    const second = secondRpc(10, new Set())
    const signer = guard(chain, {
      now: () => now,
      verificationProvider: second as never
    })
    const first = await signer.sendTransaction(request())

    now = 61_000
    chain.known.clear()
    chain.setLatest(10)
    second.getTransaction.mockImplementation(async (hash: string) =>
      hash === first.hash ? response(hash) : null
    )
    await signer.sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 11])
  })

  it('injects no nonce for a wallet-managed signer (JsonRpcSigner)', async () => {
    const chain = fakeChain({ latest: 10 })
    const jsonRpc = new JsonRpcSigner(
      chain.provider as never,
      new Wallet(PRIVATE_KEY).address
    )
    const send = vi.fn(async (_tx: TransactionRequest) => response('0x01'))
    jsonRpc.sendTransaction = send as never
    const signer = new NonceGuardSigner(jsonRpc, {
      state: new NonceGuardState()
    })

    await signer.sendTransaction(request())

    expect(signer.managesNonces).to.equal(false)
    expect(send.mock.calls[0][0].nonce).to.equal(undefined)
    expect(chain.provider.getTransactionCount).not.toHaveBeenCalled()
  })

  it("injects no nonce with nonceManagement 'off'", async () => {
    const chain = fakeChain({ latest: 10, stale: 4 })
    const signer = guard(chain, { nonceManagement: 'off' })

    await signer.sendTransaction(request())

    // ethers' own pending read, stale as it is.
    expect(chain.broadcasts[0].nonce).to.equal(6)
  })
})

describe('NonceGuardSigner: recovery', () => {
  it('NONCE_EXPIRED, unknown hash: sends the same transaction again with a fresh nonce', async () => {
    const chain = fakeChain({
      latest: 818,
      stale: 53,
      broadcast: refuseFirst(1, 'NONCE_EXPIRED', 'nonce too low')
    })
    const signer = guard(chain)

    await signer.sendTransaction(request())

    const [first, second] = chain.broadcasts
    expect([first.nonce, second.nonce]).to.deep.equal([765, 818])
    expect(second.data).to.equal(first.data)
    expect(second.to).to.equal(first.to)
  })

  it('takes the next nonce the RPC names', async () => {
    const chain = fakeChain({
      latest: 10,
      stale: 5,
      broadcast: refuseFirst(
        1,
        'NONCE_EXPIRED',
        'nonce too low: next nonce 42, tx nonce 5'
      )
    })

    await guard(chain).sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([5, 42])
  })

  it('REPLACEMENT_UNDERPRICED: the next free nonce', async () => {
    // Another sender of the key holds nonce 10 in the pool; pending does not count it yet.
    const chain = fakeChain({
      latest: 10,
      broadcast: refuseFirst(
        1,
        'REPLACEMENT_UNDERPRICED',
        'replacement transaction underpriced'
      )
    })

    await guard(chain).sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 11])
  })

  it('NONCE_EXPIRED for a transaction already mined: returns it, never sends again (control)', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)
    chain.provider.broadcastTransaction.mockImplementationOnce(
      async (raw: string) => {
        const tx = Transaction.from(raw)
        chain.broadcasts.push(tx)
        chain.known.add(tx.hash as string) // mined, its response lost
        throw refusal('NONCE_EXPIRED', 'nonce too low', raw)
      }
    )

    const sent = await signer.sendTransaction(request())

    expect(chain.broadcasts).to.have.length(1)
    expect(sent.hash).to.equal(chain.broadcasts[0].hash)
    // and the counter moved past it
    await signer.sendTransaction(request())
    expect(chain.broadcasts[1].nonce).to.equal(11)
  })

  it('"already known": the pooled transaction is returned, never sent again', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementationOnce(
      async (raw: string) => {
        const tx = Transaction.from(raw)
        chain.broadcasts.push(tx)
        setTimeout(() => chain.known.add(tx.hash as string), 0)
        throw refusal('UNKNOWN_ERROR', 'already known', raw)
      }
    )
    const signer = guard(chain, {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms / 100))
    })

    const sent = await signer.sendTransaction(request())

    expect(chain.broadcasts).to.have.length(1)
    expect(sent.hash).to.equal(chain.broadcasts[0].hash)
  })

  it('"already known" that the RPC never returns: stops, "may have been sent"', async () => {
    const chain = fakeChain({
      latest: 10,
      broadcast: async (raw) => {
        throw refusal('UNKNOWN_ERROR', 'already known', raw)
      }
    })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        chain.broadcasts.push(Transaction.from(raw))
        throw refusal('UNKNOWN_ERROR', 'already known', raw)
      }
    )

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as NonceGuardError

    expect(error).to.be.instanceOf(NonceGuardError)
    expect(error.reason).to.equal('may-have-been-sent')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('a refusal naming a different transaction: no recovery', async () => {
    const other = await new Wallet(PRIVATE_KEY).signTransaction({
      ...request(`0xdeadbeef${'00'.repeat(32)}`),
      nonce: 9,
      chainId: CHAIN_ID
    })
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        chain.broadcasts.push(Transaction.from(raw))
        throw refusal('NONCE_EXPIRED', 'nonce too low', other)
      }
    )

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as NonceGuardError

    expect(error.reason).to.equal('unverifiable')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('a refusal without a signed transaction: no recovery', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        chain.broadcasts.push(Transaction.from(raw))
        throw makeError(
          'nonce has already been used',
          'NONCE_EXPIRED',
          {} as never
        )
      }
    )

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as NonceGuardError

    expect(error.reason).to.equal('unverifiable')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('a lookup that fails proves nothing: no resend', async () => {
    const chain = fakeChain({
      latest: 818,
      stale: 53,
      broadcast: refuseFirst(1, 'NONCE_EXPIRED', 'nonce too low')
    })
    chain.provider.getTransaction.mockRejectedValue(
      makeError('timeout', 'TIMEOUT', {} as never)
    )

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as NonceGuardError

    expect(error.reason).to.equal('may-have-been-sent')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('gives up after three attempts', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        chain.broadcasts.push(Transaction.from(raw))
        throw refusal('NONCE_EXPIRED', 'nonce too low', raw)
      }
    )
    chain.provider.getTransactionCount.mockResolvedValue(0)

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as NonceGuardError

    expect(error.reason).to.equal('attempts-exhausted')
    expect(chain.broadcasts).to.have.length(3)
    expect(error.attempts).to.have.length(3)
  })

  for (const code of [
    'TIMEOUT',
    'NETWORK_ERROR',
    'SERVER_ERROR',
    'UNKNOWN_ERROR',
    'CALL_EXCEPTION'
  ]) {
    it(`never retries after ${code}`, async () => {
      const chain = fakeChain({ latest: 10 })
      chain.provider.broadcastTransaction.mockImplementation(
        async (raw: string) => {
          chain.broadcasts.push(Transaction.from(raw))
          throw makeError(
            `failed: ${code}`,
            code as never,
            { transaction: raw } as never
          )
        }
      )

      const error = await failure(guard(chain).sendTransaction(request()))

      expect((error as { code?: string }).code).to.equal(code)
      expect(chain.broadcasts).to.have.length(1)
      expect(error.message).not.to.match(LONG_HEX)
      expect((error as { transaction?: string }).transaction).not.to.match(
        LONG_HEX
      )
    })
  }

  it('an explicit nonce from the caller is never replaced', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        chain.broadcasts.push(Transaction.from(raw))
        throw refusal('NONCE_EXPIRED', 'nonce too low', raw)
      }
    )

    const error = (await failure(
      guard(chain).sendTransaction({ ...request(), nonce: 3 })
    )) as NonceGuardError

    expect(error.reason).to.equal('not-managed')
    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([3])
  })

  for (const [code, complete] of [
    ['INSUFFICIENT_FUNDS', true],
    ['TIMEOUT', false]
  ] as const)
    it(`a resend that fails with ${code} keeps the earlier refused transaction on record`, async () => {
      // Security review M3: the second send's own error lost the first, refused
      // transaction, which a single lookup had called unknown.
      let first = true
      const chain = fakeChain({
        latest: 818,
        stale: 53,
        broadcast: async (raw) => {
          if (first) {
            first = false
            throw refusal('NONCE_EXPIRED', 'nonce too low', raw)
          }
          throw makeError(
            `failed: ${code}`,
            code as never,
            {
              transaction: raw
            } as never
          )
        }
      })

      const error = (await failure(
        guard(chain).sendTransaction(request())
      )) as NonceGuardError

      expect(error).to.be.instanceOf(NonceGuardError)
      expect(error.reason).to.equal('may-have-been-sent')
      expect(error.code).to.equal(code)
      expect(error.attempts.map((attempt) => attempt.nonce)).to.deep.equal([
        765
      ])
      expect(error.attemptsComplete).to.equal(complete)
      expect(error.message).not.to.match(LONG_HEX)
      expect(chain.broadcasts).to.have.length(2)
    })

  it('a refused transaction the RPC returns only by its receipt: returned, never sent again', async () => {
    // ethers' `receipt.getTransaction()` throws "TODO" there; the response is built from the
    // signed transaction instead.
    const chain = fakeChain({ latest: 10 })
    let mined = ''
    chain.provider.broadcastTransaction.mockImplementationOnce(
      async (raw: string) => {
        const tx = Transaction.from(raw)
        chain.broadcasts.push(tx)
        mined = tx.hash as string
        throw refusal('NONCE_EXPIRED', 'nonce too low', raw)
      }
    )
    chain.provider.getTransactionReceipt.mockImplementation((async (
      hash: string
    ) =>
      hash === mined
        ? {
            hash,
            blockNumber: 7,
            blockHash: `0x${'07'.repeat(32)}`,
            index: 0,
            getTransaction: async () => {
              throw new Error('TODO')
            }
          }
        : null) as never)

    const sent = await guard(chain).sendTransaction(request())

    expect(chain.broadcasts).to.have.length(1)
    expect(sent.hash).to.equal(mined)
    expect(sent.blockNumber).to.equal(7)
    expect(sent.nonce).to.equal(10)
  })

  it("ignores a 'next nonce' far above every other source", async () => {
    const chain = fakeChain({
      latest: 10,
      stale: 5,
      broadcast: refuseFirst(
        1,
        'NONCE_EXPIRED',
        'nonce too low: next nonce 99999999, tx nonce 5'
      )
    })

    await guard(chain).sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([5, 10])
  })

  it('a refusal naming the same call on another chain: no recovery', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        const tx = Transaction.from(raw)
        chain.broadcasts.push(tx)
        const elsewhere = await new Wallet(PRIVATE_KEY).signTransaction({
          ...request(),
          nonce: tx.nonce,
          chainId: CHAIN_ID + 1
        })
        throw refusal('NONCE_EXPIRED', 'nonce too low', elsewhere)
      }
    )

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as NonceGuardError

    expect(error.reason).to.equal('unverifiable')
    expect(error.attemptsComplete).to.equal(false)
    expect(chain.broadcasts).to.have.length(1)
  })
})

describe('NonceGuardSigner: money sends', () => {
  /**
   * Another process of the key sent nonce 10 at the same moment, and it was mined in the
   * next block: our order at nonce 10 is refused, and the block shows who took the slot.
   */
  async function collidingOrder(options: { minedOurs?: boolean } = {}) {
    const chain = fakeChain({ latest: 10, head: 100 })
    const other = await otherTx(10)
    chain.provider.broadcastTransaction.mockImplementationOnce(
      async (raw: string) => {
        const tx = Transaction.from(raw)
        chain.broadcasts.push(tx)
        chain.mineBlock(
          options.minedOurs
            ? { from: tx.from as string, nonce: 10, hash: tx.hash as string }
            : other
        )
        chain.setLatest(11)
        throw refusal('NONCE_EXPIRED', 'nonce too low', raw)
      }
    )
    return chain
  }

  it('resends an order with proof from two RPCs: latest past its nonce, hash unknown, and another transaction in its slot', async () => {
    const chain = await collidingOrder()

    await guard(chain, {
      verificationProvider: secondRpc(11) as never
    }).sendTransaction(request(ORDER_CALL))

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 11])
  })

  it('never resends an order without a verificationProvider (D8)', async () => {
    // Security review M1 (P1): the order was mined through another backend, the lagging one
    // asked here returns neither the transaction nor its receipt, and its mined count is
    // fresh. One RPC read twice proves nothing.
    const chain = fakeChain({
      latest: 818,
      stale: 53,
      broadcast: refuseFirst(1, 'NONCE_EXPIRED', 'nonce too low')
    })

    const error = (await failure(
      guard(chain).sendTransaction(request(ORDER_CALL))
    )) as NonceGuardError

    expect(error.reason).to.equal('may-have-been-sent')
    expect(error.message).to.match(/verificationProvider/)
    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([765])
  })

  it('does not resend an order when no block shows another transaction in its slot', async () => {
    // Both RPCs' hash indexes lag and both counts are past the nonce, but the slot was taken
    // before the send (the stale read of beta.2) or by the order itself: no positive proof.
    const chain = fakeChain({
      latest: 818,
      stale: 53,
      broadcast: refuseFirst(1, 'NONCE_EXPIRED', 'nonce too low')
    })

    const error = (await failure(
      guard(chain, {
        verificationProvider: secondRpc(818) as never
      }).sendTransaction(request(ORDER_CALL))
    )) as NonceGuardError

    expect(error.reason).to.equal('may-have-been-sent')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('does not resend an order a block shows mined, although no RPC returns it by hash', async () => {
    const chain = await collidingOrder({ minedOurs: true })

    const error = (await failure(
      guard(chain, {
        verificationProvider: secondRpc(11) as never
      }).sendTransaction(request(ORDER_CALL))
    )) as NonceGuardError

    expect(error.reason).to.equal('may-have-been-sent')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('reads the mined count before the hash lookups', async () => {
    // Security review M1 (P1b): the transaction is mined between the hash reads and the
    // count read; read last, the count looked like another transaction took the slot.
    let lookups = 0
    const provider = {
      getTransactionCount: vi.fn(async () => (lookups >= 2 ? 11 : 10)),
      getTransaction: vi.fn(async () => {
        lookups++
        return null
      }),
      getTransactionReceipt: vi.fn(async () => null)
    }

    const proven = await provenNeverSent({
      provider: provider as never,
      address: new Wallet(PRIVATE_KEY).address,
      attempts: [{ hash: `0x${'11'.repeat(32)}`, nonce: 10 }],
      sleep: async () => undefined
    })

    expect(proven).to.equal(false)
  })

  it('does not resend an order when the latest count does not prove the slot taken', async () => {
    // Underpriced: another transaction holds the nonce, unmined, so ours could still land.
    const chain = fakeChain({
      latest: 10,
      broadcast: refuseFirst(
        1,
        'REPLACEMENT_UNDERPRICED',
        'replacement transaction underpriced'
      )
    })

    const error = (await failure(
      guard(chain, {
        verificationProvider: secondRpc(10) as never
      }).sendTransaction(request(ORDER_CALL))
    )) as NonceGuardError

    expect(error.reason).to.equal('may-have-been-sent')
    expect(error.moneySend).to.equal(true)
    expect(error.message).to.match(/may have been sent, check/)
    expect(chain.broadcasts).to.have.length(1)
  })

  it('does not resend an order the second provider knows', async () => {
    const chain = fakeChain({
      latest: 818,
      stale: 53,
      broadcast: refuseFirst(1, 'NONCE_EXPIRED', 'nonce too low')
    })
    const second = {
      ...secondRpc(818),
      getTransaction: async () => response('0x02')
    }

    const error = (await failure(
      guard(chain, { verificationProvider: second as never }).sendTransaction(
        request(ORDER_CALL)
      )
    )) as NonceGuardError

    expect(error.reason).to.equal('may-have-been-sent')
    expect(chain.broadcasts).to.have.length(1)
  })

  it('counts every call not known to move no value as money', () => {
    expect(isMoneySend(request(METADATA_CALL))).to.equal(false)
    expect(isMoneySend(request(ORDER_CALL))).to.equal(true)
    expect(isMoneySend(request('0xffffffff'))).to.equal(true)
    expect(isMoneySend({ ...request(METADATA_CALL), value: 1n })).to.equal(true)
    expect(isMoneySend({ to: TO })).to.equal(false)
  })

  it("matches ocean.js's ABIs: only publishing, pricing and metadata calls are free of value", () => {
    // PR 11 contract: if ocean.js renames or re-types one of these, it counts as money (safe),
    // and this test names it.
    const wallet = new Wallet(PRIVATE_KEY)
    const at = '0x0000000000000000000000000000000000000001'
    const abis = {
      Nft: new Nft(wallet, CHAIN_ID, {} as never).abi,
      NftFactory: new NftFactory(at, wallet, CHAIN_ID, {} as never).abi,
      Datatoken: new Datatoken(wallet, CHAIN_ID, {} as never).abi,
      FixedRateExchange: new FixedRateExchange(
        at,
        wallet,
        CHAIN_ID,
        {} as never
      ).abi,
      Dispenser: new Dispenser(at, wallet, CHAIN_ID, {} as never).abi,
      Escrow: new EscrowContract(at, wallet, CHAIN_ID, {} as never).abi
    }
    const free: string[] = []
    for (const [name, abi] of Object.entries(abis))
      new Interface(abi as never).forEachFunction((fragment) => {
        if (fragment.constant) return
        if (!isMoneySend({ to: TO, data: fragment.selector }))
          free.push(`${name}.${fragment.name}`)
      })

    expect(free.sort()).to.deep.equal(
      [
        'Datatoken.createDispenser',
        'Datatoken.createFixedRate',
        'FixedRateExchange.setRate',
        'Nft.createERC20',
        'Nft.setMetaData',
        'Nft.setMetaDataAndTokenURI',
        'Nft.setMetaDataState',
        'NftFactory.createNftWithErc20',
        'NftFactory.createNftWithErc20WithDispenser',
        'NftFactory.createNftWithErc20WithFixedRate'
      ].sort()
    )
  })
})

describe('reporting', () => {
  it('confirmTransaction names the recorded failure instead of "ocean.js returned no transaction"', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        throw refusal(
          'REPLACEMENT_UNDERPRICED',
          'replacement transaction underpriced',
          raw
        )
      }
    )
    const signer = guard(chain)

    // What ocean.js's sendPreparedTransaction does: catch, log, return null.
    const returned = await signer
      .sendTransaction(request(ORDER_CALL))
      .catch(() => null)
    const error = await failure(
      confirmTransaction('startOrder', returned, signer)
    )

    expect(error.message).to.match(
      /^startOrder failed: .*REPLACEMENT_UNDERPRICED.*may have been sent/
    )
    expect(error.message).not.to.match(/ocean\.js returned no transaction/)
    expect(error.cause).to.be.instanceOf(NonceGuardError)
    expect(error.message).not.to.match(LONG_HEX)
  })

  it("does not blame one call for another's failure (security review M2)", async () => {
    // Op A's order goes out; op B's send to another contract fails; then A's wait fails
    // and ocean.js returns null for A.
    const OTHER = '0x00000000000000000000000000000000000000bb'
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)
    await signer.sendTransaction(request(ORDER_CALL))
    chain.provider.broadcastTransaction.mockImplementationOnce(async () => {
      throw makeError('insufficient funds', 'INSUFFICIENT_FUNDS', {} as never)
    })
    const b = await signer
      .sendTransaction({ ...request(ORDER_CALL), to: OTHER })
      .catch(() => null)

    const errorA = await failure(
      confirmTransaction('startOrder', null, signer, TO)
    )
    const errorB = await failure(
      confirmTransaction('approve', b, signer, OTHER)
    )

    expect(errorA.message).not.to.match(/insufficient funds/)
    expect(errorA.message).to.match(/ocean\.js returned no transaction/)
    expect(errorB.message).to.match(/^approve failed: insufficient funds/)
  })

  it('keeps the generic message for two concurrent sends to one contract', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)
    await signer.sendTransaction(request(ORDER_CALL))
    chain.provider.broadcastTransaction.mockImplementationOnce(async () => {
      throw makeError('insufficient funds', 'INSUFFICIENT_FUNDS', {} as never)
    })
    await signer.sendTransaction(request(ORDER_CALL)).catch(() => null)

    for (let call = 0; call < 2; call++)
      expect(
        (await failure(confirmTransaction('startOrder', null, signer, TO)))
          .message
      ).to.match(/ocean\.js returned no transaction/)
  })

  it('names the failure of a later call once the earlier one was confirmed', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)
    const first = await signer.sendTransaction(request(ORDER_CALL))
    await confirmTransaction('startOrder', first, signer, TO)

    chain.provider.broadcastTransaction.mockImplementationOnce(async () => {
      throw makeError('insufficient funds', 'INSUFFICIENT_FUNDS', {} as never)
    })
    const second = await signer
      .sendTransaction(request(ORDER_CALL))
      .catch(() => null)

    const error = await failure(
      confirmTransaction('startOrder', second, signer, TO)
    )
    expect(error.message).to.match(/^startOrder failed: insufficient funds/)
    // Refused before the broadcast: no "may have been sent".
    expect(error.message).not.to.match(/may have been sent/)
  })

  it('says a timed-out send may have been sent (security review m3)', async () => {
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(async () => {
      throw makeError('request timeout', 'TIMEOUT', {} as never)
    })
    const signer = guard(chain)

    const returned = await signer
      .sendTransaction(request(ORDER_CALL))
      .catch(() => null)
    const error = await failure(
      confirmTransaction('startOrder', returned, signer, TO)
    )

    expect(error.message).to.match(
      /^startOrder failed: request timeout.*It may have been sent: check the account's latest transactions before retrying\.$/
    )
  })

  it("finds a failure sent through ocean.js's confidential-chain wrapper (code review m2)", async () => {
    // ocean.js's `getSignerAccordingSdk()` wraps the signer with sapphire's
    // `wrapEthersSigner`, which sends through `guard.connect(wrappedProvider)`.
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(async () => {
      throw makeError('insufficient funds', 'INSUFFICIENT_FUNDS', {} as never)
    })
    const provider = Object.assign(chain.provider, {
      send: async () => {
        throw new Error('not asked')
      }
    })
    const signer = guard({ ...chain, provider })
    const wrapped = wrapEthersSigner(signer, {
      fetcher: {
        cipher: async () => ({ encryptCall: (data: string) => data })
      }
    } as never)

    const returned = await wrapped
      .sendTransaction(request(ORDER_CALL))
      .catch(() => null)
    const error = await failure(
      confirmTransaction('startOrder', returned, signer, TO)
    )

    expect(error.message).to.match(/^startOrder failed: insufficient funds/)
  })

  it('drops the HTTP request and response of a failed send (security review m4)', async () => {
    // ethers' SERVER_ERROR for an HTTP 500 on eth_sendRawTransaction carries the
    // FetchRequest, whose body is the signed transaction.
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        const fetch = new FetchRequest('https://rpc.example.org/k3y')
        fetch.body = { method: 'eth_sendRawTransaction', params: [raw] }
        throw makeError('server response 500', 'SERVER_ERROR', {
          request: fetch,
          response: { statusCode: 500 }
        } as never)
      }
    )

    const error = (await failure(
      guard(chain).sendTransaction(request())
    )) as Error & { code?: string; request?: unknown; response?: unknown }

    expect(error.code).to.equal('SERVER_ERROR')
    for (const field of [error.request, error.response]) {
      expect(field).to.be.a('string')
      expect(field).not.to.match(LONG_HEX)
      expect(field).not.to.match(/k3y/)
    }
    expect(error.message).not.to.match(LONG_HEX)
  })

  it('keeps the generic message without a recorded failure, and reads a failure once', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)

    const error = await failure(confirmTransaction('startOrder', null, signer))

    expect(error.message).to.match(/ocean\.js returned no transaction/)
  })

  it('no message carries a signed transaction', async () => {
    const raw = await new Wallet(PRIVATE_KEY).signTransaction({
      ...request(),
      nonce: 1,
      chainId: CHAIN_ID
    })
    for (const code of [
      'NONCE_EXPIRED',
      'REPLACEMENT_UNDERPRICED',
      'UNKNOWN_ERROR'
    ]) {
      const error = refusal(
        code,
        code === 'UNKNOWN_ERROR' ? 'already known' : 'nonce too low',
        raw
      )
      expect(error.message).to.match(LONG_HEX) // ethers puts it there
      const scrubbed = withoutSignedTransaction(error) as Error
      expect(scrubbed.message).not.to.match(LONG_HEX)
      expect(JSON.stringify(scrubbed)).not.to.match(LONG_HEX)
    }
  })

  it('redacts RPC-supplied text: no URL token, JWT or signature in the error or its report', async () => {
    const secret =
      'nonce too low at https://rpc.example.org/v1/s3cr3tT0ken?key=abc eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl'
    const chain = fakeChain({ latest: 10 })
    chain.provider.broadcastTransaction.mockImplementation(
      async (raw: string) => {
        throw refusal('REPLACEMENT_UNDERPRICED', secret, raw)
      }
    )
    const signer = guard(chain)

    const returned = await signer
      .sendTransaction(request(ORDER_CALL))
      .catch(() => null)
    const error = await failure(
      confirmTransaction('startOrder', returned, signer)
    )

    for (const text of [error.message, (error.cause as Error).message]) {
      expect(text).not.to.match(/s3cr3tT0ken|key=abc|eyJhbGciOiJIUzI1NiJ9/)
      expect(text).to.match(/https:\/\/rpc\.example\.org/)
    }
    expect((error.cause as Error).cause).to.equal(undefined)
  })

  it('classifies the nonce refusals and nothing else', () => {
    const raw = '0x02'
    expect(
      nonceRefusalOf(refusal('NONCE_EXPIRED', 'nonce too low', raw))
    ).to.equal('nonce-expired')
    expect(
      nonceRefusalOf(refusal('REPLACEMENT_UNDERPRICED', 'x', raw))
    ).to.equal('underpriced')
    expect(
      nonceRefusalOf(refusal('UNKNOWN_ERROR', 'already known', raw))
    ).to.equal('already-known')
    // Nethermind's wording.
    expect(
      nonceRefusalOf(refusal('UNKNOWN_ERROR', 'AlreadyKnown', raw))
    ).to.equal('already-known')
    expect(
      nonceRefusalOf(makeError('timeout', 'TIMEOUT', {} as never))
    ).to.equal(undefined)
    expect(nonceRefusalOf(new Error('nonce too low'))).to.equal(undefined)
  })
})

describe('Nautilus.create: the verification provider', () => {
  const ADDRESS = '0x0000000000000000000000000000000000000001'
  const create = (verificationChainId: bigint) =>
    Nautilus.create(
      new Wallet(PRIVATE_KEY).connect({
        getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) })
      } as never),
      {
        verificationProvider: {
          getNetwork: async () => ({ chainId: verificationChainId })
        } as never,
        config: {
          oceanNodeUri: 'https://ocean-node.example.com',
          nftFactoryAddress: ADDRESS,
          fixedRateExchangeAddress: ADDRESS,
          dispenserAddress: ADDRESS
        }
      }
    )

  it("must be on the signer's chain (code review m5)", async () => {
    // On another chain it never knows the transaction, so its "unknown" proves nothing.
    const error = await failure(create(1n))
    expect(error.message).to.match(
      /verificationProvider is on chain 1, but the signer's provider is on chain 8996/
    )

    const nautilus = await create(BigInt(CHAIN_ID))
    expect(nautilus.getSigner()).to.be.instanceOf(NonceGuardSigner)
  })
})
