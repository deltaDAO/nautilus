/**
 * Regression tests for the access flow and its node client.
 *
 * Each test pins one of three consume-time failures: a provider fee the datatoken was
 * never approved to pull (any non-zero fee reverted on chain), a download requested from a
 * node that cannot decrypt the file object, and a missing policy server that killed the
 * whole flow instead of degrading to "SSI unavailable".
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import type { Config } from '@oceanprotocol/lib'
import { allowanceWei, approveWei, ProviderInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access, settleOrder } from '../../src/access/index.js'
import { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  ASSET_DID,
  DATATOKEN_ADDRESS,
  getAssetFixture
} from '../fixtures/Asset.js'
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
  it('approves the datatoken for a non-zero fee before ordering', async () => {
    // `ERC20Template._checkProviderFee` pulls the fee with `transferFrom`, and neither
    // `startOrder` nor `reuseOrder` in ocean.js approves anything — so without an explicit
    // approval, any order carrying a non-zero provider fee reverts.
    await settle({
      providerFee: { providerFeeAmount: '30', providerFeeToken: FEE_TOKEN }
    })

    expect(vi.mocked(approveWei)).toHaveBeenCalledWith(
      signer,
      chainConfig,
      CONSUMER,
      FEE_TOKEN,
      DATATOKEN_ADDRESS,
      // The node quotes the fee in raw wei; `approve` would scale it by the token's
      // decimals a second time.
      '30',
      true
    )

    // The approval must land before the order that spends it.
    expect(vi.mocked(approveWei).mock.invocationCallOrder[0]).to.be.lessThan(
      vi.mocked(order).mock.invocationCallOrder[0]
    )
  })

  it('skips the approval when the fee is zero', async () => {
    await settle({
      providerFee: { providerFeeAmount: '0', providerFeeToken: FEE_TOKEN }
    })

    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).toHaveBeenCalled()
  })

  it('skips the transaction when the standing allowance already covers the fee', async () => {
    vi.mocked(allowanceWei).mockResolvedValue('30')

    await settle({
      providerFee: { providerFeeAmount: '30', providerFeeToken: FEE_TOKEN }
    })

    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('approves the new fee before extending a reusable order', async () => {
    const result = await settle({
      validOrder: '0xexisting',
      providerFee: { providerFeeAmount: '30', providerFeeToken: FEE_TOKEN }
    })

    expect(vi.mocked(approveWei)).toHaveBeenCalledOnce()
    expect(vi.mocked(reuseOrder)).toHaveBeenCalledOnce()
    expect(result.transferTxId).to.equal('0xreused')
  })

  it('reuses a fee-free order without touching the chain', async () => {
    const result = await settle({
      validOrder: '0xexisting',
      providerFee: { providerFeeAmount: '0', providerFeeToken: FEE_TOKEN }
    })

    expect(result).to.deep.equal({ transferTxId: '0xexisting', reused: true })
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
  })

  it('surfaces an approval ocean.js swallowed', async () => {
    // `approveWei` catches a failed send, logs it and returns null — left alone, the
    // failure would only surface as the order reverting on a missing allowance.
    vi.mocked(approveWei).mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof approveWei>>
    )

    await expectThrowsAsync(
      () =>
        settle({
          providerFee: { providerFeeAmount: '30', providerFeeToken: FEE_TOKEN }
        }),
      /could not approve the provider fee/i
    )
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
