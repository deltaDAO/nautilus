/**
 * The caller's consent to what a node asks to be paid.
 *
 * Two amounts in `access()` and `compute()` are chosen by a node rather than read from
 * chain: the provider fee (token, amount and collector, from `initialize` /
 * `initializeCompute`) and the compute escrow payment (contract, token and amount, from
 * `initializeCompute`). The fee signature check proves only that the node signed its fee,
 * and in `access()` the node is the service's `serviceEndpoint`, which the publisher
 * chooses. So nautilus pays neither unless the caller allowed it, with a ceiling
 * (`maxProviderFee`, `maxEscrowPayment`) or a confirmation callback
 * (`confirmProviderFees`, `confirmEscrowPayment`). A fee or payment of zero always passes.
 *
 * Everything here is read-only: no RPC call, no transaction.
 */
import { getAddress, isAddress } from 'ethers'
import { chargedProviderFee, type ProviderFeeLike } from './providerFee.js'

/** An amount of one ERC20 token, in the token's smallest unit (wei for 18 decimals). */
export interface TokenAmount {
  /** The token's address. */
  token: string
  /**
   * In the token's smallest unit: a `bigint`, or a decimal integer string such as
   * `'1500000000000000000'` (1.5 tokens at 18 decimals). Use `parseUnits('1.5', 18)` from
   * ethers to convert.
   */
  amount: bigint | string
}

/** One provider fee a call would pay, as passed to `confirmProviderFees`. */
export interface ProviderFeeQuote {
  /** The fee token, checksummed. */
  token: string
  /** In the token's smallest unit. Never zero: a zero fee is not quoted. */
  amount: bigint
  /** `providerFeeAddress`: who receives the fee. */
  collector: string
  /** The datatoken that pulls the fee during the order. */
  datatoken?: string
  /** The asset and service ordered, where known. */
  did?: string
  serviceId?: string
}

/** The escrow payment `compute()` would fund, as passed to `confirmEscrowPayment`. */
export interface EscrowPaymentQuote {
  /**
   * The escrow contract, checksummed. Always one known for the chain: the chain config's
   * `escrow`, or the `Escrow` / `EnterpriseEscrow` entry of Ocean's address data.
   */
  escrowAddress: string
  /** The payment token, checksummed. */
  token: string
  /** What the node may lock for the job, in the token's smallest unit. Never zero. */
  amount: bigint
  /** The address allowed to lock and claim it: the compute environment's account. */
  payee: string
  /** How long the node may keep the funds locked, in seconds. */
  minLockSeconds: bigint
  chainId: number
}

/**
 * How much provider fee a call may pay without asking.
 *
 * Without either option, a non-zero provider fee is refused with a
 * `ProviderFeeNotAllowedError` before anything is approved or sent.
 */
export interface ProviderFeeLimits {
  /**
   * The most the call may pay in provider fees, per token, in the token's smallest unit.
   * A call that orders several services (a compute job) is held to the sum of its fees in
   * each token. A fee in a token not listed here is not covered.
   */
  maxProviderFee?: TokenAmount | TokenAmount[]
  /**
   * Asked when `maxProviderFee` does not cover the call's fees, with every non-zero fee
   * the call would pay. Return `true` to pay them, `false` to refuse with a
   * `ProviderFeeNotAllowedError`. Not called when the fees are zero or within the ceiling.
   */
  confirmProviderFees?: (fees: ProviderFeeQuote[]) => boolean | Promise<boolean>
}

/**
 * How much a compute job may deposit and authorise in escrow without asking.
 *
 * Without either option, a paid job is refused with an `EscrowPaymentNotAllowedError`
 * before anything is approved or sent. Neither option can allow an escrow contract that is
 * not known for the chain: the chain config's `escrow`, or the `Escrow` / `EnterpriseEscrow`
 * entry of Ocean's address data.
 */
export interface EscrowPaymentLimits {
  /**
   * The most one job may lock in escrow, per payment token, in the token's smallest unit.
   */
  maxEscrowPayment?: TokenAmount | TokenAmount[]
  /**
   * Asked when `maxEscrowPayment` does not cover the job's payment. Return `true` to fund
   * and authorise it, `false` to refuse with an `EscrowPaymentNotAllowedError`.
   */
  confirmEscrowPayment?: (
    payment: EscrowPaymentQuote
  ) => boolean | Promise<boolean>
}

const NOTHING_SPENT =
  'Nothing was spent: this is checked before any approval, purchase, escrow or order transaction.'

