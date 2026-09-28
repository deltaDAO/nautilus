/**
 * Unit conversion at the ocean.js call boundary.
 *
 * ocean.js is inconsistent about who converts human-readable amounts to token units:
 * the `NftFactory` bundle methods convert (`getFreCreationParams`,
 * `createNftWithDatatokenWithDispenserTx`), while the standalone `Datatoken.createFixedRate`
 * and `Datatoken.createDispenser` forward values raw to the contract — and the `approve`
 * util converts internally, expecting human units. These tests pin that nautilus converts
 * exactly where ocean.js does not, and only there.
 */
import {
  approve,
  type Config,
  Datatoken,
  Nft,
  type ProviderFees,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import { parseUnits, type Signer } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { createDatatokenForService } from '../../src/publish/index.js'
import { order } from '../../src/utils/order.js'
import type { OrderPrice, PricingInfo } from '../../src/utils/pricing.js'

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oceanprotocol/lib')>()

  return {
    ...actual,
    approve: vi.fn(),
    Datatoken: vi.fn(),
    Nft: vi.fn()
  }
})

/** A minimal `TransactionResponse` that satisfies `confirmTransaction`. */
function transactionLike() {
  return { wait: async () => ({ hash: '0xreceipt' }) }
}

/**
 * Makes a mocked ocean.js class construct the given instance. The implementation must be
 * a regular function — arrow functions cannot be `new`ed.
 */
function constructs<T>(mocked: { mockImplementation: unknown }, instance: T) {
  ;(mocked.mockImplementation as (fn: () => T) => void)(function (this: void) {
    return instance
  })
}

const signer = {} as Signer

const chainConfig = {
  chainId: 32456,
  fixedRateExchangeAddress: '0x1111111111111111111111111111111111111111',
  dispenserAddress: '0x2222222222222222222222222222222222222222'
} as Config

const noPublishMarketFee = {
  publishMarketFeeAddress: ZERO_ADDRESS,
  publishMarketFeeToken: ZERO_ADDRESS,
  publishMarketFeeAmount: '0'
}

beforeEach(() => {
  vi.mocked(approve).mockReset()
  vi.mocked(Datatoken).mockReset()
  vi.mocked(Nft).mockReset()
})

describe('order approveSpend', () => {
  const pricing: PricingInfo = {
    schema: 'fixed',
    // Template 2 orders atomically, so the datatoken itself is the spender and no
    // FixedRateExchange instance is needed.
    templateId: 2,
    datatokenAddress: '0x3333333333333333333333333333333333333333',
    exchangeId: '0xexchange',
    baseTokenAddress: '0x4444444444444444444444444444444444444444',
    baseTokenDecimals: 6,
    publishMarketFee: noPublishMarketFee
  }

  const price: OrderPrice = {
    total: '12.5',
    baseTokenAmount: '12.5',
    opcFee: '0',
    publishMarketFee: '0',
    consumeMarketFee: '0'
  }

  function mockAtomicDatatoken() {
    const buyFromFreAndOrder = vi.fn().mockResolvedValue(transactionLike())

    constructs(vi.mocked(Datatoken), { buyFromFreAndOrder })

    return buyFromFreAndOrder
  }

  function placeOrder() {
    return order({
      signer,
      config: chainConfig,
      pricing,
      price,
      serviceIndex: 0,
      providerFees: {} as ProviderFees,
      consumer: '0x5555555555555555555555555555555555555555',
      payer: '0x6666666666666666666666666666666666666666'
    })
  }

  it('passes the human-unit amount and the token decimals to approve', async () => {
    mockAtomicDatatoken()
    vi.mocked(approve).mockResolvedValue(
      transactionLike() as unknown as Awaited<ReturnType<typeof approve>>
    )

    await placeOrder()

    // ocean.js's `approve` converts internally, so it must get '12.5' — not
    // parseUnits('12.5', 6) — plus the decimals to convert with. A wei amount here
    // inflated the allowance by 10^decimals and defeated approve's allowance check.
    expect(approve).toHaveBeenCalledWith(
      signer,
      chainConfig,
      '0x6666666666666666666666666666666666666666',
      pricing.baseTokenAddress,
      pricing.datatokenAddress,
      '12.5',
      false,
      6
    )
  })

  it('accepts approve short-circuiting on a sufficient allowance', async () => {
    const buyFromFreAndOrder = mockAtomicDatatoken()

    // `approve` returns the existing allowance as a number instead of a transaction.
    vi.mocked(approve).mockResolvedValue(100)

    const result = await placeOrder()

    expect(result).to.deep.equal({ transferTxId: '0xreceipt', reused: false })
    expect(buyFromFreAndOrder).toHaveBeenCalledOnce()
  })
})

