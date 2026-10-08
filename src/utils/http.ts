/**
 * `fetch` with a per-request timeout that covers reading the body too. Kept out of the
 * package's exports.
 *
 * The timer is cleared in every outcome, so nothing keeps the event loop alive after the
 * call settles. The body of an error answer is read up to `MAX_ERROR_BODY_BYTES` only.
 *
 * Redirects are not followed by default: the requests nautilus sends carry credentials in
 * headers other than `Authorization` (which `fetch` strips on a cross-origin redirect) and
 * bodies (envelopes, signed DDOs), and a redirect could take them to another origin or to
 * plain `http://`. A 3xx answer throws a `RedirectError` instead.
 *
 * A caller that opts into `followRedirects` still gets two rules on the final URL: a
 * redirect that ends on plain `http://` on a non-loopback host throws a `RedirectError`,
 * unless the request itself already went there in clear, and so does one that ends on an
 * internal host (loopback, private, link-local; see `isInternalHost`) when the request went
 * to a public one.
 *
 * The body is read up to `maxBodyBytes` (8 MiB by default), so a server cannot make
 * nautilus buffer an answer of any size.
 */

import { isInternalHost, isLoopbackHost } from './transport.js'

export interface FetchedText {
  ok: boolean
  status: number
  statusText: string
  /** The body as text; for a non-2xx answer, at most `MAX_ERROR_BODY_BYTES` of it. */
  body: string
  /** The `Retry-After` header, when the response has one. */
  retryAfter?: string
  /**
   * The URL that answered: the last one after followed redirects (`response.url`), or the
   * requested URL when fetch reports none.
   */
  url?: string
}

/**
 * What `fetchResponse` resolves with: a 2xx answer with its body unread, or any other
 * answer read as text.
 */
export type FetchedResponse =
  | {
      ok: true
      status: number
      statusText: string
      /** The URL that answered, as in `FetchedText.url`. */
      url: string
      /** The response, its body unread. */
      response: Response
    }
  | (FetchedText & { ok: false })

export interface FetchTextOptions {
  /** Per-request timeout, body included. A finite number of milliseconds, 0 or more. */
  timeoutMs: number
  signal?: AbortSignal
  /**
   * Follow redirects (`redirect: 'follow'`). Default `false`: a 3xx answer throws a
   * `RedirectError`. Only for reads that send no credentials, no consumer data and no body,
   * e.g. a public gateway GET. A redirect still throws a `RedirectError` when it ends on
   * plain `http://` on a non-loopback host, unless the requested URL was such a URL
   * already, or on an internal host (`isInternalHost`), unless the requested URL was on one
   * already. Only the final URL is seen: fetch does not show the hops in between.
   */
  followRedirects?: boolean
  /**
   * The largest body read, in bytes. A larger 2xx answer throws a `ResponseTooLargeError`;
   * a non-2xx answer is cut at `MAX_ERROR_BODY_BYTES`, or at `maxBodyBytes` when that is
   * smaller. `fetchResponse` leaves a 2xx body to the caller. Default:
   * `DEFAULT_MAX_BODY_BYTES` (8 MiB).
   */
  maxBodyBytes?: number
}

/** The default of `FetchTextOptions.maxBodyBytes`: 8 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024

/** The longest delay `setTimeout` takes; anything longer fires after 1 ms. */
export const MAX_TIMER_MS = 2 ** 31 - 1

/** How much of an error answer's body is read; the rest is cancelled. */
export const MAX_ERROR_BODY_BYTES = 64 * 1024

/** Thrown when a request did not complete within its timeout. */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms`)
    this.name = 'RequestTimeoutError'
  }
}

/** Thrown when an answer's body is larger than `FetchTextOptions.maxBodyBytes`. */
export class ResponseTooLargeError extends Error {
  readonly maxBodyBytes: number

  constructor(maxBodyBytes: number) {
    super(`the answer is larger than ${maxBodyBytes} bytes`)
    this.name = 'ResponseTooLargeError'
    this.maxBodyBytes = maxBodyBytes
  }
}

/** Why a followed redirect was refused. */
type RedirectRefusal = 'insecure' | 'internal'

/**
 * Thrown when a request was answered with a redirect, which `fetchText` does not follow, or
 * (with `followRedirects`) when a followed redirect ended on plain `http://` or on an
 * internal host.
 */
export class RedirectError extends Error {
  /**
   * The redirect's status (0 for a browser's opaque redirect). For a followed redirect that
   * was refused, the status of that last answer.
   */
  readonly status: number
  /** The origin the redirect pointed to, when the response showed it. */
  readonly locationOrigin?: string
  /** Whether this is a followed redirect that ended on plain `http://`. */
  readonly insecure: boolean
  /** Whether this is a followed redirect from a public host that ended on an internal one. */
  readonly internal: boolean

