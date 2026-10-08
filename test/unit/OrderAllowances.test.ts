/**
 * One allowance per (token, spender), for everything an order pulls from the payer.
 *
 * An ERC20 `approve` replaces the previous allowance rather than adding to it. The
 * provider fee, the publish-market fee and (on templates 2 and 4) the purchase are all
 * pulled by the datatoken, so when two of them are in the same token, approving them one
 * after the other left only the last, and the order reverted on the shortfall: on
 * template 1, after the datatoken had already been bought.
 *
 * These tests run the real `order()` and `reuseOrder()` against stubbed ocean.js calls,
 * and pin that every check happens before the first approval, that a shared pair is
 * approved once for the sum, and that pairs in different tokens are approved as before.
 */
import {
  allowanceWei,
  approve,
  approveWei,
  type Config,
  Datatoken,
  Dispenser,
  FixedRateExchange,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import { getAddress, type Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { order, reuseOrder } from '../../src/utils/order.js'
import { ProviderFeeNotAllowedError } from '../../src/utils/paymentLimits.js'
import type { OrderPrice, PricingInfo } from '../../src/utils/pricing.js'
import { ProviderFeeSignatureError } from '../../src/utils/providerFee.js'
import {
  poisonedProviderFee,
  signedProviderFee
} from '../fixtures/ProviderFee.js'
import { expectThrowsAsync } from '../helpers.js'

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oceanprotocol/lib')>()

  return {
    ...actual,
    approve: vi.fn(),
    approveWei: vi.fn(),
    allowanceWei: vi.fn(),
    Datatoken: vi.fn(),
    Dispenser: vi.fn(),
    FixedRateExchange: vi.fn()
  }
})

const EXCHANGE = '0x1111111111111111111111111111111111111111'
const DISPENSER = '0x2222222222222222222222222222222222222222'
const DATATOKEN = '0x3333333333333333333333333333333333333333'
const BASE_TOKEN = '0x4444444444444444444444444444444444444444'
const PUBLISH_MARKET = '0x5555555555555555555555555555555555555555'
const CONSUMER = '0x7777777777777777777777777777777777777777'
const FEE_TOKEN = '0x8888888888888888888888888888888888888888'
const OTHER_TOKEN = '0x9999999999999999999999999999999999999999'

const ONE = 10n ** 18n

/**
 * A ceiling generous enough for every provider fee below, so the allowance tests see the
 * order as a caller who allowed its fee does. The ceiling itself is tested at the end.
 */
const ANY_FEE = {
  maxProviderFee: [FEE_TOKEN, BASE_TOKEN, OTHER_TOKEN].map((token) => ({
    token,
    amount: 10n * ONE
  }))
}

const signer = { getAddress: async () => CONSUMER } as unknown as Signer

const chainConfig = {
  chainId: 32456,
  fixedRateExchangeAddress: EXCHANGE,
  dispenserAddress: DISPENSER
} as Config

/** 10.5 base tokens for the purchase. */
const price: OrderPrice = {
  total: '10.5',
  baseTokenAmount: '10.5',
  opcFee: '0',
  publishMarketFee: '1',
  consumeMarketFee: '0'
}

/** A publish-market fee of 1 token (1e18 base units) in `token`. */
function publishFeeIn(token: string): PricingInfo['publishMarketFee'] {
  return {
    publishMarketFeeAddress: PUBLISH_MARKET,
    publishMarketFeeToken: token,
    publishMarketFeeAmount: ONE.toString()
  }
}

const NO_PUBLISH_FEE = {
  publishMarketFeeAddress: ZERO_ADDRESS,
  publishMarketFeeToken: ZERO_ADDRESS,
  publishMarketFeeAmount: '0'
}

/** A provider fee of 2 tokens (2e18 base units) in `token`. */
function providerFeeIn(token: string) {
  return signedProviderFee({
    providerFeeToken: token,
    providerFeeAmount: (2n * ONE).toString()
  })
}

