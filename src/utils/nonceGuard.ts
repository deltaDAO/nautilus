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

/** How long a recorded send stays available to `confirmTransaction()`. */
const FAILURE_TTL_MS = 60_000

/** At most this many recorded sends per guard (and its `connect()` copies). */
const MAX_RECORDED_SENDS = 64

/**
 * How long after its broadcast the last counted transaction is assumed in flight: an RPC
 * that does not return it yet (a lagging or load-balanced backend) does not reset the
 * counter within this time.
 */
const COUNTER_GRACE_MS = 60_000

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
  error: unknown
  /** The error's message, sanitised. */
  text: string
  /** Whether the transaction may have reached the chain. */
  maySent: boolean
}

/**
 * The recent sends of a guard, by contract (`to`): each one's hash once broadcast, or its
 * failure. `confirmTransaction()` names a failure only when it is the only send to that
 * contract in the last minute; with two (`Promise.all` of two orders of one asset, or a
 * success whose `wait()` then failed next to another call's failure) it cannot tell which
 * call the failure belongs to, and keeps its generic message.
 */
export class SendLog {
  private records: Array<{
    at: number
    to?: string
    hash?: string
    failure?: RecordedFailure
  }> = []

  constructor(private readonly now: () => number = Date.now) {}

  sent(to: string | undefined, hash: string): void {
    this.add({ to, hash })
  }

  failed(to: string | undefined, failure: RecordedFailure): void {
    this.add({ to, failure })
  }

  /** The send of `hash` was confirmed: it no longer competes with a failure. */
  settle(hash: string): void {
    this.records = this.records.filter((record) => record.hash !== hash)
  }

  /** The caller handled `error` itself (it was thrown to it, not swallowed). */
  forget(error: unknown): void {
    this.records = this.records.filter(
      (record) => record.failure?.error !== error
    )
  }

