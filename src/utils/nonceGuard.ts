/**
 * The nonce guard: one place that sees every transaction nautilus sends, before ocean.js
 * swallows its failure.
 *
 * ocean.js builds each contract call with the signer it was given and sends it with
 * `signer.sendTransaction` (`sendPreparedTransaction`), which catches every failure and
 * returns `null`. Each send took its nonce from a fresh `getNonce('pending')` read, so two
 * operations of one signer running at once (two publishes, a publish and an order) could
 * read the same nonce and one of them failed, and so did a send after a stale read from the
 * RPC; all nautilus saw was "ocean.js returned no transaction". `Nautilus.create()` wraps
 * the signer in a `NonceGuardSigner`, which:
 *
 * - **prevents** in-process collisions: for a signer that signs locally (an ethers
 *   `Wallet`), populate and broadcast run one at a time per (chain, address), with the
 *   nonce `max(local next, pending)`; the local counter advances only after a successful
 *   broadcast. Waiting for the receipt is not serialised;
 * - **recovers** from nonce-class refusals only (`NONCE_EXPIRED` / "nonce too low",
 *   `REPLACEMENT_UNDERPRICED`, "already known"): a transaction the chain already knows is
 *   returned, never sent again; one it does not know is sent again, identical but for the
 *   nonce, at most three times. A send that moves value (an order, a purchase, an
 *   approval, an escrow payment) is sent again only with proof from two RPCs that the first
 *   one can never land (`provenNeverSent`, `provenSlotsTaken`); otherwise, and always
 *   without a `verificationProvider`, it stops with "may have been sent";
 * - **reports** each send failure per contract, so `confirmTransaction()` names the cause
 *   instead of "ocean.js returned no transaction", when it is unambiguous which send
 *   failed.
 *
 * A timeout, a network error or any other refusal is never retried: the transaction may
 * have landed. Signers whose wallet assigns the nonce (`JsonRpcSigner`, browser wallets)
 * get no nonce and no resend, only the "already sent" check and the reporting; so does
 * every signer with `nonceManagement: 'off'`.
 *
 * In-process only: two processes sending with one key can still collide; the recovery
 * covers the occasional collision. Use one key per process.
 */
import {
  AbstractSigner,
  BaseWallet,
  getAddress,
  hexlify,
  isError,
  type Provider,
  resolveAddress,
  type Signer,
  Transaction,
  type TransactionRequest,
  TransactionResponse,
  type TypedDataDomain,
  type TypedDataField
} from 'ethers'
import { debug, debugRaw } from '../log/debug.js'
import { type Logger, log } from '../log/logger.js'
import { redactSecrets, sanitize } from '../node/messages.js'
import { createKeyedLock } from './keyedLock.js'

/**
 * `'auto'` (the default): nautilus sets the nonce of every transaction a locally signing
 * signer (an ethers `Wallet`) sends, one send at a time per address, and resends after a
 * nonce collision when that is provably safe. Wallet-managed signers get no nonce from
 * nautilus either way. `'off'`: nautilus never sets a nonce and never resends; it still
 * returns a transaction the chain already has and reports why a send failed.
 */
export type NonceManagement = 'auto' | 'off'

/** Why the guard gave up on a send. */
export type NonceGuardReason =
  /** It cannot prove the transaction was never sent, so it may still land. */
  | 'may-have-been-sent'
  /** Three attempts, each refused for its nonce. */
  | 'attempts-exhausted'
  /** The refused transaction cannot be checked: missing, unreadable, or not this send's. */
  | 'unverifiable'
  /** The nonce was set by the caller, or the wallet sets it: nautilus does not resend. */
  | 'not-managed'

/** A transaction the guard signed or saw for one send: its hash and nonce. */
export interface SentAttempt {
  hash: string
  nonce: number
}

/**
 * Thrown when a send was refused for its nonce and nautilus did not, or could not safely,
 * recover. The message names the transaction by hash and nonce, never by its signed bytes
 * (those go to the debug channel, topic `nonce`).
 */
export class NonceGuardError extends Error {
  readonly reason: NonceGuardReason
  /** The ethers error code of the last refusal, e.g. `NONCE_EXPIRED`. */
  readonly code?: string
  /** Every signed transaction of this send that was refused, in order. */
  readonly attempts: SentAttempt[]
  /**
   * Whether `attempts` lists every transaction of this send that may have reached the
   * chain. `false` when a refusal named no transaction nautilus could check, or when a
   * resend failed in a way that may follow its broadcast (a timeout): look the account's
   * transactions up by nonce then.
   */
  readonly attemptsComplete: boolean
  /** Whether this send moves value: an order, a purchase, an approval, an escrow payment. */
  readonly moneySend: boolean

  constructor(params: {
    reason: NonceGuardReason
    code?: string
    attempts: SentAttempt[]
    attemptsComplete?: boolean
    moneySend: boolean
    message: string
  }) {
    super(params.message)
    this.name = 'NonceGuardError'
    this.reason = params.reason
    this.code = params.code
    this.attempts = params.attempts
    this.attemptsComplete = params.attemptsComplete ?? true
    this.moneySend = params.moneySend
  }
}

/**
 * The selectors of the transactions nautilus sends that move no value: publishing, pricing
 * and metadata. Every other call, and any call with a `value`, counts as a money send and
 * is resent only with proof that the first one cannot land. Checked against ocean.js's
 * ABIs by `test/unit/NonceGuard.test.ts`.
 */
const NO_VALUE_SELECTORS = new Set([
  '0xe38d7cad', // ERC721Template.createERC20
  '0x1aa3adf9', // ERC721Template.setMetaData
  '0x19a18a85', // ERC721Template.setMetaDataAndTokenURI
  '0x467c97f5', // ERC721Template.setMetaDataState
  '0xf86b2bcf', // ERC721Factory.createNftWithErc20
  '0xaa897ddc', // ERC721Factory.createNftWithErc20WithDispenser
  '0xd282aa86', // ERC721Factory.createNftWithErc20WithFixedRate
  '0x191c918a', // ERC20Template.createDispenser
  '0x8b96412b', // ERC20Template.createFixedRate
  '0x680819eb' // FixedRateExchange.setRate
])

/** At most this many signed transactions per send. */
const MAX_ATTEMPTS = 3

/** How long a recorded failure stays available to `confirmTransaction()`. */
const FAILURE_TTL_MS = 60_000

/**
 * At most this many recorded sends per guard (and its `connect()` copies), and at most
 * this many contracts remembered as ambiguous (see `SendLog`).
 */
const MAX_RECORDED_SENDS = 64

/**
 * How long after its broadcast a transaction is assumed in flight: an RPC that does not
 * return it yet (a lagging or load-balanced backend) does not have its nonce taken again
 * within this time.
 */
const COUNTER_GRACE_MS = 60_000

/** At most this many broadcasts per (chain, address) are kept to be checked for a drop. */
const MAX_OUTSTANDING = 256