function fixed(
  templateId: number,
  publishMarketFee: PricingInfo['publishMarketFee']
): PricingInfo {
  return {
    schema: 'fixed',
    templateId,
    datatokenAddress: DATATOKEN,
    exchangeId: '0xlive',
    baseTokenAddress: BASE_TOKEN,
    baseTokenDecimals: 18,
    publishMarketFee
  }
}

/** Makes a mocked ocean.js class construct the given instance on every `new`. */
function constructs<T>(mocked: { mockImplementation: unknown }, instance: T) {
  ;(mocked.mockImplementation as (fn: () => T) => void)(function (this: void) {
    return instance
  })
}

function transaction(hash: string) {
  return { wait: async () => ({ hash }) }
}

/** Stubs every order call, recording the order in which they and the approvals ran. */
function mockChain() {
  const datatoken = {
    buyFromFreAndOrder: vi.fn(async () => transaction('0xatomic')),
    buyFromDispenserAndOrder: vi.fn(async () => transaction('0xdispensed')),
    startOrder: vi.fn(async () => transaction('0xstarted')),
    reuseOrder: vi.fn(async () => transaction('0xreused'))
  }
  const exchange = { buyDatatokens: vi.fn(async () => transaction('0xbuy')) }
  const dispenser = { dispense: vi.fn(async () => transaction('0xdispense')) }

  constructs(vi.mocked(Datatoken), datatoken)
  constructs(vi.mocked(FixedRateExchange), exchange)
  constructs(vi.mocked(Dispenser), dispenser)

  return { datatoken, exchange, dispenser }
}

/** Every approval sent, as (token, spender, amount, units). */
function approvals() {
  return [
    ...vi.mocked(approve).mock.calls.map((call) => ({
      token: call[3],
      spender: call[4],
      amount: call[5],
      units: 'human'
    })),
    ...vi.mocked(approveWei).mock.calls.map((call) => ({
      token: call[3],
      spender: call[4],
      amount: call[5],
      units: 'wei'
    }))
  ]
}

function placeOrder(
  pricing: PricingInfo,
  providerFees = providerFeeIn(FEE_TOKEN)
) {
  return order({
    signer,
    config: chainConfig,
    pricing,
    price,
    serviceIndex: 0,
    providerFees,
    consumer: CONSUMER,
    ...ANY_FEE
  })
}

beforeEach(() => {
  vi.mocked(approve)
    .mockReset()
    .mockResolvedValue(transaction('0xapprove') as never)
  vi.mocked(approveWei)
    .mockReset()
    .mockResolvedValue({ hash: '0xapproval' } as never)
  vi.mocked(allowanceWei).mockReset().mockResolvedValue('0')
  vi.mocked(Datatoken).mockReset()
  vi.mocked(Dispenser).mockReset()
  vi.mocked(FixedRateExchange).mockReset()
})

