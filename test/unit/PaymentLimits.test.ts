/**
 * The caller's consent to what a node asks to be paid.
 *
 * The node chooses the provider fee's token and amount, and the compute escrow's contract
 * and amount. These tests pin that nautilus pays a non-zero fee only within
 * `maxProviderFee` or with `confirmProviderFees`, funds only the escrow contract pinned for
 * the chain (the caller's explicit choice, else the chain's `EnterpriseEscrow` in Ocean's
 * address data, else its `Escrow`), and only within `maxEscrowPayment` or with
 * `confirmEscrowPayment`; that every
 * refusal comes before the first approval, deposit or order; and that the escrow is
 * approved, funded and authorised for exact amounts.
 *
 * Everything on chain is stubbed: the escrow contract, ocean.js's `sendTx`, approvals and
 * the token balance read. `sendSettlement` is stubbed for `compute()`, and `order()` /
 * `reuseOrder()` for `access()`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  allowanceWei,
  approveWei,
  type ComputeEnvironment,
  type Config,
  ConfigHelper,
  EscrowContract,
  sendTx
} from '@oceanprotocol/lib'
import { getAddress, type Signer } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputeConfig } from '../../src/@types/Compute.js'
import { access, settleOrder } from '../../src/access/index.js'
import { planSettlement, sendSettlement } from '../../src/access/settlement.js'
import { resolveEscrowPin } from '../../src/compute/escrow.js'
import { type ComputeContext, compute } from '../../src/compute/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { createKeyedLock } from '../../src/utils/keyedLock.js'
import { order, reuseOrder } from '../../src/utils/order.js'
import {
  checkEscrowQuote,
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

// `compute()` plans every order with the real `planSettlement` (its checks and pricing
// reads), then sends them through `sendSettlement`, stubbed here. `access()` settles
// through the real module, which then calls `order()` / `reuseOrder()`, stubbed below.
vi.mock('../../src/access/settlement.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/access/settlement.js')>()

  return {
    ...original,
    planSettlement: vi.fn(original.planSettlement),
    sendSettlement: vi.fn(
      async ({ datatokenAddress }: { datatokenAddress: string }) => ({
        transferTxId: `tx-${datatokenAddress}`
      })
    )
  }
})

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(async () => ({ transferTxId: '0xfresh', reused: false })),
  reuseOrder: vi.fn(async () => ({ transferTxId: '0xreused', reused: true }))
}))

vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async (_signer: unknown, datatokenAddress: string) => ({
    schema: 'free',
    templateId: 1,
    datatokenAddress,
    publishMarketFee: {}
  })),
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
/** No `escrow`: the pin comes from `compute()`'s context, never from the chain config. */
const chainConfig = {
  chainId: CHAIN_ID,
  gasFeeMultiplier: 1,
  dispenserAddress: '0x0000000000000000000000000000000000d15e45'
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
    // A node without a policy server: no session is opened.
    async hasPolicyServer() {
      return false
    },
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

/**
 * Runs `compute()` against a node answering `quote`. The escrow is pinned to `ESCROW`
 * explicitly unless `context` says otherwise (the test chain has no escrow in Ocean's
 * address data).
 */
function runCompute(
  quote: object,
  config: Partial<ComputeConfig> = {},
  context: Partial<Omit<ComputeContext, 'node'>> = {}
) {
  const { client, computeStart } = computeNode(quote)
  const running = compute(
    { ...JOB, ...config },
    { node: client, signer, chainConfig, escrow: ESCROW, ...context }
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
  expect(vi.mocked(sendSettlement)).not.toHaveBeenCalled()
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
    expect(vi.mocked(sendSettlement)).toHaveBeenCalledTimes(2)
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
    expect(vi.mocked(sendSettlement)).toHaveBeenCalledTimes(2)
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
      .mocked(planSettlement)
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
      vi.mocked(planSettlement).mock.calls.map((call) => call[0].maxProviderFee)
    ).to.deep.equal([[], []])
  })
})

