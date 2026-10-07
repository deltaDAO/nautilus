/**
 * What happens to a stored envelope when the write it was stored for fails.
 *
 * The envelope is stored before the metadata transaction, so every failure in between
 * leaves an object in the store. Nothing can point at it while the transaction was never
 * sent, so nautilus removes it; once the transaction may have been mined, the object may be
 * what the NFT now points at, so nautilus keeps it and says so. These tests pin both halves
 * and the line between them, which `writeMetadata()` draws at ocean.js's send step.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FailedWithStoredObject } from '../../src/@types/Publish.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import {
  PublishIncompleteError,
  prepareMetadataForWrite,
  settleStoredEnvelope,
  writeMetadata
} from '../../src/publish/index.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import { Eip191VcSigner } from '../../src/signing/vc.js'
import { ASSET_DID, getAssetFixture, NFT_ADDRESS } from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
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

  it('settles once, and wraps a thrown non-error', async () => {
    const remoteStore = store(async () => undefined)
    const params = {
      remoteStore,
      storedPointer: S3_POINTER,
      metadataHash: HASH,
      sent: false
    }

    const first = await settleStoredEnvelope(new Error('x'), params)
    expect(await settleStoredEnvelope(first, params)).to.equal(first)
    expect(remoteStore.removed).to.have.length(1)

    const wrapped = (await settleStoredEnvelope(
      'plain string',
      params
    )) as FailedWithStoredObject
    expect(wrapped).to.be.instanceOf(Error)
    expect(wrapped.cause).to.equal('plain string')
    expect(wrapped.stored.cleanup).to.equal('removed')
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

  const write = async (onSent: () => void) =>
    writeMetadata({
      signer: new Wallet(PRIVATE_KEY),
      chainConfig: { chainId: 32456 } as never,
      nftAddress: NFT_ADDRESS,
      nodeUri: 'https://node.test.invalid',
      lifecycleState: 0,
      prepared: await prepared(),
      onSent
    })

  it('does not report "sent" when building the transaction fails', async () => {
    chain.setMetadata = async () => {
      throw new Error('execution reverted (estimateGas)')
    }
    const onSent = vi.fn()

    await expectThrowsAsync(() => write(onSent), /estimateGas/)
    expect(onSent).not.toHaveBeenCalled()
  })

  it('reports "sent" once ocean.js went on to send, even if it returned nothing', async () => {
    const onSent = vi.fn()

    await expectThrowsAsync(
      () => write(onSent),
      /setMetadata failed: ocean.js returned no transaction/
    )
    expect(onSent).toHaveBeenCalledTimes(1)
  })
})
