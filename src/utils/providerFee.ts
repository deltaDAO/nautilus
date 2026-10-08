/**
 * A read-only check of the provider fee, before an order spends anything on it.
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
 * The fee is a struct argument of the order call with no defaults on chain, so a fee with
 * a field missing cannot be sent at all; it is refused here too rather than hashed with a
 * made-up value.
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
  toBeHex,
  ZeroAddress
} from 'ethers'

/** secp256k1's group order, to fold a high `s` back to the canonical form ethers takes. */
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/**
 * How many times, in total, `initializeWithValidProviderFee` calls `initialize` before
 * giving up: the first call and up to two retries.
 */
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

/** Every field of the datatoken's `providerFee` struct. None has a default on chain. */
export const PROVIDER_FEE_FIELDS = [
  'providerFeeAddress',
  'providerFeeToken',
  'providerFeeAmount',
  'providerData',
  'validUntil',
  'v',
  'r',
  's'
] as const satisfies readonly (keyof ProviderFees)[]

/** What is wrong with a fee, if anything. */
type FeeProblem =
  /** Fields the node left out (all of them when there is no fee). */
  | { kind: 'missing'; fields: string[] }
  /** Every field is there, but the fee cannot be ABI-encoded into the order call. */
  | { kind: 'malformed'; detail: string }
  /** The fee can be sent, and `ecrecover` gives `recovered`, not `providerFeeAddress`. */
  | { kind: 'signature'; recovered: string }

const NOTHING_SPENT =
  'Nothing was spent: this is checked before the approval, purchase and escrow transactions that are sent ahead of the order.'

/**
 * Thrown before an order whose provider fee the datatoken would reject: a signature that
 * does not recover to `providerFeeAddress`, or a fee that is missing, incomplete or cannot
 * be encoded into the order call.
 */
export class ProviderFeeSignatureError extends Error {
  /** The fee the node signed, as it sent it (`{}` when it sent none). */
  readonly providerFee: ProviderFeeLike
  /** The address `ecrecover` would return on chain, when it could be computed. */
  readonly recovered?: string
  /** How many fees the node was asked for. */
  readonly attempts: number

  constructor(
    providerFee: ProviderFeeLike | undefined,
    details: {
      recovered?: string
      attempts: number
      reason: string
      /** Fields the fee lacks; set for a missing or incomplete fee. */
      missing?: string[]
      /** Why a complete fee cannot be encoded into the order call. */
      malformed?: string
    }
  ) {
    const fee = providerFee ?? {}

    super(
      details.missing?.length
        ? `Refusing to order: ${
            details.missing.length === PROVIDER_FEE_FIELDS.length
              ? 'there is no provider fee'
              : `the provider fee is missing ${details.missing.join(', ')}`
          }, and startOrder/reuseOrder need every field of it (the datatoken has no defaults for them). ${details.reason} ${NOTHING_SPENT}`
        : details.malformed
          ? `Refusing to order: the provider fee cannot be sent to the datatoken as it stands (${details.malformed}). ${details.reason} ${NOTHING_SPENT}`
          : `Refusing to order: the provider fee signed by ${String(fee.providerFeeAddress)} would fail the datatoken's signature check (ecrecover gives ${details.recovered ?? 'no address'}), so startOrder/reuseOrder would revert; ocean.js's gas estimate would fail on it. ${details.reason} The datatoken checks the "\\x19Ethereum Signed Message:\\n32" digest of the 32-byte fee hash. ${NOTHING_SPENT}`
    )
    this.name = 'ProviderFeeSignatureError'
    this.providerFee = fee
    this.recovered = details.recovered
    this.attempts = details.attempts
  }
}

/**
 * The fee's `messageHash`, exactly as `_checkProviderFee` packs it.
 *
 * Throws for a fee that cannot be packed, a missing field included: the contract has no
 * default for any of them, so none is assumed here.
 */
export function providerFeeMessageHash(fee: ProviderFeeLike): string {
  return solidityPackedKeccak256(
    ['bytes', 'address', 'address', 'uint256', 'uint256'],
    [
      String(required(fee, 'providerData')),
      getAddress(String(required(fee, 'providerFeeAddress'))),
      getAddress(String(required(fee, 'providerFeeToken'))),
      toUint256(required(fee, 'providerFeeAmount'), 'providerFeeAmount'),
      toUint256(required(fee, 'validUntil'), 'validUntil')
    ]
  )
}

/** The fields the fee lacks. Everything, for no fee or one that is not an object. */
export function missingProviderFeeFields(fee: unknown): string[] {
  if (!fee || typeof fee !== 'object') return [...PROVIDER_FEE_FIELDS]

  const record = fee as Record<string, unknown>

  return PROVIDER_FEE_FIELDS.filter((field) => isAbsent(record[field]))
}

