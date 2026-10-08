/**
 * The provider-fee signature pre-check.
 *
 * The datatoken's `_checkProviderFee` recovers the signer from the `\n32` digest of all 32
 * bytes of the fee hash, and `startOrder`/`reuseOrder` revert unless it is
 * `providerFeeAddress`. These tests build a fee whose signature does not recover that way
 * (a hash starting with `0x00`, signed over `toBeArray(messageHash)`) and pin that it is
 * refused before any transaction, and that a fresh fee is asked for.
 */
import {
  concat,
  getBytes,
  keccak256,
  recoverAddress,
  toBeHex,
  toUtf8Bytes,
  ZeroAddress,
  ZeroHash,
  zeroPadValue
} from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertProviderFeeSignature,
  chargedProviderFee,
  initializeWithValidProviderFee,
  isFeeDue,
  isProviderFeeSignatureValid,
  missingProviderFeeFields,
  PROVIDER_FEE_ATTEMPTS,
  PROVIDER_FEE_RETRY_DELAY_MS,
  ProviderFeeSignatureError,
  providerFeeMessageHash,
  providerFeeToSend,
  recoverProviderFeeSigner
} from '../../src/utils/providerFee.js'
import {
  feeMessageHash,
  PROVIDER_FEE_WALLET,
  poisonedProviderFee,
  poisonedValidUntil,
  signedProviderFee
} from '../fixtures/ProviderFee.js'

const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/**
 * `_checkProviderFee` written out byte by byte, independent of the helpers under test:
 * `abi.encodePacked(bytes, address, address, uint256, uint256)`, then the `\n32` prefix.
 */
function contractDigest(fee: ReturnType<typeof signedProviderFee>): string {
  const messageHash = keccak256(
    concat([
      getBytes(fee.providerData),
      getBytes(fee.providerFeeAddress),
      getBytes(fee.providerFeeToken),
      zeroPadValue(toBeHex(BigInt(fee.providerFeeAmount)), 32),
      zeroPadValue(toBeHex(BigInt(fee.validUntil)), 32)
    ])
  )

  return keccak256(
    concat([
      toUtf8Bytes('\x19Ethereum Signed Message:\n32'),
      getBytes(messageHash)
    ])
  )
}

describe('the fee digest', () => {
  it('packs the fee exactly as the datatoken does', () => {
    const fee = signedProviderFee()

    expect(providerFeeMessageHash(fee)).to.equal(feeMessageHash())
    // The digest the contract recovers from, rebuilt by hand, gives the node's address.
    expect(
      recoverAddress(contractDigest(fee), {
        r: fee.r,
        s: fee.s,
        v: Number(fee.v)
      })
    ).to.equal(PROVIDER_FEE_WALLET.address)
  })
})

describe('isProviderFeeSignatureValid', () => {
  it('accepts a fee signed over toBeArray(messageHash) when its hash has no leading zero byte', () => {
    expect(feeMessageHash().startsWith('0x00')).to.equal(false)
    expect(isProviderFeeSignatureValid(signedProviderFee({}, 'node'))).to.equal(
      true
    )
    expect(
      isProviderFeeSignatureValid(signedProviderFee({}, 'contract'))
    ).to.equal(true)
  })

  it('rejects a fee whose hash starts with 0x00, signed the node’s way', () => {
    const validUntil = poisonedValidUntil()
    const poisoned = poisonedProviderFee()

    expect(feeMessageHash({ validUntil })).to.match(/^0x00/)
    expect(isProviderFeeSignatureValid(poisoned)).to.equal(false)
    // ecrecover on chain returns some other address.
    expect(recoverProviderFeeSigner(poisoned)).not.to.equal(
      PROVIDER_FEE_WALLET.address
    )

    // The same fee signed over all 32 bytes is fine: the check is about the encoding.
    expect(
      isProviderFeeSignatureValid(signedProviderFee({ validUntil }, 'contract'))
    ).to.equal(true)
  })

  it('rejects a fee changed after signing', () => {
    const fee = signedProviderFee()

    expect(
      isProviderFeeSignatureValid({ ...fee, providerFeeAmount: '31' })
    ).to.equal(false)
    expect(
      isProviderFeeSignatureValid({ ...fee, validUntil: '1900000001' })
    ).to.equal(false)
  })

  it('rejects a v that ecrecover does not take, and malformed fields', () => {
    const fee = signedProviderFee()

    expect(
      isProviderFeeSignatureValid({ ...fee, v: Number(fee.v) - 27 })
    ).to.equal(false)
    expect(isProviderFeeSignatureValid({ ...fee, r: '0x1234' })).to.equal(false)
    expect(
      isProviderFeeSignatureValid({
        ...fee,
        providerFeeToken: 'not-an-address'
      })
    ).to.equal(false)
    expect(isProviderFeeSignatureValid({})).to.equal(false)
  })

  it('accepts the high-s form ecrecover accepts too', () => {
    const fee = signedProviderFee()
    const highS = {
      ...fee,
      s: toBeHex(SECP256K1_N - BigInt(fee.s), 32),
      v: Number(fee.v) === 27 ? 28 : 27
    }

    expect(isProviderFeeSignatureValid(highS)).to.equal(true)
  })

  it('takes numbers and decimal strings, as the node sends them', () => {
    const fee = signedProviderFee()

    expect(
      isProviderFeeSignatureValid({
        ...fee,
        v: Number(fee.v),
        validUntil: Number(fee.validUntil)
      })
    ).to.equal(true)
  })
})