describe('compute() escrow contract and quote', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }

  it('refuses an escrow contract other than the pinned one, even when confirmed', async () => {
    const confirm = vi.fn(() => true)

    const thrown = await runCompute(
      quoteWith(goodFees, { ...PAYMENT, escrowAddress: ATTACKER }),
      { ...ALLOW_ALL, confirmEscrowPayment: confirm }
    ).running.catch((caught) => caught)

    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(thrown.reason).to.equal('escrow-address')
    expect(thrown.message).to.contain(ATTACKER)
    expect(thrown.message).to.contain(getAddress(ESCROW))
    expect(thrown.message).to.contain('rule: explicit')
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

  it('refuses when no escrow is set and the address data lists none for the chain', async () => {
    // Pontus-X devnet (the test chain) is in the addresses ocean.js ships, without an
    // escrow. A chain config's escrow, as ocean.js fills it, does not count as a choice.
    const saved = process.env.ADDRESS_FILE
    delete process.env.ADDRESS_FILE
    try {
      const confirm = vi.fn(() => true)
      const thrown = await runCompute(
        quoteWith(goodFees, PAYMENT),
        {
          ...ALLOW_ALL,
          confirmEscrowPayment: confirm
        },
        {
          escrow: undefined,
          chainConfig: { ...chainConfig, escrow: ESCROW } as Config
        }
      ).running.catch((caught) => caught)

      expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
      expect(thrown.reason).to.equal('unknown-escrow')
      expect(thrown.message).to.match(
        /EnterpriseEscrow contract as config\.escrow/
      )
      expect(confirm).not.toHaveBeenCalled()
      expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
      expectNothingSent()
    } finally {
      if (saved !== undefined) process.env.ADDRESS_FILE = saved
    }
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

  it.each([
    ['no escrow address', { amount: 0 }],
    ['no escrow address, as a string', { amount: '0' }],
    ['no escrow address, in hex', { amount: '0x0' }],
    ['an empty escrow address', { escrowAddress: '', amount: 0 }],
    [
      'another escrow contract',
      { ...PAYMENT, escrowAddress: ATTACKER, amount: 0 }
    ]
  ])(
    'starts a zero payment with %s, funding nothing, even with no escrow pinned',
    async (_name, payment) => {
      const saved = process.env.ADDRESS_FILE
      delete process.env.ADDRESS_FILE
      try {
        const confirm = vi.fn(() => false)

        // A free environment: the node quotes a zero amount, and no escrow is pinned (the
        // test chain's address data lists none, and none is set explicitly).
        const { running, computeStart } = runCompute(
          quoteWith(goodFees, payment),
          { confirmEscrowPayment: confirm },
          { escrow: undefined }
        )
        await running

        expect(confirm).not.toHaveBeenCalled()
        expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
        expect(vi.mocked(sendTx)).not.toHaveBeenCalled()
        expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
        expect(computeStart).toHaveBeenCalledOnce()
      } finally {
        if (saved !== undefined) process.env.ADDRESS_FILE = saved
      }
    }
  )

  it.each([
    ['a fractional amount', { amount: '1.5' }],
    ['a negative amount', { amount: -1 }],
    ['no amount', {}],
    ['a non-numeric amount', { amount: 'zero' }]
  ])(
    'still refuses %s with no escrow address, before anything is sent',
    async (_name, payment) => {
      const thrown = await runCompute(
        quoteWith(goodFees, payment),
        ALLOW_ALL
      ).running.catch((caught) => caught)

      expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
      expect(thrown.reason).to.equal('mismatch')
      expect(thrown.message).to.contain('is not an exact non-negative integer')
      expectNothingSent()
    }
  )

  it('checks the amount before the escrow address in checkEscrowQuote()', () => {
    const expected = {
      pin: { rule: 'none' as const },
      chainId: CHAIN_ID,
      token: TOKEN,
      payee: PAYEE
    }

    expect(checkEscrowQuote({ amount: 0 }, expected)).to.equal(undefined)
    expect(() => checkEscrowQuote({ amount: 1 }, expected)).to.throw(
      EscrowPaymentNotAllowedError,
      /no escrow contract is pinned/
    )
  })
})

describe('compute() escrow pin', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }
  const ENTERPRISE = getAddress('0x00000000000000000000000000000000e5c4e5c4')
  const CHOSEN = getAddress('0x0000000000000000000000000000000000c405e0')
  const savedAddressFile = process.env.ADDRESS_FILE
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nautilus-escrow-'))
  })

  afterEach(() => {
    if (savedAddressFile === undefined) delete process.env.ADDRESS_FILE
    else process.env.ADDRESS_FILE = savedAddressFile
    rmSync(dir, { recursive: true, force: true })
  })

  /** Ocean's address data for the test chain, as ocean.js reads it from ADDRESS_FILE. */
  function useAddressData(entry: object) {
    const file = join(dir, 'address.json')
    writeFileSync(
      file,
      JSON.stringify({ testchain: { chainId: CHAIN_ID, ...entry } })
    )
    process.env.ADDRESS_FILE = file
  }

  /** `compute()` with no explicit escrow, the node naming `escrowAddress`. */
  function runDefault(
    escrowAddress: string,
    config: Partial<ComputeConfig> = {}
  ) {
    return runCompute(
      quoteWith(goodFees, { ...PAYMENT, escrowAddress }),
      { ...ALLOW_ALL, ...config },
      // As ocean.js's ConfigHelper fills it: the address data's Escrow. Not a choice.
      {
        escrow: undefined,
        chainConfig: { ...chainConfig, escrow: ESCROW } as Config
      }
    )
  }

  async function refusal(running: Promise<unknown>) {
    const thrown = await running.catch((caught) => caught)
    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
    return thrown as EscrowPaymentNotAllowedError
  }

  it('funds the explicit escrow, and only that one', async () => {
    useAddressData({ Escrow: ESCROW, EnterpriseEscrow: ENTERPRISE })

    const { running, computeStart } = runCompute(
      quoteWith(goodFees, { ...PAYMENT, escrowAddress: CHOSEN.toLowerCase() }),
      ALLOW_ALL,
      { escrow: CHOSEN.toLowerCase() }
    )
    await running
    expect(vi.mocked(EscrowContract).mock.calls[0][0]).to.equal(CHOSEN)
    expect(computeStart).toHaveBeenCalledOnce()

    // The address data's EnterpriseEscrow and Escrow are refused once a choice is made.
    for (const other of [ENTERPRISE, ESCROW]) {
      vi.clearAllMocks()
      const thrown = await refusal(
        runCompute(
          quoteWith(goodFees, { ...PAYMENT, escrowAddress: other }),
          { ...ALLOW_ALL, confirmEscrowPayment: () => true },
          { escrow: CHOSEN }
        ).running
      )
      expect(thrown.reason).to.equal('escrow-address')
      expect(thrown.message).to.contain(`is ${CHOSEN}`)
      expect(thrown.message).to.contain('rule: explicit')
    }
  })

  it('funds only the EnterpriseEscrow on a chain whose address data has both', async () => {
    useAddressData({ Escrow: ESCROW, EnterpriseEscrow: ENTERPRISE })

    const { running, computeStart } = runDefault(ENTERPRISE.toLowerCase())
    await running

    const config = { ...chainConfig, escrow: ESCROW }
    expect(vi.mocked(EscrowContract)).toHaveBeenCalledWith(
      ENTERPRISE,
      signer,
      CHAIN_ID,
      config
    )
    expect(vi.mocked(approveWei)).toHaveBeenCalledExactlyOnceWith(
      signer,
      config,
      CONSUMER,
      TOKEN,
      ENTERPRISE,
      ONE.toString(),
      true
    )
    expect(escrowTransactions()[0]).to.deep.equal({
      method: 'deposit',
      args: [TOKEN, ONE]
    })
    expect(computeStart).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    const confirm = vi.fn(() => true)
    const thrown = await refusal(
      runDefault(ESCROW, { confirmEscrowPayment: confirm }).running
    )
    expect(thrown.reason).to.equal('escrow-address')
    expect(thrown.message).to.contain(`is ${ENTERPRISE}`)
    expect(thrown.message).to.contain(
      'rule: EnterpriseEscrow from the address data'
    )
    expect(confirm).not.toHaveBeenCalled()
  })

  it('falls back to Escrow on a chain whose address data has no EnterpriseEscrow', async () => {
    useAddressData({ Escrow: ESCROW })

    const { running, computeStart } = runDefault(ESCROW)
    await running
    expect(vi.mocked(EscrowContract).mock.calls[0][0]).to.equal(
      getAddress(ESCROW)
    )
    expect(computeStart).toHaveBeenCalledOnce()
  })

  it('refuses when nothing is set and the address data lists no escrow', async () => {
    useAddressData({})

    const thrown = await refusal(
      runDefault(ESCROW, { confirmEscrowPayment: () => true }).running
    )
    expect(thrown.reason).to.equal('unknown-escrow')
    expect(thrown.message).to.contain(
      "Set the chain's EnterpriseEscrow contract as config.escrow"
    )
  })

  it.each([
    [
      'explicit',
      { Escrow: ESCROW, EnterpriseEscrow: ENTERPRISE },
      CHOSEN,
      CHOSEN,
      'rule: explicit'
    ],
    [
      'enterprise-escrow',
      { Escrow: ESCROW, EnterpriseEscrow: ENTERPRISE },
      undefined,
      ENTERPRISE,
      'rule: EnterpriseEscrow from the address data'
    ],
    [
      'escrow',
      { Escrow: ESCROW },
      undefined,
      getAddress(ESCROW),
      'rule: Escrow fallback'
    ]
  ])(
    'refuses an attacker’s escrow under the rule %s, even when confirmed',
    async (_rule, data, escrow, expected, rule) => {
      useAddressData(data)
      const confirm = vi.fn(() => true)

      const thrown = await refusal(
        runCompute(
          quoteWith(goodFees, { ...PAYMENT, escrowAddress: ATTACKER }),
          { ...ALLOW_ALL, confirmEscrowPayment: confirm },
          { escrow }
        ).running
      )
      expect(thrown.reason).to.equal('escrow-address')
      expect(thrown.message).to.contain(ATTACKER)
      expect(thrown.message).to.contain(`is ${expected}`)
      expect(thrown.message).to.contain(rule)
      expect(confirm).not.toHaveBeenCalled()
    }
  )

  it('refuses a malformed explicit escrow before calling the node', async () => {
    const { client } = computeNode(quoteWith(goodFees, PAYMENT))
    const resolve = vi.spyOn(client, 'resolve')

    await expectThrowsAsync(
      () =>
        compute(JOB, {
          node: client,
          signer,
          chainConfig,
          escrow: '0x1234'
        }),
      /must be an address, not '0x1234'/
    )
    expect(resolve).not.toHaveBeenCalled()
    expectNothingSent()
  })
})

