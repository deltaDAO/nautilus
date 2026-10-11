/**
 * Every ocean.js contract nautilus builds gets the chain id and the chain config.
 *
 * ocean.js's contract classes take `(address, signer, network?, config?)` and, without a
 * `config`, look one up with `ConfigHelper.getConfig(network)`. With no `network` either,
 * that lookup is `getConfig(undefined)`, which finds nothing and logs
 * "No config found for given network 'undefined'" through `LoggerInstance.error`: at
 * ocean.js's default level, so every fixed-price order printed it.
 *
 * These tests build the real ocean.js classes (only their chain calls are stubbed), so the
 * real constructor runs its real lookup, and spy on ocean.js's real logger. The chain is
 * one ocean.js ships a config for: for any other, ocean.js's `Datatoken` still looks one up
 * for the `Nft` it builds inside (with the chain id, not `undefined`), which nautilus cannot
 * change.
 */
import {
  type Config,
  Datatoken,
  Dispenser,
  FixedRateExchange,
  LoggerInstance,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editPrice } from '../../src/utils/contracts.js'
import { getDatatokenBalance } from '../../src/utils/index.js'
import { order } from '../../src/utils/order.js'
import {
  getOrderPrice,
  getPricingInfo,
  type OrderPrice,
  type PricingInfo
} from '../../src/utils/pricing.js'
import { getAssetFixture } from '../fixtures/Asset.js'
import { signedProviderFee } from '../fixtures/ProviderFee.js'

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oceanprotocol/lib')>()

  return {
    ...actual,
    approve: vi.fn(async () => ({ wait: async () => ({ hash: '0xapprove' }) })),
    approveWei: vi.fn(async () => ({ hash: '0xapproval' })),
    allowanceWei: vi.fn(async () => '0'),
    unitsToAmount: vi.fn(async () => '0')
  }
})

const EXCHANGE = '0x1111111111111111111111111111111111111111'
const DISPENSER = '0x2222222222222222222222222222222222222222'
const DATATOKEN = '0x3333333333333333333333333333333333333333'
const BASE_TOKEN = '0x4444444444444444444444444444444444444444'
const CONSUMER = '0x7777777777777777777777777777777777777777'

const signer = { getAddress: async () => CONSUMER } as unknown as Signer

/**
 * nautilus's config for a chain ocean.js ships a config for (`pontus-x-devnet`, see the file
 * header), with nautilus's own contract addresses.
 */
const chainConfig = {
  chainId: 32456,
  fixedRateExchangeAddress: EXCHANGE,
  dispenserAddress: DISPENSER
} as Config

const NO_CONFIG = /No config found for given network/

function transaction(hash: string) {
  return { wait: async () => ({ hash }) }
}

const NO_PUBLISH_FEE = {
  publishMarketFeeAddress: ZERO_ADDRESS,
  publishMarketFeeToken: ZERO_ADDRESS,
  publishMarketFeeAmount: '0'
}

const price: OrderPrice = {
  total: '1',
  baseTokenAmount: '1',
  opcFee: '0',
  publishMarketFee: '0',
  consumeMarketFee: '0'
}

/**
 * Template 1 (the default here): the exchange and the dispenser are separate calls. On
 * template 2 the datatoken buys and orders in one call, with no exchange or dispenser built.
 */
function pricing(schema: 'fixed' | 'free', templateId = 1): PricingInfo {
  return schema === 'fixed'
    ? {
        schema,
        templateId,
        datatokenAddress: DATATOKEN,
        exchangeId: '0xlive',
        baseTokenAddress: BASE_TOKEN,
        baseTokenDecimals: 18,
        publishMarketFee: NO_PUBLISH_FEE
      }
    : {
        schema,
        templateId,
        datatokenAddress: DATATOKEN,
        publishMarketFee: NO_PUBLISH_FEE
      }
}

function placeOrder(schema: 'fixed' | 'free', templateId = 1) {
  return order({
    signer,
    config: chainConfig,
    pricing: pricing(schema, templateId),
    price,
    serviceIndex: 0,
    providerFees: signedProviderFee({ providerFeeAmount: '0' }),
    consumer: CONSUMER
  })
}

/** What `LoggerInstance.error` was called with, as text. */
let errors: string[]
/** The `config` each ocean.js contract was built with, by class. */
let built: { name: string; config: unknown }[]

