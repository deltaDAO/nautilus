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
 */

export interface FetchedText {
  ok: boolean
  status: number
  statusText: string
  body: string
  /** The `Retry-After` header, when the response has one. */
  retryAfter?: string
}

export interface FetchTextOptions {
  /** Per-request timeout, body included. A finite number of milliseconds, 0 or more. */
  timeoutMs: number
  signal?: AbortSignal
  /**
   * Follow redirects (`redirect: 'follow'`). Default `false`: a 3xx answer throws a
   * `RedirectError`. Only for reads that send no credentials and no body, e.g. a public
   * gateway GET.
   */
  followRedirects?: boolean
}

/** The longest delay `setTimeout` takes; anything longer fires after 1 ms. */
export const MAX_TIMER_MS = 2 ** 31 - 1

/** Thrown when a request did not complete within its timeout. */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms`)
    this.name = 'RequestTimeoutError'
  }
}

/** Thrown when a request was answered with a redirect, which `fetchText` does not follow. */
export class RedirectError extends Error {
  readonly status: number
  /** The origin the redirect pointed to, when the response showed it. */
  readonly locationOrigin?: string

  constructor(url: string, status: number, location?: string | null) {
    const target = location ? originOf(location, url) : undefined
    super(
      `${originOf(url, url) ?? 'the server'} answered with a redirect (${status || 'opaque'})${target ? ` to ${target}` : ''}. nautilus does not follow redirects for requests that carry credentials or a body; use the final URL instead.`
    )
    this.name = 'RedirectError'
    this.status = status
    this.locationOrigin = target
  }
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
 * `followRedirects`), with a `RangeError` for a `timeoutMs` that is negative or not finite,
 * and with fetch's own error otherwise. Timeouts above 2^31 − 1 ms are clamped to that.
 */
export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: FetchTextOptions
): Promise<FetchedText> {
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

    const body = await response.text()
    const retryAfter = response.headers?.get?.('retry-after') ?? undefined

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
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
