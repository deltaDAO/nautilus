/**
 * What happens when the previous-order lookup fails (as opposed to finding nothing).
 *
 * Ordering without the lookup can pay twice for an order the account already holds. So a
 * service that costs anything is not ordered: `OrderCheckError` is thrown before anything
 * is sent, unless the caller opted in with `orderOnLookupFailure`. A free service is
 * ordered, with a warning, since a second order costs only gas.
 *
 * The lookup's error comes from the RPC: its text is classified and redacted here (no URL,
 * no long hex, first line only, bounded), and the raw error goes to the sensitive debug
 * channel under the `order` topic.
 */
import { debugRaw } from '../log/debug.js'
import {
  isErrorCode,
  sanitize,
  stripControlCharacters
} from '../node/messages.js'
import {
  type IncompleteLookupLimit,
  IncompleteOrderLookupError,
  InconsistentRpcAnswerError
} from '../utils/previousOrder.js'
import {
  answeredWithError,
  codeOf,
  errorChain,
  messageOf,
  rateLimitOf
} from '../utils/rpcErrors.js'

/** Why the previous order could not be checked. */
export type OrderCheckFailure =
  /** The RPC refused the reads as too many (HTTP 429, `Retry-After`, a rate-limit -32005). */
  | 'rate-limited'
  /** The RPC did not answer: a network error or a timeout. */
  | 'unreachable'
  /** The lookup stopped before it covered the whole order window. */
  | 'incomplete'
  /**
   * The RPC answered with another error, or without data its own answers promise (no
   * receipt for a transaction its logs list, no newest block).
   */
  | 'rpc-error'

/** An amount of a token, as people read it: `{ amount: '1.002', symbol: 'devEURAU' }`. */
export interface OrderCheckPrice {
  /** In whole tokens, as a decimal string. */
  amount: string
  /** The token's symbol, or its shortened address when the symbol cannot be read. */
  symbol: string
}

/** A lookup failure, classified, with a text safe to show. */
export interface LookupFailure {
  reason: OrderCheckFailure
  /** The cause in plain words, e.g. `the RPC rate-limited the check (HTTP 429)`. */
  phrase: string
  /** The redacted error kept as the `cause` of an `OrderCheckError`. */
  cause: Error
  checkedHours?: number
  windowHours?: number
  /** For `incomplete`: the bound that stopped the lookup. */
  limit?: IncompleteLookupLimit
}

/** Who and what an order is for, as named in the message. */
export interface OrderSubject {
  did?: string
  serviceId: string
  serviceName?: string
  assetName?: string
  consumer: string
}

/** How much of the RPC's error text goes into a message. */
const MAX_DETAIL_LENGTH = 200
/** How much of a publisher-chosen name goes into a message. */
const MAX_NAME_LENGTH = 80

const NETWORK_CODES = new Set([
  'TIMEOUT',
  'NETWORK_ERROR',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ABORT_ERR'
])

const NETWORK =
  /\b(?:timeout|timed out|fetch failed|socket hang up|network error|connection (?:refused|reset|closed))\b/i

/**
 * A URL: `scheme://…`, also with its slashes JSON-escaped (`https:\/\/host\/path`). Applied
 * only to `sanitize`'s output, where a URL is down to its origin already: this drops the
 * origin too.
 */
