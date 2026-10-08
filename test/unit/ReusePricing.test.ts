/**
 * How `completePublish()` compares a reused datatoken's pricing with the service's config.
 *
 * `completePublish()` never changes existing pricing, so a datatoken priced differently
 * from its service would go live as it is: another rate, free instead of fixed, a previous
 * owner's exchange. Every difference that can be read from chain is named.
 */
import { Wallet } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import type { PricingConfigWithoutOwner } from '../../src/@types/Publish.js'
import {
  type ExistingPricing,
  pricingMismatches,
  readExistingPricing
} from '../../src/publish/reuse.js'

const OWNER = '0x1111111111111111111111111111111111111111'
const FACTORY = '0x2222222222222222222222222222222222222222'
const OTHER = '0x3333333333333333333333333333333333333333'
const BASE_TOKEN = '0x4444444444444444444444444444444444444444'
const COLLECTOR = '0x5555555555555555555555555555555555555555'
const ZERO = '0x0000000000000000000000000000000000000000'
const DATATOKEN = '0x6666666666666666666666666666666666666666'

const reads = vi.hoisted(() => ({
  exchange: {} as Record<string, unknown>,
  fees: {} as Record<string, unknown>,
  dispenser: {} as Record<string, unknown>,
  /** The contract address each reader was constructed with. */
  addresses: [] as string[]
}))

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Datatoken: class {
      async getPaymentCollector() {
        return OWNER
      }
    },
    FixedRateExchange: class {
      constructor(address: string) {
        reads.addresses.push(address)
      }
      async getExchange(exchangeId: string) {
        return { ...reads.exchange, exchangeId }
      }
      async getFeesInfo() {
        return reads.fees
      }
    },
    Dispenser: class {
      constructor(address: string) {
        reads.addresses.push(address)
      }
      async status() {
        return reads.dispenser
      }
    }
  }
})

const freCreationParams = {
  fixedRateAddress: OTHER,
  baseTokenAddress: BASE_TOKEN,
  baseTokenDecimals: 18,
  datatokenDecimals: 18,
  fixedRate: '10',
  marketFee: '0.01',
  marketFeeCollector: COLLECTOR
}

const fixed: PricingConfigWithoutOwner = { type: 'fixed', freCreationParams }

/** The exchange `publish()` creates for `fixed`, as the readers report it. */
const exchange: ExistingPricing = {
  schema: 'fixed',
  exchangeId: '0x01',
  exchangeOwner: OWNER,
  baseToken: BASE_TOKEN,
  fixedRate: '10.0',
  marketFee: '0.01',
  marketFeeCollector: COLLECTOR,
  allowedSwapper: ZERO,
  withMint: true,
  paymentCollector: OWNER
}

/** The dispenser `publish()` creates for `{ type: 'free' }`. */
const dispenser: ExistingPricing = {
  schema: 'free',
  active: true,
  owner: OWNER,
  maxTokens: '1.0',
  maxBalance: '100000000.0',
  allowedSwapper: ZERO,
  isMinter: true,
  paymentCollector: OWNER
}

const compare = (
  pricing: PricingConfigWithoutOwner | undefined,
  existing: ExistingPricing
) =>
  pricingMismatches({
    pricing,
    existing,
    owner: OWNER,
    nftFactoryAddress: FACTORY
  })