/**
 * How far above every other nonce source the "next nonce" an RPC names in its refusal may
 * be. A stale backend can lag by dozens (beta.2: 765 against 818); a larger hint is taken
 * for a garbled message, not a nonce, since a transaction sent with it would wait forever.
 */
const MAX_HINT_AHEAD = 256

/** At most this many blocks are searched for the transaction that took a nonce. */
const MAX_PROOF_BLOCKS = 128

/**
 * ethers error codes that mean a send never reached the chain: the wallet refused to sign
 * it, or the signer or the RPC refused it before accepting it.
 */
const NOT_BROADCAST_CODES = [
  'ACTION_REJECTED',
  'INSUFFICIENT_FUNDS',
  'INVALID_ARGUMENT',
  'UNSUPPORTED_OPERATION'
] as const

/**
 * The per-(chain, address) state of the guards of one process: the send lock and the local
 * nonce counter. Shared by every `Nautilus` instance, so two instances with one key do not
 * collide either.
 */
export class NonceGuardState {
  readonly lock = createKeyedLock()
  /** The next nonce per key, after the last successful broadcast at `at` (ms). */
  readonly next = new Map<string, SentAttempt & { next: number; at: number }>()
  /**
   * Per key, the latest `MAX_OUTSTANDING` broadcasts by nonce, each with its broadcast time
   * `at` (ms): the earliest one the RPC's pending count does not cover, when dropped,
   * leaves a gap no later transaction gets past.
   */
  readonly outstanding = new Map<
    string,
    Map<number, SentAttempt & { at: number }>
  >()
}

const processState = new NonceGuardState()

/** What a guard is built with. */
export interface NonceGuardOptions {
  nonceManagement?: NonceManagement
  /**
   * A second RPC on the same chain. Its reads are part of every proof that a transaction
   * was never sent: without it, a transaction that moves value is never sent again, and the
   * other proofs read the signer's provider twice.
   */
  verificationProvider?: Provider
  logger?: Logger
  /**
   * The sends recorded for `confirmTransaction()`. A guard's `connect()` copies (ocean.js's
   * confidential-chain wrapper makes one) share it, so a failure is found through either.
   */
  sends?: SendLog
  /** Only for tests: the state to use instead of the process-wide one. */
  state?: NonceGuardState
  /** Only for tests: how to wait between attempts. */
  sleep?: (ms: number) => Promise<void>
  /** Only for tests: the clock. */
  now?: () => number
}

/** A failed send as `confirmTransaction()` reports it. */
interface RecordedFailure {
  /**
   * The failure, for `cause`: the guard's `NonceGuardError`, or a sanitised copy of the
   * wallet's or RPC's error (`sanitizedSendError`), never the raw error.
   */
  error: unknown
  /** The error's message, sanitised. */
  text: string
  /** Whether the transaction may have reached the chain. */
  maySent: boolean
}

/**
 * The sends of a guard, by contract (`to`): each one's hash once broadcast, or its
 * failure. `confirmTransaction()` names a failure only when it is the only send to that
 * contract on record; with two (`Promise.all` of two orders of one asset, or a success
 * whose `wait()` then failed next to another call's failure) it cannot tell which call the
 * failure belongs to, and keeps its generic message.
 *
 * A broadcast stays on record until it is confirmed (its `wait()` resolved, or
 * `confirmTransaction()` got it), however long that takes; a failure for a minute. When
 * the record is full, failures go first; a broadcast that still has to go leaves its
 * contract ambiguous, so a later failure there is never named for the wrong call.
 */
export class SendLog {
  private records: Array<{
    at: number
    to?: string
    hash?: string
    failure?: RecordedFailure
    /** The error as thrown, for `forget`. */
    source?: unknown
  }> = []

  /** Contracts (`''` without one) of unconfirmed broadcasts dropped from a full record. */
  private readonly ambiguous = new Set<string>()

  constructor(private readonly now: () => number = Date.now) {}

  sent(to: string | undefined, hash: string): void {
    this.add({ to, hash })
  }

  failed(
    to: string | undefined,
    failure: RecordedFailure,
    source: unknown = failure.error
  ): void {
    this.add({ to, failure, source })
  }

  /** The send of `hash` was confirmed: it no longer competes with a failure. */
  settle(hash: string): void {
    this.records = this.records.filter((record) => record.hash !== hash)
  }

  /** The caller handled `error` itself (it was thrown to it, not swallowed). */
  forget(error: unknown): void {
    this.records = this.records.filter(
      (record) => !record.failure || record.source !== error
    )
  }

  /**
   * The failure of the only send on record to `to` (of the only send on record at all,
   * without `to`), once; `undefined` when that send succeeded, there was more than one, or
   * an unconfirmed send to `to` was dropped from a full record.
   */
  take(to?: string): RecordedFailure | undefined {
    this.prune()
    const target = to?.toLowerCase()
    if (target === undefined ? this.ambiguous.size : this.ambiguous.has(target))
      return undefined

    const candidates = this.records.filter(
      (record) => target === undefined || record.to === target
    )
    const [only] = candidates
    if (candidates.length !== 1 || !only.failure) return undefined

    this.records = this.records.filter((record) => record !== only)
    return only.failure
  }

  private add(record: {
    to?: string
    hash?: string
    failure?: RecordedFailure
    source?: unknown
  }) {
    this.prune()
    this.records.push({
      ...record,
      to: record.to?.toLowerCase(),
      at: this.now()
    })
    if (this.records.length <= MAX_RECORDED_SENDS) return

    const failure = this.records.findIndex((each) => each.failure)
    if (failure >= 0) {
      this.records.splice(failure, 1)
      return
    }
    // Only unconfirmed broadcasts: the oldest goes, and its contract stays ambiguous.
    const dropped = this.records.shift()
    const key = dropped?.to ?? ''
    this.ambiguous.delete(key)
    this.ambiguous.add(key)
    if (this.ambiguous.size > MAX_RECORDED_SENDS)
      this.ambiguous.delete(this.ambiguous.values().next().value as string)
  }

  /** Drops the failures older than `FAILURE_TTL_MS`; broadcasts stay until confirmed. */
  private prune(): void {
    const oldest = this.now() - FAILURE_TTL_MS
    this.records = this.records.filter(
      (record) => !record.failure || record.at >= oldest
    )
  }
}

/** Whether the signer signs transactions itself, so nautilus can choose the nonce. */
export function signsLocally(signer: Signer): boolean {
  if (signer instanceof BaseWallet) return true

  // An ethers `Wallet` from another copy of ethers: same shape.
  const candidate = signer as unknown as {
    signingKey?: unknown
    signTransaction?: unknown
  }
  return (
    typeof candidate.signingKey === 'object' &&
    candidate.signingKey !== null &&
    typeof candidate.signTransaction === 'function'
  )
}

/** The nonce-class refusal an error is, if any. */
export type NonceRefusal = 'nonce-expired' | 'underpriced' | 'already-known'

