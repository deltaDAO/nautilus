/**
 * The caller's consent to what a node asks to be paid.
 *
 * The node chooses the provider fee's token and amount, and the compute escrow's contract
 * and amount. These tests pin that nautilus pays a non-zero fee only within
 * `maxProviderFee` or with `confirmProviderFees`, funds only the chain config's escrow
 * contract, and only within `maxEscrowPayment` or with `confirmEscrowPayment`; that every
 * refusal comes before the first approval, deposit or order; and that the escrow is
 * approved, funded and authorised for exact amounts.
 *
 * Everything on chain is stubbed: the escrow contract, ocean.js's `sendTx`, approvals and
 * the token balance read. `settleOrder` is stubbed for `compute()`, and `order()` /
 * `reuseOrder()` for `access()`.
 */
import {
  allowanceWei,
  approveWei,
  type ComputeEnvironment,
  type Config,
  EscrowContract,
  sendTx
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputeConfig } from '../../src/@types/Compute.js'
import { access, settleOrder } from '../../src/access/index.js'
import { compute } from '../../src/compute/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  EscrowPaymentNotAllowedError,
  ProviderFeeNotAllowedError
} from '../../src/utils/paymentLimits.js'
import { getPricingInfo } from '../../src/utils/pricing.js'
import {
  ASSET_DID,
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAlgorithmAssetFixture,
  getAssetFixture,
  getComputeAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import {
  PROVIDER_FEE_WALLET,
  signedProviderFee
} from '../fixtures/ProviderFee.js'
import { expectThrowsAsync } from '../helpers.js'

// #region stubs

const escrow = {
  getUserFunds: vi.fn(),
  getAuthorizations: vi.fn(),
  contract: {
    getFunction: vi.fn((name: string) =>
      Object.assign(vi.fn(), {
        estimateGas: vi.fn(async () => 50_000n),
        method: name
      })
    )
  }
}

const erc20 = { balanceOf: vi.fn() }

vi.mock('@oceanprotocol/lib', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  EscrowContract: vi.fn(function (this: void) {
    return escrow
  }),
  sendTx: vi.fn(async () => ({ wait: async () => ({ hash: '0xescrow' }) })),
  allowanceWei: vi.fn(async () => '0'),
  approveWei: vi.fn(async () => ({ hash: '0xapproval' }))
}))

vi.mock('ethers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Contract: vi.fn(function (this: void) {
    return { getFunction: () => erc20.balanceOf }
  })
}))

// `compute()` orders through `settleOrder`; `access()` keeps its own, which then calls
// `order()` / `reuseOrder()`.
vi.mock('../../src/access/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  settleOrder: vi.fn(
    async ({ datatokenAddress }: { datatokenAddress: string }) => ({
      transferTxId: `tx-${datatokenAddress}`
    })
  )
}))

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(async () => ({ transferTxId: '0xfresh', reused: false })),
  reuseOrder: vi.fn(async () => ({ transferTxId: '0xreused', reused: true }))
}))

vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async () => ({ schema: 'free' })),
  getOrderPrice: vi.fn(async () => ({ total: '0', consumeMarketFee: '0' }))
}))

// #endregion

// #region fixtures

const ONE = 10n ** 18n
const CONSUMER = '0x0000000000000000000000000000000000C05e5A'
const TOKEN = '0xfEE0000000000000000000000000000000000000'
const OTHER_TOKEN = '0x9999999999999999999999999999999999999999'
const ESCROW = '0x00000000000000000000000000000000000e5c40'
const PAYEE = '0x00000000000000000000000000000000000000C0'
const ATTACKER = '0xBAd0000000000000000000000000000000000Bad'

const ALGO_DID = 'did:ope:algorithm'
const ALGO_SERVICE_ID = 'algorithm-access-service'
const ALGO_DATATOKEN = '0x1111111111111111111111111111111111111111'

