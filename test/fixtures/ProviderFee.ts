/**
 * Provider fees for tests of the fee-signature pre-check.
 *
 * `messageHash = solidityPackedKeccak256(['bytes','address','address','uint256','uint256'], …)`
 * is signed with `wallet.signMessage`, either over all 32 bytes (the `\n32` digest the
 * datatoken verifies) or over `toBeArray(messageHash)`. For a hash starting with `0x00`
 * the latter is 31 bytes under a `\n31` prefix, which does not recover to
 * `providerFeeAddress`.
 */
import type { ProviderFees } from '@oceanprotocol/lib'
import {
  getBytes,
  hashMessage,
  hexlify,
  Signature,
  solidityPackedKeccak256,
  toBeArray,
  toUtf8Bytes,
  Wallet
} from 'ethers'

export const PROVIDER_FEE_KEY =
  '0x4242424242424242424242424242424242424242424242424242424242424242'
export const PROVIDER_FEE_WALLET = new Wallet(PROVIDER_FEE_KEY)
export const PROVIDER_FEE_TOKEN = '0xfee0000000000000000000000000000000000000'

export interface FeeFields {
  providerData?: string
  providerFeeAmount?: string
  providerFeeToken?: string
  validUntil?: number
}

function fields(overrides: FeeFields) {
  return {
    providerData:
      overrides.providerData ??
      hexlify(toUtf8Bytes(JSON.stringify({ dt: '0xdt', id: 'access' }))),
    providerFeeAddress: PROVIDER_FEE_WALLET.address,
    providerFeeToken: overrides.providerFeeToken ?? PROVIDER_FEE_TOKEN,
    providerFeeAmount: overrides.providerFeeAmount ?? '30',
    validUntil: overrides.validUntil ?? 1_900_000_000
  }
}

/** The fee's `messageHash`, as the node and the contract compute it. */
export function feeMessageHash(overrides: FeeFields = {}): string {
  const fee = fields(overrides)

  return solidityPackedKeccak256(
    ['bytes', 'address', 'address', 'uint256', 'uint256'],
    [
      fee.providerData,
      fee.providerFeeAddress,
      fee.providerFeeToken,
      BigInt(fee.providerFeeAmount),
      fee.validUntil
    ]
  )
}

/**
 * A signed fee. `node` signs `toBeArray(messageHash)`; `contract` signs all 32 bytes, as
 * the datatoken verifies.
 */
export function signedProviderFee(
  overrides: FeeFields = {},
  how: 'node' | 'contract' = 'node'
): ProviderFees {
  const fee = fields(overrides)
  const messageHash = feeMessageHash(overrides)
  const message =
    how === 'node'
      ? new Uint8Array(toBeArray(messageHash))
      : getBytes(messageHash)

  // `signMessage` is async; signing the same EIP-191 digest directly is not.
  const signature = Signature.from(
    PROVIDER_FEE_WALLET.signingKey.sign(hashMessage(message))
  )

  return {
    ...fee,
    validUntil: fee.validUntil as unknown as string,
    v: (signature.v <= 1 ? signature.v + 27 : signature.v) as unknown as string,
    r: signature.r,
    s: signature.s
  }
}

/** The first `validUntil` from `start` whose fee hash starts with `0x00`. */
export function poisonedValidUntil(
  overrides: FeeFields = {},
  start = 1_900_000_000
): number {
  for (let validUntil = start; ; validUntil++)
    if (feeMessageHash({ ...overrides, validUntil }).startsWith('0x00'))
      return validUntil
}

/** A fee whose hash starts with `0x00`, signed the node's way: the contract rejects it. */
export function poisonedProviderFee(overrides: FeeFields = {}): ProviderFees {
  return signedProviderFee(
    { ...overrides, validUntil: poisonedValidUntil(overrides) },
    'node'
  )
}