/** The RPC's own wording on an ethers error, or the error's short message. */
function refusalTexts(error: unknown): string[] {
  const value = error as {
    shortMessage?: unknown
    info?: { error?: { message?: unknown } }
    error?: { message?: unknown }
  } | null
  return [
    value?.shortMessage,
    value?.info?.error?.message,
    value?.error?.message
  ].filter((text): text is string => typeof text === 'string')
}

/**
 * `NONCE_EXPIRED` ("nonce too low", "nonce has already been used"),
 * `REPLACEMENT_UNDERPRICED`, or "already known" (which ethers reports as `UNKNOWN_ERROR`).
 * `undefined` for anything else: a timeout, a network error, any other refusal.
 */
export function nonceRefusalOf(error: unknown): NonceRefusal | undefined {
  if (isError(error, 'NONCE_EXPIRED')) return 'nonce-expired'
  if (isError(error, 'REPLACEMENT_UNDERPRICED')) return 'underpriced'

  const texts = refusalTexts(error).join('\n')
  // Nethermind answers "AlreadyKnown"; "unknown transaction type" is no such answer.
  if (/already ?known|\bknown transaction\b|already imported/i.test(texts))
    return 'already-known'
  if (/nonce too low|nonce has already been used/i.test(texts))
    return 'nonce-expired'
  if (
    /replacement transaction underpriced|replacement fee too low/i.test(texts)
  )
    return 'underpriced'

  return undefined
}

/** The signed transaction a failed `eth_sendRawTransaction` carries, if any. */
export function signedTransactionOf(error: unknown): string | undefined {
  const value = error as {
    transaction?: unknown
    payload?: { params?: unknown[] }
    info?: { transaction?: unknown; payload?: { params?: unknown[] } }
  } | null
  return [
    value?.transaction,
    value?.payload?.params?.[0],
    // "only replay-protected transactions" (`UNSUPPORTED_OPERATION`) keeps it here.
    value?.info?.transaction,
    value?.info?.payload?.params?.[0]
  ].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && /^0x[0-9a-f]{20,}$/i.test(candidate)
  )
}

/** The nonce an RPC names as the next one ("next nonce 819", "state: 819"), if it does. */
function suggestedNonce(error: unknown): number | undefined {
  for (const text of refusalTexts(error)) {
    const match = /next nonce:?\s*(\d+)|state:\s*(\d+)/i.exec(text)
    const value = Number(match?.[1] ?? match?.[2])
    if (match && Number.isSafeInteger(value)) return value
  }
  return undefined
}

/** Whether the transaction moves value; anything not known to move none counts. */
export function isMoneySend(request: TransactionRequest): boolean {
  if (request.value !== undefined && request.value !== null)
    if (BigInt(request.value) > 0n) return true

  const data = request.data ? hexlify(request.data).toLowerCase() : '0x'
  if (data === '0x') return false

  return !NO_VALUE_SELECTORS.has(data.slice(0, 10))
}

/** Whether a failed send certainly never reached the chain (see `NOT_BROADCAST_CODES`). */
export function notBroadcast(error: unknown): boolean {
  if (error instanceof NonceGuardError) return false
  // A hash on the error means the RPC accepted the transaction, whatever the code.
  if (
    (error as { info?: { sendTransactionHash?: unknown } } | null)?.info
      ?.sendTransactionHash
  )
    return false
  if (
    isError(error, 'UNSUPPORTED_OPERATION') &&
    /provider destroyed/i.test(error.shortMessage ?? error.message)
  )
    return false
  return NOT_BROADCAST_CODES.some((code) => isError(error, code))
}

/**
 * Errors `withoutSignedTransaction` already handled, each with what it returned: the error
 * itself, scrubbed in place, or a sanitised copy.
 */
const scrubbedErrors = new WeakMap<object, unknown>()

/** The fields of an ethers error that can carry a signed transaction, a URL or RPC text. */
interface ScrubbedFields {
  name?: unknown
  code?: unknown
  reason?: unknown
  action?: unknown
  hash?: unknown
  transactionHash?: unknown
  message?: unknown
  stack?: unknown
  shortMessage?: unknown
  transaction?: unknown
  request?: unknown
  response?: unknown
  payload?: { params?: unknown[] }
  error?: { message?: unknown }
  info?: {
    transaction?: unknown
    requestUrl?: unknown
    responseBody?: unknown
    sendTransactionHash?: unknown
    payload?: { params?: unknown[] }
    error?: { message?: unknown }
    info?: { error?: { message?: unknown } }
  }
}

/**
 * A failed send's error made safe to throw and print (an unmined signed transaction can be
 * broadcast by anyone who reads it, and an RPC's URL may carry its API key):
 *
 * - the signed transaction, wherever ethers puts it (`transaction`, the payload's
 *   parameter, `info.transaction`) and wherever a message quotes it (an RPC's echo too, in
 *   any letter case), becomes `<signed transaction 0x…hash>`;
 * - the HTTP request and response of a failed request (ethers' `SERVER_ERROR`: `request`,
 *   `response`, `info.responseBody`) become a note, and `info.requestUrl` its origin;
 * - every message (the error's, and its copy at the top of the stack; `shortMessage`; the
 *   RPC's own in `error` and `info.error`) is redacted as `redactSecrets` does: URLs to
 *   their origin, credentials.
 *
 * In place, so the caller keeps the error it would have got. When a field does not take
 * its redacted value (a frozen error, a read-only field), the error is returned as a
 * sanitised copy instead (`scrubbedCopy`); throw what this returns, never the argument.
 * The raw error goes to the debug channel (`nonce`) first. `confirmTransaction()`'s
 * `cause` is a sanitised copy either way (`sanitizedSendError`).
 */
