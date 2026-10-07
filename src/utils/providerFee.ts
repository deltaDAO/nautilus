/**
 * A read-only check of the provider-fee signature, before an order spends gas on it.
 *
 * The datatoken checks the node's fee signature in `_checkProviderFee` (ERC20Template,
 * ERC20TemplateEnterprise and ERC20Template4 alike):
 *
 *   messageHash = keccak256(abi.encodePacked(providerData, providerFeeAddress,
 *                                            providerFeeToken, providerFeeAmount, validUntil))
 *   digest      = keccak256("\x19Ethereum Signed Message:\n32" ++ messageHash)
 *   require(ecrecover(digest, v, r, s) == providerFeeAddress, "Invalid provider fee")
 *
 * A fee whose signature does not recover to `providerFeeAddress` this way makes
 * `startOrder`/`reuseOrder` revert on chain. This module rebuilds the contract's digest
 * exactly and recovers the signer locally: no RPC call, no transaction.
 *
 * Not exported from the package, apart from `ProviderFeeSignatureError`.
 */
import type { ProviderFees } from '@oceanprotocol/lib'
import {
  getAddress,
  getBytes,
  hashMessage,
  isHexString,
  recoverAddress,
  solidityPackedKeccak256,
  toBeHex
} from 'ethers'

/** secp256k1's group order, to fold a high `s` back to the canonical form ethers takes. */
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** How many fees `initializeWithValidProviderFee` asks for before giving up. */
export const PROVIDER_FEE_ATTEMPTS = 3

/**
 * The wait before asking again. A download fee's `validUntil` is `now + service.timeout`
 * rounded to the second on the node, so a new fee within the same second has the same hash.
 */
export const PROVIDER_FEE_RETRY_DELAY_MS = 1_100

/** A provider fee as the node sends it: numbers or decimal strings, `0x` hex for the rest. */
export type ProviderFeeLike = Partial<
  Record<keyof ProviderFees, string | number | bigint>
>

/** Thrown before an order whose provider-fee signature the datatoken would reject. */
export class ProviderFeeSignatureError extends Error {
  /** The fee the node signed, as it sent it. */
  readonly providerFee: ProviderFeeLike
  /** The address `ecrecover` would return on chain, when it could be computed. */
  readonly recovered?: string
  /** How many fees the node was asked for. */
  readonly attempts: number

  constructor(
    providerFee: ProviderFeeLike,
    details: { recovered?: string; attempts: number; reason: string }
  ) {
    super(
      `Refusing to order: the provider fee signed by ${String(providerFee.providerFeeAddress)} would fail the datatoken's signature check (ecrecover gives ${details.recovered ?? 'no address'}), so startOrder/reuseOrder would revert and spend gas. ${details.reason} The datatoken checks the "\\x19Ethereum Signed Message:\\n32" digest of the 32-byte fee hash. Nothing was spent.`
    )
    this.name = 'ProviderFeeSignatureError'
    this.providerFee = providerFee
    this.recovered = details.recovered
    this.attempts = details.attempts
  }
}

/** The fee's `messageHash`, exactly as `_checkProviderFee` packs it. */
export function providerFeeMessageHash(fee: ProviderFeeLike): string {
  return solidityPackedKeccak256(
    ['bytes', 'address', 'address', 'uint256', 'uint256'],
    [
      String(fee.providerData),
      getAddress(String(fee.providerFeeAddress)),
      getAddress(String(fee.providerFeeToken)),
      BigInt(fee.providerFeeAmount ?? 0),
      BigInt(fee.validUntil ?? 0)
    ]
  )
}

/**
 * The address the datatoken's `ecrecover` returns for this fee, or `undefined` where it
 * would return the zero address or the fee is malformed (either way the order reverts).
 */