const URL_TEXT = /[a-z][a-z0-9+.-]{0,31}:(?:\\*\/){2}(?:[^\s"'<>\\]|\\+\/)*/gi
/** A URL without its scheme: `host.tld[:port]/path…`. */
const HOST_PATH =
  /\b(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}(?::\d{1,5})?\\*\/(?:[^\s"'<>\\]|\\+\/)*/gi

/**
 * Thrown by `access()` (and `settleOrder()`) before it pays for a service when it could not
 * check whether the account already holds a valid order: buying without that check could
 * pay twice. Nothing was ordered or paid, and the call can be retried. Pass
 * `orderOnLookupFailure: true` to order anyway. `compute()` does not throw it: it makes no
 * lookup of its own (it orders every input the node does not report as validly ordered).
 */
export class OrderCheckError extends Error {
  readonly code = 'ORDER_CHECK_FAILED' as const
  readonly reason: OrderCheckFailure
  /** Always `true`: nothing was sent, so the same call can simply be made again. */
  readonly retryable = true as const
  /** The asset's DID, when known. */
  readonly did?: string
  readonly serviceId: string
  /** The account the order is for. */
  readonly consumer: string
  /**
   * What a new order would cost: the datatoken's price in its base token, or, for a free
   * datatoken, the first fee due. `undefined` when the pricing could not be read either.
   */
  readonly price: OrderCheckPrice | undefined
  /**
   * Every part a new order would pay, each in its own token: the price, the publish-market
   * fee and the provider fee, those that are not zero. Empty when the pricing could not be
   * read.
   */
  readonly costs: OrderCheckPrice[]
  /** For `incomplete`: hours back from now the lookup did read. */
  readonly checkedHours?: number
  /** For `incomplete`: hours back from now an order would still be in force. */
  readonly windowHours?: number
  /**
   * The lookup's error, redacted: first line only, credentials under escaping redacted, no
   * URL, at most 200 characters.
   */
  declare readonly cause: Error

  /**
   * @param costs every part a new order would pay, or `undefined` when the pricing could
   * not be read: nothing can be bought then, so the message offers no opt-in.
   */
  constructor(
    subject: OrderSubject,
    costs: OrderCheckPrice[] | undefined,
    failure: LookupFailure,
    operation = 'access()'
  ) {
    const optIn = costs
      ? ' To buy anyway, pass `orderOnLookupFailure: true`.'
      : ''
    super(
      `${operation} stopped before paying for ${describeSubject(subject)}: it could not check whether ${shortHex(subject.consumer)} already holds a valid order, and buying without that check could make you pay twice (${costs ? describeCosts(costs) : 'the price could not be read either'}). Nothing was ordered or paid; it is safe to retry. Cause: ${failure.phrase}. ${nextStep(failure)}${optIn}`,
      { cause: failure.cause }
    )
    this.name = 'OrderCheckError'
    this.reason = failure.reason
    this.did = subject.did
    this.serviceId = subject.serviceId
    this.consumer = subject.consumer
    this.price = costs?.[0]
    this.costs = costs ?? []
    if (failure.reason === 'incomplete') {
      this.checkedHours = failure.checkedHours
      this.windowHours = failure.windowHours
    }
  }
}

/**
 * What to do. A rate limit or a missing answer passes; a scan that ran out of reads may do
 * better on another RPC; one stopped by its depth or its candidate cap ends the same way
 * on a retry, and only the user knows whether the account bought the service before.
 */
function nextStep(failure: LookupFailure): string {
  if (failure.reason !== 'incomplete')
    return 'Retry in a minute or use another RPC.'
  if (failure.limit === 'reads') return 'Use another RPC, or retry.'

  const window = failure.windowHours ?? Number.NaN
  return `A retry ends the same way. If this account ${
    Number.isFinite(window)
      ? `has not bought this service in the last ${hours(window, 'nearest')} hours`
      : 'never bought this service'
  }, buying is safe.`
}

/**
 * The warning when a new order is placed without the check: for a free service (`costs`
 * empty), or with `orderOnLookupFailure`.
 */
export function lookupFailedWarning(
  subject: OrderSubject,
  failure: LookupFailure,
  costs: OrderCheckPrice[]
): string {
  const head = `Could not check whether ${shortHex(subject.consumer)} already holds an order for ${describeSubject(subject)}: ${failure.phrase}. A new order will be placed`

  return costs.length
    ? `${head}, as \`orderOnLookupFailure\` allows: if the account already holds one, this will pay twice (${describeCosts(costs)}).`
    : `${head}. The service is free: this costs only gas.`
}

/**
 * Classifies the lookup's error and makes its text safe to show. The raw error goes to the
 * sensitive debug channel (`order` topic). Never throws: an error that cannot be read (a
 * throwing getter, a hostile proxy) is an `rpc-error` without detail.
 */
export function classifyLookupFailure(error: unknown): LookupFailure {
  try {
    debugRaw('order', 'previous-order lookup error before redaction', error)
    return classify(error)
  } catch {
    return {
      reason: 'rpc-error',
      phrase: 'the RPC returned an error that could not be read',
      cause: new Error('unreadable error')
    }
  }
}

function classify(error: unknown): LookupFailure {
  const chain = errorChain(error)

  const incomplete = chain.find(
    (entry): entry is IncompleteOrderLookupError =>
      entry instanceof IncompleteOrderLookupError
  )
  if (incomplete)
    return {
      reason: 'incomplete',
      phrase: incompletePhrase(incomplete.checkedHours, incomplete.windowHours),
      cause: redactedError(incomplete),
      checkedHours: incomplete.checkedHours,
      windowHours: incomplete.windowHours,
      limit: incomplete.limit
    }

  const inconsistent = chain.find(
    (entry): entry is InconsistentRpcAnswerError =>
      entry instanceof InconsistentRpcAnswerError
  )
  if (inconsistent)
    return {
      reason: 'rpc-error',
      phrase: `the RPC's answer lacked data the check needs (${inconsistent.missing})`,
      cause: redactedError(inconsistent)
    }

  const rateLimit = rateLimitOf(error)
  if (rateLimit)
    return {
      reason: 'rate-limited',
      phrase: `the RPC rate-limited the check${
        rateLimit.http429
          ? ' (HTTP 429)'
          : rateLimit.code32005
            ? ' (error -32005)'
            : ''
      }`,
      cause: redactedError(error)
    }

  const codes = chain.map(codeOf).filter((code) => code !== undefined)
  const texts = chain.map(messageOf).filter((text) => text !== undefined)

  // "timeout" in the text of an RPC that answered with a JSON-RPC error ("query timeout")
  // is that RPC's error, not a missing answer.
  if (
    codes.some((code) => NETWORK_CODES.has(code)) ||
    chain.some(
      (entry) =>
        entry instanceof Error &&
        (entry.name === 'AbortError' || entry.name === 'TimeoutError')
    ) ||
    (!answeredWithError(chain) && texts.some((text) => NETWORK.test(text)))
  )
    return {
      reason: 'unreachable',
      phrase: 'the RPC did not answer',
      cause: redactedError(error)
    }

  const cause = redactedError(error)
  return {
    reason: 'rpc-error',
    phrase: `the RPC returned an error: ${cause.message.replace(/[.\s]+$/, '')}`,
    cause
  }
}

/** `service "Download" of asset "Weather" (did:ope:59a18b63…)`. */
function describeSubject(subject: OrderSubject): string {
  const service = subject.serviceName
    ? `service "${safeName(subject.serviceName)}"`
    : `service ${safeName(shortHex(subject.serviceId))}`
  const did = subject.did ? shortDid(subject.did) : undefined

  if (subject.assetName)
    return `${service} of asset "${safeName(subject.assetName)}"${did ? ` (${did})` : ''}`

  return did ? `${service} of ${did}` : service
}

/** `1.002 devEURAU + 0.1 OCEAN`. */
function describeCosts(costs: OrderCheckPrice[]): string {
  return costs.map((cost) => `${cost.amount} ${cost.symbol}`).join(' + ')
}

/**
 * `the check covered only the last 16 of the 24 hours an order stays valid`; for orders
 * that never expire, `… the last 55 hours, and orders of this service never expire`.
 */
function incompletePhrase(checked: number, window: number): string {
  const never = !Number.isFinite(window)

  if (!Number.isFinite(checked))
    return never
      ? 'the check could not read back far enough, and orders of this service never expire'
      : `the check did not cover all of the ${hours(window, 'nearest')} hours an order stays valid`

  return never
    ? `the check covered only the last ${hours(checked, 'down')} hours, and orders of this service never expire`
    : `the check covered only the last ${hours(checked, 'down')} of the ${hours(window, 'nearest')} hours an order stays valid`
}

/** Text a publisher chose (a name, a symbol), safe and short enough for one line. */
export function safeName(text: string, maxLength = MAX_NAME_LENGTH): string {
  const clean = stripControlCharacters(String(text)).replace(/"/g, "'")
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean
}

/** `0x4C84…4A52`; a DID's or service id's long hex as its first 8 characters and `…`. */
export function shortHex(value: string): string {
  if (/^0x[0-9a-f]{40}$/i.test(value))
    return `${value.slice(0, 6)}…${value.slice(-4)}`
  return value.length > 12 && /^(?:0x)?[0-9a-f]+$/i.test(value)
    ? `${value.slice(0, 8)}…`
    : value
}

/** `did:ope:59a18b63…`. */
function shortDid(did: string): string {
  const match = /^(did:[a-z0-9]+:)([0-9a-f]{9,})$/i.exec(did)
  return match ? `${match[1]}${match[2].slice(0, 8)}…` : safeName(did)
}

/** Hours as people read them: whole hours from 10 on, else one decimal. */
function hours(value: number, round: 'down' | 'nearest'): string {
  if (!Number.isFinite(value)) return String(value)
  if (value >= 10)
    return String(round === 'down' ? Math.floor(value) : Math.round(value))
  const tenths =
    round === 'down' ? Math.floor(value * 10) : Math.round(value * 10)
  return String(tenths / 10)
}

/**
 * The error's most specific text, made safe to show: the RPC's own JSON-RPC message when
 * there is one, else ethers' short message, else the message; first line only, through
 * `sanitize` (credentials redacted, also under JSON escaping and percent-encoding of any
 * depth, so a key spelt `"api\u004bey"` is `apiKey`; before and after invisible characters
 * are stripped; at most 200 characters, a word split by the cut dropped), then with every URL removed, also one without a scheme (`sanitize`
 * keeps a URL's origin), and long hex shortened. Keeps the name, and an error code such as
 * `SERVER_ERROR` or `-32000`.
 */
function redactedError(error: unknown): Error {
  const chain = errorChain(error)
  // ethers keeps the RPC's JSON-RPC error in `error` or `info.error`: the deepest message is
  // the RPC's own words, without ethers' request and payload dump.
  const texts = chain.map(messageOf).filter((text) => text !== undefined)
  const raw = texts.length ? texts[texts.length - 1] : String(error)

  // Redaction first, on the RPC's whole first line: the URL removal below cannot cut a URL
  // short of a token in it (`https://host/x\y/v3/<token>`) before `sanitize` sees it, and
  // `sanitize` reads a key spelt with escapes (`"api\u004bey"`) as the key. The raw error
  // is in the debug channel already (`classifyLookupFailure`).
  const text = sanitize(raw.split(/\r?\n/)[0] ?? '', MAX_DETAIL_LENGTH, null)
    .replace(URL_TEXT, '<url>')
    .replace(HOST_PATH, '<url>')
    .replace(
      /\b0x[0-9a-f]{16,}\b/gi,
      (hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`
    )

  const safe = new Error(text || 'unknown error')
  const first = chain[0]
  if (first instanceof Error) safe.name = safeName(first.name, 40)
  const code = chain.map(codeOf).find((value) => value && isErrorCode(value))
  if (code) Object.assign(safe, { code })

  return safe
}