describe('resolveEscrowPin()', () => {
  const OP_SEPOLIA = 11155420
  const OP_SEPOLIA_ENTERPRISE_ESCROW = getAddress(
    '0xfa48673a7C36A2A768f89AC1ee8C355D5c367B02'
  )
  const OP_SEPOLIA_ESCROW = getAddress(
    '0x7842Fa3B2d87Ff1cd52C4152382f7C4B3406E5A6'
  )
  const savedAddressFile = process.env.ADDRESS_FILE

  beforeEach(() => {
    delete process.env.ADDRESS_FILE
  })

  afterEach(() => {
    if (savedAddressFile === undefined) delete process.env.ADDRESS_FILE
    else process.env.ADDRESS_FILE = savedAddressFile
  })

  /** OP Sepolia's escrow quote, as ocean-node would send it, naming `escrowAddress`. */
  function opSepoliaQuote(escrowAddress: string) {
    return {
      ...PAYMENT,
      chainId: OP_SEPOLIA,
      escrowAddress: escrowAddress.toLowerCase()
    }
  }

  function check(escrowAddress: string, explicit?: string) {
    return checkEscrowQuote(opSepoliaQuote(escrowAddress), {
      pin: resolveEscrowPin(OP_SEPOLIA, explicit),
      chainId: OP_SEPOLIA,
      token: TOKEN,
      payee: PAYEE
    })
  }

  it('pins OP Sepolia’s EnterpriseEscrow from the addresses ocean.js ships', () => {
    // ocean.js fills config.escrow from the plain Escrow; nautilus pins EnterpriseEscrow,
    // the contract ocean-node 4.2.0 uses for the chain.
    expect(new ConfigHelper().getConfig(OP_SEPOLIA)?.escrow).to.equal(
      OP_SEPOLIA_ESCROW
    )
    expect(resolveEscrowPin(OP_SEPOLIA)).to.deep.equal({
      address: OP_SEPOLIA_ENTERPRISE_ESCROW,
      rule: 'enterprise-escrow'
    })
  })

  it('accepts OP Sepolia’s EnterpriseEscrow and refuses its Escrow by default', () => {
    expect(check(OP_SEPOLIA_ENTERPRISE_ESCROW)?.escrowAddress).to.equal(
      OP_SEPOLIA_ENTERPRISE_ESCROW
    )

    let thrown: unknown
    try {
      check(OP_SEPOLIA_ESCROW)
    } catch (error) {
      thrown = error
    }
    expect(thrown).to.be.instanceOf(EscrowPaymentNotAllowedError)
    expect((thrown as EscrowPaymentNotAllowedError).reason).to.equal(
      'escrow-address'
    )
    expect((thrown as Error).message).to.contain(
      `is ${OP_SEPOLIA_ENTERPRISE_ESCROW}`
    )
  })

  it('accepts OP Sepolia’s Escrow only when the caller chooses it', () => {
    expect(check(OP_SEPOLIA_ESCROW, OP_SEPOLIA_ESCROW)?.escrowAddress).to.equal(
      OP_SEPOLIA_ESCROW
    )
    expect(() =>
      check(OP_SEPOLIA_ENTERPRISE_ESCROW, OP_SEPOLIA_ESCROW)
    ).to.throw(EscrowPaymentNotAllowedError, /rule: explicit/)
  })

  it('pins nothing on Pontus-X devnet, whose address data lists no escrow', () => {
    expect(resolveEscrowPin(32456)).to.deep.equal({ rule: 'none' })
    expect(resolveEscrowPin(32456, ESCROW.toLowerCase())).to.deep.equal({
      address: getAddress(ESCROW),
      rule: 'explicit'
    })
  })

  it('treats an empty explicit escrow as unset, and refuses a malformed one', () => {
    expect(resolveEscrowPin(OP_SEPOLIA, '')).to.deep.equal({
      address: OP_SEPOLIA_ENTERPRISE_ESCROW,
      rule: 'enterprise-escrow'
    })
    expect(() => resolveEscrowPin(OP_SEPOLIA, 'not-an-address')).to.throw(
      /must be an address/
    )
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
    const firstOrder = vi.mocked(sendSettlement).mock.invocationCallOrder[0]
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
    expect(vi.mocked(sendSettlement)).toHaveBeenCalledTimes(2)
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
    expect(vi.mocked(sendSettlement)).not.toHaveBeenCalled()
  })
})