/** The escrow quote, as `initializeCompute` returns it for a paid job: 1 token. */
const PAYMENT = {
  escrowAddress: ESCROW.toLowerCase(),
  payee: PAYEE.toLowerCase(),
  chainId: CHAIN_ID,
  minLockSeconds: 3900,
  token: TOKEN.toLowerCase(),
  amount: ONE.toString()
}

/** A provider fee of `amount` base units in `token`, signed by the node. */
function feeOf(amount: bigint, token = TOKEN) {
  return signedProviderFee({
    providerFeeAmount: amount.toString(),
    providerFeeToken: token
  })
}

const signer = { getAddress: async () => CONSUMER } as unknown as Signer
const chainConfig = {
  chainId: CHAIN_ID,
  escrow: ESCROW,
  gasFeeMultiplier: 1
} as unknown as Config

function accessOnlyAlgorithm(): AssetV5 {
  const asset = getAlgorithmAssetFixture()
  asset.id = ALGO_DID
  asset.credentialSubject.id = ALGO_DID

  const service = asset.credentialSubject.services[0]
  service.id = ALGO_SERVICE_ID
  service.type = 'access'
  service.datatokenAddress = ALGO_DATATOKEN
  delete service.compute

  return asset
}

function environment(): ComputeEnvironment {
  return {
    id: 'env-1',
    consumerAddress: PAYEE,
    resources: [{ id: 'cpu', min: 1, max: 4 }],
    fees: { [String(CHAIN_ID)]: [{ feeToken: TOKEN }] },
    maxJobDuration: 3600
  } as unknown as ComputeEnvironment
}

/** A compute node answering `initializeCompute` with `quote`. */
function computeNode(quote: object) {
  const assets: Record<string, AssetV5> = {
    [ASSET_DID]: getComputeAssetFixture(),
    [ALGO_DID]: accessOnlyAlgorithm()
  }
  const computeStart = vi.fn(async () => [{ jobId: 'job-1' }])

  const client = {
    nodeUri: 'https://node.test.invalid',
    async resolve(did: string) {
      return assets[did]
    },
    async getComputeEnvironments() {
      return [environment()]
    },
    async initializeCompute() {
      return quote
    },
    computeStart
  } as unknown as OceanNodeClient

  return { client, computeStart }
}

/** An `initializeCompute` answer: one fee per input, plus `payment` when given. */
function quoteWith(
  fees: { dataset: unknown; algorithm: unknown },
  payment?: object
) {
  return {
    datasets: [{ datatoken: DATATOKEN_ADDRESS, providerFee: fees.dataset }],
    algorithm: { providerFee: fees.algorithm },
    ...(payment ? { payment } : {})
  }
}

const JOB = {
  dataset: { did: ASSET_DID },
  algorithm: { did: ALGO_DID }
} satisfies ComputeConfig

/** Generous enough for the fees and payment above. */
const ALLOW_ALL = {
  maxProviderFee: { token: TOKEN, amount: ONE },
  maxEscrowPayment: { token: TOKEN, amount: ONE }
}

function runCompute(
  quote: object,
  config: Partial<ComputeConfig> = {},
  chain: Config = chainConfig
) {
  const { client, computeStart } = computeNode(quote)
  const running = compute(
    { ...JOB, ...config },
    { node: client, signer, chainConfig: chain }
  )

  return { running, computeStart }
}

/** Every transaction the escrow flow sent, in order, as (what, args). */
function escrowTransactions() {
  return vi.mocked(sendTx).mock.calls.map((call) => ({
    method: (call[3] as unknown as { method: string }).method,
    args: call.slice(4)
  }))
}

function expectNothingSent() {
  expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  expect(vi.mocked(sendTx)).not.toHaveBeenCalled()
  expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
}

// #endregion

beforeEach(() => {
  vi.clearAllMocks()
  escrow.getUserFunds.mockResolvedValue({ available: 0n, locked: 0n })
  escrow.getAuthorizations.mockResolvedValue([])
  erc20.balanceOf.mockResolvedValue(100n * ONE)
  vi.mocked(allowanceWei).mockResolvedValue('0')
})