describe('order() allowances', () => {
  it('approves provider and publish fee in one token once, for their sum (template 1)', async () => {
    // The case that reverted: the provider fee was approved to the datatoken first, then
    // the publish-market fee replaced that allowance, and startOrder ran short after the
    // datatoken had been bought.
    const { exchange, datatoken } = mockChain()

    await placeOrder(fixed(1, publishFeeIn(FEE_TOKEN)))

    expect(approvals()).to.deep.equal([
      { token: BASE_TOKEN, spender: EXCHANGE, amount: '10.5', units: 'human' },
      {
        token: FEE_TOKEN,
        spender: DATATOKEN,
        amount: (3n * ONE).toString(),
        units: 'wei'
      }
    ])
    expect(exchange.buyDatatokens).toHaveBeenCalledOnce()
    expect(datatoken.startOrder).toHaveBeenCalledOnce()
  })

  it('does the same on the atomic templates, beside the purchase in another token', async () => {
    mockChain()

    await placeOrder(fixed(2, publishFeeIn(FEE_TOKEN)))

    expect(approvals()).to.deep.equal([
      { token: BASE_TOKEN, spender: DATATOKEN, amount: '10.5', units: 'human' },
      {
        token: FEE_TOKEN,
        spender: DATATOKEN,
        amount: (3n * ONE).toString(),
        units: 'wei'
      }
    ])
  })

  it('folds a provider fee in the base token into the purchase allowance (templates 2 and 4)', async () => {
    // The datatoken pulls the purchase, the publish-market fee and the provider fee: one
    // allowance for all three.
    for (const templateId of [2, 4]) {
      vi.mocked(approve).mockClear()
      vi.mocked(approveWei).mockClear()
      const { datatoken } = mockChain()

      await placeOrder(
        fixed(templateId, publishFeeIn(BASE_TOKEN)),
        providerFeeIn(BASE_TOKEN)
      )

      expect(approvals()).to.deep.equal([
        // 10.5 + 1 + 2, in human units, with the decimals to convert them.
        {
          token: BASE_TOKEN,
          spender: DATATOKEN,
          amount: '13.5',
          units: 'human'
        }
      ])
      expect(vi.mocked(approve).mock.calls[0][7]).to.equal(18)
      // The quote the exchange is held to stays the purchase alone.
      const [, , freParams] = datatoken.buyFromFreAndOrder.mock
        .calls[0] as unknown as [
        unknown,
        unknown,
        { maxBaseTokenAmount: string }
      ]
      expect(freParams.maxBaseTokenAmount).to.equal('10.5')
    }
  })

  it('keeps a provider fee in the base token apart from a purchase approved to the exchange (template 1)', async () => {
    mockChain()

    await placeOrder(
      fixed(1, publishFeeIn(OTHER_TOKEN)),
      providerFeeIn(BASE_TOKEN)
    )

    expect(approvals()).to.deep.equal([
      { token: BASE_TOKEN, spender: EXCHANGE, amount: '10.5', units: 'human' },
      {
        token: OTHER_TOKEN,
        spender: DATATOKEN,
        amount: ONE.toString(),
        units: 'wei'
      },
      {
        token: BASE_TOKEN,
        spender: DATATOKEN,
        amount: (2n * ONE).toString(),
        units: 'wei'
      }
    ])
  })

  it('approves three different tokens separately, each as before', async () => {
    mockChain()

    await placeOrder(
      fixed(2, publishFeeIn(OTHER_TOKEN)),
      providerFeeIn(FEE_TOKEN)
    )

    expect(approvals()).to.deep.equal([
      { token: BASE_TOKEN, spender: DATATOKEN, amount: '10.5', units: 'human' },
      {
        token: OTHER_TOKEN,
        spender: DATATOKEN,
        amount: ONE.toString(),
        units: 'wei'
      },
      {
        token: FEE_TOKEN,
        spender: DATATOKEN,
        amount: (2n * ONE).toString(),
        units: 'wei'
      }
    ])
  })

  it('compares a standing allowance with the sum, not with one fee', async () => {
    mockChain()

    // Covers the publish-market fee alone, but not both fees.
    vi.mocked(allowanceWei).mockResolvedValue(ONE.toString())
    await placeOrder(fixed(1, publishFeeIn(FEE_TOKEN)))
    expect(vi.mocked(approveWei)).toHaveBeenCalledOnce()
    expect(vi.mocked(approveWei).mock.calls[0][5]).to.equal(
      (3n * ONE).toString()
    )

    vi.mocked(approveWei).mockClear()
    vi.mocked(allowanceWei).mockResolvedValue((3n * ONE).toString())
    await placeOrder(fixed(1, publishFeeIn(FEE_TOKEN)))
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('approves the provider fee on a dispenser order, with the publish-market fee', async () => {
    const { dispenser, datatoken } = mockChain()

    await placeOrder({
      schema: 'free',
      templateId: 1,
      datatokenAddress: DATATOKEN,
      publishMarketFee: publishFeeIn(FEE_TOKEN)
    })

    expect(approvals()).to.deep.equal([
      {
        token: FEE_TOKEN,
        spender: DATATOKEN,
        amount: (3n * ONE).toString(),
        units: 'wei'
      }
    ])
    expect(dispenser.dispense).toHaveBeenCalledOnce()
    expect(datatoken.startOrder).toHaveBeenCalledOnce()
  })

  it('approves nothing for a fee the datatoken does not charge', async () => {
    // `_checkProviderFee` transfers only a non-zero amount in a real token.
    mockChain()

    await placeOrder(
      fixed(2, NO_PUBLISH_FEE),
      signedProviderFee({ providerFeeAmount: '0' })
    )
    await placeOrder(
      fixed(2, NO_PUBLISH_FEE),
      signedProviderFee({ providerFeeToken: ZERO_ADDRESS })
    )

    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('names both fees when their shared approval fails', async () => {
    mockChain()
    vi.mocked(approveWei).mockResolvedValue(null as never)

    await expectThrowsAsync(
      () => placeOrder(fixed(1, publishFeeIn(FEE_TOKEN))),
      /could not approve the publish-market fee and provider fee/i
    )
  })
})

describe('order() checks everything before the first approval', () => {
  it('refuses a missing provider fee before any approval or contract', async () => {
    mockChain()

    const thrown = await order({
      signer,
      config: chainConfig,
      pricing: fixed(1, publishFeeIn(FEE_TOKEN)),
      price,
      serviceIndex: 0,
      providerFees: undefined as never,
      consumer: CONSUMER,
      ...ANY_FEE
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(approvals()).to.deep.equal([])
    expect(vi.mocked(Datatoken)).not.toHaveBeenCalled()
  })

  it('refuses a partial provider fee before any approval', async () => {
    mockChain()
    const { validUntil: _until, ...partial } = providerFeeIn(FEE_TOKEN)

    await expectThrowsAsync(
      () => placeOrder(fixed(1, NO_PUBLISH_FEE), partial as never),
      /missing validUntil/
    )
    expect(approvals()).to.deep.equal([])
  })

  it('refuses a rejected signature before any approval', async () => {
    mockChain()

    await expectThrowsAsync(
      () => placeOrder(fixed(1, NO_PUBLISH_FEE), poisonedProviderFee()),
      /signature check/
    )
    expect(approvals()).to.deep.equal([])
  })

  it.each([
    ['no exchange id', { exchangeId: undefined }, /no exchange id/],
    ['no base token', { baseTokenAddress: undefined }, /base token/]
  ])(
    'refuses fixed pricing with %s before approving the provider fee',
    async (_name, change, error) => {
      mockChain()

      await expectThrowsAsync(
        () => placeOrder({ ...fixed(1, NO_PUBLISH_FEE), ...change }),
        error
      )
      expect(approvals()).to.deep.equal([])
    }
  )

  it('refuses a chain config without the exchange before any approval', async () => {
    mockChain()

    await expectThrowsAsync(
      () =>
        order({
          signer,
          config: {
            ...chainConfig,
            fixedRateExchangeAddress: undefined
          } as never,
          pricing: fixed(1, NO_PUBLISH_FEE),
          price,
          serviceIndex: 0,
          providerFees: providerFeeIn(FEE_TOKEN),
          consumer: CONSUMER,
          ...ANY_FEE
        }),
      /no fixedRateExchangeAddress/
    )
    expect(approvals()).to.deep.equal([])
  })

  it('refuses a fee with no collector before any approval', async () => {
    mockChain()

    await expectThrowsAsync(
      () =>
        order({
          signer,
          config: chainConfig,
          pricing: fixed(1, NO_PUBLISH_FEE),
          price: { ...price, consumeMarket: { address: '', fee: '0.02' } },
          serviceIndex: 0,
          providerFees: providerFeeIn(FEE_TOKEN),
          consumer: CONSUMER,
          ...ANY_FEE
        }),
      /no collector address/
    )
    expect(approvals()).to.deep.equal([])
  })

  it('refuses a free order without a dispenser before approving the fees', async () => {
    mockChain()

    await expectThrowsAsync(
      () =>
        order({
          signer,
          config: { ...chainConfig, dispenserAddress: undefined } as never,
          pricing: {
            schema: 'free',
            templateId: 1,
            datatokenAddress: DATATOKEN,
            publishMarketFee: publishFeeIn(FEE_TOKEN)
          },
          price,
          serviceIndex: 0,
          providerFees: providerFeeIn(FEE_TOKEN),
          consumer: CONSUMER,
          ...ANY_FEE
        }),
      /no dispenserAddress/
    )
    expect(approvals()).to.deep.equal([])
  })

  it('refuses pricing that cannot be ordered before approving the provider fee', async () => {
    mockChain()

    await expectThrowsAsync(
      () =>
        placeOrder({
          schema: 'none',
          templateId: 1,
          datatokenAddress: DATATOKEN,
          publishMarketFee: NO_PUBLISH_FEE
        }),
      /neither a fixed-rate exchange nor a dispenser/
    )
    expect(approvals()).to.deep.equal([])
  })
})

describe('order() payer', () => {
  // The datatoken and the exchange pull every amount from msg.sender, and the signer sends
  // the approvals. An allowance held by another `payer` used to skip the merged purchase
  // approval on templates 2 and 4, and buyFromFreAndOrder then reverted on the shortfall.
  const OTHER_PAYER = '0x6666666666666666666666666666666666666666'

  it('refuses a payer other than the signer before any allowance read or approval', async () => {
    for (const pricing of [
      fixed(1, publishFeeIn(FEE_TOKEN)),
      fixed(2, publishFeeIn(BASE_TOKEN)),
      fixed(4, NO_PUBLISH_FEE),
      {
        schema: 'free',
        templateId: 1,
        datatokenAddress: DATATOKEN,
        publishMarketFee: NO_PUBLISH_FEE
      } as PricingInfo
    ]) {
      mockChain()

      await expectThrowsAsync(
        () =>
          order({
            signer,
            config: chainConfig,
            pricing,
            price,
            serviceIndex: 0,
            providerFees: providerFeeIn(BASE_TOKEN),
            consumer: CONSUMER,
            payer: OTHER_PAYER,
            ...ANY_FEE
          }),
        new RegExp(
          `The payer ${OTHER_PAYER} is not the signer ${CONSUMER}.*signed by the account that pays`
        )
      )
      expect(approvals()).to.deep.equal([])
      expect(vi.mocked(allowanceWei)).not.toHaveBeenCalled()
      expect(vi.mocked(Datatoken)).not.toHaveBeenCalled()
    }
  })

  it("checks the signer's own allowance for the merged purchase, whatever the payer's spelling", async () => {
    const checksummed = getAddress('0xabcdef00000000000000000000000000000000ab')
    const mixedCaseSigner = {
      getAddress: async () => checksummed
    } as unknown as Signer
    const { datatoken } = mockChain()

    await order({
      signer: mixedCaseSigner,
      config: chainConfig,
      pricing: fixed(2, publishFeeIn(BASE_TOKEN)),
      price,
      serviceIndex: 0,
      providerFees: providerFeeIn(BASE_TOKEN),
      consumer: CONSUMER,
      payer: checksummed.toLowerCase(),
      ...ANY_FEE
    })

    // ocean.js's approve compares the allowance of this account before it approves.
    expect(vi.mocked(approve).mock.calls.map((call) => call[2])).to.deep.equal([
      checksummed
    ])
    expect(datatoken.buyFromFreAndOrder).toHaveBeenCalledOnce()
  })
})

describe('reuseOrder() allowance', () => {
  function extend(providerFees: unknown) {
    return reuseOrder({
      signer,
      config: chainConfig,
      datatokenAddress: DATATOKEN,
      validOrderTx: '0xexisting',
      providerFees: providerFees as never,
      ...ANY_FEE
    })
  }

  it('approves the datatoken for the new fee, in wei, before reusing the order', async () => {
    // `_checkProviderFee` pulls the fee with `transferFrom`, and ocean.js's reuseOrder
    // approves nothing, so without this any non-zero provider fee reverts.
    const { datatoken } = mockChain()

    const result = await extend(providerFeeIn(FEE_TOKEN))

    expect(vi.mocked(approveWei)).toHaveBeenCalledWith(
      signer,
      chainConfig,
      CONSUMER,
      FEE_TOKEN,
      DATATOKEN,
      (2n * ONE).toString(),
      true
    )
    expect(vi.mocked(approveWei).mock.invocationCallOrder[0]).to.be.lessThan(
      datatoken.reuseOrder.mock.invocationCallOrder[0]
    )
    expect(result).to.deep.equal({ transferTxId: '0xreused', reused: true })
  })

  it('skips the approval when the fee is zero or a standing allowance covers it', async () => {
    mockChain()

    await extend(signedProviderFee({ providerFeeAmount: '0' }))
    vi.mocked(allowanceWei).mockResolvedValue((2n * ONE).toString())
    await extend(providerFeeIn(FEE_TOKEN))

    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('surfaces an approval ocean.js swallowed', async () => {
    // `approveWei` catches a failed send, logs it and returns null; left alone, the
    // failure would only surface as the order reverting on a missing allowance.
    const { datatoken } = mockChain()
    vi.mocked(approveWei).mockResolvedValue(null as never)

    await expectThrowsAsync(
      () => extend(providerFeeIn(FEE_TOKEN)),
      /could not approve the provider fee/i
    )
    expect(datatoken.reuseOrder).not.toHaveBeenCalled()
  })

  it('refuses a missing or partial fee before the approval', async () => {
    const { datatoken } = mockChain()
    const { providerFeeAmount: _amount, ...partial } = providerFeeIn(FEE_TOKEN)

    await expectThrowsAsync(() => extend(undefined), /there is no provider fee/)
    await expectThrowsAsync(() => extend(partial), /missing providerFeeAmount/)

    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(datatoken.reuseOrder).not.toHaveBeenCalled()
  })
})

describe('order() and reuseOrder() pay only an allowed provider fee', () => {
  // The node chooses the fee's token and amount; a valid signature only proves it signed
  // them. Direct callers of order()/reuseOrder() get the same consent rule as access().
  const fee = providerFeeIn(FEE_TOKEN) // 2 tokens

  function orderWith(limits: object, providerFees: unknown = fee) {
    return order({
      signer,
      config: chainConfig,
      pricing: fixed(1, NO_PUBLISH_FEE),
      price,
      serviceIndex: 0,
      providerFees: providerFees as never,
      consumer: CONSUMER,
      ...limits
    })
  }

  function reuseWith(limits: object) {
    return reuseOrder({
      signer,
      config: chainConfig,
      datatokenAddress: DATATOKEN,
      validOrderTx: '0xexisting',
      providerFees: fee,
      ...limits
    })
  }

  it('refuses a non-zero fee without a ceiling or confirmation, before any approval', async () => {
    const { exchange, datatoken } = mockChain()

    const thrown = await orderWith({}).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(thrown.reason).to.equal('no-limit')
    expect(thrown.fees).to.deep.equal([
      {
        token: FEE_TOKEN,
        amount: 2n * ONE,
        collector: fee.providerFeeAddress,
        datatoken: DATATOKEN
      }
    ])
    expect(thrown.message).to.match(/Nothing was spent/)
    expect(approvals()).to.deep.equal([])
    expect(exchange.buyDatatokens).not.toHaveBeenCalled()
    expect(datatoken.startOrder).not.toHaveBeenCalled()
  })

  it('refuses a fee over the ceiling, or in a token the ceiling does not list', async () => {
    mockChain()

    for (const maxProviderFee of [
      { token: FEE_TOKEN, amount: 2n * ONE - 1n },
      [{ token: OTHER_TOKEN, amount: 100n * ONE }]
    ]) {
      const thrown = await orderWith({ maxProviderFee }).catch(
        (caught) => caught
      )
      expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
      expect(thrown.reason).to.equal('over-limit')
    }

    expect(approvals()).to.deep.equal([])
  })

  it('pays a fee within the ceiling, approving exactly the fee', async () => {
    const { datatoken } = mockChain()

    // Exactly at the ceiling, given as a decimal string with the token in lower case.
    await orderWith({
      maxProviderFee: {
        token: FEE_TOKEN.toLowerCase(),
        amount: (2n * ONE).toString()
      }
    })

    expect(approvals()).to.deep.equal([
      { token: BASE_TOKEN, spender: EXCHANGE, amount: '10.5', units: 'human' },
      {
        token: FEE_TOKEN,
        spender: DATATOKEN,
        amount: (2n * ONE).toString(),
        units: 'wei'
      }
    ])
    expect(datatoken.startOrder).toHaveBeenCalledOnce()
  })

  it('asks confirmProviderFees when the ceiling does not cover the fee, and follows it', async () => {
    mockChain()
    const confirm = vi.fn(async () => true)

    await orderWith({
      maxProviderFee: { token: FEE_TOKEN, amount: 1n },
      confirmProviderFees: confirm
    })

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]).to.deep.equal([
      [
        {
          token: FEE_TOKEN,
          amount: 2n * ONE,
          collector: fee.providerFeeAddress,
          datatoken: DATATOKEN
        }
      ]
    ])
    expect(vi.mocked(approveWei)).toHaveBeenCalledOnce()

    vi.mocked(approve).mockClear()
    vi.mocked(approveWei).mockClear()
    const declined = await orderWith({
      confirmProviderFees: () => false
    }).catch((caught) => caught)

    expect(declined).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(declined.reason).to.equal('declined')
    expect(approvals()).to.deep.equal([])
  })

  it('does not ask about a fee within the ceiling', async () => {
    mockChain()
    const confirm = vi.fn(() => false)

    await orderWith({
      maxProviderFee: { token: FEE_TOKEN, amount: 2n * ONE },
      confirmProviderFees: confirm
    })

    expect(confirm).not.toHaveBeenCalled()
  })

  it('pays a zero fee, or one the datatoken does not charge, without any consent', async () => {
    mockChain()
    const confirm = vi.fn(() => false)

    await orderWith(
      { confirmProviderFees: confirm },
      signedProviderFee({ providerFeeAmount: '0' })
    )
    await orderWith(
      { confirmProviderFees: confirm },
      signedProviderFee({ providerFeeToken: ZERO_ADDRESS })
    )

    expect(confirm).not.toHaveBeenCalled()
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
  })

  it('surfaces a throwing confirmProviderFees, before any approval', async () => {
    mockChain()

    await expectThrowsAsync(
      () =>
        orderWith({
          confirmProviderFees: () => {
            throw new Error('the user closed the dialog')
          }
        }),
      /closed the dialog/
    )
    expect(approvals()).to.deep.equal([])
  })

  it('refuses a malformed ceiling before any approval', async () => {
    mockChain()

    await expectThrowsAsync(
      () => orderWith({ maxProviderFee: { token: 'nope', amount: 1n } }),
      /maxProviderFee: every entry needs a token address/
    )
    await expectThrowsAsync(
      () => orderWith({ maxProviderFee: { token: FEE_TOKEN, amount: '1.5' } }),
      /non-negative integer/
    )
    await expectThrowsAsync(
      () => orderWith({ maxProviderFee: { token: FEE_TOKEN, amount: -1n } }),
      /non-negative integer/
    )
    await expectThrowsAsync(
      () =>
        orderWith({
          maxProviderFee: [
            { token: FEE_TOKEN, amount: 1n },
            { token: FEE_TOKEN.toLowerCase(), amount: 2n }
          ]
        }),
      /listed twice/
    )
    expect(approvals()).to.deep.equal([])
  })

  it('applies the same rule to reuseOrder()', async () => {
    const { datatoken } = mockChain()

    const thrown = await reuseWith({}).catch((caught) => caught)
    expect(thrown).to.be.instanceOf(ProviderFeeNotAllowedError)
    expect(vi.mocked(approveWei)).not.toHaveBeenCalled()
    expect(datatoken.reuseOrder).not.toHaveBeenCalled()

    await reuseWith({ maxProviderFee: { token: FEE_TOKEN, amount: 2n * ONE } })
    expect(vi.mocked(approveWei).mock.calls[0][5]).to.equal(
      (2n * ONE).toString()
    )
    expect(datatoken.reuseOrder).toHaveBeenCalledOnce()
  })
})
