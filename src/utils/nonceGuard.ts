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
 *   approval, an escrow payment) is sent again only with proof that the first one can
 *   never land; otherwise it stops with "may have been sent";
 * - **reports** the last send failure, so `confirmTransaction()` names the cause instead
 *   of "ocean.js returned no transaction".
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
  type TransactionResponse,
  type TypedDataDomain,
  type TypedDataField
} from 'ethers'
import { debug, debugRaw } from '../log/debug.js'
import { type Logger, log } from '../log/logger.js'
import { sanitize } from '../node/messages.js'
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
  /** Whether this send moves value: an order, a purchase, an approval, an escrow payment. */
  readonly moneySend: boolean

  constructor(params: {
    reason: NonceGuardReason
    code?: string
    attempts: SentAttempt[]
    moneySend: boolean
    message: string
  }) {
    super(params.message)
    this.name = 'NonceGuardError'
    this.reason = params.reason
    this.code = params.code
    this.attempts = params.attempts
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

/** How long a recorded send failure stays available to `confirmTransaction()`. */
const FAILURE_TTL_MS = 60_000

/**
 * The per-(chain, address) state of the guards of one process: the send lock and the local
 * nonce counter. Shared by every `Nautilus` instance, so two instances with one key do not
 * collide either.
 */
export class NonceGuardState {
  readonly lock = createKeyedLock()
  /** The next nonce per key, after the last successful broadcast. */
  readonly next = new Map<string, SentAttempt & { next: number }>()
}

const processState = new NonceGuardState()

/** What a guard is built with. */
export interface NonceGuardOptions {
  nonceManagement?: NonceManagement
  /**
   * A second RPC, asked for the second "never sent" read before a money send is sent
   * again and before an envelope is removed. Default: the signer's provider.
   */
  verificationProvider?: Provider
  logger?: Logger
  /** Only for tests: the state to use instead of the process-wide one. */
  state?: NonceGuardState
  /** Only for tests: how to wait between attempts. */
  sleep?: (ms: number) => Promise<void>
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
  if (/already known|known transaction|already imported/i.test(texts))
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
    info?: { payload?: { params?: unknown[] } }
  } | null
  return [
    value?.transaction,
    value?.payload?.params?.[0],
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

/**
 * An ethers send error without the signed transaction: its message names the
 * transaction's hash instead, and `transaction` (or the payload's parameter) holds the
 * hash. The signed bytes go to the debug channel (`nonce`): an unmined signed transaction
 * can be broadcast by anyone who reads it.
 */
export function withoutSignedTransaction(error: unknown): unknown {
  const raw = signedTransactionOf(error)
  if (!raw || !error || typeof error !== 'object') return error

  debugRaw('nonce', 'signed transaction of a failed send', raw)

  let hash = 'unknown'
  try {
    hash = Transaction.from(raw).hash ?? hash
  } catch {
    // Not decodable: still removed.
  }

  const replacement = `<signed transaction ${hash}>`
  const target = error as {
    message?: unknown
    transaction?: unknown
    payload?: { params?: unknown[] }
    info?: { payload?: { params?: unknown[] } }
  }
  try {
    if (typeof target.message === 'string')
      target.message = target.message.split(raw).join(replacement)
    if (target.transaction === raw) target.transaction = replacement
    for (const params of [target.payload?.params, target.info?.payload?.params])
      if (Array.isArray(params) && params[0] === raw) params[0] = replacement
  } catch {
    // A frozen error keeps its fields.
  }

  return error
}

/** A transaction the chain knows by hash: pending or mined. */
async function lookUp(
  provider: Provider,
  hash: string
): Promise<TransactionResponse | null> {
  const response = await provider.getTransaction(hash)
  if (response) return response

  // A mined transaction some RPCs no longer return by hash still has a receipt.
  const receipt = await provider.getTransactionReceipt(hash)
  return receipt ? receipt.getTransaction() : null
}

/**
 * Whether none of `attempts` can land: each hash unknown on two reads (the second through
 * `second` when given, a moment later), and the account's mined count past the highest
 * nonce, so another transaction used each slot. Never throws: a read that fails is no
 * proof.
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

  try {
    for (const attempt of attempts)
      if (await lookUp(provider, attempt.hash)) return false

    await (params.sleep ?? wait)(500)

    for (const attempt of attempts)
      if (await lookUp(params.second ?? provider, attempt.hash)) return false

    const latest = await provider.getTransactionCount(address, 'latest')
    const highest = Math.max(...attempts.map((attempt) => attempt.nonce))

    debug('sensitive', 'nonce', 'never-sent proof', {
      address,
      attempts,
      latest,
      secondProvider: Boolean(params.second)
    })

    return latest > highest
  } catch {
    return false
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A failed send as `confirmTransaction()` reports it. */
interface RecordedFailure {
  at: number
  error: unknown
  text: string
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
  private readonly options: NonceGuardOptions
  private readonly state: NonceGuardState
  private readonly log: Logger
  private readonly sleep: (ms: number) => Promise<void>
  private lastFailure?: RecordedFailure

  constructor(signer: Signer, options: NonceGuardOptions = {}) {
    super(signer.provider)
    this.signer = signer
    this.nonceManagement = options.nonceManagement ?? 'auto'
    this.verificationProvider = options.verificationProvider
    this.options = options
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
   * The last send failure of this signer within the last minute, once: read by
   * `confirmTransaction()` when ocean.js returned no transaction.
   */
  takeLastFailure(): { error: unknown; text: string } | undefined {
    const failure = this.lastFailure
    this.lastFailure = undefined
    if (!failure || Date.now() - failure.at > FAILURE_TTL_MS) return undefined
    return { error: failure.error, text: failure.text }
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    if (!this.managesNonces) return this.sendUnmanaged(tx)

    const provider = this.requireProvider()
    const address = getAddress(await this.signer.getAddress())
    const { chainId } = await provider.getNetwork()
    const key = `${chainId}:${address.toLowerCase()}`

    return this.state.lock(key, () => this.sendManaged(key, address, tx))
  }

  private requireProvider(): Provider {
    if (!this.provider)
      throw new Error('The signer has no provider, so it cannot send.')
    return this.provider
  }

  /** The wallet sets the nonce: send, and only check a nonce refusal for "already sent". */
  private async sendUnmanaged(
    tx: TransactionRequest
  ): Promise<TransactionResponse> {
    try {
      const response = await this.signer.sendTransaction(tx)
      this.lastFailure = undefined
      return response
    } catch (error) {
      const outcome = await this.recover({
        error,
        request: tx,
        attempts: [],
        attempt: MAX_ATTEMPTS,
        resend: false
      })
      if ('response' in outcome) return outcome.response
      throw this.fail('error' in outcome ? outcome.error : error)
    }
  }

  private async sendManaged(
    key: string,
    address: string,
    request: TransactionRequest
  ): Promise<TransactionResponse> {
    const explicit = request.nonce !== undefined && request.nonce !== null
    let nonce: number
    try {
      nonce = explicit
        ? Number(request.nonce)
        : await this.nextNonce(key, address)
    } catch (error) {
      // Nothing was sent: the nonce could not be read.
      throw this.fail(error)
    }
    const attempts: SentAttempt[] = []

    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.signer.sendTransaction({
          ...request,
          nonce
        })
        this.advance(key, { hash: response.hash, nonce })
        this.lastFailure = undefined
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
          attempts,
          attempt,
          resend: !explicit
        })

        if ('response' in outcome) return outcome.response
        if ('nonce' in outcome) {
          nonce = outcome.nonce
          await this.sleep(500 + Math.floor(Math.random() * 1500))
          continue
        }
        throw this.fail(outcome.error)
      }
    }
  }

  /**
   * The nonce for the next send: `max(local next, pending)`. A local counter ahead of the
   * pending count is kept only while the RPC still knows the last transaction it counted:
   * one that was dropped would otherwise leave a gap no later transaction gets past.
   */
  private async nextNonce(key: string, address: string): Promise<number> {
    const provider = this.requireProvider()
    const pending = await provider.getTransactionCount(address, 'pending')
    const local = this.state.next.get(key)

    let nonce = pending
    if (local && local.next > pending) {
      // A read that fails proves nothing: the counter stays.
      const known = await lookUp(provider, local.hash)
        .then(
          (first) =>
            first ?? lookUp(this.verificationProvider ?? provider, local.hash)
        )
        .catch(() => true)
      if (known) nonce = local.next
      else {
        this.state.next.delete(key)
        this.log.emit(
          'chain.nonce.counter_reset',
          `The RPC no longer knows transaction ${local.hash} (nonce ${local.nonce}) of ${address}, so it was dropped: the nonce counter falls back to the RPC's pending count ${pending}.`,
          { address, txNonce: local.nonce, pending, txHash: local.hash }
        )
      }
    }

    debug('sensitive', 'nonce', 'nonce chosen', {
      address,
      pending,
      local: local?.next,
      nonce
    })
    return nonce
  }

  private advance(key: string, sent: SentAttempt): void {
    const current = this.state.next.get(key)
    if (!current || sent.nonce + 1 > current.next)
      this.state.next.set(key, { ...sent, next: sent.nonce + 1 })
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
    attempts: SentAttempt[]
    attempt: number
    resend: boolean
  }): Promise<
    { response: TransactionResponse } | { nonce: number } | { error: unknown }
  > {
    const { error, request, attempts } = params
    const refusal = nonceRefusalOf(error)
    const code = (error as { code?: unknown } | null)?.code
    const raw = signedTransactionOf(error)

    if (raw) debugRaw('nonce', 'signed transaction of a refused send', raw)
    debug('sensitive', 'nonce', 'send refused', {
      code,
      refusal: refusal ?? 'not a nonce refusal',
      attempt: params.attempt
    })

    // A timeout, a network error, any other refusal: the transaction may have landed.
    if (!refusal) return { error: withoutSignedTransaction(error) }

    const moneySend = isMoneySend(request)
    const stop = (reason: NonceGuardReason, message: string) => ({
      error: new NonceGuardError({
        reason,
        code: typeof code === 'string' ? code : undefined,
        attempts,
        moneySend,
        message
      })
    })
    // The refusal itself (with the RPC's unredacted text) goes to the debug channel only:
    // the error names its code and the RPC's message, redacted.
    debugRaw('nonce', 'refusal', () => withoutSignedTransaction(error))

    const decoded = raw ? decode(raw) : undefined
    const address = params.address ?? getAddress(await this.signer.getAddress())

    if (!decoded || !(await this.isThisSend(decoded, request, address)))
      return stop(
        'unverifiable',
        `The transaction from ${address} was refused (${describeRefusal(error)}), and the refusal ${decoded ? 'names a different transaction' : 'carries no transaction nautilus can check'}, so nautilus cannot tell whether it was sent: it did not send it again. Check the account's latest transactions before retrying.`
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
      known = await lookUp(provider, sent.hash)
      for (
        let poll = 0;
        !known && refusal === 'already-known' && poll < 3;
        poll++
      ) {
        await this.sleep(500)
        known = await lookUp(provider, sent.hash)
      }
    } catch {
      return stop(
        'may-have-been-sent',
        `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} was refused for its nonce (${describeRefusal(error)}), and the RPC could not be asked whether it has it: it may have been sent, check the account's latest transactions before retrying.`
      )
    }
    if (known) {
      if (params.key) this.advance(params.key, sent)
      this.log.emit(
        'chain.nonce.already_sent',
        `The RPC refused transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} as ${describeRefusal(error)}, but it already has it: nautilus waits for it instead of sending it again.`,
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
        `Transaction ${sent.hash} of ${address} was refused for its nonce ${sent.nonce} (${describeRefusal(error)}). ${this.managesNonces ? 'The nonce was set by the caller' : this.nonceManagement === 'off' ? "nonceManagement is 'off'" : 'The wallet sets the nonce'}, so nautilus did not send it again.`
      )

    if (params.attempt >= MAX_ATTEMPTS)
      return stop(
        'attempts-exhausted',
        `Transaction of ${address} refused for its nonce ${MAX_ATTEMPTS} times (last ${sent.hash}, nonce ${sent.nonce}: ${describeRefusal(error)}). The RPC's nonce answers may be stale; nautilus stopped sending.`
      )

    if (
      moneySend &&
      !(await provenNeverSent({
        provider,
        second: this.verificationProvider,
        address,
        attempts,
        sleep: this.sleep
      }))
    )
      return stop(
        'may-have-been-sent',
        `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} moves value and was refused for its nonce (${describeRefusal(error)}), and nautilus cannot prove it can never be mined: it may have been sent, check the account's latest transactions before retrying.`
      )

    const [pending, latest] = await Promise.all([
      provider.getTransactionCount(address, 'pending'),
      provider.getTransactionCount(address, 'latest')
    ])
    const local = this.state.next.get(params.key)?.next ?? 0
    const nonce = Math.max(
      suggestedNonce(error) ?? 0,
      local,
      pending,
      latest,
      sent.nonce + 1
    )

    this.log.emit(
      'chain.nonce.resending',
      `Transaction ${sent.hash} of ${address} was refused for its nonce ${sent.nonce} (${describeRefusal(error)}) and the chain does not have it: sending the same transaction again with nonce ${nonce}.`,
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
      suggested: suggestedNonce(error),
      nonce
    })

    return { nonce }
  }

  /** Whether the signed transaction is this send's: same sender, recipient and data. */
  private async isThisSend(
    decoded: Transaction,
    request: TransactionRequest,
    address: string
  ): Promise<boolean> {
    try {
      const to =
        request.to === undefined || request.to === null
          ? null
          : await resolveAddress(request.to, this)
      const data = request.data ? hexlify(request.data) : '0x'
      return (
        decoded.from?.toLowerCase() === address.toLowerCase() &&
        (decoded.to?.toLowerCase() ?? null) === (to?.toLowerCase() ?? null) &&
        decoded.data.toLowerCase() === data.toLowerCase() &&
        decoded.value === BigInt(request.value ?? 0)
      )
    } catch {
      return false
    }
  }

  /** Records the failure for `confirmTransaction()` and reports it; returns the error to throw. */
  private fail(error: unknown): unknown {
    const text = sanitize(
      error instanceof Error ? error.message : String(error),
      600,
      'nonce'
    )
    this.lastFailure = { at: Date.now(), error, text }

    if (error instanceof NonceGuardError)
      this.log.emit('chain.nonce.gave_up', error.message, {
        reason: error.reason,
        code: error.code,
        attempts: error.attempts.map((attempt) => attempt.hash),
        moneySend: error.moneySend
      })
    else
      this.log.emit(
        'chain.send.failed',
        `A transaction was not sent: ${text}`,
        {
          code: (error as { code?: unknown } | null)?.code
        }
      )

    return error
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

/**
 * `error`, naming the send failure the guard of `signer` recorded, if any: for an ocean.js
 * call that throws a generic error of its own when the send fails (`createDatatoken`'s
 * "Failed to send createDatatoken transaction", `approveWei` returning nothing). The
 * recorded failure becomes the cause.
 */
export function withSendFailure(signer: unknown, error: unknown): unknown {
  const failure = guardOf(signer)?.takeLastFailure()
  if (!failure) return error

  const message = error instanceof Error ? error.message : String(error)
  return new Error(`${message}: ${failure.text}`, { cause: failure.error })
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
