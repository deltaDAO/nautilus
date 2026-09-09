/**
 * Which exchange a price comes from, and where the fees on it end up.
 *
 * Three findings live here, all of them invisible to the type checker:
 *
 *   - `getFixedRates()` is a history, so entry zero is regularly a *deactivated* exchange.
 *     Pricing off it pointed orders at an exchange that reverts, and hid a live dispenser.
 *   - the consume-market fee was quoted as an absolute amount, added to a total that
 *     already contained it, and then paid to the *publish* market's collector.
 *   - `|| 18` turned a legitimate 0-decimal base token back into 18 decimals.
 */
import {
  approve,
  type Config,
  Datatoken,
  FixedRateExchange,
  type ProviderFees,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { order } from '../../src/utils/order.js'
import {
  getOrderPrice,
  getPricingInfo,
  type OrderPrice,
  type PricingInfo
} from '../../src/utils/pricing.js'
import { expectThrowsAsync } from '../helpers.js'

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oceanprotocol/lib')>()

  return {
    ...actual,
    approve: vi.fn(async () => 1),
    Datatoken: vi.fn(),
    FixedRateExchange: vi.fn()
  }
})

const DATATOKEN = '0x3333333333333333333333333333333333333333'
const BASE_TOKEN = '0x4444444444444444444444444444444444444444'
const PUBLISH_MARKET = '0x5555555555555555555555555555555555555555'
const CONSUME_MARKET = '0x6666666666666666666666666666666666666666'
const CONSUMER = '0x7777777777777777777777777777777777777777'

const signer = {
  getAddress: async () => CONSUMER
} as unknown as Signer

const chainConfig = {
  chainId: 32456,
  fixedRateExchangeAddress: '0x1111111111111111111111111111111111111111',
  dispenserAddress: '0x2222222222222222222222222222222222222222'
} as Config

const publishMarketFee = {
  publishMarketFeeAddress: PUBLISH_MARKET,
  publishMarketFeeToken: BASE_TOKEN,
  publishMarketFeeAmount: '0'
}

/** Makes a mocked ocean.js class construct the given instance on every `new`. */
function constructs<T>(mocked: { mockImplementation: unknown }, instance: T) {
  ;(mocked.mockImplementation as (fn: () => T) => void)(function (this: void) {
    return instance
  })
}

function exchange(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    baseToken: BASE_TOKEN,
    btDecimals: '18',
    datatoken: DATATOKEN,
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(approve)
    .mockReset()
    .mockResolvedValue(1 as never)
  vi.mocked(Datatoken).mockReset()
  vi.mocked(FixedRateExchange).mockReset()
})

describe('getPricingInfo exchange selection', () => {
  function mockChain(params: {
    fixedRates: unknown[]
    dispensers?: unknown[]
    exchanges: Record<string, Record<string, unknown>>
  }) {
    constructs(vi.mocked(Datatoken), {
      getId: async () => 2,
      getFixedRates: async () => params.fixedRates,
      getDispensers: async () => params.dispensers || [],
      getPublishingMarketFee: async () => publishMarketFee
    })

    const getExchange = vi.fn(async (id: string) => {
      const found = params.exchanges[id]
      if (!found) throw new Error(`unknown exchange ${id}`)
      return found
    })

    constructs(vi.mocked(FixedRateExchange), { getExchange })

    return getExchange
  }

  it('skips a deactivated exchange for the active one behind it', async () => {
    mockChain({
      fixedRates: ['0xdead', '0xlive'],
      exchanges: {
        '0xdead': exchange({ active: false, baseToken: ZERO_ADDRESS }),
        '0xlive': exchange()
      }
    })

    const pricing = await getPricingInfo(signer, DATATOKEN, chainConfig)

    expect(pricing.schema).to.equal('fixed')
    expect(pricing.exchangeId).to.equal('0xlive')
    expect(pricing.baseTokenAddress).to.equal(BASE_TOKEN)
  })

  it('falls through to the dispenser when no exchange is active', async () => {
    // The dead exchange used to win outright, so a free asset with an old fixed-rate
    // exchange on it could not be ordered at all.
    mockChain({
      fixedRates: ['0xdead'],
      dispensers: ['0xdispenser'],
      exchanges: { '0xdead': exchange({ active: false }) }
    })

    const pricing = await getPricingInfo(signer, DATATOKEN, chainConfig)

    expect(pricing.schema).to.equal('free')
  })

  it('reports no pricing when every exchange is dead and there is no dispenser', async () => {
    mockChain({
      fixedRates: ['0xdead'],
      exchanges: { '0xdead': exchange({ active: false }) }
    })

    expect(
      (await getPricingInfo(signer, DATATOKEN, chainConfig)).schema
    ).to.equal('none')
  })

  it('does not let one unreadable entry hide the rest', async () => {
    mockChain({
      fixedRates: ['0xgone', '0xlive'],
      exchanges: { '0xlive': exchange() }
    })

    expect(
      (await getPricingInfo(signer, DATATOKEN, chainConfig)).exchangeId
    ).to.equal('0xlive')
  })

  it('keeps a 0-decimal base token', async () => {
    mockChain({
      fixedRates: ['0xlive'],
      exchanges: { '0xlive': exchange({ btDecimals: '0' }) }
    })

    expect(
      (await getPricingInfo(signer, DATATOKEN, chainConfig)).baseTokenDecimals
    ).to.equal(0)
  })
})