export function withoutSignedTransaction(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error
  if (scrubbedErrors.has(error)) return scrubbedErrors.get(error)

  const raw = signedTransactionOf(error)
  if (raw) debugRaw('nonce', 'signed transaction of a failed send', raw)
  debugRaw('nonce', 'failed send before redaction', error)

  let hash = 'unknown'
  try {
    if (raw) hash = Transaction.from(raw).hash ?? hash
  } catch {
    // Not decodable: still removed.
  }
  const replacement = `<signed transaction ${hash}>`
  // The RPC may echo it in any letter case, with or without its `0x`.
  const quoted = raw ? new RegExp(`(?:0x)?${raw.slice(2)}`, 'gi') : undefined
  const clean = (text: string) =>
    redactSecrets(quoted ? text.replace(quoted, replacement) : text)

  const target = error as ScrubbedFields
  // Whether every field took its redacted value.
  let scrubbed = true
  const set = (holder: object, key: string, value: unknown) => {
    const fields = holder as Record<string, unknown>
    try {
      if (fields[key] === value) return
      fields[key] = value
      if (fields[key] !== value) scrubbed = false
    } catch {
      // A frozen error, a read-only field or a throwing getter keeps it: copy instead.
      scrubbed = false
    }
  }

  const message = target.message
  if (typeof message === 'string') {
    const cleaned = clean(message)
    set(target, 'message', cleaned)
    // The stack starts with the message as it was (its frames are left as they are).
    if (typeof target.stack === 'string' && cleaned !== message) {
      const stack = target.stack.split(message).join(cleaned)
      set(target, 'stack', quoted ? stack.replace(quoted, replacement) : stack)
    }
  }
  const shortMessage = target.shortMessage
  if (typeof shortMessage === 'string')
    set(target, 'shortMessage', clean(shortMessage))
  for (const nested of [
    target.error,
    target.info?.error,
    target.info?.info?.error
  ]) {
    const text = nested?.message
    if (nested && typeof text === 'string') set(nested, 'message', clean(text))
  }

  if (raw) {
    if (target.transaction === raw) set(target, 'transaction', replacement)
    if (target.info?.transaction === raw)
      set(target.info, 'transaction', replacement)
    for (const params of [target.payload?.params, target.info?.payload?.params])
      if (Array.isArray(params) && params[0] === raw)
        set(params, '0', replacement)
  }

  for (const field of ['request', 'response'] as const)
    if (target[field] !== undefined)
      set(target, field, `<${field} omitted: NAUTILUS_DEBUG, topic nonce>`)
  const info = target.info
  if (info && typeof info.requestUrl === 'string')
    set(info, 'requestUrl', redactSecrets(info.requestUrl))
  if (info && info.responseBody !== undefined && info.responseBody !== null)
    set(
      info,
      'responseBody',
      '<response body omitted: NAUTILUS_DEBUG, topic nonce>'
    )

  const result = scrubbed
    ? error
    : scrubbedCopy(target, clean, raw && replacement)
  scrubbedErrors.set(error, result)
  if (result !== error) scrubbedErrors.set(result as object, result)
  return result
}

/**
 * A new error for one that could not be redacted in place: its name, its ethers `code`,
 * `reason`, `action` and the hashes a caller checks (`hash`, `transactionHash`,
 * `info.sendTransactionHash`), and its messages redacted with `clean` (`message`,
 * `shortMessage`, the RPC's in `error` and `info.error`), `info.requestUrl` cut to its
 * origin, the signed transaction as `replacement`. No request, response, payload or body.
 */
function scrubbedCopy(
  error: ScrubbedFields,
  clean: (text: string) => string,
  replacement?: string
): Error {
  const text = (value: unknown) =>
    typeof value === 'string' ? clean(value) : undefined
  const id = (value: unknown) => (typeof value === 'string' ? value : undefined)
  try {
    const copy = new Error(text(error.message) ?? 'The send failed.') as Error &
      ScrubbedFields
    if (typeof error.name === 'string') copy.name = error.name
    for (const [key, value] of Object.entries({
      code: id(error.code),
      reason: id(error.reason),
      action: id(error.action),
      hash: id(error.hash),
      transactionHash: id(error.transactionHash),
      shortMessage: text(error.shortMessage),
      transaction: replacement || undefined
    }))
      if (value !== undefined)
        (copy as unknown as Record<string, unknown>)[key] = value

    const rpcMessage = text(error.error?.message)
    if (rpcMessage !== undefined) copy.error = { message: rpcMessage }
    const info = {
      sendTransactionHash: id(error.info?.sendTransactionHash),
      requestUrl:
        typeof error.info?.requestUrl === 'string'
          ? redactSecrets(error.info.requestUrl)
          : undefined,
      error:
        text(error.info?.error?.message) === undefined
          ? undefined
          : { message: text(error.info?.error?.message) }
    }
    if (Object.values(info).some((value) => value !== undefined))
      copy.info = JSON.parse(JSON.stringify(info))
    return copy
  } catch {
    return new Error('The send failed, with an error nautilus cannot read.')
  }
}

/**
 * A copy of a failed send's error that is safe to keep on `cause`: its name, `code`, and
 * its message and `shortMessage` sanitised (bounded, credentials, URLs and signed
 * transactions redacted), without the ethers error's request, response, payload or
 * transaction. The guard's own `NonceGuardError` carries none of those and is kept as it
 * is. The raw error went to the debug channel when it was redacted
 * (`withoutSignedTransaction`).
 */
function sanitizedSendError(error: unknown): unknown {
  if (error instanceof NonceGuardError) return error

  const value = error as {
    name?: unknown
    code?: unknown
    shortMessage?: unknown
  }
  const copy = new Error(
    sanitize(error instanceof Error ? error.message : String(error), 600, null)
  ) as Error & { code?: string; shortMessage?: string }
  if (typeof value?.name === 'string') copy.name = value.name
  if (typeof value?.code === 'string') copy.code = value.code
  if (typeof value?.shortMessage === 'string')
    copy.shortMessage = sanitize(value.shortMessage, 200, null)
  return copy
}

/** Whether the chain knows the transaction by hash: pending, or mined (by its receipt). */
async function isKnown(provider: Provider, hash: string): Promise<boolean> {
  return Boolean(
    (await provider.getTransaction(hash)) ??
      (await provider.getTransactionReceipt(hash))
  )
}

/**
 * The chain's response for the signed transaction `signed`, pending or mined, or `null`
 * when it does not know it. A mined transaction some RPCs no longer return by hash still
 * has a receipt; its response is then built from the signed transaction itself (ethers'
 * `receipt.getTransaction()` throws there).
 */
async function lookUp(
  provider: Provider,
  signed: Transaction
): Promise<TransactionResponse | null> {
  const hash = signed.hash as string
  const response = await provider.getTransaction(hash)
  if (response) return response

  const receipt = await provider.getTransactionReceipt(hash)
  if (!receipt) return null

  return new TransactionResponse(
    {
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      hash,
      index: receipt.index,
      type: signed.type ?? 0,
      to: signed.to,
      from: signed.from as string,
      nonce: signed.nonce,
      gasLimit: signed.gasLimit,
      gasPrice: signed.gasPrice ?? 0n,
      maxPriorityFeePerGas: signed.maxPriorityFeePerGas,
      maxFeePerGas: signed.maxFeePerGas,
      maxFeePerBlobGas: signed.maxFeePerBlobGas,
      data: signed.data,
      value: signed.value,
      chainId: signed.chainId,
      signature: signed.signature as NonNullable<Transaction['signature']>,
      accessList: signed.accessList,
      blobVersionedHashes: signed.blobVersionedHashes,
      authorizationList: signed.authorizationList
    },
    provider
  )
}

/**
 * Whether none of `attempts` can land, as far as the mined count and the hash index show:
 * first the account's mined count past the highest nonce on every provider (so each slot
 * was taken by the time of the read; nothing later can change which transaction holds
 * it), then each hash unknown on two reads, the second through `second` when given, a
 * moment later. Never throws: a read that fails is no proof.
 *
 * It still trusts the hash index: an RPC whose index lags its state reports a mined
 * transaction as unknown. A transaction that moves value therefore also needs
 * `provenSlotsTaken`.
 */