describe('compute() checks every order before funding escrow', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }

  /** Pricing as read from chain: `schema` for the algorithm's datatoken, free otherwise. */
  function algorithmPricing(schema: 'none' | 'free') {
    vi.mocked(getPricingInfo).mockImplementation(
      async (_signer, datatokenAddress) =>
        ({
          schema: datatokenAddress === ALGO_DATATOKEN ? schema : 'free',
          templateId: 1,
          datatokenAddress,
          publishMarketFee: {}
        }) as never
    )
  }

  afterEach(() => {
    algorithmPricing('free')
  })

  it('refuses an input whose pricing cannot be ordered before any escrow read or transaction', async () => {
    algorithmPricing('none')

    const { running, computeStart } = runCompute(
      quoteWith(goodFees, PAYMENT),
      ALLOW_ALL
    )
    const thrown = await running.catch((caught) => caught)

    expect(thrown.message).to.match(
      /neither a fixed-rate exchange nor a dispenser/
    )
    // Both inputs were planned; the dataset's order was not sent either.
    expect(vi.mocked(planSettlement)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expect(escrow.getUserFunds).not.toHaveBeenCalled()
    expectNothingSent()
    expect(computeStart).not.toHaveBeenCalled()
  })

  it('refuses a free input the chain config cannot order before funding escrow', async () => {
    const { dispenserAddress: _dispenser, ...noDispenser } =
      chainConfig as Config & { dispenserAddress: string }

    const thrown = await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL, {
      chainConfig: noDispenser as Config
    }).running.catch((caught) => caught)

    expect(thrown.message).to.match(/no dispenserAddress/)
    expect(vi.mocked(EscrowContract)).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('reads every input’s pricing before the first escrow read, and funds before ordering', async () => {
    await runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL).running

    const lastPricing = Math.max(
      ...vi.mocked(getPricingInfo).mock.invocationCallOrder
    )
    expect(vi.mocked(getPricingInfo)).toHaveBeenCalledTimes(2)
    expect(lastPricing).to.be.lessThan(
      escrow.getUserFunds.mock.invocationCallOrder[0]
    )
    expect(
      Math.max(...vi.mocked(sendTx).mock.invocationCallOrder)
    ).to.be.lessThan(vi.mocked(sendSettlement).mock.invocationCallOrder[0])
    // Each planned order is sent as planned, allowed exactly its (zero) fee.
    expect(
      vi.mocked(sendSettlement).mock.calls.map((call) => call[0].kind)
    ).to.deep.equal(['order', 'order'])
  })
})