describe('getOrderPrice consume-market fee', () => {
  const fixed: PricingInfo = {
    schema: 'fixed',
    templateId: 2,
    datatokenAddress: DATATOKEN,
    exchangeId: '0xlive',
    baseTokenAddress: BASE_TOKEN,
    baseTokenDecimals: 18,
    publishMarketFee
  }

  function mockExchangeQuote() {
    const calcBaseInGivenDatatokensOut = vi.fn(async () => ({
      // What the exchange wants in, every swap-side fee already inside it.
      baseTokenAmount: '10.5',
      oceanFeeAmount: '0.1',
      marketFeeAmount: '0.2',
      consumeMarketFeeAmount: '0.2'
    }))

    constructs(vi.mocked(FixedRateExchange), { calcBaseInGivenDatatokensOut })

    return calcBaseInGivenDatatokensOut
  }

  it('passes the fee to the exchange as a fraction and does not add it again', async () => {
    // `baseTokenAmount` already contains the consume-market fee, so adding the number back
    // on top double-counted it — and the number added was a *fraction*, not an amount.
    const calc = mockExchangeQuote()

    const price = await getOrderPrice(signer, fixed, chainConfig, {
      address: CONSUME_MARKET,
      fee: '0.02'
    })

    expect(calc).toHaveBeenCalledWith('0xlive', '1', '0.02')
    expect(price.total).to.equal('10.5')
    expect(price.consumeMarketFee).to.equal('0.2')
    expect(price.consumeMarket).to.deep.equal({
      address: CONSUME_MARKET,
      fee: '0.02'
    })
  })

  it('refuses a fee with no collector', async () => {
    mockExchangeQuote()

    await expectThrowsAsync(
      () =>
        getOrderPrice(signer, fixed, chainConfig, {
          address: ZERO_ADDRESS,
          fee: '0.02'
        }),
      /needs the address that collects it/i
    )
  })

  it('refuses a fee on pricing that cannot carry one', async () => {
    // A dispenser order has no swap for the fee to ride on, so quoting one told the caller
    // their market was being paid when nothing would pay it.
    await expectThrowsAsync(
      () =>
        getOrderPrice(signer, { ...fixed, schema: 'free' }, chainConfig, {
          address: CONSUME_MARKET,
          fee: '0.02'
        }),
      /there is no swap to take it from/i
    )
  })

  it('refuses an absolute amount passed as a fraction', async () => {
    mockExchangeQuote()

    await expectThrowsAsync(
      () =>
        getOrderPrice(signer, fixed, chainConfig, {
          address: CONSUME_MARKET,
          fee: '2.5'
        }),
      /fraction of the swap, not an amount/i
    )
  })

  it('treats a zero fee as no fee at all', async () => {
    mockExchangeQuote()

    const price = await getOrderPrice(signer, fixed, chainConfig, {
      address: ZERO_ADDRESS,
      fee: '0'
    })

    expect(price.consumeMarket).to.equal(undefined)
  })

  it('sums fees without rounding them through a double', async () => {
    // Converting each decimal string to Number first rounded any amount past 15
    // significant digits, so the total came out low and the approval it sized was short.
    const price = await getOrderPrice(
      signer,
      {
        schema: 'free',
        templateId: 1,
        datatokenAddress: DATATOKEN,
        publishMarketFee: {
          ...publishMarketFee,
          publishMarketFeeAmount: '0.123456789012345678'
        }
      },
      chainConfig
    )

    expect(price.total).to.equal('0.123456789012345678')
  })
})