describe('createDatatokenForService pricing units', () => {
  function mockNftAndDatatoken() {
    constructs(vi.mocked(Nft), {
      createDatatoken: vi
        .fn()
        .mockResolvedValue('0x7777777777777777777777777777777777777777')
    })

    const createFixedRate = vi.fn().mockResolvedValue(transactionLike())
    const createDispenser = vi.fn().mockResolvedValue(transactionLike())

    constructs(vi.mocked(Datatoken), { createFixedRate, createDispenser })

    return { createFixedRate, createDispenser }
  }

  function serviceWith(pricing: unknown) {
    return {
      name: 'test service',
      id: 'test-id',
      pricing,
      datatokenCreateParams: {
        mpFeeAddress: ZERO_ADDRESS,
        feeToken: ZERO_ADDRESS,
        feeAmount: '0',
        cap: '115792089237316195423570985008687907853269984665640564039457',
        name: 'Datatoken',
        symbol: 'DT1',
        templateIndex: 2
      }
    } as unknown as NautilusService<ServiceTypes, FileTypes>
  }

  const owner = '0x8888888888888888888888888888888888888888'

  it('converts fixedRate and marketFee with the datatoken decimals', async () => {
    const { createFixedRate } = mockNftAndDatatoken()

    // Non-18 decimals to prove the conversion uses datatokenDecimals, exactly like
    // NftFactory.getFreCreationParams on the first-service path.
    await createDatatokenForService({
      signer,
      chainConfig,
      nftAddress: '0x9999999999999999999999999999999999999999',
      service: serviceWith({
        type: 'fixed',
        freCreationParams: {
          fixedRateAddress: chainConfig.fixedRateExchangeAddress,
          baseTokenAddress: '0x4444444444444444444444444444444444444444',
          marketFeeCollector: owner,
          baseTokenDecimals: 6,
          datatokenDecimals: 6,
          fixedRate: '10',
          marketFee: '0.01'
        }
      }),
      owner
    })

    expect(createFixedRate).toHaveBeenCalledWith(
      '0x7777777777777777777777777777777777777777',
      owner,
      expect.objectContaining({
        owner,
        fixedRate: parseUnits('10', 6).toString(),
        marketFee: parseUnits('0.01', 6).toString()
      })
    )
  })

  it('converts dispenser defaults and overrides to 18-decimal units', async () => {
    const { createDispenser } = mockNftAndDatatoken()

    await createDatatokenForService({
      signer,
      chainConfig,
      nftAddress: '0x9999999999999999999999999999999999999999',
      // The user override is in human units, like the defaults.
      service: serviceWith({
        type: 'free',
        dispenserParams: { maxTokens: '2' }
      }),
      owner
    })

    expect(createDispenser).toHaveBeenCalledWith(
      '0x7777777777777777777777777777777777777777',
      owner,
      chainConfig.dispenserAddress,
      {
        maxTokens: parseUnits('2', 18).toString(),
        maxBalance: parseUnits('100000000', 18).toString(),
        withMint: true,
        allowedSwapper: ZERO_ADDRESS
      }
    )
  })
})