  /**
   * The failure of the only recent send to `to` (of the only recent send at all, without
   * `to`), once; `undefined` when that send succeeded or there was more than one.
   */
  take(to?: string): RecordedFailure | undefined {
    this.prune()
    const target = to?.toLowerCase()
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
  }) {
    this.prune()
    this.records.push({
      ...record,
      to: record.to?.toLowerCase(),
      at: this.now()
    })
    if (this.records.length > MAX_RECORDED_SENDS) this.records.shift()
  }

  private prune(): void {
    const oldest = this.now() - FAILURE_TTL_MS
    this.records = this.records.filter((record) => record.at >= oldest)
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
  // Nethermind answers "AlreadyKnown".
  if (/already ?known|known transaction|already imported/i.test(texts))
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
 * An ethers send error without the signed transaction: its message names the
 * transaction's hash instead, and `transaction` (or the payload's parameter) holds the
 * hash. The signed bytes go to the debug channel (`nonce`): an unmined signed transaction
 * can be broadcast by anyone who reads it. The HTTP request and response of a failed
 * `eth_sendRawTransaction` (ethers' `SERVER_ERROR`) are dropped too: the request's body
 * is the signed transaction, and its URL may carry the RPC's token.
 */
export function withoutSignedTransaction(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error
  withoutTransport(error as { request?: unknown; response?: unknown })

  const raw = signedTransactionOf(error)
  if (!raw) return error

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

/** Drops `request` and `response` from an ethers error, to the debug channel. */
function withoutTransport(error: { request?: unknown; response?: unknown }) {
  if (error.request === undefined && error.response === undefined) return

  debugRaw('nonce', 'request and response of a failed send', () => ({
    request: error.request,
    response: error.response
  }))
  try {
    for (const field of ['request', 'response'] as const)
      if (error[field] !== undefined)
        error[field] = `<${field} omitted: NAUTILUS_DEBUG, topic nonce>`
  } catch {
    // A frozen error keeps its fields.
  }
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
 * Positive proof that none of `attempts` was mined: for each one's nonce, the transaction
 * of `address` with that nonce found in the blocks since the send (`fromBlock`, read just
 * before the first broadcast, minus one), and it is another transaction. Reads the blocks
 * from each provider in turn until every nonce is accounted for; a block a provider does
 * not return, more than `MAX_PROOF_BLOCKS` blocks, or one of `attempts` itself found in a
 * block, is no proof. A nonce taken before the send (the stale read of the beta.2 run) is
 * not in those blocks either, so such a send stops with "may have been sent".
 */
export async function provenSlotsTaken(params: {
  providers: Provider[]
  address: string
  attempts: SentAttempt[]
  fromBlock?: number
}): Promise<boolean> {
  const { address, attempts } = params
  if (params.fromBlock === undefined || !attempts.length) return false

  const ours = new Set(attempts.map((attempt) => attempt.hash.toLowerCase()))
  const open = new Set(attempts.map((attempt) => attempt.nonce))
  const start = Math.max(0, params.fromBlock - 1)
  const takenBy: Record<number, string> = {}

  for (const provider of [...new Set(params.providers)]) {
    try {
      const head = await provider.getBlockNumber()
      if (head - start + 1 > MAX_PROOF_BLOCKS) continue

      for (let number = start; number <= head && open.size; number++) {
        const block = await provider.getBlock(number, true)
        if (!block) break

        for (const tx of block.prefetchedTransactions) {
          if (tx.from.toLowerCase() !== address.toLowerCase()) continue
          if (ours.has(tx.hash.toLowerCase())) return false
          if (open.delete(tx.nonce)) takenBy[tx.nonce] = tx.hash
        }
      }
    } catch {
      // This provider proves nothing; the next may.
    }
    if (!open.size) break
  }

  debug('sensitive', 'nonce', 'slots-taken proof', {
    address,
    attempts,
    fromBlock: start,
    takenBy,
    unproven: [...open]
  })

  return open.size === 0
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
  /** The recent sends, shared with this guard's `connect()` copies. */
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
   * The failure of the only send to contract `to` within the last minute, once (see
   * `SendLog`): read by `confirmTransaction()` when ocean.js returned no transaction.
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
    const { chainId } = await provider.getNetwork()
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

  /** The wallet sets the nonce: send, and only check a nonce refusal for "already sent". */
  private async sendUnmanaged(
    tx: TransactionRequest,
    to: string | undefined
  ): Promise<TransactionResponse> {
    try {
      const response = await this.signer.sendTransaction(tx)
      this.sends.sent(to, response.hash)
      return response
    } catch (error) {
      const outcome = await this.recover({
        error,
        request: tx,
        attempts: [],
        attempt: MAX_ATTEMPTS,
        resend: false
      })
      if ('response' in outcome) {
        this.sends.sent(to, outcome.response.hash)
        return outcome.response
      }
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
        this.sends.sent(to, response.hash)
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

        if ('response' in outcome) {
          this.sends.sent(to, outcome.response.hash)
          return outcome.response
        }
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
   * pending count is kept unless the last transaction it counted was dropped
   * (`wasDropped`): one that was dropped would otherwise leave a gap no later transaction
   * gets past.
   */
  private async nextNonce(key: string, address: string): Promise<number> {
    const provider = this.requireProvider()
    const pending = await provider.getTransactionCount(address, 'pending')
    const local = this.state.next.get(key)

    let nonce = pending
    if (local && local.next > pending) {
      if (await this.wasDropped(local, address)) {
        this.state.next.delete(key)
        this.log.emit(
          'chain.nonce.counter_reset',
          `The RPC no longer knows transaction ${local.hash} (nonce ${local.nonce}) of ${address}, and the account has not mined past that nonce, so it was dropped: the nonce counter falls back to the RPC's pending count ${pending}.`,
          { address, txNonce: local.nonce, pending, txHash: local.hash }
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
   * Whether the last counted transaction was dropped, so the counter must fall back: sent
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
    const current = this.state.next.get(key)
    if (!current || sent.nonce + 1 > current.next)
      this.state.next.set(key, {
        ...sent,
        next: sent.nonce + 1,
        at: this.now()
      })
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

    if (raw) debugRaw('nonce', 'signed transaction of a refused send', raw)
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

    // The refusal itself (with the RPC's unredacted text) goes to the debug channel only:
    // the error names its code and the RPC's message, redacted.
    debugRaw('nonce', 'refusal', () => withoutSignedTransaction(error))

    const decoded = raw ? decode(raw) : undefined

    if (
      !decoded ||
      !(await this.isThisSend(decoded, request, address, params.chainId))
    )
      return stop(
        'unverifiable',
        `The transaction from ${address} was refused (${describeRefusal(error)}), and the refusal ${decoded ? 'names a different transaction' : 'carries no transaction nautilus can check'}, so nautilus cannot tell whether it was sent: it did not send it again. Check the account's latest transactions before retrying.`,
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

    if (moneySend) {
      const second = this.verificationProvider
      if (!second)
        return stop(
          'may-have-been-sent',
          `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} moves value and was refused for its nonce (${describeRefusal(error)}). nautilus sends such a transaction again only with proof from a second RPC (the verificationProvider option, not set) that the first can never be mined: it may have been sent, check the account's latest transactions before retrying.`
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
          fromBlock: params.fromBlock
        }))
      )
        return stop(
          'may-have-been-sent',
          `Transaction ${sent.hash} (nonce ${sent.nonce}) of ${address} moves value and was refused for its nonce (${describeRefusal(error)}), and nautilus cannot prove it can never be mined: it may have been sent, check the account's latest transactions before retrying.`
        )
    }

    const [pending, latest] = await Promise.all([
      provider.getTransactionCount(address, 'pending'),
      provider.getTransactionCount(address, 'latest')
    ])
    const local = this.state.next.get(params.key)?.next ?? 0
    const floor = Math.max(local, pending, latest, sent.nonce + 1)
    const suggested = suggestedNonce(error)
    // A hint far above every other source is a garbled message, not a nonce.
    const nonce =
      suggested !== undefined && suggested <= floor + MAX_HINT_AHEAD
        ? Math.max(suggested, floor)
        : floor

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
   * Records the failure for `confirmTransaction()` and reports it; returns the error to
   * throw. `notSent`: nothing was broadcast (the nonce could not be read).
   */
  private fail(
    error: unknown,
    to: string | undefined,
    options: { notSent?: boolean } = {}
  ): unknown {
    const text = sanitize(
      error instanceof Error ? error.message : String(error),
      600,
      'nonce'
    )
    const maySent = !options.notSent && !notBroadcast(error)
    this.sends.failed(to, { error, text, maySent })

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
 * transaction", `approveWei` returning nothing). The recorded failure becomes the cause.
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