describe('pricingMismatches', () => {
  it('finds none for the pricing publish() creates', () => {
    expect(compare(fixed, exchange)).to.deep.equal([])
    expect(compare({ type: 'free' }, dispenser)).to.deep.equal([])
    // Addresses in another case are the same addresses.
    expect(
      compare(fixed, {
        ...exchange,
        baseToken: BASE_TOKEN.toUpperCase().replace('0X', '0x')
      })
    ).to.deep.equal([])
  })

  it('names another pricing scheme and stops there', () => {
    expect(compare(fixed, dispenser)).to.deep.equal([
      "it is priced 'free', the service 'fixed'"
    ])
    expect(compare({ type: 'free' }, exchange)).to.deep.equal([
      "it is priced 'fixed', the service 'free'"
    ])
  })

  it('names every difference of a fixed-rate exchange', () => {
    const mismatches = compare(fixed, {
      ...exchange,
      exchangeOwner: OTHER,
      baseToken: OTHER,
      fixedRate: '1.0',
      marketFee: '0.0',
      marketFeeCollector: OTHER,
      allowedSwapper: OTHER,
      withMint: false,
      paymentCollector: OTHER
    })

    expect(mismatches).to.have.length(8)
    for (const what of [
      'the payment collector',
      'the exchange owner',
      'the base token',
      'the rate is 1.0, the service wants 10',
      'the market fee',
      'the market fee collector',
      'the allowed consumer',
      'withMint is false'
    ])
      expect(mismatches.some((entry) => entry.startsWith(what))).to.equal(true)
  })

  it('compares the rate in the units both publish paths create it with', () => {
    // The exchange reports with 18 decimals; a 6-decimal datatoken's rate is scaled with 6.
    const six = {
      ...fixed,
      freCreationParams: {
        ...freCreationParams,
        datatokenDecimals: 6,
        marketFee: '0'
      }
    }

    expect(
      compare(six, {
        ...exchange,
        fixedRate: '0.00000000001',
        marketFee: '0.0'
      })
    ).to.deep.equal([])
    expect(compare(six, { ...exchange, marketFee: '0.0' })).to.have.length(1)
  })

  it('names every difference of a dispenser', () => {
    const mismatches = compare(
      { type: 'free' },
      {
        ...dispenser,
        active: false,
        owner: OTHER,
        maxTokens: '5.0',
        maxBalance: '1.0',
        allowedSwapper: OTHER,
        isMinter: false
      }
    )

    expect(mismatches).to.deep.equal([
      'the dispenser is not active',
      `the dispenser owner is ${OTHER}, the service wants ${OWNER}`,
      'maxTokens is 5.0, the service wants 1',
      'maxBalance is 1.0, the service wants 100000000',
      `the allowed swapper is ${OTHER}, the service wants ${ZERO}`,
      'the dispenser cannot mint, the service wants withMint'
    ])
  })

  it('accepts the ERC721 factory as the owner of a dispenser created with the NFT', () => {
    expect(
      compare({ type: 'free' }, { ...dispenser, owner: FACTORY })
    ).to.deep.equal([])
  })

  it("compares a dispenser with the service's own dispenser parameters", () => {
    const pricing: PricingConfigWithoutOwner = {
      type: 'free',
      dispenserParams: { maxTokens: '5', maxBalance: '10' }
    }

    expect(compare(pricing, dispenser)).to.have.length(2)
    expect(
      compare(pricing, { ...dispenser, maxTokens: '5.0', maxBalance: '10.0' })
    ).to.deep.equal([])
  })

  it('has nothing to compare without a pricing config', () => {
    expect(compare(undefined, exchange)).to.deep.equal([])
  })

  it('refuses a fixed service without freCreationParams', () => {
    expect(compare({ type: 'fixed' }, exchange)).to.deep.equal([
      "the service's fixed pricing has no freCreationParams"
    ])
  })
})

describe('readExistingPricing', () => {
  const config = {
    chainId: 32456,
    fixedRateExchangeAddress: OTHER,
    dispenserAddress: FACTORY
  } as never
  const signer = new Wallet(`0x${'01'.repeat(32)}`)

  it('reads a fixed-rate exchange, its fees and the payment collector', async () => {
    reads.addresses = []
    reads.exchange = {
      exchangeOwner: OWNER,
      baseToken: BASE_TOKEN,
      fixedRate: '10.0',
      allowedSwapper: ZERO,
      withMint: true
    }
    reads.fees = { marketFee: '0.01', marketFeeCollector: COLLECTOR }

    const existing = await readExistingPricing({
      signer,
      chainConfig: config,
      datatokenAddress: DATATOKEN,
      info: { schema: 'fixed', exchangeId: '0x01' } as never
    })

    expect(existing).to.deep.equal(exchange)
    expect(reads.addresses).to.deep.equal([OTHER])
  })

  it('reads the dispenser at the configured address', async () => {
    reads.addresses = []
    reads.dispenser = {
      active: true,
      owner: OWNER,
      maxTokens: '1.0',
      maxBalance: '100000000.0',
      allowedSwapper: ZERO,
      isMinter: true
    }

    const existing = await readExistingPricing({
      signer,
      chainConfig: config,
      datatokenAddress: DATATOKEN,
      info: { schema: 'free' } as never
    })

    expect(existing).to.deep.equal(dispenser)
    expect(reads.addresses).to.deep.equal([FACTORY])
  })

  it('refuses a datatoken without pricing, or an exchange without an id', async () => {
    for (const info of [{ schema: 'none' }, { schema: 'fixed' }])
      await expect(
        readExistingPricing({
          signer,
          chainConfig: config,
          datatokenAddress: DATATOKEN,
          info: info as never
        })
      ).rejects.toThrow(/no pricing to read|could not be read/)
  })
})
