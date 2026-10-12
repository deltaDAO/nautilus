/**
 * Reading an RPC's error: what ethers wraps, at which depth, and whether it is a rate limit.
 *
 * Shared by the previous-order scan, which must not take a rate limit for a range refusal
 * (that halves the range until the reads run out, and ends in "not found"), by the
 * classification of a failed lookup in `OrderCheckError`, and by the pricing reads; and
 * `redactedError`, which makes an RPC's error safe to keep as a `cause`. Not exported from
 * the package.
 */
import {
  isErrorCode,
  sanitize,
  stripControlCharacters
} from '../node/messages.js'

/** How much of the RPC's error text goes into a message. */
const MAX_DETAIL_LENGTH = 200

/**
 * A URL: `scheme://…`, also with its slashes JSON-escaped (`https:\/\/host\/path`). Applied
 * only to `sanitize`'s output, where a URL is down to its origin already: this drops the
 * origin too.
 */
const URL_TEXT = /[a-z][a-z0-9+.-]{0,31}:(?:\\*\/){2}(?:[^\s"'<>\\]|\\+\/)*/gi
/** A URL without its scheme: `host.tld[:port]/path…`. */
const HOST_PATH =
  /\b(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}(?::\d{1,5})?\\*\/(?:[^\s"'<>\\]|\\+\/)*/gi

/** A `-32005` that refuses the range or the number of results, not the request rate. */
const RANGE_REFUSAL = /range|more than|too (?:large|wide|big)|results/i
/** Rate-limit wording: also QuickNode's "15/second request limit reached" and "capacity exceeded". */
const RATE_LIMITED =
  /rate[\s-]?limit|too many requests|request limit reached|capacity exceeded/i
/** QuickNode's JSON-RPC code for a request rate over the plan's limit. */
const RATE_LIMIT_CODES = ['429', '-32007']

/** How a rate limit showed, for the message. */
export interface RateLimit {
  /** An HTTP 429, also after ethers' own retries (a 599 that keeps the 429). */
  http429: boolean
  /** A JSON-RPC `-32005` (Infura and others) that is not a range refusal. */
  code32005: boolean
}

/**
 * The error, its `error`, `info.error` and `cause`, and theirs, breadth first: ethers wraps
 * the RPC's JSON-RPC error and its HTTP answer at different depths.
 */
export function errorChain(error: unknown): object[] {
  const chain: object[] = []
  const queue: unknown[] = [error]

  while (queue.length && chain.length < 12) {
    const entry = queue.shift()
    if (!entry || typeof entry !== 'object' || chain.includes(entry)) continue
    chain.push(entry)

    const {
      error: inner,
      info,
      cause
    } = entry as {
      error?: unknown
      info?: { error?: unknown }
      cause?: unknown
    }
    queue.push(inner, info?.error, cause)
  }

  return chain
}

/**
 * Whether the RPC refused the request as too many: an HTTP 429 (also ethers' escalated
 * 599 that keeps it), a `Retry-After` header on an answer that is not a server error, a
 * JSON-RPC `-32005` that does not refuse a range, QuickNode's `-32007`, or rate-limit
 * wording in its text ("rate limit", "too many requests", "request limit reached",
 * "capacity exceeded"), also as a thrown string. `undefined` when it did not.
 */
export function rateLimitOf(error: unknown): RateLimit | undefined {
  const chain = errorChain(error)
  const codes = chain.map(codeOf)
  const texts = chain.map(messageOf).filter((text) => text !== undefined)

  // A provider or a wrapper that throws a bare string ("Too Many Requests").
  if (typeof error === 'string') texts.push(error)

  const http429 = chain.some(
    (entry) => httpStatus(entry) === 429 || escalated429(entry)
  )
  const code32005 =
    codes.includes('-32005') && !texts.some((text) => RANGE_REFUSAL.test(text))

  // A `Retry-After` on a 503 says the server is down for a while, not that it is throttled.
  const retryAfter = chain.some(
    (entry) => hasRetryAfter(entry) && (httpStatus(entry) ?? 0) < 500
  )

  return http429 ||
    code32005 ||
    retryAfter ||
    RATE_LIMIT_CODES.some((code) => codes.includes(code)) ||
    texts.some((text) => RATE_LIMITED.test(text))
    ? { http429, code32005 }
    : undefined
}

/** The HTTP status an entry carries, ethers' or Node's. */
export function httpStatus(entry: object): number | undefined {
  const { status, statusCode, response, info } = entry as {
    status?: unknown
    statusCode?: unknown
    response?: { statusCode?: unknown; status?: unknown }
    info?: { responseStatus?: unknown }
  }

  for (const value of [
    status,
    statusCode,
    response?.statusCode,
    response?.status,
    typeof info?.responseStatus === 'string'
      ? info.responseStatus.split(' ')[0]
      : undefined
  ]) {
    const number = Number(value)
    if (Number.isInteger(number) && number >= 100 && number <= 599)
      return number
  }

  return undefined
}

/**
 * ethers retries a 429 itself; when it gives up, the answer it reports is a 599 whose
 * status text keeps the 429: `CLIENT ESCALATED SERVER ERROR (429 Too Many Requests; …)`.
 */
function escalated429(entry: object): boolean {
  const { response, info } = entry as {
    response?: { statusMessage?: unknown }
    info?: { responseStatus?: unknown }
  }

  return [response?.statusMessage, info?.responseStatus].some(
    (text) => typeof text === 'string' && /\(429\b/.test(text)
  )
}

function hasRetryAfter(entry: object): boolean {
  return Boolean(retryAfterHeader(entry))
}

/** An entry's `Retry-After` header, as the answer gave it. */
function retryAfterHeader(entry: object): unknown {
  const headers = (entry as { response?: { headers?: unknown } }).response
    ?.headers as
    | { get?: (name: string) => unknown; [name: string]: unknown }
    | undefined

  if (!headers || typeof headers !== 'object') return undefined
  if (typeof headers.get === 'function') return headers.get('retry-after')

  const key = Object.keys(headers).find(
    (name) => name.toLowerCase() === 'retry-after'
  )
  return key === undefined ? undefined : headers[key]
}

/**
 * The seconds a rate-limited answer asks to wait (`Retry-After`, in seconds), or
 * `undefined` when it names none. A date form is not read: the caller's own back-off
 * applies then.
 */
export function retryAfterSeconds(error: unknown): number | undefined {
  for (const entry of errorChain(error)) {
    const value = Number(
      String(retryAfterHeader(entry) ?? '').trim() || Number.NaN
    )
    if (Number.isFinite(value) && value >= 0) return value
  }

  return undefined
}

/** An entry's `code`, as a string: `SERVER_ERROR`, `ECONNREFUSED`, `-32005`. */
export function codeOf(entry: object): string | undefined {
  const code = (entry as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number'
    ? String(code)
    : undefined
}

/** An entry's text: ethers' `shortMessage` (without its request dump), else `message`. */
export function messageOf(entry: object): string | undefined {
  const { shortMessage, message } = entry as {
    shortMessage?: unknown
    message?: unknown
  }
  if (typeof shortMessage === 'string') return shortMessage
  return typeof message === 'string' ? message : undefined
}

/** Whether the RPC answered with a JSON-RPC error (a numeric code), so it did answer. */
export function answeredWithError(chain: object[]): boolean {
  return chain.some((entry) => {
    const code = (entry as { code?: unknown }).code
    return (
      (typeof code === 'number' && Number.isInteger(code)) ||
      (typeof code === 'string' && /^-?\d+$/.test(code))
    )
  })
}

/**
 * The error's most specific text, made safe to show: the RPC's own JSON-RPC message when
 * there is one, else ethers' short message, else the message; first line only, through
 * `sanitize` (credentials redacted before and after invisible characters are stripped, at
 * most 200 characters, a word split by the cut dropped), then with every URL removed, also
 * one without a scheme (`sanitize` keeps a URL's origin), and long hex shortened. Keeps the
 * name, and an error code such as `SERVER_ERROR` or `-32000`.
 */
export function redactedError(error: unknown): Error {
  const chain = errorChain(error)
  // ethers keeps the RPC's JSON-RPC error in `error` or `info.error`: the deepest message is
  // the RPC's own words, without ethers' request and payload dump.
  const texts = chain.map(messageOf).filter((text) => text !== undefined)
  const raw = texts.length ? texts[texts.length - 1] : String(error)

  // Redaction first, on the RPC's whole first line: the URL removal below cannot cut a URL
  // short of a token in it (`https://host/x\y/v3/<token>`) before `sanitize` sees it. The
  // raw error is in the debug channel already (`classifyLookupFailure`).
  const text = sanitize(raw.split(/\r?\n/)[0] ?? '', MAX_DETAIL_LENGTH, null)
    .replace(URL_TEXT, '<url>')
    .replace(HOST_PATH, '<url>')
    .replace(
      /\b0x[0-9a-f]{16,}\b/gi,
      (hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`
    )

  const safe = new Error(text || 'unknown error')
  const first = chain[0]
  if (first instanceof Error)
    safe.name = stripControlCharacters(String(first.name)).slice(0, 40)
  const code = chain.map(codeOf).find((value) => value && isErrorCode(value))
  if (code) Object.assign(safe, { code })

  return safe
}