describe('settleOrder() plans, then sends', () => {
  function settle(providerFee: unknown, limits: object, validOrder?: string) {
    return settleOrder({
      signer,
      chainConfig,
      datatokenAddress: DATATOKEN_ADDRESS,
      serviceIndex: 0,
      initialized: { providerFee, validOrder },
      consumer: CONSUMER,
      ...limits
    })
  }

  it('asks confirmProviderFees once, then lets the order pay exactly the fee', async () => {
    const confirm = vi.fn(() => true)

    await settle(feeOf(30n), { confirmProviderFees: confirm })

    expect(confirm).toHaveBeenCalledOnce()
    const [request] = vi.mocked(order).mock.calls[0]
    expect(request.confirmProviderFees).to.equal(undefined)
    expect(request.maxProviderFee).to.deep.equal([
      { token: TOKEN, amount: 30n }
    ])
  })

  it('refuses a declined fee on the extend path before reuseOrder()', async () => {
    const thrown = await settle(
      feeOf(30n),
      { confirmProviderFees: () => false },
      '0xexisting'
    ).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(vi.mocked(reuseOrder)).not.toHaveBeenCalled()
    expect(vi.mocked(getPricingInfo)).not.toHaveBeenCalled()
  })

  it('refuses unorderable pricing at the plan, before order()', async () => {
    vi.mocked(getPricingInfo).mockImplementationOnce(
      async (_signer, datatokenAddress) =>
        ({
          schema: 'none',
          templateId: 1,
          datatokenAddress,
          publishMarketFee: {}
        }) as never
    )

    await expectThrowsAsync(
      () => settle(feeOf(30n), ALLOW_ALL),
      /neither a fixed-rate exchange nor a dispenser/
    )
    expect(vi.mocked(order)).not.toHaveBeenCalled()
  })
})