  constructor(
    url: string,
    status: number,
    location?: string | null,
    refusal?: RedirectRefusal
  ) {
    const target = location ? originOf(location, url) : undefined
    const from = originOf(url, url) ?? 'the server'
    const to = target ? ` (${target})` : ''
    super(
      refusal === 'insecure'
        ? `${from} redirected to plain http://${to}. nautilus follows redirects only to https:// or a loopback host; use an https:// URL that answers without the redirect.`
        : refusal === 'internal'
          ? `${from} redirected to a loopback, private or link-local host${to}. nautilus does not follow a redirect from a public host to an internal one; use a URL that answers without the redirect.`
          : `${from} answered with a redirect (${status || 'opaque'})${target ? ` to ${target}` : ''}. nautilus does not follow redirects for requests that carry credentials or a body; use the final URL instead.`
    )
    this.name = 'RedirectError'
    this.status = status
    this.locationOrigin = target
    this.insecure = refusal === 'insecure'
    this.internal = refusal === 'internal'
  }
}

/**
 * Why a followed redirect from `requested` to `final` is refused, if it is:
 *
 * - `insecure`: it ended on plain `http://` on a non-loopback host. Not when `requested`
 *   was such a URL already: the caller chose to send it in clear (`allowInsecureTransport`),
 *   so the redirect downgrades nothing.
 * - `internal`: it ended on an internal host (loopback, private, link-local) while
 *   `requested` was on a public one, so a public server could make nautilus read, and
 *   relay into an error message, what an internal one (e.g. cloud metadata) answers.
 */
function refusedRedirect(
  requested: string,
  final: string
): RedirectRefusal | undefined {
  if (final === requested) return undefined

  const parse = (value: string) => {
    try {
      return new URL(value)
    } catch {
      return undefined
    }
  }
  const from = parse(requested)
  const to = parse(final)
  const plainRemote = (url: URL | undefined) =>
    url?.protocol === 'http:' && !isLoopbackHost(url.hostname)

  if (plainRemote(to) && !plainRemote(from)) return 'insecure'
  if (
    to &&
    from &&
    isInternalHost(to.hostname) &&
    !isInternalHost(from.hostname)
  )
    return 'internal'

  return undefined
}

/** The origin of `url` (resolved against `base`), without path, query or credentials. */
function originOf(url: string, base: string): string | undefined {
  try {
    const origin = new URL(url, base).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/**
 * The redirect rule for one response: throws a `RedirectError` (after cancelling the body)
 * for a 3xx unless `followRedirects`, and for a followed redirect `refusedRedirect` refuses.
 * Returns the URL that answered.
 */
async function assertRedirectRule(
  response: Response,
  url: string,
  followRedirects: boolean
): Promise<string> {
  // Node's fetch hands back the 3xx itself; browsers an opaque `opaqueredirect` (status 0).
  if (
    !followRedirects &&
    (response.type === 'opaqueredirect' ||
      (response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304))
  ) {
    await response.body?.cancel?.().catch(() => undefined)
    throw new RedirectError(
      url,
      response.status,
      response.headers?.get?.('location')
    )
  }

  // Before the body is read: the answer of a refused hop is not used.
  const finalUrl = response.url || url
  const refusal = followRedirects ? refusedRedirect(url, finalUrl) : undefined
  if (refusal) {
    await response.body?.cancel?.().catch(() => undefined)
    throw new RedirectError(url, response.status, finalUrl, refusal)
  }

  return finalUrl
}

/**
 * Sends one request and reads its body as text within `timeoutMs`. The body of a non-2xx
 * answer is read up to `MAX_ERROR_BODY_BYTES`; the rest is cancelled.
 *
 * Rejects with `signal.reason` when the caller's `signal` aborts, with a
 * `RequestTimeoutError` on timeout, with a `RedirectError` on a 3xx answer (unless
 * `followRedirects`) and on a followed redirect the rule refuses (see
 * `FetchTextOptions.followRedirects`), with a `ResponseTooLargeError` for a 2xx body over
 * `maxBodyBytes`, with a `RangeError` for a `timeoutMs` that is negative or not finite,
 * and with fetch's own error otherwise. Timeouts above 2^31 − 1 ms are clamped to that.
 */
export function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: FetchTextOptions
): Promise<FetchedText> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  return request(fetchImpl, url, init, options, (response, finalUrl, signal) =>
    response.ok
      ? readAnswer(response, finalUrl, signal, maxBodyBytes, 'refuse')
      : readAnswer(
          response,
          finalUrl,
          signal,
          errorBodyBytes(options),
          'truncate'
        )
  )
}

