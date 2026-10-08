/**
 * `fetch` with a per-request timeout that covers reading the body too. Kept out of the
 * package's exports.
 *
 * The timer is cleared and the abort listener removed in every outcome, so nothing keeps
 * the event loop alive after the call settles.
 *
 * Redirects are not followed by default: the requests nautilus sends carry credentials in
 * headers other than `Authorization` (which `fetch` strips on a cross-origin redirect) and
 * bodies (envelopes, signed DDOs), and a redirect could take them to another origin or to
 * plain `http://`. A 3xx answer throws a `RedirectError` instead.
 *
 * A caller that opts into `followRedirects` still gets the transport rule on the final URL:
 * a redirect that ends on plain `http://` on a non-loopback host throws a `RedirectError`,
 * unless the request itself already went there in clear.
 *
 * The body is read up to `maxBodyBytes` (8 MiB by default), so a server cannot make
 * nautilus buffer an answer of any size.
 */

import { isLoopbackHost } from './transport.js'

export interface FetchedText {
  ok: boolean
  status: number
  statusText: string
  body: string
  /** The `Retry-After` header, when the response has one. */
  retryAfter?: string
  /**
   * The URL that answered: the last one after followed redirects (`response.url`), or the
   * requested URL when fetch reports none.
   */
  url?: string
}

export interface FetchTextOptions {
  /** Per-request timeout, body included. A finite number of milliseconds, 0 or more. */
  timeoutMs: number
  signal?: AbortSignal
  /**
   * Follow redirects (`redirect: 'follow'`). Default `false`: a 3xx answer throws a
   * `RedirectError`. Only for reads that send no credentials and no body, e.g. a public
   * gateway GET. A redirect that ends on plain `http://` on a non-loopback host still
   * throws a `RedirectError`, unless the requested URL was such a URL already.
   */
  followRedirects?: boolean
  /**
   * The largest body read, in bytes. A larger answer throws a `ResponseTooLargeError`.
   * Default: `DEFAULT_MAX_BODY_BYTES` (8 MiB).
   */
  maxBodyBytes?: number
}

/** The default of `FetchTextOptions.maxBodyBytes`: 8 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024

/** The longest delay `setTimeout` takes; anything longer fires after 1 ms. */
export const MAX_TIMER_MS = 2 ** 31 - 1

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

/**
 * Thrown when a request was answered with a redirect, which `fetchText` does not follow, or
 * (with `followRedirects`) when a followed redirect ended on plain `http://`.
 */
export class RedirectError extends Error {
  /**
   * The redirect's status (0 for a browser's opaque redirect). For a followed redirect that
   * ended on plain `http://`, the status of that last answer.
   */
  readonly status: number
  /** The origin the redirect pointed to, when the response showed it. */
  readonly locationOrigin?: string
  /** Whether this is a followed redirect that ended on plain `http://`. */
  readonly insecure: boolean

  constructor(
    url: string,
    status: number,
    location?: string | null,
    insecure = false
  ) {
    const target = location ? originOf(location, url) : undefined
    const from = originOf(url, url) ?? 'the server'
    super(
      insecure
        ? `${from} redirected to plain http://${target ? ` (${target})` : ''}. nautilus follows redirects only to https:// or a loopback host; use an https:// URL that answers without the redirect.`
        : `${from} answered with a redirect (${status || 'opaque'})${target ? ` to ${target}` : ''}. nautilus does not follow redirects for requests that carry credentials or a body; use the final URL instead.`
    )
    this.name = 'RedirectError'
    this.status = status
    this.locationOrigin = target
    this.insecure = insecure
  }
}

/**
 * Whether a followed redirect took the request from `requested` to plain `http://` on a
 * non-loopback host. Not when `requested` was such a URL already: the caller chose to send
 * it in clear (`allowInsecureTransport`), so the redirect downgrades nothing.
 */
function isInsecureRedirect(requested: string, final: string): boolean {
  const parse = (value: string) => {
    try {
      return new URL(value)
    } catch {
      return undefined
    }
  }
  const plainRemote = (url: URL | undefined) =>
    url?.protocol === 'http:' && !isLoopbackHost(url.hostname)

  return plainRemote(parse(final)) && !plainRemote(parse(requested))
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
 * Sends one request and reads its body as text within `timeoutMs`.
 *
 * Rejects with `signal.reason` when the caller's `signal` aborts, with a
 * `RequestTimeoutError` on timeout, with a `RedirectError` on a 3xx answer (unless
 * `followRedirects`) and on a followed redirect that ends on plain `http://` on a
 * non-loopback host (see `FetchTextOptions.followRedirects`), with a
 * `ResponseTooLargeError` for a body over `maxBodyBytes`, with a `RangeError` for a
 * `timeoutMs` that is negative or not finite, and with fetch's own error otherwise.
 * Timeouts above 2^31 − 1 ms are clamped to that.
 */
export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: FetchTextOptions
): Promise<FetchedText> {
  const {
    timeoutMs,
    signal,
    followRedirects = false,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES
  } = options

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
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal
    })

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

    // Before the body is read: the answer of a plain-http hop is not used.
    const finalUrl = response.url || url
    if (followRedirects && isInsecureRedirect(url, finalUrl)) {
      await response.body?.cancel?.().catch(() => undefined)
      throw new RedirectError(url, response.status, finalUrl, true)
    }

    const body = await readBody(response, maxBodyBytes)
    const retryAfter = response.headers?.get?.('retry-after') ?? undefined

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      url: finalUrl,
      ...(retryAfter ? { retryAfter } : {})
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (timedOut) throw new RequestTimeoutError(timeoutMs)

    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** The body as text, refused once it is over `maxBytes`. */
async function readBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers?.get?.('content-length'))
  const reader = response.body?.getReader?.()

  if (Number.isFinite(declared) && declared > maxBytes) {
    await reader?.cancel().catch(() => undefined)
    throw new ResponseTooLargeError(maxBytes)
  }

  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new ResponseTooLargeError(maxBytes)
    return text
  }

  const decoder = new TextDecoder()
  let size = 0
  let text = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ResponseTooLargeError(maxBytes)
    }

    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
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
