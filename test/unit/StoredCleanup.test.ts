/**
 * What happens to a stored envelope when the write it was stored for fails.
 *
 * The envelope is stored before the metadata transaction, so every failure in between
 * leaves an object in the store. Nothing can point at it while the transaction was never
 * sent, so nautilus removes it; once the transaction may have been mined, the object may be
 * what the NFT now points at, so nautilus keeps it and says so. These tests pin both halves
 * and the line between them, which `writeMetadata()` draws at the broadcast, and again at
 * a mined revert, which points at nothing either.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import { makeError, type TransactionReceipt, Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FailedWithStoredObject } from '../../src/@types/Publish.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import {
  type MetadataWriteProgress,
  PublishIncompleteError,
  prepareMetadataForWrite,
  settleStoredEnvelope,
  writeMetadata
} from '../../src/publish/index.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { Eip191VcSigner } from '../../src/signing/vc.js'
import { ASSET_DID, getAssetFixture, NFT_ADDRESS } from '../fixtures/Asset.js'
import { createNodeMock } from '../mocks/node.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

const HASH = `0x${'ab'.repeat(32)}`

/** The S3 pointer as stored, secret included, and as nautilus hands it back. */
const S3_POINTER = {
  type: 's3',
  s3Access: {
    endpoint: 'https://sos.test',
    region: 'de-fra-1',
    bucket: 'ddo',
    objectKey: 'ddo/abc/def.json',
    accessKeyId: 'read-key',
    secretAccessKey: 'read-secret',
    forcePathStyle: false
  }
} as unknown as StorageObject

const chain = vi.hoisted(() => ({
  /** ocean.js's `setMetadataTx`: builds the request, or throws before anything is sent. */
  setMetadataTx: (async () => ({ to: '0xnft', data: '0x' })) as (
    ...args: unknown[]
  ) => Promise<unknown>,
  /** ocean.js's `setMetadata`, only used on a confidential (`sdk: 'oasis'`) chain. */
  setMetadata: (async () => null) as (...args: unknown[]) => Promise<unknown>
}))

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Nft: class {
      async getMetadata() {
        return ['https://node.test.invalid', NFT_ADDRESS, 0, false]
      }
      async setMetadataTx(...args: unknown[]) {
        return chain.setMetadataTx(...args)
      }
      async setMetadata(...args: unknown[]) {
        return chain.setMetadata(...args)
      }
    }
  }
})

function store(remove?: RemoteStore['remove']): RemoteStore & {
  removed: StorageObject[]
} {
  const removed: StorageObject[] = []

  return {
    removed,
    put: async () => S3_POINTER,
    ...(remove
      ? {
          remove: async (pointer: StorageObject) => {
            removed.push(pointer)
            await remove(pointer)
          }
        }
      : {})
  }
}

function signableDdo(): Record<string, unknown> {
  const { indexedMetadata: _indexed, ...ddo } =
    getAssetFixture() as unknown as Record<string, unknown>

  return { ...ddo, issuer: new Wallet(PRIVATE_KEY).address }
}

beforeEach(() => {
  chain.setMetadataTx = async () => ({ to: '0xnft', data: '0x' })
  chain.setMetadata = async () => null
})