describe('compute() provider fees', () => {
  it('refuses non-zero fees without a ceiling or confirmation, before escrow and orders', async () => {
    const { running, computeStart } = runCompute(
      quoteWith({ dataset: feeOf(30n), algorithm: feeOf(40n) }, PAYMENT),
      { maxEscrowPayment: ALLOW_ALL.maxEscrowPayment }
    )

    const thrown = await running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(thrown.reason).to.equal('no-limit')
    expect(thrown.fees).to.deep.equal([
      {
        token: TOKEN,
        amount: 30n,
        collector: PROVIDER_FEE_WALLET.address,
        datatoken: DATATOKEN_ADDRESS,
        did: ASSET_DID,
        serviceId: SERVICE_ID
      },
      {
        token: TOKEN,
        amount: 40n,
        collector: PROVIDER_FEE_WALLET.address,
        datatoken: ALGO_DATATOKEN,
        did: ALGO_DID,
        serviceId: ALGO_SERVICE_ID
      }
    ])
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
    expect(computeStart).not.toHaveBeenCalled()
  })

  it('holds the sum of the inputs’ fees in one token to the ceiling', async () => {
    const quote = quoteWith({ dataset: feeOf(30n), algorithm: feeOf(40n) })

    const over = await runCompute(quote, {
      maxProviderFee: { token: TOKEN, amount: 69n }
    }).running.catch((caught) => caught)
    expect(over).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(over.reason).to.equal('over-limit')
    expectNothingSent()

    await runCompute(quote, { maxProviderFee: { token: TOKEN, amount: 70n } })
      .running
    expect(vi.mocked(settleOrder)).toHaveBeenCalledTimes(2)
  })

  it('needs a ceiling for every token the fees are in', async () => {
    const quote = quoteWith({
      dataset: feeOf(30n),
      algorithm: feeOf(40n, OTHER_TOKEN)
    })

    const thrown = await runCompute(quote, {
      maxProviderFee: { token: TOKEN, amount: ONE }
    }).running.catch((caught) => caught)
    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)

    await runCompute(quote, {
      maxProviderFee: [
        { token: TOKEN, amount: 30n },
        { token: OTHER_TOKEN, amount: 40n }
      ]
    }).running
    expect(vi.mocked(settleOrder)).toHaveBeenCalledTimes(2)
  })

  it('asks confirmProviderFees once with every fee, and lets each order pay exactly its own', async () => {
    const confirm = vi.fn(async () => true)

    await runCompute(
      quoteWith({ dataset: feeOf(30n), algorithm: feeOf(40n) }),
      { confirmProviderFees: confirm }
    ).running

    expect(confirm).toHaveBeenCalledOnce()
    expect(
      (confirm.mock.calls[0] as unknown as [{ amount: bigint }[]])[0].map(
        (fee) => fee.amount
      )
    ).to.deep.equal([30n, 40n])

    const ceilings = vi
      .mocked(settleOrder)
      .mock.calls.map((call) => call[0].maxProviderFee)
    expect(ceilings).to.deep.equal([
      [{ token: TOKEN, amount: 30n }],
      [{ token: TOKEN, amount: 40n }]
    ])
  })

  it('refuses when confirmProviderFees declines, before escrow', async () => {
    const thrown = await runCompute(
      quoteWith({ dataset: feeOf(30n), algorithm: feeOf(40n) }, PAYMENT),
      {
        confirmProviderFees: () => false,
        maxEscrowPayment: ALLOW_ALL.maxEscrowPayment
      }
    ).running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(thrown.reason).to.equal('declined')
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('pays zero fees, and orders reused as they stand, without any consent', async () => {
    const { running, computeStart } = runCompute({
      datasets: [{ datatoken: DATATOKEN_ADDRESS, providerFee: feeOf(0n) }],
      algorithm: { validOrder: '0xexisting' }
    })

    await running

    expect(computeStart).toHaveBeenCalledOnce()
    expect(
      vi.mocked(settleOrder).mock.calls.map((call) => call[0].maxProviderFee)
    ).to.deep.equal([[], []])
  })
})

describe('compute() escrow contract and quote', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }

  it('refuses an escrow contract other than the chain config’s, even when confirmed', async () => {
    const confirm = vi.fn(() => true)

    const thrown = await runCompute(
      quoteWith(goodFees, { ...PAYMENT, escrowAddress: ATTACKER }),
      { ...ALLOW_ALL, confirmEscrowPayment: confirm }
    ).running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(thrown.reason).to.equal('escrow-address')
    expect(thrown.message).to.contain(ATTACKER)
    expect(thrown.message).to.contain(ESCROW)
    expect(confirm).not.toHaveBeenCalled()
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses a quote with no escrow address', async () => {
    const { escrowAddress: _escrow, ...payment } = PAYMENT

    const thrown = await runCompute(
      quoteWith(goodFees, payment),
      ALLOW_ALL
    ).running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(thrown.reason).to.equal('escrow-address')
    expectNothingSent()
  })

  it('refuses when the chain config knows no escrow contract', async () => {
    const thrown = await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL, {
      chainId: CHAIN_ID
    } as Config).running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(thrown.reason).to.equal('unknown-escrow')
    expect(thrown.message).to.match(/config\.escrow/)
    expectNothingSent()
  })

  it.each([
    ['another chain', { chainId: 1 }],
    ['another token', { token: OTHER_TOKEN }],
    ['another payee', { payee: ATTACKER }],
    ['a fractional amount', { amount: '1.5' }],
    ['an inexact number', { amount: 1e21 }],
    ['a negative amount', { amount: '-1' }],
    ['no amount', { amount: undefined }],
    ['a fractional lock time', { minLockSeconds: 1.5 }]
  ])('refuses a quote for %s', async (_name, change) => {
    const thrown = await runCompute(
      quoteWith(goodFees, { ...PAYMENT, ...change }),
      ALLOW_ALL
    ).running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(thrown.reason).to.equal('mismatch')
    expectNothingSent()
  })

  it('funds nothing and asks nothing for a zero payment', async () => {
    const confirm = vi.fn(() => false)

    const { running, computeStart } = runCompute(
      quoteWith(goodFees, { ...PAYMENT, amount: '0' }),
      { confirmEscrowPayment: confirm }
    )
    await running

    expect(confirm).not.toHaveBeenCalled()
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expect(vi.mocked(sendTx)).not.toHaveBeenCalled()
    expect(computeStart).toHaveBeenCalledOnce()
  })
})

