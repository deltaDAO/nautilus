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
  zeroPadValue
} from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import {
  assertProviderFeeSignature,
  initializeWithValidProviderFee,
  isProviderFeeSignatureValid,
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

  it('passes when there is no fee to send', () => {
    expect(() => assertProviderFeeSignature(undefined)).not.toThrow()
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
})