export async function provenNeverSent(params: {
  provider: Provider
  second?: Provider
  address: string
  attempts: SentAttempt[]
  sleep?: (ms: number) => Promise<void>
}): Promise<boolean> {
  const { provider, address, attempts } = params
  if (!attempts.length) return false

  const second = params.second ?? provider
  const highest = Math.max(...attempts.map((attempt) => attempt.nonce))

  try {
    const latest = await Promise.all(
      [...new Set([provider, second])].map((each) =>
        each.getTransactionCount(address, 'latest')
      )
    )
    if (latest.some((count) => count <= highest)) return false

    for (const attempt of attempts)
      if (await isKnown(provider, attempt.hash)) return false

    await (params.sleep ?? wait)(500)

    for (const attempt of attempts)
      if (await isKnown(second, attempt.hash)) return false

    debug('sensitive', 'nonce', 'never-sent proof', {
      address,
      attempts,
      latest,
      secondProvider: Boolean(params.second)
    })

    return true
  } catch {
    return false
  }
}

/**
 * Positive proof that none of `attempts` can ever be mined: for each one's nonce, the
 * transaction of `address` with that nonce found in a **finalized** block since the send
 * (`fromBlock`, read just before the first broadcast, minus one), and it is another call.
 * A holder only in the unfinalized tip proves nothing: a reorganisation can drop it and
 * mine the attempt in its slot, so a resend would land as well. **Every** provider must
 * show this for every nonce on its own: a provider on another fork, or one that forged a
 * block, cannot prove it alone. No proof when any provider shows one of `attempts` in a
 * block, has a holder above its finalized block (or no finalized block), does not return
 * a block up to its head, has more than `MAX_PROOF_BLOCKS` blocks to read, or fails a
 * read; nor when the transaction holding a nonce makes the same call (`call`: same
 * recipient and same function), which may be this send sped up in a wallet or retried by
 * another process, so this send would land twice. A nonce taken before the send (the
 * stale read of the beta.2 run) is not in those blocks either, so such a send stops with
 * "may have been sent"; so does, in practice, a collision a moment ago on a chain that
 * takes minutes to finalize (an OP Stack chain): nautilus does not wait for finality.
 */
export async function provenSlotsTaken(params: {
  providers: Provider[]
  address: string
  attempts: SentAttempt[]
  fromBlock?: number
  /** The call `attempts` make: their recipient and calldata. */
  call?: { to: string | null; data: string }
}): Promise<boolean> {
  const { address, attempts, call } = params
  if (params.fromBlock === undefined || !attempts.length) return false

  const ours = new Set(attempts.map((attempt) => attempt.hash.toLowerCase()))
  const nonces = attempts.map((attempt) => attempt.nonce)
  const start = Math.max(0, params.fromBlock - 1)
  const takenBy: Record<number, string>[] = []
  const verdict = (proven: boolean, why: string) => {
    debug('sensitive', 'nonce', 'slots-taken proof', {
      address,
      attempts,
      fromBlock: start,
      takenBy,
      proven,
      why
    })
    return proven
  }

  try {
    for (const provider of [...new Set(params.providers)]) {
      // Read first: a block at or below it, read afterwards, is final.
      const finalized = (await provider.getBlock('finalized'))?.number
      if (typeof finalized !== 'number')
        return verdict(false, 'no finalized block')
      const head = await provider.getBlockNumber()
      if (head - start + 1 > MAX_PROOF_BLOCKS)
        return verdict(false, 'too many blocks since the send')

      const open = new Set(nonces)
      const taken: Record<number, string> = {}
      takenBy.push(taken)
      for (let number = start; number <= head && open.size; number++) {
        const block = await provider.getBlock(number, true)
        if (!block) return verdict(false, `block ${number} not returned`)

        for (const tx of block.prefetchedTransactions) {
          if (tx.from.toLowerCase() !== address.toLowerCase()) continue
          if (ours.has(tx.hash.toLowerCase()))
            return verdict(false, `${tx.hash} is ours, mined`)
          if (!open.has(tx.nonce)) continue
          if (call && sameCall(tx, call))
            return verdict(false, `${tx.hash} makes the same call`)
          if (number > finalized)
            return verdict(
              false,
              `${tx.hash} holds nonce ${tx.nonce} in block ${number}, above the finalized block ${finalized}`
            )
          open.delete(tx.nonce)
          taken[tx.nonce] = tx.hash
        }
      }
      if (open.size)
        return verdict(
          false,
          `nonces ${[...open].join(', ')} not accounted for`
        )
    }
  } catch {
    return verdict(false, 'a read failed')
  }

  return verdict(true, 'every slot taken by another call on every provider')
}

/** Whether `tx` calls the same function of the same contract as `call`. */
function sameCall(
  tx: { to?: string | null; data?: string },
  call: { to: string | null; data: string }
): boolean {
  return (
    (tx.to?.toLowerCase() ?? null) === (call.to?.toLowerCase() ?? null) &&
    (tx.data ?? '0x').slice(0, 10).toLowerCase() ===
      call.data.slice(0, 10).toLowerCase()
  )
}