describe('compute() concurrent jobs from one payer', () => {
  const goodFees = { dataset: feeOf(0n), algorithm: feeOf(0n) }
  const BLOCK_MS = 1000

  /**
   * One payer's escrow for TOKEN and PAYEE, as the contract keeps it: each deposit and
   * authorisation lands a block after it is sent, and the node's `createLock` (run by
   * `computeStart`, a block after the request) applies the contract's checks.
   */
  function chain() {
    const state = {
      available: 0n,
      maxLockedAmount: 0n,
      currentLockedAmount: 0n,
      maxLockSeconds: 0n,
      maxLockCounts: 0n,
      currentLocks: 0n
    }
    const block = () =>
      new Promise((resolve) => {
        setTimeout(resolve, BLOCK_MS)
      })

    escrow.getUserFunds.mockImplementation(async () => ({
      available: state.available,
      locked: state.currentLockedAmount
    }))
    escrow.getAuthorizations.mockImplementation(async () =>
      state.maxLockCounts === 0n ? [] : [{ payee: PAYEE, ...state }]
    )
    vi.mocked(sendTx).mockImplementation((async (...call: unknown[]) => {
      const { method } = call[3] as { method: string }
      const args = call.slice(4) as bigint[]
      await block()
      if (method === 'deposit') state.available += args[1]
      if (method === 'authorize') {
        state.maxLockedAmount = args[2]
        state.maxLockSeconds = args[3]
        state.maxLockCounts = args[4]
      }
      return { wait: async () => ({ hash: '0xescrow' }) }
    }) as never)

    async function createLock(amount: bigint) {
      await block()
      if (state.available < amount) throw new Error('insufficient escrow funds')
      if (state.currentLockedAmount + amount > state.maxLockedAmount)
        throw new Error('the lock exceeds maxLockedAmount')
      if (state.currentLocks >= state.maxLockCounts)
        throw new Error('the lock exceeds maxLockCounts')
      state.available -= amount
      state.currentLockedAmount += amount
      state.currentLocks += 1n
    }

    return { state, createLock }
  }

  /** Two paid jobs of 1 token each, started together, run to the end on fake timers. */
  async function twoJobs(context: Partial<Omit<ComputeContext, 'node'>>) {
    const { createLock } = chain()
    const jobs = [0, 1].map(() =>
      runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL, context)
    )
    for (const [index, { computeStart }] of jobs.entries())
      computeStart.mockImplementation(async () => {
        await createLock(ONE)
        return [{ jobId: `job-${index}` }]
      })

    const settled = Promise.allSettled(jobs.map((job) => job.running))
    await vi.runAllTimersAsync()
    return settled
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(sendTx).mockReset()
    escrow.getUserFunds.mockReset()
    escrow.getAuthorizations.mockReset()
  })

  it('runs them one after the other per payer, token and payee, each authorising on top of the last lock', async () => {
    const results = await twoJobs({ escrowLock: createKeyedLock() })

    expect(results.map((result) => result.status)).to.deep.equal([
      'fulfilled',
      'fulfilled'
    ])
    expect(
      escrowTransactions()
        .filter((tx) => tx.method === 'authorize')
        .map((tx) => tx.args)
    ).to.deep.equal([
      [TOKEN, PAYEE, ONE, 3900n, 1n],
      // Planned after the first job's lock: one token locked, one lock in force.
      [TOKEN, PAYEE, 2n * ONE, 3900n, 2n]
    ])
  })

  it('without a lock, the second job plans from the same snapshot and its lock fails', async () => {
    // What the lock prevents: both jobs authorise maxLockedAmount = 1 token and one lock.
    const results = await twoJobs({})

    expect(results.map((result) => result.status)).to.deep.equal([
      'fulfilled',
      'rejected'
    ])
    expect((results[1] as PromiseRejectedResult).reason.message).to.match(
      /exceeds maxLockedAmount/
    )
  })

  it('does not hold up a job for another payee', async () => {
    const lock = createKeyedLock()
    const held = vi.fn()

    // A job for another payee holds its own key: this one does not wait for it.
    void lock(
      `${CHAIN_ID}:${CONSUMER}:${TOKEN}:other`.toLowerCase(),
      () => new Promise(held)
    )

    const { running } = runCompute(quoteWith(goodFees, PAYMENT), ALLOW_ALL, {
      escrowLock: lock
    })
    const settled = running.then(() => 'done')
    await vi.runAllTimersAsync()

    expect(await settled).to.equal('done')
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
      // A node without a policy server: no session is opened.
      async hasPolicyServer() {
        return false
      },
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
