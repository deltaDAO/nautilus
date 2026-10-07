/**
 * `fetch` with a per-request timeout that covers reading the body too. Kept out of the
 * package's exports.
 *
 * The timer is cleared and the abort listener removed in every outcome, so nothing keeps
 * the event loop alive after the call settles.
 */

export interface FetchedText {
  ok: boolean
  status: number
  statusText: string
  body: string
  /** The `Retry-After` header, when the response has one. */
  retryAfter?: string
}

/** Thrown when a request did not complete within its timeout. */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs} ms`)
    this.name = 'RequestTimeoutError'
  }
}

/**
 * Sends one request and reads its body as text within `timeoutMs`.
 *
 * Rejects with `signal.reason` when the caller's `signal` aborts, with a
 * `RequestTimeoutError` on timeout, and with fetch's own error otherwise.
 */
export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<FetchedText> {
  const { timeoutMs, signal } = options

  if (signal?.aborted) throw signal.reason

  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal
    })
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