describe('assertProviderFeeSignature', () => {
  it('names the digest the datatoken checks and says nothing was spent', () => {
    expect(() => assertProviderFeeSignature(poisonedProviderFee())).toThrow(
      ProviderFeeSignatureError
    )
    expect(() => assertProviderFeeSignature(poisonedProviderFee())).toThrow(
      /signature check.*\\n32" digest.*Nothing was spent/s
    )
  })

  it('refuses no fee at all: every path that calls it sends one', () => {
    const thrown = (() => {
      try {
        assertProviderFeeSignature(undefined)
      } catch (caught) {
        return caught as ProviderFeeSignatureError
      }
    })()

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown?.message).to.match(/there is no provider fee/)
    expect(thrown?.message).to.match(/Nothing was spent/)
    expect(thrown?.providerFee).to.deep.equal({})
  })

  it('names the fields a partial fee is missing', () => {
    const {
      providerFeeAmount: _amount,
      validUntil: _until,
      ...partial
    } = signedProviderFee()

    expect(() => assertProviderFeeSignature(partial)).toThrow(
      /missing providerFeeAmount, validUntil/
    )
  })

  it('says what the refusal saves: the approval, purchase and escrow transactions', () => {
    // ocean.js estimates gas before sending the order, so the order itself would not be
    // mined; what the check saves is what is sent ahead of it.
    expect(() => assertProviderFeeSignature(poisonedProviderFee())).toThrow(
      /gas estimate.*approval, purchase and escrow transactions/s
    )
  })
})

describe('incomplete fees', () => {
  // A fee signed with amount 0 and validUntil 0 hashes the same as one without those
  // fields, if missing fields are read as 0. The contract has no such default: the fee is
  // a struct argument, and an incomplete one cannot be encoded into the order call.
  const zeroes = signedProviderFee({ providerFeeAmount: '0', validUntil: 0 })

  it('accepts the complete fee', () => {
    expect(isProviderFeeSignatureValid(zeroes)).to.equal(true)
  })

  it.each(missingProviderFeeFields(undefined))(
    'rejects it without %s, rather than hashing a default',
    (field) => {
      const partial: Record<string, unknown> = { ...zeroes }
      delete partial[field]

      expect(isProviderFeeSignatureValid(partial)).to.equal(false)
      expect(recoverProviderFeeSigner(partial)).to.equal(undefined)
      expect(missingProviderFeeFields(partial)).to.deep.equal([field])
    }
  )

  it('treats null and an empty string as missing', () => {
    expect(
      isProviderFeeSignatureValid({ ...zeroes, providerFeeAmount: '' })
    ).to.equal(false)
    expect(
      isProviderFeeSignatureValid({
        ...zeroes,
        validUntil: null as unknown as string
      })
    ).to.equal(false)
  })

  it('does not hash a fee with a field missing', () => {
    const { validUntil: _until, ...partial } = zeroes

    expect(() => providerFeeMessageHash(partial)).toThrow(/no validUntil/)
  })
})