/** Why a provider fee was refused. */
export type ProviderFeeRefusal =
  /** No `maxProviderFee` and no `confirmProviderFees`. */
  | 'no-limit'
  /** The fees exceed `maxProviderFee`, or are in a token it does not list. */
  | 'over-limit'
  /** `confirmProviderFees` returned `false`. */
  | 'declined'

/**
 * Thrown before an order whose provider fee the caller did not allow, ahead of any
 * approval, purchase, escrow or order transaction.
 */
export class ProviderFeeNotAllowedError extends Error {
  /** Every non-zero fee the call would have paid. */
  readonly fees: ProviderFeeQuote[]
  readonly reason: ProviderFeeRefusal

  constructor(fees: ProviderFeeQuote[], reason: ProviderFeeRefusal) {
    const listed = fees.map(describeFee).join('; ')

    super(
      `Refusing to pay ${fees.length === 1 ? 'a provider fee' : 'provider fees'} of ${listed}: ${
        reason === 'declined'
          ? 'confirmProviderFees declined it.'
          : reason === 'over-limit'
            ? 'it is more than maxProviderFee allows for that token. Raise maxProviderFee, or pass confirmProviderFees to decide per call.'
            : 'no maxProviderFee or confirmProviderFees allows it. The node sets this fee, so nautilus pays a non-zero one only with your consent: pass maxProviderFee (or confirmProviderFees) to this call or to Nautilus.create.'
      } ${NOTHING_SPENT}`
    )
    this.name = 'ProviderFeeNotAllowedError'
    this.fees = fees
    this.reason = reason
  }
}

/** Why an escrow payment was refused. */
export type EscrowPaymentRefusal =
  /** No escrow contract is known for the chain to compare the node's with. */
  | 'unknown-escrow'
  /** The node named an escrow contract that is not one known for the chain. */
  | 'escrow-address'
  /** The quote is for another chain, token or payee than this job, or is malformed. */
  | 'mismatch'
  /** No `maxEscrowPayment` and no `confirmEscrowPayment`. */
  | 'no-limit'
  /** The amount exceeds `maxEscrowPayment`, or is in a token it does not list. */
  | 'over-limit'
  /** `confirmEscrowPayment` returned `false`. */
  | 'declined'

/**
 * Thrown before a compute job's escrow deposit or authorisation when the node's quote
 * names an unexpected contract, chain, token or payee, or an amount the caller did not
 * allow; ahead of any approval, escrow or order transaction.
 */
export class EscrowPaymentNotAllowedError extends Error {
  /** The quote as the node sent it. */
  readonly payment: unknown
  readonly reason: EscrowPaymentRefusal

  constructor(payment: unknown, reason: EscrowPaymentRefusal, detail: string) {
    super(
      `Refusing to fund escrow for this compute job: ${detail} ${NOTHING_SPENT}`
    )
    this.name = 'EscrowPaymentNotAllowedError'
    this.payment = payment
    this.reason = reason
  }
}

/**
 * A ceiling as a map from checksummed token to amount. Throws for an address that is not
 * one, an amount that is not a non-negative integer, or a token listed twice.
 */
export function normaliseCeiling(
  ceiling: TokenAmount | TokenAmount[] | undefined,
  option: string
): Map<string, bigint> {
  const entries = ceiling === undefined ? [] : [ceiling].flat()
  const byToken = new Map<string, bigint>()

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !isAddress(entry.token))
      throw new Error(
        `${option}: every entry needs a token address, got ${safeJson(entry)}.`
      )

    const token = getAddress(entry.token)
    const amount = toBaseUnits(entry.amount)

    if (amount === undefined)
      throw new Error(
        `${option}: the amount for ${token} must be a non-negative integer in the token's smallest unit (a bigint or a decimal string), got ${safeJson(entry.amount)}.`
      )

    if (byToken.has(token))
      throw new Error(`${option}: ${token} is listed twice.`)

    byToken.set(token, amount)
  }

  return byToken
}

/** Checks a ceiling's shape without using it, so a bad one fails at configuration time. */
export function assertValidLimits(
  limits: ProviderFeeLimits & EscrowPaymentLimits
): void {
  normaliseCeiling(limits.maxProviderFee, 'maxProviderFee')
  normaliseCeiling(limits.maxEscrowPayment, 'maxEscrowPayment')

  for (const option of ['confirmProviderFees', 'confirmEscrowPayment'] as const)
    if (limits[option] !== undefined && typeof limits[option] !== 'function')
      throw new Error(`${option} must be a function.`)
}

/**
 * The provider fee a call would pay, as a quote, or `undefined` when it pays none: no fee,
 * a zero amount, or a zero token or collector (the datatoken then transfers nothing).
 * Call it on a fee that passed the signature check.
 */