beforeEach(() => {
  errors = []
  built = []
  vi.spyOn(LoggerInstance, 'error').mockImplementation((...args) => {
    errors.push(args.map(String).join(' '))
  })

  // The real constructors run; only the calls that would go to the chain are stubbed, and
  // each stub records the config its instance was built with.
  const record = <T>(name: string, value: T) =>
    function (this: { config: unknown }) {
      built.push({ name, config: this.config })
      return value
    }

  // Spies, so `vi.restoreAllMocks()` puts ocean.js's own methods back after each test.
  const stub = (
    cls: { prototype: object },
    methods: Record<string, unknown>
  ) => {
    for (const [method, implementation] of Object.entries(methods))
      vi.spyOn(
        cls.prototype as Record<string, (...args: unknown[]) => unknown>,
        method
      ).mockImplementation(implementation as (...args: unknown[]) => unknown)
  }
  stub(Datatoken, {
    getId: record('Datatoken', Promise.resolve(1)),
    getFixedRates: record(
      'Datatoken',
      Promise.resolve([{ contractAddress: EXCHANGE, id: '0xlive' }])
    ),
    getDispensers: record('Datatoken', Promise.resolve([])),
    getPublishingMarketFee: record(
      'Datatoken',
      Promise.resolve(NO_PUBLISH_FEE)
    ),
    startOrder: record('Datatoken', Promise.resolve(transaction('0xstarted'))),
    buyFromFreAndOrder: record(
      'Datatoken',
      Promise.resolve(transaction('0xboughtandordered'))
    ),
    buyFromDispenserAndOrder: record(
      'Datatoken',
      Promise.resolve(transaction('0xdispensedandordered'))
    ),
    balance: record('Datatoken', Promise.resolve('3'))
  })
  stub(FixedRateExchange, {
    getExchange: record(
      'FixedRateExchange',
      Promise.resolve({ active: true, baseToken: BASE_TOKEN, btDecimals: '18' })
    ),
    calcBaseInGivenDatatokensOut: record(
      'FixedRateExchange',
      Promise.resolve({
        baseTokenAmount: '1',
        oceanFeeAmount: '0',
        consumeMarketFeeAmount: '0'
      })
    ),
    buyDatatokens: record(
      'FixedRateExchange',
      Promise.resolve(transaction('0xbuy'))
    ),
    setRate: record('FixedRateExchange', Promise.resolve(transaction('0xrate')))
  })
  stub(Dispenser, {
    dispense: record('Dispenser', Promise.resolve(transaction('0xdispense')))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Nothing logged "No config found", and every contract built had the chain config. */
function expectConfigured(names: string[]) {
  expect(errors.filter((text) => NO_CONFIG.test(text))).to.deep.equal([])
  for (const name of names) {
    const instances = built.filter((entry) => entry.name === name)
    expect(instances.length, `${name} was not built`).to.be.greaterThan(0)
    for (const instance of instances)
      expect(instance.config).to.equal(chainConfig)
  }
}

describe('ocean.js contracts get the chain\'s config (no "No config found")', () => {
  it('a fixed-price order: the exchange that sells the datatoken', async () => {
    await placeOrder('fixed')

    expectConfigured(['FixedRateExchange', 'Datatoken'])
  })

  it('a free order: the dispenser that hands it out', async () => {
    await placeOrder('free')

    expectConfigured(['Dispenser', 'Datatoken'])
  })

  it('control: an atomic (template 2) order builds neither, and never printed it', async () => {
    await placeOrder('fixed', 2)
    await placeOrder('free', 2)

    expect(errors).to.deep.equal([])
    expect(built.map((entry) => entry.name)).not.to.include.members([
      'FixedRateExchange',
      'Dispenser'
    ])
  })

  it('the price of a fixed-price order', async () => {
    await getOrderPrice(signer, pricing('fixed'), chainConfig)

    expectConfigured(['FixedRateExchange'])
  })

  it('the pricing of a datatoken, which looks for its active exchange', async () => {
    const info = await getPricingInfo(signer, DATATOKEN, chainConfig)

    expect(info.schema).to.equal('fixed')
    expectConfigured(['FixedRateExchange', 'Datatoken'])
  })

  it('editPrice, which sets the rate on the exchange', async () => {
    const asset = getAssetFixture()
    const service = asset.credentialSubject.services[0]

    await editPrice({
      asset,
      serviceId: service.id,
      newPrice: '2',
      chainConfig,
      signer
    })

    expectConfigured(['FixedRateExchange', 'Datatoken'])
  })

  it('getDatatokenBalance, given the chain config', async () => {
    expect(await getDatatokenBalance(signer, DATATOKEN, chainConfig)).to.equal(
      '3'
    )

    expectConfigured(['Datatoken'])
  })

  it('getDatatokenBalance without a config reads the chain id from the signer', async () => {
    const withChain = {
      getAddress: async () => CONSUMER,
      provider: { getNetwork: async () => ({ chainId: 32456n }) }
    } as unknown as Signer

    expect(await getDatatokenBalance(withChain, DATATOKEN)).to.equal('3')

    expect(errors.filter((text) => NO_CONFIG.test(text))).to.deep.equal([])
  })

  it('getPricingInfo without a config reads the chain id from the signer', async () => {
    const withChain = {
      getAddress: async () => CONSUMER,
      provider: { getNetwork: async () => ({ chainId: 32456n }) }
    } as unknown as Signer

    const info = await getPricingInfo(withChain, DATATOKEN)

    // Without the exchange address, the fixed rates are reported as read.
    expect(info.schema).to.equal('fixed')
    expect(errors.filter((text) => NO_CONFIG.test(text))).to.deep.equal([])
    const [datatoken] = built.filter((entry) => entry.name === 'Datatoken')
    expect(datatoken.config).to.deep.equal({ chainId: 32456 })
  })
})