/** The latest block number, or `undefined` when it cannot be read. */
async function blockNumberOf(provider: Provider): Promise<number | undefined> {
  try {
    return await provider.getBlockNumber()
  } catch {
    return undefined
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * An ethers `AbstractSigner` that delegates to the user's signer, adding the nonce
 * handling described at the top of this file. `Nautilus.create()` installs it; nautilus
 * sends every transaction through it.
 */
export class NonceGuardSigner extends AbstractSigner {
  readonly signer: Signer
  readonly nonceManagement: NonceManagement
  readonly verificationProvider?: Provider
  /** The sends on record, shared with this guard's `connect()` copies. */
  readonly sends: SendLog
  private readonly options: NonceGuardOptions
  private readonly state: NonceGuardState
  private readonly log: Logger
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(signer: Signer, options: NonceGuardOptions = {}) {
    super(signer.provider)
    this.signer = signer
    this.nonceManagement = options.nonceManagement ?? 'auto'
    this.verificationProvider = options.verificationProvider
    this.now = options.now ?? Date.now
    this.sends = options.sends ?? new SendLog(this.now)
    this.options = { ...options, sends: this.sends }
    this.state = options.state ?? processState
    this.log = options.logger ?? log
    this.sleep = options.sleep ?? wait
  }

  /** Whether nautilus chooses the nonces: `'auto'` and a locally signing signer. */
  get managesNonces(): boolean {
    return this.nonceManagement === 'auto' && signsLocally(this.signer)
  }

  connect(provider: Provider | null): NonceGuardSigner {
    return new NonceGuardSigner(this.signer.connect(provider), this.options)
  }

  getAddress(): Promise<string> {
    return this.signer.getAddress()
  }

  signTransaction(tx: TransactionRequest): Promise<string> {
    return this.signer.signTransaction(tx)
  }

  signMessage(message: string | Uint8Array): Promise<string> {
    return this.signer.signMessage(message)
  }

  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string> {
    return this.signer.signTypedData(domain, types, value)
  }

  /**
   * The failure of the only send to contract `to` on record, once (see `SendLog`): read by `confirmTransaction()` when ocean.js returned no transaction.
   */
  takeFailure(
    to?: string
  ): { error: unknown; text: string; maySent: boolean } | undefined {
    return this.sends.take(to)
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const to = await this.recipientOf(tx)
    if (!this.managesNonces) return this.sendUnmanaged(tx, to)

    const provider = this.requireProvider()
    const address = getAddress(await this.signer.getAddress())
    let chainId: bigint
    try {
      ;({ chainId } = await provider.getNetwork())
    } catch (error) {
      // Nothing was sent: the chain could not be read.
      throw this.fail(error, to, { notSent: true })
    }
    const key = `${chainId}:${address.toLowerCase()}`

    return this.state.lock(key, () =>
      this.sendManaged({ key, address, chainId, to }, tx)
    )
  }

  private requireProvider(): Provider {
    if (!this.provider)
      throw new Error('The signer has no provider, so it cannot send.')
    return this.provider
  }

  /** The contract a send goes to, lower case, for the send record; `undefined` if unknown. */
  private async recipientOf(
    tx: TransactionRequest
  ): Promise<string | undefined> {
    if (tx.to === undefined || tx.to === null) return undefined
    try {
      return (await resolveAddress(tx.to, this)).toLowerCase()
    } catch {
      return undefined
    }
  }

  /**
   * Records the broadcast `response` for `confirmTransaction()` until it is confirmed:
   * when its `wait()` resolves (ocean.js waits for every transaction it sends), or when
   * `confirmTransaction()` gets it. A `wait()` that throws leaves it on record, so another
   * call's failure to the same contract is not named for this one.
   */
  private track(
    to: string | undefined,
    response: TransactionResponse
  ): TransactionResponse {
    this.sends.sent(to, response.hash)
    const wait = response.wait
    if (typeof wait !== 'function') return response

    const sends = this.sends
    try {
      Object.defineProperty(response, 'wait', {
        configurable: true,
        writable: true,
        value: async (...args: Parameters<TransactionResponse['wait']>) => {
          const receipt = await wait.apply(response, args)
          sends.settle(response.hash)
          return receipt
        }
      })
    } catch {
      // A frozen response stays on record until `confirmTransaction()` gets it.
    }
    return response
  }

  /** The wallet sets the nonce: send, and only check a nonce refusal for "already sent". */
  private async sendUnmanaged(
    tx: TransactionRequest,
    to: string | undefined
  ): Promise<TransactionResponse> {
    try {
      return this.track(to, await this.signer.sendTransaction(tx))
    } catch (error) {
      const outcome = await this.recover({
        error,
        request: tx,
        attempts: [],
        attempt: MAX_ATTEMPTS,
        resend: false
      })
      if ('response' in outcome) return this.track(to, outcome.response)
      throw this.fail('error' in outcome ? outcome.error : error, to)
    }
  }

  private async sendManaged(
    send: { key: string; address: string; chainId: bigint; to?: string },
    request: TransactionRequest
  ): Promise<TransactionResponse> {
    const { key, address, to } = send
    const explicit = request.nonce !== undefined && request.nonce !== null
    const provider = this.requireProvider()
    let nonce: number
    let fromBlock: number | undefined
    try {
      ;[nonce, fromBlock] = await Promise.all([
        explicit ? Number(request.nonce) : this.nextNonce(key, address),
        // Where a money send's proof looks for the transaction that took its nonce.
        isMoneySend(request) ? blockNumberOf(provider) : undefined
      ])
    } catch (error) {
      // Nothing was sent: the nonce could not be read.
      throw this.fail(error, to, { notSent: true })
    }
    const attempts: SentAttempt[] = []

    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.signer.sendTransaction({
          ...request,
          nonce
        })
        this.advance(key, { hash: response.hash, nonce })
        this.track(to, response)
        debug('sensitive', 'nonce', 'broadcast', {
          address,
          nonce,
          hash: response.hash,
          attempt
        })
        return response
      } catch (error) {
        const outcome = await this.recover({
          error,
          request,
          address,
          key,
          chainId: send.chainId,
          attempts,
          attempt,
          resend: !explicit,
          fromBlock
        })

        if ('response' in outcome) return this.track(to, outcome.response)
        if ('nonce' in outcome) {
          nonce = outcome.nonce
          await this.sleep(500 + Math.floor(Math.random() * 1500))
          continue
        }
        throw this.fail(outcome.error, to)
      }
    }
  }

  /**
   * The nonce for the next send: `max(local next, pending)`. A local counter ahead of the
   * pending count is kept unless the earliest broadcast the pending count does not cover
   * (else the last one counted) was dropped (`wasDropped`): one that was dropped leaves a
   * gap no later transaction gets past, so this send takes the pending count, filling it.
   * The counter stays, so the send after it skips the transactions still waiting behind
   * the gap. The dropped broadcast stays on record until one at its nonce succeeds, so a
   * refill that fails leaves the gap to the next send.
   */
  private async nextNonce(key: string, address: string): Promise<number> {
    const provider = this.requireProvider()
    const pending = await provider.getTransactionCount(address, 'pending')
    const local = this.state.next.get(key)
    const outstanding = this.state.outstanding.get(key)

    let nonce = pending
    if (local && local.next > pending) {
      // Below `pending` the RPC counts every slot (pending or mined): no gap there.
      const uncounted = [...(outstanding?.keys() ?? [])].filter(
        (sent) => sent >= pending
      )
      const gap =
        (uncounted.length && outstanding?.get(Math.min(...uncounted))) || local
      if (await this.wasDropped(gap, address)) {
        // The record stays until a broadcast at its nonce replaces it (`advance`): a send
        // that fails here leaves the gap for the next one to fill.
        this.log.emit(
          'chain.nonce.counter_reset',
          `The RPC no longer knows transaction ${gap.hash} (nonce ${gap.nonce}) of ${address}, and the account has not mined past that nonce, so it was dropped: the next transaction takes the RPC's pending count ${pending}.`,
          { address, txNonce: gap.nonce, pending, txHash: gap.hash }
        )
      } else nonce = local.next
    }

    debug('sensitive', 'nonce', 'nonce chosen', {
      address,
      pending,
      local: local?.next,
      nonce
    })
    return nonce
  }

  /**
   * Whether a counted transaction was dropped, so its nonce must be taken again: sent
   * more than `COUNTER_GRACE_MS` ago, unknown by hash on two reads (the second through
   * the verification provider, a moment later), and the account's mined count on each
   * provider not past its nonce. An RPC that merely lags (it answers `pending` and the
   * hash lookup from a backend that has not seen the transaction yet) fails the first or
   * the last condition. A read that fails proves nothing: the counter stays.
   */
  private async wasDropped(
    local: SentAttempt & { at: number },
    address: string
  ): Promise<boolean> {
    if (this.now() - local.at < COUNTER_GRACE_MS) return false

    const provider = this.requireProvider()
    const second = this.verificationProvider ?? provider
    try {
      if (await isKnown(provider, local.hash)) return false
      await this.sleep(500)
      if (await isKnown(second, local.hash)) return false

      for (const each of new Set([provider, second]))
        if ((await each.getTransactionCount(address, 'latest')) > local.nonce)
          return false
      return true
    } catch {
      return false
    }
  }

  private advance(key: string, sent: SentAttempt): void {
    const at = this.now()
    const current = this.state.next.get(key)
    if (!current || sent.nonce + 1 > current.next)
      this.state.next.set(key, { ...sent, next: sent.nonce + 1, at })

    let outstanding = this.state.outstanding.get(key)
    if (!outstanding) {
      outstanding = new Map()
      this.state.outstanding.set(key, outstanding)
    }
    outstanding.set(sent.nonce, { ...sent, at })
    if (outstanding.size > MAX_OUTSTANDING)
      outstanding.delete(Math.min(...outstanding.keys()))
  }

  /**
   * What to do after a refused send: return the transaction the chain already has, send
   * again with `nonce`, or give up with `error`. Only nonce-class refusals of a transaction
   * that is provably this send's are recovered from.
   */
  private async recover(params: {
    error: unknown
    request: TransactionRequest
    address?: string
    key?: string
    chainId?: bigint
    attempts: SentAttempt[]
    attempt: number
    resend: boolean
    /** The block number read before the first broadcast, for a money send's proof. */
    fromBlock?: number
  }): Promise<
    { response: TransactionResponse } | { nonce: number } | { error: unknown }
  > {
    const { error, request, attempts } = params
    const refusal = nonceRefusalOf(error)
    const code = (error as { code?: unknown } | null)?.code
    const raw = signedTransactionOf(error)
    // Read before the error is redacted: the redaction can take the number with it.
    const suggested = suggestedNonce(error)

    debug('sensitive', 'nonce', 'send refused', {
      code,
      refusal: refusal ?? 'not a nonce refusal',
      attempt: params.attempt
    })

    const moneySend = isMoneySend(request)
    const stop = (
      reason: NonceGuardReason,
      message: string,
      attemptsComplete = true
    ) => ({
      error: new NonceGuardError({
        reason,
        code: typeof code === 'string' ? code : undefined,
        attempts,
        attemptsComplete,
        moneySend,
        message
      })
    })
    const address = params.address ?? getAddress(await this.signer.getAddress())

    // A timeout, a network error, any other refusal: the transaction may have landed.
    if (!refusal) {
      const scrubbed = withoutSignedTransaction(error)
      if (!attempts.length) return { error: scrubbed }

      // A resend failed otherwise: the earlier refused transactions stay on record.
      const sentNot = notBroadcast(error)
      const last = attempts[attempts.length - 1]
      return stop(
        'may-have-been-sent',
        `Transaction ${last.hash} (nonce ${last.nonce}) of ${address} was refused for its nonce and sent again, and that send failed (${describeFailure(scrubbed)}). ${sentNot ? 'The earlier transaction' : 'Either transaction'} may have been sent: check the account's latest transactions before retrying.`,
        sentNot
      )
    }

    // The refusal itself (with the RPC's unredacted text and the signed transaction) goes
    // to the debug channel only: it is redacted (in place, else copied), and the errors
    // below name its code and the RPC's message, redacted.
    const refused = withoutSignedTransaction(error)

    const decoded = raw ? decode(raw) : undefined

    if (
      !decoded ||
      !(await this.isThisSend(decoded, request, address, params.chainId))
    )
      return stop(
        'unverifiable',
        `The transaction from ${address} was refused (${describeRefusal(refused)}), and the refusal ${decoded ? 'names a different transaction' : 'carries no transaction nautilus can check'}, so nautilus cannot tell whether it was sent: it did not send it again. Check the account's latest transactions before retrying.`,
        false
      )

    const sent: SentAttempt = {
      hash: decoded.hash as string,
      nonce: decoded.nonce
    }
    attempts.push(sent)
    const provider = this.requireProvider()

    // Known by hash: it was sent (maybe by an earlier attempt). Never send it again. A
    // lookup that fails proves nothing either way, so nothing is sent again.
    let known: TransactionResponse | null
    try {
      known = await lookUp(provider, decoded)
      for (
        let poll = 0;
        !known && refusal === 'already-known' && poll < 3;
        poll++
      ) {
        await this.sleep(500)
        known = await lookUp(provider, decoded)
      }
    } catch {
      return stop(
        'may-have-been-sent',
        `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} was refused for its nonce (${describeRefusal(refused)}), and the RPC could not be asked whether it has it: it may have been sent, check the account's latest transactions before retrying.`
      )
    }
    if (known) {
      if (params.key) this.advance(params.key, sent)
      this.log.emit(
        'chain.nonce.already_sent',
        `The RPC refused transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} as ${describeRefusal(refused)}, but it already has it: nautilus waits for it instead of sending it again.`,
        { address, txNonce: sent.nonce, txHash: sent.hash, code }
      )
      return { response: known }
    }

    if (refusal === 'already-known')
      return stop(
        'may-have-been-sent',
        `The RPC reported transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} as already known, but does not return it: it may have been sent, check the account's latest transactions before retrying.`
      )

    if (!params.resend || !params.key)
      return stop(
        'not-managed',
        `Transaction ${sent.hash} of ${address} was refused for its nonce ${sent.nonce} (${describeRefusal(refused)}). ${this.managesNonces ? 'The nonce was set by the caller' : this.nonceManagement === 'off' ? "nonceManagement is 'off'" : 'The wallet sets the nonce'}, so nautilus did not send it again.`
      )

    if (params.attempt >= MAX_ATTEMPTS)
      return stop(
        'attempts-exhausted',
        `Transaction of ${address} refused for its nonce ${MAX_ATTEMPTS} times (last ${sent.hash}, nonce ${sent.nonce}: ${describeRefusal(refused)}). The RPC's nonce answers may be stale; nautilus stopped sending.`
      )

    if (moneySend) {
      const second = this.verificationProvider
      if (!second)
        return stop(
          'may-have-been-sent',
          `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} moves value and was refused for its nonce (${describeRefusal(refused)}). nautilus sends such a transaction again only with proof from a second RPC (the verificationProvider option, not set) that the first can never be mined: it may have been sent, check the account's latest transactions before retrying.`
        )
      if (
        !(await provenNeverSent({
          provider,
          second,
          address,
          attempts,
          sleep: this.sleep
        })) ||
        !(await provenSlotsTaken({
          providers: [provider, second],
          address,
          attempts,
          fromBlock: params.fromBlock,
          call: { to: decoded.to, data: decoded.data }
        }))
      )
        return stop(
          'may-have-been-sent',
          `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} moves value and was refused for its nonce (${describeRefusal(refused)}), and nautilus cannot prove it can never be mined: it may have been sent, check the account's latest transactions before retrying.`
        )
    }

    let pending: number
    let latest: number
    try {
      ;[pending, latest] = await Promise.all([
        provider.getTransactionCount(address, 'pending'),
        provider.getTransactionCount(address, 'latest')
      ])
    } catch (readError) {
      return stop(
        'may-have-been-sent',
        `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} was refused for its nonce (${describeRefusal(refused)}), and the RPC could not be asked for the account's next nonce (${describeFailure(withoutSignedTransaction(readError))}): nautilus did not send it again. It may have been sent: check the account's latest transactions before retrying.`
      )
    }
    const local = this.state.next.get(params.key)?.next ?? 0
    const floor = Math.max(local, pending, latest, sent.nonce + 1)
    // A hint far above every other source is a garbled message, not a nonce.
    const nonce =
      suggested !== undefined && suggested <= floor + MAX_HINT_AHEAD
        ? Math.max(suggested, floor)
        : floor

    this.log.emit(
      'chain.nonce.resending',
      `Transaction ${sent.hash} of ${address} was refused for its nonce ${sent.nonce} (${describeRefusal(refused)}) and the chain does not have it: sending the same transaction again with nonce ${nonce}.`,
      {
        address,
        txNonce: sent.nonce,
        nextNonce: nonce,
        txHash: sent.hash,
        code
      }
    )
    debug('sensitive', 'nonce', 'resync', {
      address,
      refused: sent,
      pending,
      latest,
      local,
      suggested,
      nonce
    })

    return { nonce }
  }

  /** Whether the signed transaction is this send's: same chain, sender, recipient and data. */
  private async isThisSend(
    decoded: Transaction,
    request: TransactionRequest,
    address: string,
    chainId?: bigint
  ): Promise<boolean> {
    try {
      const to =
        request.to === undefined || request.to === null
          ? null
          : await resolveAddress(request.to, this)
      const data = request.data ? hexlify(request.data) : '0x'
      const chain =
        chainId ?? (await this.requireProvider().getNetwork()).chainId
      return (
        decoded.chainId === chain &&
        decoded.from?.toLowerCase() === address.toLowerCase() &&
        (decoded.to?.toLowerCase() ?? null) === (to?.toLowerCase() ?? null) &&
        decoded.data.toLowerCase() === data.toLowerCase() &&
        decoded.value === BigInt(request.value ?? 0)
      )
    } catch {
      return false
    }
  }

  /**
   * Records the failure for `confirmTransaction()` (a sanitised copy, for its `cause`) and
   * reports it; returns the error to throw, redacted in place (`withoutSignedTransaction`:
   * no signed transaction, no RPC URL path, no HTTP request). `notSent`: nothing was
   * broadcast (the nonce could not be read).
   */
  private fail(
    error: unknown,
    to: string | undefined,
    options: { notSent?: boolean } = {}
  ): unknown {
    // `error` itself, redacted, or a sanitised copy where it cannot be.
    const thrown = withoutSignedTransaction(error)
    const text = sanitize(
      thrown instanceof Error ? thrown.message : String(thrown),
      600,
      'nonce'
    )
    const maySent = !options.notSent && !notBroadcast(error)
    this.sends.failed(
      to,
      { error: sanitizedSendError(thrown), text, maySent },
      thrown
    )

    if (error instanceof NonceGuardError)
      this.log.emit('chain.nonce.gave_up', error.message, {
        reason: error.reason,
        code: error.code,
        attempts: error.attempts.map((attempt) => attempt.hash),
        attemptsComplete: error.attemptsComplete,
        moneySend: error.moneySend
      })
    else
      this.log.emit(
        'chain.send.failed',
        maySent
          ? `A send failed, and the transaction may have reached the chain: ${text}`
          : `A transaction was not sent: ${text}`,
        {
          code: (error as { code?: unknown } | null)?.code,
          maySent
        }
      )

    return thrown
  }
}

