/**
 * What becomes of the stored envelope, end to end, once the metadata transaction is in the
 * wallet's hands.
 *
 * ocean.js's `Nft.setMetadata` returns `null` both for a wallet rejection (never broadcast)
 * and for a mined revert, so nautilus used to keep the envelope "in case it was mined" for
 * both: a guaranteed orphan. It now sends the transaction itself, so a rejection and a
 * revert remove the envelope, and only a transaction that may have changed the metadata
 * keeps it. Everything but the chain runs for real.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import { makeError, Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FailedWithStoredObject,
  PublishResponse
} from '../../src/@types/Publish.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import {
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import { createNodeMock } from '../mocks/node.js'

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

const chain = vi.hoisted(() => ({
  setMetadataTx: vi.fn(async () => ({ to: '0xnft', data: '0x1234' }))
}))

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Nft: class {
      async getMetadata() {
        return ['https://node.test.invalid', '0x', 0, true]
      }
      async getNftPermissions() {
        return {
          manager: true,
          deployERC20: true,
          updateMetadata: true,
          store: true
        }
      }
      setMetadataTx = chain.setMetadataTx
    }
  }
})

vi.mock('../../src/utils/contracts.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, getMetadataEventsInBlock: vi.fn(async () => []) }
})

const RECEIPT = { hash: '0xmined', blockNumber: 7, status: 1 }

async function setup() {
  const wallet = new Wallet(PRIVATE_KEY).connect({
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) })
  } as never)

  const removed: StorageObject[] = []
  const remoteStore: RemoteStore = {
    put: async () =>
      ({
        type: 'url',
        url: 'https://store.test.invalid/ddo',
        method: 'GET'
      }) as unknown as StorageObject,
    remove: async (pointer) => {
      removed.push(pointer)
    }
  }

  const nautilus = await Nautilus.create(wallet, {
    remoteStore,
    config: {
      oceanNodeUri: 'https://node.test.invalid',
      nftFactoryAddress: NFT_ADDRESS,
      fixedRateExchangeAddress: DATATOKEN_ADDRESS,
      dispenserAddress: OWNER_ADDRESS
    }
  })
  ;(nautilus as unknown as { node: OceanNodeClient }).node =
    createNodeMock().client

  const send = vi.fn<() => Promise<unknown>>()
  wallet.sendTransaction = send as never

  const edit = () =>
    nautilus
      .edit(new AssetBuilder(getAssetFixture({ issuer: undefined })).build())
      .then(
        (response) => ({ response }),
        (error: FailedWithStoredObject) => ({ error })
      ) as Promise<{
      response?: PublishResponse
      error?: FailedWithStoredObject
    }>

  return { send, edit, removed }
}

beforeEach(() => {
  chain.setMetadataTx.mockClear()
})

describe('the stored envelope after the metadata transaction', () => {
  it('is removed when the wallet rejects the transaction', async () => {
    const { send, edit, removed } = await setup()
    send.mockRejectedValue(
      makeError('user rejected action', 'ACTION_REJECTED', {} as never)
    )

    const { error } = await edit()

    expect(send).toHaveBeenCalledTimes(1)
    expect(error?.message).to.match(
      /user rejected action.*removed again, since no transaction points at it/
    )
    expect(error?.stored.cleanup).to.equal('removed')
    expect(removed).to.have.length(1)
  })

  it('is removed when the transaction is mined and reverts', async () => {
    const { send, edit, removed } = await setup()
    send.mockResolvedValue({
      hash: '0xsent',
      wait: async () => {
        throw makeError('transaction execution reverted', 'CALL_EXCEPTION', {
          receipt: { ...RECEIPT, status: 0 }
        } as never)
      }
    })

    const { error } = await edit()

    expect(error?.message).to.match(
      /0xsent was mined in block 7 but reverted, so it did not change the metadata.*removed again/
    )
    expect(error?.stored.cleanup).to.equal('removed')
    expect(removed).to.have.length(1)
  })

  it('is kept when the receipt is lost after the broadcast', async () => {
    const { send, edit, removed } = await setup()
    send.mockResolvedValue({
      hash: '0xsent',
      wait: async () => {
        throw makeError('timeout', 'TIMEOUT', {} as never)
      }
    })

    const { error } = await edit()

    expect(error?.stored.cleanup).to.equal('kept')
    expect(error?.message).to.match(/may have been mined.*was kept/)
    expect(removed).to.have.length(0)
  })

  it('is kept, with the hash, when the wallet broadcast the transaction and then failed', async () => {
    // ethers' JsonRpcSigner gives up polling for a transaction it already sent with
    // INVALID_ARGUMENT or UNSUPPORTED_OPERATION, and sets info.sendTransactionHash.
    const { send, edit, removed } = await setup()
    const hash = `0x${'5e'.repeat(32)}`
    send.mockRejectedValue(
      makeError('invalid transaction', 'INVALID_ARGUMENT', {
        info: { sendTransactionHash: hash }
      } as never)
    )

    const { error } = await edit()

    expect(error?.stored.cleanup).to.equal('kept')
    expect(error?.stored.txHash).to.equal(hash)
    expect(error?.message).to.match(
      new RegExp(`metadata transaction ${hash} was sent but not confirmed`)
    )
    expect(removed).to.have.length(0)
  })

  it('is kept, and the edit succeeds, when the wallet sped the transaction up', async () => {
    const { send, edit, removed } = await setup()
    const replacement = { hash: '0xspedup', blockNumber: 8, status: 1 }
    send.mockResolvedValue({
      hash: '0xsent',
      wait: async () => {
        throw makeError('transaction was replaced', 'TRANSACTION_REPLACED', {
          cancelled: false,
          reason: 'repriced',
          hash: replacement.hash,
          receipt: replacement
        } as never)
      }
    })

    const { response, error } = await edit()

    expect(error).to.equal(undefined)
    expect(response?.setMetadataTxReceipt).to.equal(replacement)
    expect(removed).to.have.length(0)
  })

  it('is kept, and referenced, when the transaction is mined', async () => {
    const { send, edit, removed } = await setup()
    send.mockResolvedValue({ hash: '0xsent', wait: async () => RECEIPT })

    const { response, error } = await edit()

    expect(error).to.equal(undefined)
    expect(response?.setMetadataTxReceipt).to.equal(RECEIPT)
    expect(response?.stored.pointer).to.deep.include({ type: 'url' })
    expect(chain.setMetadataTx).toHaveBeenCalledTimes(1)
    expect(removed).to.have.length(0)
  })
})