/**
 * The address the datatoken's `ecrecover` returns for this fee: the zero address where the
 * precompile returns nothing (a `v` other than 27 or 28, `r` or `s` out of range, no
 * point), exactly as on chain. `undefined` for a fee that is missing a field or cannot be
 * encoded into the order call at all.
 */
export function recoverProviderFeeSigner(
  fee: ProviderFeeLike
): string | undefined {
  if (missingProviderFeeFields(fee).length) return undefined
  if (malformation(fee)) return undefined

  return ecrecover(fee)
}

/**
 * Whether the datatoken would accept this fee: complete, encodable, and signed so that
 * `ecrecover` gives `providerFeeAddress`.
 *
 * Like the contract, this accepts a fee whose `providerFeeAddress` is the zero address
 * when `ecrecover` gives the zero address too; the datatoken then charges nothing.
 */
export function isProviderFeeSignatureValid(fee: ProviderFeeLike): boolean {
  return providerFeeProblem(fee) === undefined
}

/**
 * Throws a `ProviderFeeSignatureError` unless the datatoken would accept the fee. A fee is
 * required: no fee, or one with a field missing, is refused too. Call this only where a
 * fee is sent; an order reused as it stands sends none and needs no check.
 */
export function assertProviderFeeSignature(
  fee: ProviderFeeLike | undefined,
  attempts = 1
): void {
  const problem = providerFeeProblem(fee)

  if (!problem) return

  throw feeError(
    fee,
    problem,
    attempts,
    problem.kind === 'signature'
      ? 'Ask the node for a new fee (initialize again).'
      : 'Ask the node for a complete fee (initialize again).'
  )
}

/**
 * The provider fee `settleOrder` will send to the datatoken, or `undefined` when it reuses
 * the order as it stands (an order in force and no fee due) and sends nothing.
 *
 * Any other answer sends a fee, so an answer with none gives `{}`: an empty fee, which the
 * check refuses before anything is spent.
 */
export function providerFeeToSend(initialized: {
  validOrder?: string | boolean
  providerFee?: unknown
}): ProviderFeeLike | undefined {
  const providerFee = initialized.providerFee as ProviderFeeLike | undefined

  if (initialized.validOrder && !isFeeDue(providerFee)) return undefined

  return providerFee ?? {}
}

/**
 * Whether the fee asks for a non-zero amount, compared as a number (`'0x0'` and `'00'` are
 * zero). An amount that does not parse counts as due, so the order is not reused as it
 * stands on the strength of it; the fee check then refuses it.
 */
export function isFeeDue(providerFee: ProviderFeeLike | undefined): boolean {
  const amount = providerFee?.providerFeeAmount

  if (isAbsent(amount)) return false

  try {
    return BigInt(amount as string | number | bigint) > 0n
  } catch {
    return true
  }
}

/**
 * What the datatoken pulls from the payer for this fee, if anything.
 *
 * Mirrors `_checkProviderFee`, which transfers only when the amount is non-zero and both
 * the token and `providerFeeAddress` are set. Call it on a fee that passed the check.
 */
export function chargedProviderFee(
  fee: ProviderFeeLike | undefined
): { token: string; amount: bigint } | undefined {
  if (!fee || !isFeeDue(fee)) return undefined

  const token = getAddress(String(fee.providerFeeToken))
  const collector = getAddress(String(fee.providerFeeAddress))

  if (token === ZeroAddress || collector === ZeroAddress) return undefined

  return {
    token,
    amount: BigInt(fee.providerFeeAmount as string | number | bigint)
  }
}

