/**
 * Regression tests for the access flow and its node client.
 *
 * Each test pins one of three consume-time failures: a provider fee the datatoken was
 * never approved to pull (any non-zero fee reverted on chain), a download requested from a
 * node that cannot decrypt the file object, and a missing policy server that killed the
 * whole flow instead of degrading to "SSI unavailable".
 */

import type { Config } from '@oceanprotocol/lib'
import { allowanceWei, approveWei, ProviderInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, settleOrder } from '../../src/access/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import { getPricingInfo } from '../../src/utils/pricing.js'
import { ProviderFeeSignatureError } from '../../src/utils/providerFee.js'
import {
  ASSET_DID,
  DATATOKEN_ADDRESS,
  getAssetFixture
} from '../fixtures/Asset.js'
import {
  poisonedProviderFee,
  signedProviderFee
} from '../fixtures/ProviderFee.js'
import { expectThrowsAsync } from '../helpers.js'

// Everything on-chain is stubbed: the approvals under test go through ocean.js's token
// utils, and the order itself through `../utils/order` — only their call shapes matter.
vi.mock('@oceanprotocol/lib', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  allowanceWei: vi.fn(async () => '0'),
  approveWei: vi.fn(async () => ({ hash: '0xapproval' }))
}))

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(async () => ({ transferTxId: '0xfresh', reused: false })),
  reuseOrder: vi.fn(async () => ({ transferTxId: '0xreused', reused: true }))
}))

// The fresh-order path reads pricing from chain before ordering; stub both reads.
vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async () => ({ schema: 'free' })),
  getOrderPrice: vi.fn(async () => ({ total: '0', consumeMarketFee: '0' }))
}))

const CONSUMER = '0x0000000000000000000000000000000000c05e5a'
const FEE_TOKEN = '0xfee0000000000000000000000000000000000000'

const signer = { getAddress: async () => CONSUMER } as unknown as Signer
const chainConfig = { chainId: 32456 } as unknown as Config

