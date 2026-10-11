/**
 * Reading an RPC's error: what ethers wraps, at which depth, and whether it is a rate limit.
 *
 * Shared by the previous-order scan, which must not take a rate limit for a range refusal
 * (that halves the range until the reads run out, and ends in "not found"), and by the
 * classification of a failed lookup in `OrderCheckError`. Not exported from the package.
 */

/** A `-32005` that refuses the range or the number of results, not the request rate. */
const RANGE_REFUSAL = /range|more than|too (?:large|wide|big)|results/i
const RATE_LIMITED = /rate[\s-]?limit|too many requests/i

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
 * JSON-RPC `-32005` that does not refuse a range, or "rate limit" / "too many requests" in
 * its text. `undefined` when it did not.
 */
export function rateLimitOf(error: unknown): RateLimit | undefined {
  const chain = errorChain(error)
  const codes = chain.map(codeOf)
  const texts = chain.map(messageOf).filter((text) => text !== undefined)

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
    codes.includes('429') ||
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
  const headers = (entry as { response?: { headers?: unknown } }).response
    ?.headers as
    | { get?: (name: string) => unknown; [name: string]: unknown }
    | undefined

  if (!headers || typeof headers !== 'object') return false
  if (typeof headers.get === 'function')
    return Boolean(headers.get('retry-after'))
  return Object.keys(headers).some((key) => key.toLowerCase() === 'retry-after')
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