describe('compute() escrow amount', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }

  it('refuses a paid job without a ceiling or confirmation', async () => {
    const thrown = await runCompute(quoteWith(goodFees, PAYMENT)).running.catch(
      (caught) => caught
    )

    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(thrown.reason).to.equal('no-limit')
    expect(thrown.message).to.match(/maxEscrowPayment/)
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses an amount over the ceiling, or in a token it does not list', async () => {
    for (const maxEscrowPayment of [
      { token: TOKEN, amount: ONE - 1n },
      { token: OTHER_TOKEN, amount: 100n * ONE }
    ]) {
      const thrown = await runCompute(quoteWith(goodFees, PAYMENT), {
        maxEscrowPayment
      }).running.catch((caught) => caught)

      expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
      expect(thrown.reason).to.equal('over-limit')
    }

    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('asks confirmEscrowPayment with the checked quote, and follows it', async () => {
    const confirm = vi.fn(async () => true)

    await runCompute(quoteWith(goodFees, PAYMENT), {
      maxEscrowPayment: { token: TOKEN, amount: 1n },
      confirmEscrowPayment: confirm
    }).running

    expect(confirm).toHaveBeenCalledWith({
      escrowAddress: ESCROW,
      token: TOKEN,
      amount: ONE,
      payee: PAYEE,
      minLockSeconds: 3900n,
      chainId: CHAIN_ID
    })
    expect(vi.mocked(sendTx)).toHaveBeenCalled()

    vi.clearAllMocks()
    const declined = await runCompute(quoteWith(goodFees, PAYMENT), {
      confirmEscrowPayment: () => false
    }).running.catch((caught) => caught)

    expect(declined).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(declined.reason).to.equal('declined')
    expectNothingSent()
  })
})