function settle(initialized: {
  validOrder?: string
  providerFee?: unknown
}): ReturnType<typeof settleOrder> {
  return settleOrder({
    signer,
    chainConfig,
    datatokenAddress: DATATOKEN_ADDRESS,
    serviceIndex: 0,
    initialized,
    consumer: CONSUMER
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(allowanceWei).mockResolvedValue('0')
})

describe('settleOrder provider fee', () => {
  // The approvals themselves are pinned against the real `order()`/`reuseOrder()` in
  // OrderAllowances.test.ts: they approve the provider fee together with whatever else the
  // order pulls, so `settleOrder` approves nothing of its own.
  it('hands the fee to order() for a fresh order, approving nothing itself', async () => {
    const providerFee = signedProviderFee({
      providerFeeAmount: '30',
      providerFeeToken: FEE_TOKEN
    })

    const result = await settle({ providerFee })

    expect(result.transferTxId).to.equal('0xfresh')
    expect(vi.mocked(order)).toHaveBeenCalledOnce()
    expect(vi.mocked(order).mock.calls[0][0].providerFees).to.equal(providerFee)
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('hands the new fee to reuseOrder() to extend a reusable order', async () => {
    const providerFee = signedProviderFee({
      providerFeeAmount: '30',
      providerFeeToken: FEE_TOKEN
    })

    const result = await settle({ validOrder: '0xexisting', providerFee })

    expect(vi.mocked(reuseOrder)).toHaveBeenCalledOnce()
    expect(vi.mocked(reuseOrder).mock.calls[0][0]).to.include({
      validOrderTx: '0xexisting',
      providerFees: providerFee
    })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(result.transferTxId).to.equal('0xreused')
  })

  it('reuses a fee-free order without touching the chain', async () => {
    const result = await settle({
      validOrder: '0xexisting',
      providerFee: signedProviderFee({
        providerFeeAmount: '0',
        providerFeeToken: FEE_TOKEN
      })
    })

    expect(result).to.deep.equal({ transferTxId: '0xexisting', reused: true })
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('reuses an order as it stands when the node sends no fee at all', async () => {
    // Nothing is sent on this path, so there is no fee to require.
    const result = await settle({ validOrder: '0xexisting' })

    expect(result).to.deep.equal({ transferTxId: '0xexisting', reused: true })
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('reads a zero amount as a number, so 0x0 is not a fee due', async () => {
    const result = await settle({
      validOrder: '0xexisting',
      providerFee: { providerFeeAmount: '0x0' }
    })

    expect(result).to.deep.equal({ transferTxId: '0xexisting', reused: true })
  })
})

describe('settleOrder without a complete provider fee', () => {
  // A fresh order and an extension both send the fee to the datatoken, which takes every
  // field of it. Without one, ocean.js fails while encoding the order, after the approvals
  // and (on template 1) the purchase were already sent.
  it('refuses a fresh order with no fee, before any chain read or order', async () => {
    const thrown = await settle({}).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/there is no provider fee/)
    expect(vi.mocked(getPricingInfo)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('refuses a fee missing its amount or validUntil, rather than reading them as 0', async () => {
    const {
      providerFeeAmount: _amount,
      validUntil: _until,
      ...partial
    } = signedProviderFee({ providerFeeAmount: '0', validUntil: 0 })

    await expectThrowsAsync(
      () => settle({ providerFee: partial }),
      /missing providerFeeAmount, validUntil/
    )

    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('refuses an extension whose fee is due but incomplete, before reuseOrder', async () => {
    const { v: _v, ...partial } = signedProviderFee({
      providerFeeAmount: '30',
      providerFeeToken: FEE_TOKEN
    })

    const thrown = await settle({
      validOrder: '0xexisting',
      providerFee: partial
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/missing v\b/)
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })
})

describe('OceanNodeClient.forEndpoint', () => {
  const client = new OceanNodeClient({
    nodeUri: 'https://node.test.invalid',
    chainId: 32456,
    auth: 'a-session-token',
    consumerAddress: CONSUMER
  })

  it('returns the same client for the same endpoint, however it is spelled', () => {
    expect(client.forEndpoint('https://node.test.invalid/')).to.equal(client)
  })

  it('binds a new client to another endpoint, keeping auth and chain', async () => {
    const other = client.forEndpoint('https://other-node.test.invalid/')

    expect(other).not.to.equal(client)
    expect(other.nodeUri).to.equal('https://other-node.test.invalid')
    expect(other.chainId).to.equal(client.chainId)
    expect(other.getAuth()).to.equal(client.getAuth())
    expect(await other.getConsumerAddress()).to.equal(CONSUMER)
  })
})

describe('access endpoint routing', () => {
  const SERVICE_NODE = 'https://service-node.test.invalid'

  /**
   * A node mock whose `forEndpoint` hands out clients that record which node each call was
   * addressed to. The asset carries a reusable, fee-free order so `settleOrder` returns
   * without touching the (unstubbed) chain.
   */
  function createAccessNodeMock(asset: AssetV5) {
    const calls = {
      resolve: [] as string[],
      initialize: [] as string[],
      download: [] as string[]
    }

    const clientFor = (uri: string): OceanNodeClient => {
      const client = {
        nodeUri: uri,
        forEndpoint(next: string) {
          const normalized = next.replace(/\/+$/, '')
          return normalized === uri ? client : clientFor(normalized)
        },
        async resolve() {
          calls.resolve.push(uri)
          return asset
        },
        async initialize() {
          calls.initialize.push(uri)
          return {
            datatoken: DATATOKEN_ADDRESS,
            validOrder: '0xexisting',
            providerFee: { providerFeeAmount: '0' }
          }
        },
        async getDownloadUrl() {
          calls.download.push(uri)
          return `${uri}/download`
        }
      } as unknown as OceanNodeClient

      return client
    }

    return { client: clientFor('https://node.test.invalid'), calls }
  }

  it('asks the service’s own node for the quote and the download', async () => {
    // The file object was encrypted with a key local to the node in the service's
    // endpoint; the configured node would take the payment and then fail to decrypt.
    const asset = getAssetFixture()
    asset.credentialSubject.services[0].serviceEndpoint = `${SERVICE_NODE}/`

    const { client, calls } = createAccessNodeMock(asset)

    const result = await access(
      { assetDid: ASSET_DID },
      { node: client, signer, chainConfig }
    )

    expect(calls.resolve).to.deep.equal(['https://node.test.invalid'])
    expect(calls.initialize).to.deep.equal([SERVICE_NODE])
    expect(calls.download).to.deep.equal([SERVICE_NODE])
    expect(result.url).to.equal(`${SERVICE_NODE}/download`)
  })

  it('stays on the configured node when the service advertises it', async () => {
    const { client, calls } = createAccessNodeMock(getAssetFixture())

    await access({ assetDid: ASSET_DID }, { node: client, signer, chainConfig })

    expect(calls.initialize).to.deep.equal(['https://node.test.invalid'])
    expect(calls.download).to.deep.equal(['https://node.test.invalid'])
  })

  it('challenges the credential provider with the service’s node', async () => {
    // The session has to be minted by the policy server that will check it. Resolving
    // against the configured node created it in one place and submitted it in another.
    const asset = getAssetFixture()
    asset.credentialSubject.services[0].serviceEndpoint = SERVICE_NODE

    const { client } = createAccessNodeMock(asset)
    const challenged: string[] = []

    await access(
      { assetDid: ASSET_DID },
      {
        node: client,
        signer,
        chainConfig,
        credentials: {
          interactive: true,
          async resolve(challenge) {
            challenged.push(challenge.node.nodeUri)
            return null
          }
        }
      }
    )

    expect(challenged).to.deep.equal([SERVICE_NODE])
  })
})

describe('OceanNodeClient.initializePolicyVerification', () => {
  it('returns null instead of failing the flow when the node rejects it', async () => {
    // ocean.js throws on any non-ok response, so a node that simply has no policy server
    // looked identical to a hard failure — and killed the access/compute flow that the
    // WaltIdProvider's graceful no-SSI branch was written to survive.
    const spy = vi
      .spyOn(ProviderInstance, 'initializePSVerification')
      .mockRejectedValue(new Error('404: not found'))

    try {
      const client = new OceanNodeClient({
        nodeUri: 'https://node.test.invalid',
        chainId: 32456,
        auth: 'a-session-token',
        consumerAddress: CONSUMER
      })

      const result = await client.initializePolicyVerification({
        documentId: ASSET_DID,
        serviceId: 'service-id',
        consumerAddress: CONSUMER,
        policyServer: {}
      })

      expect(result).to.equal(null)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('provider-fee signature pre-check', () => {
  it('refuses a fee whose signature does not recover to providerFeeAddress, before the approval and the order', async () => {
    await expectThrowsAsync(
      () =>
        settle({
          providerFee: poisonedProviderFee({ providerFeeToken: FEE_TOKEN })
        }),
      /would fail the datatoken's signature check/
    )

    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(vi.mocked(getPricingInfo)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })

  it('refuses one on a reused order with a fee due, before reuseOrder', async () => {
    const thrown = await settle({
      validOrder: '0xexisting',
      providerFee: poisonedProviderFee({ providerFeeToken: FEE_TOKEN })
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('does not check a fee it does not send (reused order, nothing due)', async () => {
    const result = await settle({
      validOrder: '0xexisting',
      providerFee: { ...poisonedProviderFee(), providerFeeAmount: '0' }
    })

    expect(result).to.deep.equal({ transferTxId: '0xexisting', reused: true })
  })

  describe('access()', () => {
    function nodeAnswering(fees: unknown[], asset = getAssetFixture()) {
      const initialize = vi.fn(async () => ({
        datatoken: DATATOKEN_ADDRESS,
        providerFee: fees.length > 1 ? fees.shift() : fees[0]
      }))

      const client = {
        nodeUri: 'https://node.test.invalid',
        forEndpoint() {
          return client
        },
        async resolve() {
          return asset
        },
        initialize,
        async getDownloadUrl() {
          return 'https://node.test.invalid/download'
        }
      } as unknown as OceanNodeClient

      return { client, initialize }
    }

    it('asks the node for a new fee and orders with the good one', async () => {
      vi.useFakeTimers()
      try {
        const good = signedProviderFee({ providerFeeAmount: '0' })
        const { client, initialize } = nodeAnswering([
          poisonedProviderFee({ providerFeeAmount: '0' }),
          good
        ])

        const accessing = access(
          { assetDid: ASSET_DID },
          { node: client, signer, chainConfig }
        )
        await vi.advanceTimersByTimeAsync(2_000)
        await accessing

        expect(initialize).toHaveBeenCalledTimes(2)
        expect(vi.mocked(order)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(order).mock.calls[0][0].providerFees).to.equal(good)
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives up with a ProviderFeeSignatureError and orders nothing', async () => {
      vi.useFakeTimers()
      try {
        // The same fee every time: a service with timeout 0 has validUntil 0.
        const { client, initialize } = nodeAnswering([
          poisonedProviderFee({ providerFeeAmount: '0' })
        ])

        const accessing = access(
          { assetDid: ASSET_DID },
          { node: client, signer, chainConfig }
        ).catch((caught) => caught)
        await vi.advanceTimersByTimeAsync(5_000)

        expect(await accessing).to.be.instanceOf(ProviderFeeSignatureError)
        expect(initialize).toHaveBeenCalledTimes(2)
        expect(vi.mocked(order)).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('asks 3 times in total, 1.1 s apart, while each fee is new and rejected', async () => {
      vi.useFakeTimers()
      try {
        // Three different fees, each one the datatoken rejects.
        const { client, initialize } = nodeAnswering([
          poisonedProviderFee({ providerFeeAmount: '0' }),
          poisonedProviderFee({ providerFeeAmount: '0', providerData: '0x01' }),
          poisonedProviderFee({ providerFeeAmount: '0', providerData: '0x02' })
        ])

        const accessing = access(
          { assetDid: ASSET_DID },
          { node: client, signer, chainConfig }
        ).catch((caught) => caught)

        await vi.advanceTimersByTimeAsync(1_099)
        expect(initialize).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(initialize).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(5_000)

        const thrown = await accessing
        expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
        expect(thrown.attempts).to.equal(3)
        expect(initialize).toHaveBeenCalledTimes(3)
        expect(vi.mocked(order)).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not ask again for a service with timeout 0, whose fee never changes', async () => {
      vi.useFakeTimers()
      try {
        const asset = getAssetFixture()
        asset.credentialSubject.services[0].timeout = 0

        const { client, initialize } = nodeAnswering(
          [poisonedProviderFee({ providerFeeAmount: '0' })],
          asset
        )

        const accessing = access(
          { assetDid: ASSET_DID },
          { node: client, signer, chainConfig }
        ).catch((caught) => caught)
        await vi.advanceTimersByTimeAsync(5_000)

        const thrown = await accessing
        expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
        expect(thrown.message).to.match(/not asked again/)
        expect(initialize).toHaveBeenCalledTimes(1)
        expect(vi.mocked(order)).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('refuses an answer with no fee at once, and orders nothing', async () => {
      vi.useFakeTimers()
      try {
        const { client, initialize } = nodeAnswering([undefined])

        const accessing = access(
          { assetDid: ASSET_DID },
          { node: client, signer, chainConfig }
        ).catch((caught) => caught)
        await vi.advanceTimersByTimeAsync(5_000)

        const thrown = await accessing
        expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
        expect(thrown.message).to.match(/there is no provider fee/)
        expect(initialize).toHaveBeenCalledTimes(1)
        expect(vi.mocked(order)).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