describe('settleStoredEnvelope', () => {
  it('removes the object when the transaction was never sent, and keeps the error', async () => {
    const remoteStore = store(async () => undefined)
    const original = new Error('verify failed')

    const thrown = (await settleStoredEnvelope(original, {
      remoteStore,
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: false
    })) as FailedWithStoredObject

    expect(thrown).to.equal(original)
    // remove() gets the pointer as stored; the caller gets it redacted.
    expect(remoteStore.removed).to.deep.equal([S3_POINTER])
    expect(thrown.stored.cleanup).to.equal('removed')
    expect(thrown.stored.metadataHash).to.equal(HASH)
    expect(JSON.stringify(thrown.stored)).not.to.contain('read-secret')
    expect(thrown.message).to.match(/^verify failed The envelope .* removed/)
  })

  it('keeps the object once the transaction may have been sent', async () => {
    const remoteStore = store(async () => undefined)

    const thrown = (await settleStoredEnvelope(new Error('receipt timeout'), {
      remoteStore,
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: true
    })) as FailedWithStoredObject

    expect(remoteStore.removed).to.have.length(0)
    expect(thrown.stored.cleanup).to.equal('kept')
    expect(thrown.message).to.match(/may have been mined.*was kept/)
  })

  it('reports a store without remove(), or a failing one, instead of hiding the error', async () => {
    const without = (await settleStoredEnvelope(new Error('boom'), {
      remoteStore: store(),
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: false
    })) as FailedWithStoredObject

    expect(without.stored).to.deep.include({
      cleanup: 'not-removed',
      removeError: 'the remote store has no remove()'
    })

    const failing = (await settleStoredEnvelope(new Error('boom'), {
      remoteStore: store(async () => {
        throw new Error('S3 DELETE: access denied')
      }),
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: false
    })) as FailedWithStoredObject

    expect(failing.message).to.match(/^boom .*access denied/)
    expect(failing.stored).to.deep.include({
      cleanup: 'not-removed',
      removeError: 'S3 DELETE: access denied'
    })
  })

  it('removes it even when the error already carries a `stored` field, and wraps a thrown non-error', async () => {
    const remoteStore = store(async () => undefined)
    const params = {
      remoteStore,
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: false
    }

    // A custom verify() may throw an error with a `stored` field of its own: that is no
    // reason to leave the envelope behind.
    const custom = Object.assign(new Error('custom verify'), {
      stored: { cleanup: 'kept' }
    })
    const settled = (await settleStoredEnvelope(
      custom,
      params
    )) as FailedWithStoredObject
    expect(settled).to.equal(custom)
    expect(settled.stored.cleanup).to.equal('removed')
    expect(remoteStore.removed).to.have.length(1)

    const wrapped = (await settleStoredEnvelope(
      'plain string',
      params
    )) as FailedWithStoredObject
    expect(wrapped).to.be.instanceOf(Error)
    expect(wrapped.cause).to.equal('plain string')
    expect(wrapped.stored.cleanup).to.equal('removed')
  })

  it('still removes the object when the pointer cannot be copied for the report', async () => {
    // A custom store's pointer with a BigInt: JSON cannot copy it, so redacting throws.
    const pointer = {
      type: 's3',
      s3Access: {
        ...(S3_POINTER as unknown as { s3Access: object }).s3Access,
        size: 10n
      }
    } as unknown as StorageObject
    const remoteStore = store(async () => undefined)
    const original = new Error('verify failed')

    const thrown = (await settleStoredEnvelope(original, {
      remoteStore,
      storedPointer: pointer,
      metadataHash: HASH,
      sent: false
    })) as FailedWithStoredObject

    expect(thrown).to.equal(original)
    expect(remoteStore.removed).to.deep.equal([pointer])
    expect(thrown.stored).to.deep.equal({
      pointer: { type: 's3' },
      metadataHash: HASH,
      cleanup: 'removed'
    })
    expect(JSON.stringify(thrown.stored)).not.to.contain('read-secret')
  })
})

describe('PublishIncompleteError', () => {
  it('carries stored, and does not claim "no metadata" once the transaction was sent', async () => {
    const cause = (await settleStoredEnvelope(new Error('receipt timeout'), {
      remoteStore: store(async () => undefined),
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: true
    })) as FailedWithStoredObject

    const error = new PublishIncompleteError(NFT_ADDRESS, [], cause)

    expect(error.cause).to.equal(cause)
    expect(error.stored?.cleanup).to.equal('kept')
    expect(error.message).to.match(/metadata transaction was sent/)
    expect(error.message).not.to.match(/has no metadata yet/)

    const plain = new PublishIncompleteError(NFT_ADDRESS, [], new Error('x'))
    expect(plain.stored).to.equal(undefined)
    expect(plain.message).to.match(/has no metadata yet/)
  })
})

describe('prepareMetadataForWrite', () => {
  it('removes the stored envelope when encrypting the pointer fails', async () => {
    const node = createNodeMock()
    const encrypt = node.client.encrypt.bind(node.client)
    const client = {
      ...node.client,
      nodeUri: node.client.nodeUri,
      encrypt: async (data: unknown, ...rest: unknown[]) => {
        if (data && typeof data === 'object' && 'remote' in data)
          throw new Error('401 nonce: 1 is not a valid nonce')
        return (encrypt as (...args: unknown[]) => Promise<string>)(
          data,
          ...rest
        )
      }
    } as unknown as OceanNodeClient
    const remoteStore = store(async () => undefined)

    const thrown = (await prepareMetadataForWrite({
      node: client,
      ddo: signableDdo(),
      signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
      remoteStore,
      did: ASSET_DID
    }).catch((error) => error)) as FailedWithStoredObject

    expect(thrown.message).to.match(/not a valid nonce.*removed/)
    expect(thrown.stored.cleanup).to.equal('removed')
    expect(remoteStore.removed).to.deep.equal([S3_POINTER])
  })
})