export function quoteProviderFee(
  fee: ProviderFeeLike | undefined,
  context: Pick<ProviderFeeQuote, 'datatoken' | 'did' | 'serviceId'> = {}
): ProviderFeeQuote | undefined {
  const charged = chargedProviderFee(fee)

  if (!charged) return undefined

  return {
    token: charged.token,
    amount: charged.amount,
    collector: getAddress(String(fee?.providerFeeAddress)),
    ...definedOnly(context)
  }
}

/**
 * Exactly the fees given, as a ceiling: what `access()` and `compute()` pass on to
 * `order()`/`reuseOrder()` once the caller has allowed them, so the same fees are not
 * confirmed twice and nothing more can be paid.
 */
export function ceilingFor(
  fees: (ProviderFeeQuote | undefined)[]
): TokenAmount[] {
  const byToken = new Map<string, bigint>()

  for (const fee of fees)
    if (fee) byToken.set(fee.token, (byToken.get(fee.token) ?? 0n) + fee.amount)

  return [...byToken].map(([token, amount]) => ({ token, amount }))
}

/**
 * Throws a `ProviderFeeNotAllowedError` unless the caller allowed every fee: their sum per
 * token is within `maxProviderFee`, or `confirmProviderFees` returned `true`. Fees of zero
 * are not passed in, so a call that pays none always passes.
 */
export async function assertProviderFeesAllowed(
  quotes: (ProviderFeeQuote | undefined)[],
  limits: ProviderFeeLimits
): Promise<void> {
  const fees = quotes.filter(
    (fee): fee is ProviderFeeQuote => fee !== undefined
  )
  const ceiling = normaliseCeiling(limits.maxProviderFee, 'maxProviderFee')

  if (!fees.length) return

  const totals = new Map<string, bigint>()
  for (const fee of fees)
    totals.set(fee.token, (totals.get(fee.token) ?? 0n) + fee.amount)

  const covered = [...totals].every(([token, total]) => {
    const max = ceiling.get(token)
    return max !== undefined && total <= max
  })

  if (covered) return

  if (limits.confirmProviderFees) {
    if (
      (await limits.confirmProviderFees(fees.map((fee) => ({ ...fee })))) ===
      true
    )
      return

    throw new ProviderFeeNotAllowedError(fees, 'declined')
  }

  throw new ProviderFeeNotAllowedError(
    fees,
    limits.maxProviderFee === undefined ? 'no-limit' : 'over-limit'
  )
}

/**
 * Throws an `EscrowPaymentNotAllowedError` unless the caller allowed the payment: within
 * `maxEscrowPayment` for its token, or `confirmEscrowPayment` returned `true`. The quote's
 * contract, chain, token and payee are checked before this, by `checkEscrowQuote`.
 */
export async function assertEscrowPaymentAllowed(
  quote: EscrowPaymentQuote,
  limits: EscrowPaymentLimits,
  raw: unknown
): Promise<void> {
  const ceiling = normaliseCeiling(limits.maxEscrowPayment, 'maxEscrowPayment')
  const max = ceiling.get(quote.token)

  if (max !== undefined && quote.amount <= max) return

  const what = `${quote.amount} base units of ${quote.token} for ${quote.payee}`

  if (limits.confirmEscrowPayment) {
    if ((await limits.confirmEscrowPayment({ ...quote })) === true) return

    throw new EscrowPaymentNotAllowedError(
      raw,
      'declined',
      `confirmEscrowPayment declined ${what}.`
    )
  }

  throw limits.maxEscrowPayment === undefined
    ? new EscrowPaymentNotAllowedError(
        raw,
        'no-limit',
        `the node asks to lock ${what}, and no maxEscrowPayment or confirmEscrowPayment allows it. Pass maxEscrowPayment (or confirmEscrowPayment) to this call or to Nautilus.create.`
      )
    : new EscrowPaymentNotAllowedError(
        raw,
        'over-limit',
        `the node asks to lock ${what}, more than maxEscrowPayment allows for that token (${max ?? 'none'}).`
      )
}

/**
 * Checks the node's escrow quote against the job and the chain config, and returns it as
 * a quote, or `undefined` when it asks for nothing. Throws an
 * `EscrowPaymentNotAllowedError` when the contract is none of the known escrow contracts
 * for the chain (or none is known), or the chain, token or payee differ from the job's, or
 * a field is missing or not an exact integer.
 */
