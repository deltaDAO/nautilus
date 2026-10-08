/**
 * `Nautilus.create` takes the payment limits once, as the default for every `access()` and
 * `compute()` call; a call that sets either option of a pair (`maxProviderFee` /
 * `confirmProviderFees`, `maxEscrowPayment` / `confirmEscrowPayment`) replaces that pair.
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

  it('replaces a pair of defaults as a whole when the call sets either option of it', async () => {
    const permissive = vi.fn(() => true)
    const nautilus = await createNautilus({
      maxProviderFee: { token: TOKEN, amount: 5n },
      confirmProviderFees: permissive,
      maxEscrowPayment: { token: TOKEN, amount: 7n },
      confirmEscrowPayment: permissive
    })

    // A tight per-call ceiling must not inherit the permissive default callback.
    await nautilus.access({
      assetDid: 'did:ope:data',
      maxProviderFee: { token: TOKEN, amount: 1n }
    })
    await nautilus.compute({ ...JOB, maxEscrowPayment: [] })

    const [accessConfig] = vi.mocked(access).mock.calls[0]
    expect(accessConfig.maxProviderFee).to.deep.equal({
      token: TOKEN,
      amount: 1n
    })
    expect(accessConfig.confirmProviderFees).to.equal(undefined)

    // The escrow pair is the call's own; the provider-fee pair, untouched, is the default.
    const [computeConfig] = vi.mocked(compute).mock.calls[0]
    expect(computeConfig.maxEscrowPayment).to.deep.equal([])
    expect(computeConfig.confirmEscrowPayment).to.equal(undefined)
    expect(computeConfig.maxProviderFee).to.deep.equal({
      token: TOKEN,
      amount: 5n
    })
    expect(computeConfig.confirmProviderFees).to.equal(permissive)
  })

  it('takes a per-call callback without the default ceiling', async () => {
    const decline = () => false
    const nautilus = await createNautilus({
      maxProviderFee: { token: TOKEN, amount: 5n },
      maxEscrowPayment: { token: TOKEN, amount: 7n }
    })

    await nautilus.compute({
      ...JOB,
      confirmProviderFees: decline,
      confirmEscrowPayment: decline
    })

    const [config] = vi.mocked(compute).mock.calls[0]
    expect(config.maxProviderFee).to.equal(undefined)
    expect(config.confirmProviderFees).to.equal(decline)
    expect(config.maxEscrowPayment).to.equal(undefined)
    expect(config.confirmEscrowPayment).to.equal(decline)
  })

  it('clears a default when the call sets its option to undefined', async () => {
    const nautilus = await createNautilus({
      confirmProviderFees: () => true,
      confirmEscrowPayment: () => true
    })

    await nautilus.access({
      assetDid: 'did:ope:data',
      confirmProviderFees: undefined
    })
    await nautilus.compute({ ...JOB, maxEscrowPayment: undefined })

    const [accessConfig] = vi.mocked(access).mock.calls[0]
    expect(accessConfig.maxProviderFee).to.equal(undefined)
    expect(accessConfig.confirmProviderFees).to.equal(undefined)

    const [computeConfig] = vi.mocked(compute).mock.calls[0]
    expect(computeConfig.maxEscrowPayment).to.equal(undefined)
    expect(computeConfig.confirmEscrowPayment).to.equal(undefined)
    // The provider-fee pair, which the call left alone, is still the default.
    expect(computeConfig.confirmProviderFees).to.be.a('function')
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

  it('passes one escrow lock per instance to every compute()', async () => {
    const nautilus = await createNautilus({})
    const other = await createNautilus({})

    await nautilus.compute(JOB)
    await nautilus.compute(JOB)
    await other.compute(JOB)

    const [first, second, third] = vi
      .mocked(compute)
      .mock.calls.map((call) => call[1].escrowLock)
    expect(first).to.be.a('function')
    expect(second).to.equal(first)
    expect(third).to.be.a('function')
    expect(third).not.to.equal(first)
  })

  it('refuses a malformed config.escrow at create', async () => {
    await expectThrowsAsync(
      () => createNautilus({ config: { escrow: '0x1234' } }),
      /escrow is not a valid address/
    )
  })
})