function decode(raw: string): Transaction | undefined {
  try {
    const decoded = Transaction.from(raw)
    return decoded.from && decoded.hash ? decoded : undefined
  } catch {
    return undefined
  }
}

/** The refusal in a few words, from the RPC's own message: no signed bytes, bounded. */
function describeRefusal(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const text = refusalTexts(error)
    .map((part) => sanitize(part, 120, 'nonce'))
    .filter(Boolean)
  const unique = [...new Set(text)].join('; ')
  return `${typeof code === 'string' ? code : 'refused'}${unique ? `: ${unique}` : ''}`
}

/** A failed send in a few words: its message, sanitised and bounded. */
function describeFailure(error: unknown): string {
  return sanitize(
    error instanceof Error ? error.message : String(error),
    200,
    'nonce'
  )
}

/** The sentence `confirmTransaction()` adds when a failed send may still have landed. */
const MAY_HAVE_BEEN_SENT =
  "It may have been sent: check the account's latest transactions before retrying."

/**
 * The text naming a recorded failure: its message, and, when the transaction may have
 * reached the chain and the message does not say so already, `MAY_HAVE_BEEN_SENT`.
 */
export function failureText(failure: {
  text: string
  maySent: boolean
}): string {
  return failure.maySent &&
    !/check the account's latest transactions/i.test(failure.text)
    ? `${failure.text.replace(/\.$/, '')}. ${MAY_HAVE_BEEN_SENT}`
    : failure.text
}

