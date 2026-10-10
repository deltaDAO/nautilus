/**
 * The nonce guard `Nautilus.create()` wraps the signer in (PR 4, N5): one send at a time per
 * (chain, address), nonce `max(local next, pending)`, recovery only from nonce refusals of a
 * transaction that is provably this send's, no resend of a money send without proof, and
 * the cause of a failed send named where ocean.js only returns `null`.
 *
 * The chain is a fake provider; the signer is a real ethers `Wallet`, so every refusal
 * carries a real signed transaction, as `eth_sendRawTransaction` errors do.
 */
import {
  Datatoken,
  Dispenser,
  EscrowContract,
  FixedRateExchange,
  Nft,
  NftFactory
} from '@oceanprotocol/lib'
import {
  Interface,
  JsonRpcSigner,
  makeError,
  Transaction,
  type TransactionRequest,
  Wallet
} from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import {
  isMoneySend,
  NonceGuardError,
  NonceGuardSigner,
  NonceGuardState,
  nonceRefusalOf,
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

/**
 * A chain with `latest` mined transactions of the wallet, a pending count that may lag
 * (`stale`), and known transactions by hash. `broadcast` decides each send.
 */
function fakeChain(options: {
  latest?: number
  stale?: number
  broadcast?: Broadcast
  known?: Set<string>
}) {
  const known = options.known ?? new Set<string>()
  const broadcasts: Transaction[] = []
  let latest = options.latest ?? 10
  const reads: string[] = []

  const provider = {
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) }),
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
    }
  }
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

  it('falls back to the pending count when the RPC no longer knows the last transaction', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)
    await signer.sendTransaction(request())

    // The transaction with nonce 10 was dropped: pending is 10 again, the hash unknown.
    chain.known.clear()
    chain.provider.getTransactionCount.mockResolvedValueOnce(10)
    await signer.sendTransaction(request())

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([10, 10])
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
})

describe('NonceGuardSigner: money sends', () => {
  it('resends an order only with proof: hash absent twice and latest past its nonce', async () => {
    const chain = fakeChain({
      latest: 818,
      stale: 53,
      broadcast: refuseFirst(1, 'NONCE_EXPIRED', 'nonce too low')
    })

    await guard(chain).sendTransaction(request(ORDER_CALL))

    expect(chain.broadcasts.map((tx) => tx.nonce)).to.deep.equal([765, 818])
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
      guard(chain).sendTransaction(request(ORDER_CALL))
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
      getTransaction: async () => response('0x02'),
      getTransactionReceipt: async () => null
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

  it('keeps the generic message without a recorded failure, and reads a failure once', async () => {
    const chain = fakeChain({ latest: 10 })
    const signer = guard(chain)

    const error = await failure(confirmTransaction('startOrder', null, signer))

    expect(error.message).to.match(/ocean\.js returned no transaction/)
  })

  it('no message carries a signed transaction', async () => {
    const chain = fakeChain({ latest: 10 })
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
    void chain
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
    expect(
      nonceRefusalOf(makeError('timeout', 'TIMEOUT', {} as never))
    ).to.equal(undefined)
    expect(nonceRefusalOf(new Error('nonce too low'))).to.equal(undefined)
  })
})
