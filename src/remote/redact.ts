/**
 * Redacted copies of storage pointers, for anything nautilus hands back to the caller.
 *
 * The on-chain copy of a pointer is node-encrypted. The copy in `PublishResponse.stored`
 * is not, and results get logged, stored and returned from APIs. So secrets are replaced:
 *
 *   - `s3Access.secretAccessKey` (the key id, bucket and object key stay, which is all
 *     `S3RemoteStore.remove()` needs);
 *   - every header value of a `url` pointer;
 *   - the password in a URL's user info (`ftp://user:password@host/…`).
 *
 * Kept out of the package's exports.
 */
import type { StorageObject } from '@oceanprotocol/lib'

export const REDACTED = '<redacted>'

export function redactPointer<T extends StorageObject>(pointer: T): T {
  if (!pointer || typeof pointer !== 'object') return pointer

  const copy = JSON.parse(JSON.stringify(pointer)) as Record<string, unknown>

  const s3Access = copy.s3Access as Record<string, unknown> | undefined
  if (s3Access && typeof s3Access === 'object' && 'secretAccessKey' in s3Access)
    s3Access.secretAccessKey = REDACTED

  if (copy.headers && typeof copy.headers === 'object')
    copy.headers = redactHeaders(copy.headers)

  if (typeof copy.url === 'string') copy.url = redactUserInfo(copy.url)

  return copy as T
}

function redactHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) return headers.map(redactHeaders)
  if (!headers || typeof headers !== 'object') return REDACTED

  return Object.fromEntries(
    Object.keys(headers).map((name) => [name, REDACTED])
  )
}

function redactUserInfo(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.password) return url

    parsed.password = REDACTED
    return parsed.toString()
  } catch {
    return url
  }
}