describe('writeMetadata', () => {
  async function prepared() {
    return prepareMetadataForWrite({
      node: createNodeMock().client,
      ddo: signableDdo(),
      signer: new Eip191VcSigner(new Wallet(PRIVATE_KEY)),
      remoteStore: store(),
      did: ASSET_DID
    })
  }

  const RECEIPT = { hash: '0xmined', blockNumber: 7, status: 1 }

  /** A wallet whose broadcast is `send`, recording where the write got to. */
  async function write(
    send: () => Promise<unknown>,
    chainConfig: Record<string, unknown> = {}
  ) {
    const signer = new Wallet(PRIVATE_KEY)
    const sendTransaction = vi.fn(send)
    signer.sendTransaction = sendTransaction as never
    const progress: MetadataWriteProgress[] = []

    const result: { receipt?: TransactionReceipt; error?: Error } =
      await writeMetadata({
        signer,
        chainConfig: { chainId: 32456, ...chainConfig } as never,
        nftAddress: NFT_ADDRESS,
        nodeUri: 'https://node.test.invalid',
        lifecycleState: 0,
        prepared: await prepared(),
        onProgress: (stage) => progress.push(stage)
      }).then(
        (receipt) => ({ receipt }),
        (error: Error) => ({ error })
      )

    return { ...result, progress, sendTransaction }
  }

  /** A broadcast transaction whose `wait()` does `wait`. */
  const sent = (wait: () => Promise<unknown>) => async () => ({
    hash: '0xsent',
    wait
  })

  it('reports nothing when building the transaction fails, and sends nothing', async () => {
    chain.setMetadataTx = async () => {
      throw new Error('Caller is not Metadata updater')
    }

    const { error, progress, sendTransaction } = await write(
      sent(async () => RECEIPT)
    )

    expect(error?.message).to.equal('Caller is not Metadata updater')
    expect(progress).to.deep.equal([])
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('reports nothing when the wallet or the RPC refuses the transaction', async () => {
    for (const code of ['ACTION_REJECTED', 'INSUFFICIENT_FUNDS'] as const) {
      const refusal = makeError(`refused: ${code}`, code, {} as never)

      const { error, progress } = await write(async () => {
        throw refusal
      })

      expect(error).to.equal(refusal)
      expect(progress).to.deep.equal([])
    }
  })

  it('reports "sent" when the send fails in a way that may follow the broadcast', async () => {
    for (const failure of [
      makeError('request timed out', 'TIMEOUT', {} as never),
      makeError('connection reset', 'NETWORK_ERROR', {} as never),
      new Error('custom signer failed')
    ]) {
      const { error, progress } = await write(async () => {
        throw failure
      })

      expect(error).to.equal(failure)
      expect(progress).to.deep.equal(['sent'])
    }
  })

  it('returns the receipt of a mined transaction, reporting "sent"', async () => {
    const { receipt, error, progress, sendTransaction } = await write(
      sent(async () => RECEIPT)
    )

    expect(error).to.equal(undefined)
    expect(receipt).to.equal(RECEIPT)
    expect(progress).to.deep.equal(['sent'])
    expect(sendTransaction).toHaveBeenCalledWith({ to: '0xnft', data: '0x' })
  })

  it('reports "reverted" for a mined revert, which changed no metadata', async () => {
    const revert = makeError(
      'transaction execution reverted',
      'CALL_EXCEPTION',
      {
        receipt: { ...RECEIPT, status: 0 }
      } as never
    )

    const thrown = await write(
      sent(async () => {
        throw revert
      })
    )

    expect(thrown.progress).to.deep.equal(['sent', 'reverted'])
    expect(thrown.error?.message).to.match(
      /setMetadata transaction 0xsent was mined in block 7 but reverted, so it did not change the metadata of NFT/
    )
    expect(thrown.error?.cause).to.equal(revert)

    // A custom signer's wait() may return the reverted receipt instead.
    const returned = await write(sent(async () => ({ ...RECEIPT, status: 0 })))
    expect(returned.progress).to.deep.equal(['sent', 'reverted'])
    expect(returned.error?.message).to.match(/mined in block 7 but reverted/)
  })

  it('reports "reverted" for a transaction another one cancelled, and keeps "sent" for a repriced one', async () => {
    const replaced = (reason: string) =>
      makeError('transaction was replaced', 'TRANSACTION_REPLACED', {
        cancelled: reason !== 'repriced',
        reason,
        hash: '0xreplacement',
        receipt: RECEIPT
      } as never)

    const cancelled = await write(
      sent(async () => {
        throw replaced('cancelled')
      })
    )
    expect(cancelled.progress).to.deep.equal(['sent', 'reverted'])
    expect(cancelled.error?.message).to.match(/was replaced by 0xreplacement/)

    // Same data at a higher fee: the replacement carries this metadata.
    const repriced = await write(
      sent(async () => {
        throw replaced('repriced')
      })
    )
    expect(repriced.progress).to.deep.equal(['sent'])
  })

  it('keeps "sent" when the receipt never comes', async () => {
    const lost = await write(
      sent(async () => {
        throw makeError('timeout', 'TIMEOUT', {} as never)
      })
    )
    expect(lost.progress).to.deep.equal(['sent'])

    const none = await write(sent(async () => null))
    expect(none.progress).to.deep.equal(['sent'])
    expect(none.error?.message).to.match(/submitted but never confirmed/)
  })

  it('sends through ocean.js on a confidential chain, whose null it cannot tell apart', async () => {
    const { error, progress, sendTransaction } = await write(
      sent(async () => RECEIPT),
      { sdk: 'oasis' }
    )

    expect(sendTransaction).not.toHaveBeenCalled()
    expect(progress).to.deep.equal(['sent'])
    expect(error?.message).to.match(
      /setMetadata failed: ocean.js returned no transaction/
    )
  })
})