describe('compute() escrow funding, in exact amounts', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }

  it('approves and deposits exactly the shortfall, and authorises exactly the job', async () => {
    // 0.4 tokens already in escrow, 0.25 locked by the payee for another job.
    escrow.getUserFunds.mockResolvedValue({
      available: (4n * ONE) / 10n,
      locked: ONE / 4n
    })
    escrow.getAuthorizations.mockResolvedValue([
      {
        payee: PAYEE.toLowerCase(),
        maxLockedAmount: ONE / 4n,
        currentLockedAmount: ONE / 4n,
        maxLockSeconds: 100n,
        maxLockCounts: 1n,
        currentLocks: 1n
      }
    ])

    await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running

    const deposit = (6n * ONE) / 10n

    expect(vi.mocked(EscrowContract)).toHaveBeenCalledWith(
      ESCROW,
      signer,
      CHAIN_ID,
      chainConfig
    )
    expect(vi.mocked(approveWei)).toHaveBeenCalledExactlyOnceWith(
      signer,
      chainConfig,
      CONSUMER,
      TOKEN,
      ESCROW,
      deposit.toString(),
      true
    )
    expect(escrowTransactions()).to.deep.equal([
      { method: 'deposit', args: [TOKEN, deposit] },
      {
        method: 'authorize',
        // The standing lock plus this job, the job's lock time, one more lock.
        args: [TOKEN, PAYEE, ONE / 4n + ONE, 3900n, 2n]
      }
    ])

    // The approval, the deposit and the authorisation all come before the first order.
    const firstOrder = vi.mocked(settleOrder).mock.invocationCallOrder[0]
    expect(vi.mocked(approveWei).mock.invocationCallOrder[0]).to.be.lessThan(
      vi.mocked(sendTx).mock.invocationCallOrder[0]
    )
    expect(vi.mocked(sendTx).mock.invocationCallOrder[1]).to.be.lessThan(
      firstOrder
    )
  })

  it('never approves the escrow for more than the deposit', async () => {
    await runCompute(quoteWith(goodFees, PAYMENT), {
      maxEscrowPayment: { token: TOKEN, amount: 1000n * ONE }
    }).running

    // Not the ceiling, and not the amount scaled by the token's decimals a second time.
    expect(vi.mocked(approveWei).mock.calls[0][5]).to.equal(ONE.toString())
    expect(escrowTransactions()[0]).to.deep.equal({
      method: 'deposit',
      args: [TOKEN, ONE]
    })
  })

  it('skips the approval a standing allowance covers, and the deposit escrow covers', async () => {
    vi.mocked(allowanceWei).mockResolvedValue(ONE.toString())

    await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(escrowTransactions().map((tx) => tx.method)).to.deep.equal([
      'deposit',
      'authorize'
    ])

    vi.clearAllMocks()
    escrow.getUserFunds.mockResolvedValue({ available: 2n * ONE, locked: 0n })

    await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(erc20.balanceOf).not.toHaveBeenCalled()
    expect(escrowTransactions().map((tx) => tx.method)).to.deep.equal([
      'authorize'
    ])
  })

  it('leaves a standing authorisation that covers the job as it is', async () => {
    escrow.getUserFunds.mockResolvedValue({ available: ONE, locked: 0n })
    escrow.getAuthorizations.mockResolvedValue([
      // A plain array, the way ethers returns a struct.
      [PAYEE, 5n * ONE, 0n, 7200n, 10n, 0n]
    ])

    await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running

    expect(vi.mocked(sendTx)).not.toHaveBeenCalled()
    expect(vi.mocked(settleOrder)).toHaveBeenCalledTimes(2)
  })

  it('raises only what falls short of a standing authorisation', async () => {
    escrow.getUserFunds.mockResolvedValue({ available: ONE, locked: 0n })
    escrow.getAuthorizations.mockResolvedValue([
      {
        payee: PAYEE,
        maxLockedAmount: 5n * ONE,
        currentLockedAmount: 0n,
        maxLockSeconds: 60n,
        maxLockCounts: 10n,
        currentLocks: 0n
      }
    ])

    await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running

    expect(escrowTransactions()).to.deep.equal([
      { method: 'authorize', args: [TOKEN, PAYEE, 5n * ONE, 3900n, 10n] }
    ])
  })

  it('refuses before any transaction when the wallet cannot cover the deposit', async () => {
    erc20.balanceOf.mockResolvedValue(ONE / 2n)

    await expectThrowsAsync(
      () => runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running,
      /wallet holds 500000000000000000 of the 1000000000000000000 to deposit\. Nothing was spent/
    )
    expectNothingSent()
  })

  it('surfaces an escrow transaction ocean.js swallowed, before any order', async () => {
    vi.mocked(sendTx).mockResolvedValueOnce(null as never)

    await expectThrowsAsync(
      () => runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running,
      /escrow deposit failed/
    )
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
  })
})