/**
 * Like `fetchText`, but a 2xx answer resolves with its `Response` as soon as the headers
 * arrived, and leaves the body to the caller, e.g. to stream it: `timeoutMs` covers the
 * request up to the headers, and `signal` stays attached to the body. A non-2xx answer is
 * read as `fetchText` reads it, within `timeoutMs`. Same errors and redirect rule as
 * `fetchText`; `maxBodyBytes` bounds only the error body here, as the 2xx body is the
 * caller's to read.
 */
export function fetchResponse(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: FetchTextOptions
): Promise<FetchedResponse> {
  return request(
    fetchImpl,
    url,
    init,
    options,
    async (response, finalUrl, signal) =>
      response.ok
        ? {
            ok: true,
            status: response.status,
            statusText: response.statusText,
            url: finalUrl,
            response
          }
        : {
            ...(await readAnswer(
              response,
              finalUrl,
              signal,
              errorBodyBytes(options),
              'truncate'
            )),
            ok: false
          }
  )
}

/**
 * The one implementation behind `fetchText` and `fetchResponse`: sends the request and runs
 * `read` on its answer, both within `timeoutMs`, after the redirect rule. `signal` (the
 * caller's, combined with the timeout) stays attached to the body after this settles; the
 * timer does not.
 */
async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: FetchTextOptions,
  read: (
    response: Response,
    finalUrl: string,
    signal: AbortSignal
  ) => Promise<T>
): Promise<T> {
  const { timeoutMs, signal, followRedirects = false } = options

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new RangeError(
      `timeoutMs must be a finite number of milliseconds, 0 or more; got ${timeoutMs}`
    )

  if (signal?.aborted) throw signal.reason

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(
    () => {
      timedOut = true
      controller.abort()
    },
    Math.min(timeoutMs, MAX_TIMER_MS)
  )
  const requestSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: followRedirects ? 'follow' : 'manual',
      signal: requestSignal
    })
    const finalUrl = await assertRedirectRule(response, url, followRedirects)

    return await read(response, finalUrl, requestSignal)
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (timedOut) throw new RequestTimeoutError(timeoutMs)

    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * How much of an error answer's body is read: `MAX_ERROR_BODY_BYTES`, or `maxBodyBytes`
 * when that is smaller.
 */
function errorBodyBytes(options: FetchTextOptions): number {
  return Math.min(
    MAX_ERROR_BODY_BYTES,
    options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  )
}

/**
 * An answer read as text, at most `maxBytes` of its body: past that, `'refuse'` throws a
 * `ResponseTooLargeError` and `'truncate'` keeps the first `maxBytes`.
 */
async function readAnswer(
  response: Response,
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  overflow: BodyOverflow
): Promise<FetchedText> {
  const body = await readBoundedText(response, maxBytes, signal, overflow)
  const retryAfter = response.headers?.get?.('retry-after') ?? undefined

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
    url,
    ...(retryAfter ? { retryAfter } : {})
  }
}

/** What `readBoundedText` does with a body over its bound. */
type BodyOverflow = 'refuse' | 'truncate'

/**
 * The body as UTF-8 text, at most `maxBytes` of it, counted in bytes. Past that the rest of
 * the stream is cancelled, and `'refuse'` throws a `ResponseTooLargeError` (also, before
 * reading, for a declared `content-length` over it) while `'truncate'` returns what was
 * read. Rejects when `signal` aborts while it reads, also for a body stream that does not
 * follow the request's signal.
 */
async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  overflow: BodyOverflow
): Promise<string> {
  const refuse = overflow === 'refuse'
  const reader = response.body?.getReader?.()

  const declared = Number(response.headers?.get?.('content-length'))
  if (refuse && Number.isFinite(declared) && declared > maxBytes) {
    await reader?.cancel().catch(() => undefined)
    throw new ResponseTooLargeError(maxBytes)
  }

  if (!reader) {
    const text = await response.text()
    if (!refuse) return text.slice(0, maxBytes)
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new ResponseTooLargeError(maxBytes)
    return text
  }

  const onAbort = () => {
    reader.cancel(signal.reason).catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  const decoder = new TextDecoder()
  let text = ''
  let received = 0
  try {
    for (;;) {
      if (!refuse && received >= maxBytes) {
        await reader.cancel().catch(() => undefined)
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      const room = maxBytes - received
      if (value.byteLength > room) {
        if (refuse) {
          await reader.cancel().catch(() => undefined)
          throw new ResponseTooLargeError(maxBytes)
        }
        received += room
        text += decoder.decode(value.subarray(0, room), { stream: true })
        continue
      }

      received += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
    if (signal.aborted) throw signal.reason

    return text + decoder.decode()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** The message of whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return cause instanceof Error && cause.message !== error.message
      ? `${error.message} (${cause.message})`
      : error.message
  }

  return String(error)
}