/**
 * Calls `initialize` until every provider fee in its answer is one the datatoken accepts,
 * and returns that answer. `feesOf` lists the fees the answer would send; `undefined`
 * stands for an order reused as it stands, which sends none.
 *
 * `attempts` is the total number of `initialize` calls (default 3: the first and up to two
 * retries, `delayMs` apart). A new fee normally has a new `validUntil` and so a new hash.
 * Where it cannot (a compute fee, or a download fee for a service with `timeout: 0`, whose
 * `validUntil` never changes), pass `attempts: 1`; a fee whose hash repeats also stops the
 * loop at once. A missing, incomplete or malformed fee is refused without asking again.
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
    const bad = feesOf(result).flatMap((fee) => {
      if (fee === undefined) return []

      const problem = providerFeeProblem(fee)

      return problem ? [{ fee, problem }] : []
    })

    if (!bad.length) return result

    // A missing or malformed fee is the shape of the answer, not its timing.
    const unusable = bad.find(({ problem }) => problem.kind !== 'signature')

    if (unusable)
      throw feeError(
        unusable.fee,
        unusable.problem,
        attempt,
        'The node was not asked again: a new request does not change which fields its answer carries.'
      )

    const { fee, problem } = bad[0]
    const hashes = bad.map(({ fee }) => hashOrUndefined(fee))
    const repeated = hashes.some((hash) => hash && seenBad.has(hash))

    if (repeated || attempt >= attempts)
      throw feeError(
        fee,
        problem,
        attempt,
        repeated
          ? `The node signed the same fee again on attempt ${attempt} (its validUntil does not change: a compute fee, or a service with timeout 0), so asking again cannot help.`
          : attempts === 1
            ? 'This fee is the same on every request (its validUntil does not change: a compute fee, or a service with timeout 0), so the node was not asked again.'
            : `The node was asked ${attempt} times and every fee had a signature the contract rejects.`
      )

    for (const hash of hashes) if (hash) seenBad.add(hash)

    await sleep(delayMs)
  }
}

// #region helpers

function providerFeeProblem(fee: unknown): FeeProblem | undefined {
  const missing = missingProviderFeeFields(fee)

  if (missing.length) return { kind: 'missing', fields: missing }

  const feeLike = fee as ProviderFeeLike
  const detail = malformation(feeLike)

  if (detail) return { kind: 'malformed', detail }

  const recovered = ecrecover(feeLike)

  return recovered === getAddress(String(feeLike.providerFeeAddress))
    ? undefined
    : { kind: 'signature', recovered }
}

function feeError(
  fee: unknown,
  problem: FeeProblem,
  attempts: number,
  reason: string
): ProviderFeeSignatureError {
  const feeLike = (fee && typeof fee === 'object' ? fee : {}) as ProviderFeeLike

  return new ProviderFeeSignatureError(feeLike, {
    attempts,
    reason,
    ...(problem.kind === 'missing' ? { missing: problem.fields } : {}),
    ...(problem.kind === 'malformed' ? { malformed: problem.detail } : {}),
    ...(problem.kind === 'signature' ? { recovered: problem.recovered } : {})
  })
}

/**
 * Why a fee with every field present still cannot be ABI-encoded into the order call, or
 * `undefined` when it can. `v` is a `uint8` and `r`/`s` are `bytes32` there.
 */
function malformation(fee: ProviderFeeLike): string | undefined {
  try {
    providerFeeMessageHash(fee)
  } catch (error) {
    return `its fields do not encode: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
  }

  if (toUint8(fee.v) === undefined) return `v is ${String(fee.v)}, not a uint8`

  for (const field of ['r', 's'] as const)
    if (!isHexString(String(fee[field]), 32))
      return `${field} is ${String(fee[field])}, not 32 bytes of hex`

  return undefined
}

/** `ecrecover` as the precompile computes it, for an encodable fee. */
function ecrecover(fee: ProviderFeeLike): string {
  const v = toUint8(fee.v)
  const r = BigInt(String(fee.r))
  let s = BigInt(String(fee.s))

  // The precompile returns nothing (the zero address) unless v is 27 or 28 and both r and
  // s lie in [1, n - 1].
  if (v !== 27 && v !== 28) return ZeroAddress
  if (r === 0n || r >= SECP256K1_N || s === 0n || s >= SECP256K1_N)
    return ZeroAddress

  let recoveryV = v
  // `ecrecover` accepts a high s, ethers does not: (r, n - s) with the other v recovers
  // the same key.
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s
    recoveryV = v === 27 ? 28 : 27
  }

  try {
    return recoverAddress(hashMessage(getBytes(providerFeeMessageHash(fee))), {
      r: toBeHex(r, 32),
      s: toBeHex(s, 32),
      v: recoveryV
    })
  } catch {
    // No curve point for this r: the precompile returns nothing.
    return ZeroAddress
  }
}

function hashOrUndefined(fee: ProviderFeeLike): string | undefined {
  try {
    return providerFeeMessageHash(fee)
  } catch {
    return undefined
  }
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function required<K extends keyof ProviderFees>(
  fee: ProviderFeeLike,
  field: K
): string | number | bigint {
  const value = fee[field]

  if (isAbsent(value)) throw new Error(`the fee has no ${field}`)

  return value as string | number | bigint
}

function toUint256(value: string | number | bigint, field: string): bigint {
  const parsed = BigInt(value)

  if (parsed < 0n) throw new Error(`${field} is negative`)

  return parsed
}

function toUint8(value: unknown): number | undefined {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255
    ? parsed
    : undefined
}

// #endregion