describe('a fee with providerFeeAddress zero', () => {
  // `_checkProviderFee` requires `ecrecover(...) == providerFeeAddress`, and `ecrecover`
  // returns the zero address for a signature it cannot use, so the contract accepts such
  // a fee (and charges nothing for it). The check mirrors that.
  const unsigned = {
    ...signedProviderFee({ providerFeeAmount: '0' }),
    providerFeeAddress: ZeroAddress,
    v: '27',
    r: ZeroHash,
    s: ZeroHash
  }

  it('is accepted when ecrecover gives the zero address too, as on chain', () => {
    expect(recoverProviderFeeSigner(unsigned)).to.equal(ZeroAddress)
    expect(isProviderFeeSignatureValid(unsigned)).to.equal(true)
    expect(() => assertProviderFeeSignature(unsigned)).not.toThrow()
  })

  it('is refused when the signature recovers to a real address', () => {
    const signed = { ...signedProviderFee(), providerFeeAddress: ZeroAddress }

    expect(isProviderFeeSignatureValid(signed)).to.equal(false)
  })

  it('gives the zero address for every signature the precompile cannot use', () => {
    const fee = signedProviderFee()

    expect(recoverProviderFeeSigner({ ...fee, v: 26 })).to.equal(ZeroAddress)
    expect(recoverProviderFeeSigner({ ...fee, r: ZeroHash })).to.equal(
      ZeroAddress
    )
    expect(
      recoverProviderFeeSigner({ ...fee, s: toBeHex(SECP256K1_N, 32) })
    ).to.equal(ZeroAddress)
  })

  it('charges nothing, as the contract skips the transfer', () => {
    expect(
      chargedProviderFee({ ...unsigned, providerFeeAmount: '30' })
    ).to.equal(undefined)
  })
})

describe('isFeeDue', () => {
  it('compares the amount as a number', () => {
    for (const zero of ['0', '00', '0x0', 0, 0n])
      expect(isFeeDue({ providerFeeAmount: zero }), String(zero)).to.equal(
        false
      )

    expect(isFeeDue({ providerFeeAmount: '30' })).to.equal(true)
    expect(isFeeDue({ providerFeeAmount: '0x1e' })).to.equal(true)
  })

  it('is false without an amount, and true for one that does not parse', () => {
    expect(isFeeDue(undefined)).to.equal(false)
    expect(isFeeDue({})).to.equal(false)
    // Not a reason to reuse the order as it stands: the fee check then refuses it.
    expect(isFeeDue({ providerFeeAmount: 'thirty' })).to.equal(true)
  })
})

describe('chargedProviderFee', () => {
  it('is what the datatoken pulls: a non-zero amount in a real token', () => {
    expect(chargedProviderFee(signedProviderFee())).to.deep.equal({
      token: '0xfEE0000000000000000000000000000000000000',
      amount: 30n
    })
    expect(
      chargedProviderFee(signedProviderFee({ providerFeeAmount: '0' }))
    ).to.equal(undefined)
    expect(
      chargedProviderFee(signedProviderFee({ providerFeeToken: ZeroAddress }))
    ).to.equal(undefined)
  })
})

describe('providerFeeToSend', () => {
  it('is nothing for a reusable order with no fee due', () => {
    expect(
      providerFeeToSend({
        validOrder: '0xorder',
        providerFee: { providerFeeAmount: '0' }
      })
    ).to.equal(undefined)
  })

  it('is an empty fee, which the check refuses, when an order is due and the node sent none', () => {
    expect(providerFeeToSend({})).to.deep.equal({})
    expect(providerFeeToSend({ validOrder: '' })).to.deep.equal({})
    expect(isProviderFeeSignatureValid(providerFeeToSend({}) ?? {})).to.equal(
      false
    )
  })

  it('is nothing for a reusable order the node sent no fee for', () => {
    expect(providerFeeToSend({ validOrder: '0xorder' })).to.equal(undefined)
  })

  it('is the fee for a fresh order, or a reused one with a fee due', () => {
    const fee = signedProviderFee()

    expect(providerFeeToSend({ providerFee: fee })).to.equal(fee)
    expect(
      providerFeeToSend({ validOrder: '0xorder', providerFee: fee })
    ).to.equal(fee)
  })
})