export function checkEscrowQuote(
  payment: unknown,
  expected: {
    /**
     * The escrow contracts known for the chain (see `knownEscrowContracts`), or one. Entries
     * that are not addresses are ignored.
     */
    escrow: string | readonly (string | undefined)[] | undefined
    chainId: number
    token: string
    payee: string
  }
): EscrowPaymentQuote | undefined {
  const quote = (payment ?? {}) as Record<string, unknown>
  const mismatch = (detail: string) =>
    new EscrowPaymentNotAllowedError(payment, 'mismatch', detail)

  const known = [
    ...new Set(
      [expected.escrow]
        .flat()
        .filter((entry): entry is string => !!entry && isAddress(entry))
        .map((entry) => getAddress(entry))
    )
  ]

  if (!known.length)
    throw new EscrowPaymentNotAllowedError(
      payment,
      'unknown-escrow',
      `no escrow contract is known for chain ${expected.chainId}: the chain config has no escrow, and Ocean's address data lists no Escrow or EnterpriseEscrow for it, so the one the node named (${String(quote.escrowAddress)}) cannot be checked. Pass the escrow contract your node uses as config.escrow to Nautilus.create.`
    )

  const escrow =
    typeof quote.escrowAddress === 'string' && isAddress(quote.escrowAddress)
      ? getAddress(quote.escrowAddress)
      : undefined

  if (!escrow || !known.includes(escrow))
    throw new EscrowPaymentNotAllowedError(
      payment,
      'escrow-address',
      `the node named escrow contract ${String(quote.escrowAddress)}, but the escrow contracts known for chain ${expected.chainId} are ${known.join(', ')} (the chain config's escrow and Ocean's address data). Only those are funded or authorised.`
    )

  if (quote.chainId !== undefined && Number(quote.chainId) !== expected.chainId)
    throw mismatch(
      `the quote is for chain ${String(quote.chainId)}, but the job is paid on chain ${expected.chainId}.`
    )

  if (
    quote.token !== undefined &&
    (typeof quote.token !== 'string' ||
      !isAddress(quote.token) ||
      getAddress(quote.token) !== getAddress(expected.token))
  )
    throw mismatch(
      `the quote is in token ${String(quote.token)}, but the job is paid in ${getAddress(expected.token)}.`
    )

  if (
    quote.payee !== undefined &&
    (typeof quote.payee !== 'string' ||
      !isAddress(quote.payee) ||
      getAddress(quote.payee) !== getAddress(expected.payee))
  )
    throw mismatch(
      `the quote names payee ${String(quote.payee)}, but the compute environment's account is ${getAddress(expected.payee)}.`
    )

  const amount = toBaseUnits(quote.amount)
  if (amount === undefined)
    throw mismatch(
      `the amount ${safeJson(quote.amount)} is not an exact non-negative integer in the token's smallest unit.`
    )

  const minLockSeconds = toBaseUnits(quote.minLockSeconds ?? 0)
  if (minLockSeconds === undefined)
    throw mismatch(
      `minLockSeconds ${safeJson(quote.minLockSeconds)} is not a non-negative integer.`
    )

  if (amount === 0n) return undefined

  return {
    escrowAddress: escrow,
    token: getAddress(expected.token),
    amount,
    payee: getAddress(expected.payee),
    minLockSeconds,
    chainId: expected.chainId
  }
}

// #region helpers

/**
 * A non-negative integer amount, exactly: a bigint, a decimal (or `0x`) integer string, or
 * a number that is a safe integer. `undefined` for anything else, a float or a number
 * beyond 2^53 included, whose exact value is already lost.
 */
function toBaseUnits(value: unknown): bigint | undefined {
  let parsed: bigint

  if (typeof value === 'bigint') parsed = value
  else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return undefined
    parsed = BigInt(value)
  } else if (
    typeof value === 'string' &&
    /^(0x[0-9a-f]+|\d+)$/i.test(value.trim())
  )
    parsed = BigInt(value.trim())
  else return undefined

  return parsed >= 0n ? parsed : undefined
}

function describeFee(fee: ProviderFeeQuote): string {
  const target =
    fee.did && fee.serviceId
      ? ` for ${fee.did}#${fee.serviceId}`
      : fee.datatoken
        ? ` for datatoken ${fee.datatoken}`
        : ''

  return `${fee.amount} base units of ${fee.token} to ${fee.collector}${target}`
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>
}

/** A value for an error message: JSON, with bigints as `123n`. */
function safeJson(value: unknown): string {
  try {
    return String(
      JSON.stringify(value, (_key, entry) =>
        typeof entry === 'bigint' ? `${entry}n` : entry
      )
    ).replace(/"(\d+n)"/g, '$1')
  } catch {
    return String(value)
  }
}

// #endregion