describe('order fee routing', () => {
  const price: OrderPrice = {
    total: '10.5',
    baseTokenAmount: '10.5',
    opcFee: '0.1',
    publishMarketFee: '0',
    consumeMarketFee: '0.2',
    consumeMarket: { address: CONSUME_MARKET, fee: '0.02' }
  }

  function placeOrder(pricing: PricingInfo, orderPrice: OrderPrice = price) {
    return order({
      signer,
      config: chainConfig,
      pricing,
      price: orderPrice,
      serviceIndex: 0,
      providerFees: {} as ProviderFees,
      consumer: CONSUMER
    })
  }

  it('pays the swap fee to the consume market, not the publish market', async () => {
    // The publish market's collector used to be handed the caller's own cut.
    const buyFromFreAndOrder = vi
      .fn()
      .mockResolvedValue({ wait: async () => ({ hash: '0xreceipt' }) })

    constructs(vi.mocked(Datatoken), { buyFromFreAndOrder })

    await placeOrder({
      schema: 'fixed',
      templateId: 2,
      datatokenAddress: DATATOKEN,
      exchangeId: '0xlive',
      baseTokenAddress: BASE_TOKEN,
      baseTokenDecimals: 18,
      publishMarketFee
    })

    const [, , freParams] = buyFromFreAndOrder.mock.calls[0]

    expect(freParams.marketFeeAddress).to.equal(CONSUME_MARKET)
    expect(freParams.swapMarketFee).to.equal('0.02')
  })

  it('keeps a 0-decimal base token out of the 18-decimal fallback', async () => {
    const buyFromFreAndOrder = vi
      .fn()
      .mockResolvedValue({ wait: async () => ({ hash: '0xreceipt' }) })

    constructs(vi.mocked(Datatoken), { buyFromFreAndOrder })

    await placeOrder({
      schema: 'fixed',
      templateId: 2,
      datatokenAddress: DATATOKEN,
      exchangeId: '0xlive',
      baseTokenAddress: BASE_TOKEN,
      baseTokenDecimals: 0,
      publishMarketFee
    })

    const [, , freParams] = buyFromFreAndOrder.mock.calls[0]

    expect(freParams.baseTokenDecimals).to.equal(0)
  })

  it('routes the fee on the non-atomic path too', async () => {
    const startOrder = vi
      .fn()
      .mockResolvedValue({ wait: async () => ({ hash: '0xreceipt' }) })
    const buyDatatokens = vi
      .fn()
      .mockResolvedValue({ wait: async () => ({ hash: '0xbuy' }) })

    constructs(vi.mocked(Datatoken), { startOrder })
    constructs(vi.mocked(FixedRateExchange), { buyDatatokens })

    await placeOrder({
      schema: 'fixed',
      templateId: 1,
      datatokenAddress: DATATOKEN,
      exchangeId: '0xlive',
      baseTokenAddress: BASE_TOKEN,
      baseTokenDecimals: 18,
      publishMarketFee
    })

    expect(buyDatatokens).toHaveBeenCalledWith(
      '0xlive',
      '1',
      '10.5',
      CONSUME_MARKET,
      '0.02'
    )
  })

  it('refuses to order a hand-built quote whose fee has no collector', async () => {
    constructs(vi.mocked(Datatoken), {})

    await expectThrowsAsync(
      () =>
        placeOrder(
          {
            schema: 'fixed',
            templateId: 2,
            datatokenAddress: DATATOKEN,
            exchangeId: '0xlive',
            baseTokenAddress: BASE_TOKEN,
            baseTokenDecimals: 18,
            publishMarketFee
          },
          { ...price, consumeMarket: { address: '', fee: '0.02' } }
        ),
      /no collector address/i
    )
  })
})