describe('initializeWithValidProviderFee', () => {
  const feesOf = (result: { providerFee?: unknown }) => [
    result.providerFee as ReturnType<typeof signedProviderFee>
  ]

  it('returns the first answer when its fee is good, without waiting', async () => {
    const good = { providerFee: signedProviderFee() }
    const initialize = vi.fn(async () => good)
    const sleep = vi.fn(async () => undefined)

    expect(
      await initializeWithValidProviderFee(initialize, feesOf, { sleep })
    ).to.equal(good)
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('asks again after a fee the datatoken would reject, a second later', async () => {
    const good = { providerFee: signedProviderFee() }
    const initialize = vi
      .fn()
      .mockResolvedValueOnce({ providerFee: poisonedProviderFee() })
      .mockResolvedValueOnce(good)
    const sleep = vi.fn(async () => undefined)

    expect(
      await initializeWithValidProviderFee(initialize, feesOf, { sleep })
    ).to.equal(good)
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(PROVIDER_FEE_RETRY_DELAY_MS)
  })

  it('stops at once when the node returns the same fee again', async () => {
    // A compute fee has validUntil = service.timeout, so it never changes.
    const poisoned = poisonedProviderFee()
    const initialize = vi.fn(async () => ({ providerFee: poisoned }))

    const thrown = await initializeWithValidProviderFee(initialize, feesOf, {
      attempts: 5,
      sleep: async () => undefined
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/same fee again on attempt 2/)
    expect(thrown.attempts).to.equal(2)
    expect(initialize).toHaveBeenCalledTimes(2)
  })

  it('gives up after the last attempt', async () => {
    let start = 1_900_000_000
    const initialize = vi.fn(async () => {
      const validUntil = poisonedValidUntil({}, start)
      start = validUntil + 1
      return { providerFee: signedProviderFee({ validUntil }, 'node') }
    })

    const thrown = await initializeWithValidProviderFee(initialize, feesOf, {
      attempts: 3,
      sleep: async () => undefined
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/asked 3 times/)
    expect(initialize).toHaveBeenCalledTimes(3)
  })

  it('ignores answers with no fee to send', async () => {
    const initialize = vi.fn(async () => ({ providerFee: undefined }))

    expect(
      await initializeWithValidProviderFee(initialize, feesOf)
    ).to.deep.equal({ providerFee: undefined })
  })

  it('refuses an incomplete fee at once, without asking again', async () => {
    const { validUntil: _until, ...partial } = signedProviderFee()
    const initialize = vi.fn(async () => ({ providerFee: partial }))
    const sleep = vi.fn(async () => undefined)

    const thrown = await initializeWithValidProviderFee(initialize, feesOf, {
      sleep
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/missing validUntil.*not asked again/s)
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('asks only once with attempts: 1, for a fee that never changes', async () => {
    const initialize = vi.fn(async () => ({
      providerFee: poisonedProviderFee()
    }))
    const sleep = vi.fn(async () => undefined)

    const thrown = await initializeWithValidProviderFee(initialize, feesOf, {
      attempts: 1,
      sleep
    }).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
    expect(thrown.message).to.match(/not asked again/)
    expect(thrown.attempts).to.equal(1)
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  describe('by default', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls initialize 3 times in total, 1.1 s apart, then gives up', async () => {
      // What the access docs promise: 3 calls (2 retries), 1.1 s between them.
      vi.useFakeTimers()

      let start = 1_900_000_000
      const calledAt: number[] = []
      const initialize = vi.fn(async () => {
        calledAt.push(Date.now())
        const validUntil = poisonedValidUntil({}, start)
        start = validUntil + 1
        return { providerFee: signedProviderFee({ validUntil }, 'node') }
      })

      const running = initializeWithValidProviderFee(initialize, feesOf).catch(
        (caught) => caught
      )
      await vi.advanceTimersByTimeAsync(10_000)
      const thrown = await running

      expect(PROVIDER_FEE_ATTEMPTS).to.equal(3)
      expect(PROVIDER_FEE_RETRY_DELAY_MS).to.equal(1_100)
      expect(thrown).to.be.instanceOf(ProviderFeeSignatureError)
      expect(thrown.attempts).to.equal(3)
      expect(initialize).toHaveBeenCalledTimes(3)
      expect(calledAt[1] - calledAt[0]).to.equal(1_100)
      expect(calledAt[2] - calledAt[1]).to.equal(1_100)
    })
  })
})
