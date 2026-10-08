/**
 * `Nautilus.create` takes the payment limits once, as the default for every `access()` and
 * `compute()` call; an option passed to the call replaces the default of the same name.
 * A malformed limit fails at `create`, not at the first paid call. Only the caller's own
 * `config.escrow` reaches `compute()` as the escrow pin, not the one ocean.js fills in.
 */
import { Wallet } from 'ethers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access } from '../../src/access/index.js'
import { compute } from '../../src/compute/index.js'
import { Nautilus, type NautilusOptions } from '../../src/index.js'
import { expectThrowsAsync } from '../helpers.js'

vi.mock('../../src/access/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  access: vi.fn(async () => ({}))
}))

vi.mock('../../src/compute/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  compute: vi.fn(async () => ({}))
}))

const ADDRESS = '0x0000000000000000000000000000000000000001'
const TOKEN = '0x0000000000000000000000000000000000000fee'

function createNautilus(options: NautilusOptions, chainId = 32456n) {
  return Nautilus.create(
    Wallet.createRandom().connect({
      getNetwork: async () => ({ chainId })
    } as never),
    {
      ...options,
      config: {
        oceanNodeUri: 'https://ocean-node.example.com',
        nftFactoryAddress: ADDRESS,
        fixedRateExchangeAddress: ADDRESS,
        dispenserAddress: ADDRESS,
        ...options.config
      }
    }
  )
}

const JOB = {
  dataset: { did: 'did:ope:data' },
  algorithm: { did: 'did:ope:algo' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('payment limits in Nautilus.create', () => {
  it('passes the defaults to access() and compute()', async () => {
    const confirmProviderFees = () => true
    const confirmEscrowPayment = () => true
    const nautilus = await createNautilus({
      maxProviderFee: { token: TOKEN, amount: 5n },
      confirmProviderFees,
      maxEscrowPayment: { token: TOKEN, amount: 7n },
      confirmEscrowPayment
    })

    await nautilus.access({ assetDid: 'did:ope:data' })
    await nautilus.compute(JOB)

    expect(vi.mocked(access).mock.calls[0][0]).to.deep.include({
      maxProviderFee: { token: TOKEN, amount: 5n },
      confirmProviderFees
    })
    expect(vi.mocked(compute).mock.calls[0][0]).to.deep.include({
      maxProviderFee: { token: TOKEN, amount: 5n },
      confirmProviderFees,
      maxEscrowPayment: { token: TOKEN, amount: 7n },
      confirmEscrowPayment
    })
  })

  it('lets each call replace a default of the same name, keeping the others', async () => {
    const fallback = () => true
    const nautilus = await createNautilus({
      maxProviderFee: { token: TOKEN, amount: 5n },
      confirmProviderFees: fallback,
      maxEscrowPayment: { token: TOKEN, amount: 7n }
    })

    await nautilus.access({
      assetDid: 'did:ope:data',
      maxProviderFee: { token: TOKEN, amount: 1n }
    })
    await nautilus.compute({ ...JOB, maxEscrowPayment: [] })

    expect(vi.mocked(access).mock.calls[0][0]).to.deep.include({
      maxProviderFee: { token: TOKEN, amount: 1n },
      confirmProviderFees: fallback
    })
    expect(vi.mocked(compute).mock.calls[0][0]).to.deep.include({
      maxProviderFee: { token: TOKEN, amount: 5n },
      maxEscrowPayment: []
    })
  })

  it('passes nothing when neither the call nor create sets a limit', async () => {
    const nautilus = await createNautilus({})

    await nautilus.compute(JOB)

    const [config] = vi.mocked(compute).mock.calls[0]
    expect(config.maxProviderFee).to.equal(undefined)
    expect(config.confirmProviderFees).to.equal(undefined)
    expect(config.maxEscrowPayment).to.equal(undefined)
    expect(config.confirmEscrowPayment).to.equal(undefined)
  })

  it('refuses a malformed limit at create', async () => {
    await expectThrowsAsync(
      () => createNautilus({ maxProviderFee: { token: '0x12', amount: 1n } }),
      /maxProviderFee: every entry needs a token address/
    )
    await expectThrowsAsync(
      () =>
        createNautilus({ maxEscrowPayment: { token: TOKEN, amount: '1e18' } }),
      /maxEscrowPayment: the amount .* must be a non-negative integer/
    )
    await expectThrowsAsync(
      () => createNautilus({ confirmProviderFees: true as never }),
      /confirmProviderFees must be a function/
    )
  })
})

describe('escrow pin in Nautilus.create', () => {
  const OP_SEPOLIA = 11155420n
  const ESCROW = '0x00000000000000000000000000000000000e5c40'

  it('passes the caller’s config.escrow to compute() as the explicit pin', async () => {
    const nautilus = await createNautilus({ config: { escrow: ESCROW } })

    await nautilus.compute(JOB)

    expect(vi.mocked(compute).mock.calls[0][1].escrow).to.equal(ESCROW)
  })

  it('passes no pin when only ocean.js filled config.escrow', async () => {
    const nautilus = await createNautilus({}, OP_SEPOLIA)

    // ocean.js's ConfigHelper fills it from the address data's plain Escrow.
    expect(nautilus.getOceanConfig().escrow).to.equal(
      '0x7842Fa3B2d87Ff1cd52C4152382f7C4B3406E5A6'
    )

    await nautilus.compute(JOB)

    expect(vi.mocked(compute).mock.calls[0][1].escrow).to.equal(undefined)
  })

  it('refuses a malformed config.escrow at create', async () => {
    await expectThrowsAsync(
      () => createNautilus({ config: { escrow: '0x1234' } }),
      /escrow is not a valid address/
    )
  })
})