describe('access() provider fee', () => {
  const SERVICE_NODE = 'https://publisher-node.test.invalid'

  /** The service's node, as the publisher runs it, answering with `providerFee`. */
  function accessNode(providerFee: unknown, validOrder?: string) {
    const asset = getAssetFixture()
    asset.credentialSubject.services[0].serviceEndpoint = SERVICE_NODE

    const client = {
      nodeUri: 'https://node.test.invalid',
      forEndpoint() {
        return client
      },
      async resolve() {
        return asset
      },
      async initialize() {
        return { datatoken: DATATOKEN_ADDRESS, providerFee, validOrder }
      },
      getDownloadUrl: vi.fn(async () => `${SERVICE_NODE}/download`)
    }

    return client
  }

  function download(
    client: ReturnType<typeof accessNode>,
    limits: object = {}
  ) {
    return access(
      { assetDid: ASSET_DID, ...limits },
      { node: client as unknown as OceanNodeClient, signer, chainConfig }
    )
  }

  it('refuses a fee of the consumer’s whole balance before any chain read or order', async () => {
    const client = accessNode(feeOf(100n * ONE))

    const thrown = await download(client).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(thrown.fees[0]).to.include({
      amount: 100n * ONE,
      did: ASSET_DID,
      serviceId: SERVICE_ID
    })
    expect(vi.mocked(getPricingInfo)).not.toHaveBeenCalled()
    expect(vi.mocked(order)).not.toHaveBeenCalled()
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
    expect(client.getDownloadUrl).not.toHaveBeenCalled()
  })

  it('pays a fee within the ceiling, letting the order pay exactly it', async () => {
    const client = accessNode(feeOf(30n))

    const result = await download(client, {
      maxProviderFee: { token: TOKEN, amount: 100n }
    })

    expect(result.transferTxId).to.equal('0xfresh')
    expect(vi.mocked(order).mock.calls[0][0].maxProviderFee).to.deep.equal([
      { token: TOKEN, amount: 30n }
    ])
  })

  it('applies the same rule when extending a reusable order', async () => {
    const refused = await download(accessNode(feeOf(30n), '0xexisting')).catch(
      (caught) => caught
    )
    expect(refused).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()

    const confirm = vi.fn(() => true)
    await download(accessNode(feeOf(30n), '0xexisting'), {
      confirmProviderFees: confirm
    })
    expect(confirm).toHaveBeenCalledOnce()
    expect(vi.mocked(reuseOrder).mock.calls[0][0].maxProviderFee).to.deep.equal(
      [{ token: TOKEN, amount: 30n }]
    )
  })

  it('needs no consent for a zero fee', async () => {
    await download(accessNode(feeOf(0n)))

    expect(vi.mocked(order)).toHaveBeenCalledOnce()
  })
})