/**
 * `error`, naming the send failure the guard of `signer` recorded for contract `to`, if
 * there is exactly one (see `SendLog`): for an ocean.js call that throws a generic error
 * of its own when the send fails (`createDatatoken`'s "Failed to send createDatatoken
 * transaction", `approveWei` returning nothing). The recorded failure (the guard's
 * `NonceGuardError`, or a sanitised copy of the wallet's or RPC's error) becomes the cause.
 */
export function withSendFailure(
  signer: unknown,
  error: unknown,
  to?: string
): unknown {
  const failure = guardOf(signer)?.takeFailure(to)
  if (!failure) return error

  const message = error instanceof Error ? error.message : String(error)
  return new Error(`${message}: ${failureText(failure)}`, {
    cause: failure.error
  })
}

/** The guard of `signer`, if nautilus installed one. */
export function guardOf(signer: unknown): NonceGuardSigner | undefined {
  return signer instanceof NonceGuardSigner ? signer : undefined
}

/**
 * Wraps `signer` in a `NonceGuardSigner`, unless it already is one. What
 * `Nautilus.create()` does with the signer it is given.
 */
export function guardSigner(
  signer: Signer,
  options: NonceGuardOptions = {}
): NonceGuardSigner {
  return signer instanceof NonceGuardSigner
    ? signer
    : new NonceGuardSigner(signer, options)
}