export function recoverProviderFeeSigner(
  fee: ProviderFeeLike
): string | undefined {
  try {
    const v = Number(fee.v)
    const r = String(fee.r)
    let s = String(fee.s)

    // `ecrecover` takes v as given: only 27 and 28 recover anything.
    if (v !== 27 && v !== 28) return undefined
    if (!isHexString(r, 32) || !isHexString(s, 32)) return undefined

    let recoveryV = v
    // `ecrecover` accepts a high s, ethers does not: (r, n - s) with the other v recovers
    // the same key.
    if (BigInt(s) > SECP256K1_N / 2n) {
      s = toBeHex(SECP256K1_N - BigInt(s), 32)
      recoveryV = v === 27 ? 28 : 27
    }

    const digest = hashMessage(getBytes(providerFeeMessageHash(fee)))

    return recoverAddress(digest, { r, s, v: recoveryV })
  } catch {
    return undefined
  }
}

/** Whether the datatoken would accept this fee's signature. */
export function isProviderFeeSignatureValid(fee: ProviderFeeLike): boolean {
  const recovered = recoverProviderFeeSigner(fee)

  try {
    return (
      recovered !== undefined &&
      recovered === getAddress(String(fee.providerFeeAddress))
    )
  } catch {
    return false
  }
}

/**
 * Throws a `ProviderFeeSignatureError` unless the datatoken would accept the fee's
 * signature. No fee (an order reused as it stands) passes.
 */
export function assertProviderFeeSignature(
  fee: ProviderFeeLike | undefined,
  attempts = 1
): void {
  if (!fee) return
  if (isProviderFeeSignatureValid(fee)) return

  throw new ProviderFeeSignatureError(fee, {
    recovered: recoverProviderFeeSigner(fee),
    attempts,
    reason: 'Ask the node for a new fee (initialize again).'
  })
}

/**
 * The provider fee `settleOrder` will send to the datatoken, or `undefined` when it reuses
 * the order as it stands (an order in force and no fee due) and sends nothing.
 */
export function providerFeeToSend(initialized: {
  validOrder?: string
  providerFee?: unknown
}): ProviderFeeLike | undefined {
  const providerFee = initialized.providerFee as ProviderFeeLike | undefined

  if (initialized.validOrder && !isFeeDue(providerFee)) return undefined

  return providerFee
}

export function isFeeDue(providerFee: ProviderFeeLike | undefined): boolean {
  return Boolean(
    providerFee?.providerFeeAmount &&
      String(providerFee.providerFeeAmount) !== '0'
  )
}

function hashOrUndefined(fee: ProviderFeeLike): string | undefined {
  try {
    return providerFeeMessageHash(fee)
  } catch {
    return undefined
  }
}

/**
 * Calls `initialize` until every provider fee in its answer carries a signature the
 * datatoken accepts, up to `attempts` times, and returns that answer.
 *
 * A new fee normally has a new `validUntil` and so a new hash. When the node answers with
 * the same hash again (a compute fee has `validUntil = service.timeout`,
 * and a download fee for a service with `timeout: 0` has `validUntil = 0`), asking again
 * cannot help, and this throws at once.
 */
export async function initializeWithValidProviderFee<T>(
  initialize: () => Promise<T>,
  feesOf: (result: T) => (ProviderFeeLike | undefined)[],
  options: {
    attempts?: number
    delayMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? PROVIDER_FEE_ATTEMPTS)
  const delayMs = options.delayMs ?? PROVIDER_FEE_RETRY_DELAY_MS
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const seenBad = new Set<string>()

  for (let attempt = 1; ; attempt++) {
    const result = await initialize()
    const bad = feesOf(result).filter(
      (fee): fee is ProviderFeeLike =>
        fee !== undefined && !isProviderFeeSignatureValid(fee)
    )

    if (!bad.length) return result

    const fee = bad[0]
    const hashes = bad.map(hashOrUndefined)
    const repeated = hashes.some((hash) => hash && seenBad.has(hash))

    if (repeated || attempt >= attempts)
      throw new ProviderFeeSignatureError(fee, {
        recovered: recoverProviderFeeSigner(fee),
        attempts: attempt,
        reason: repeated
          ? `The node signed the same fee again on attempt ${attempt} (its validUntil does not change: a compute fee, or a service with timeout 0), so asking again cannot help.`
          : `The node was asked ${attempt} times and every fee had a signature the contract rejects.`
      })

    for (const hash of hashes) if (hash) seenBad.add(hash)

    await sleep(delayMs)
  }
}
