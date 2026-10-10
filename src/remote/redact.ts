/**
 * Redacted copies of storage pointers, for anything nautilus hands back to the caller.
 *
 * The on-chain copy of a pointer is node-encrypted. The copy in `PublishResponse.stored`
 * is not, and results get logged, stored and returned from APIs. So secrets are replaced:
 *
 *   - `s3Access.secretAccessKey` (the key id, bucket and object key stay, which is all
 *     `S3RemoteStore.remove()` needs);
 *   - every header value of a `url` pointer;
 *   - in a pointer's `url`, everything that can carry a credential (see `redactUrl`).
 *
 * The unredacted pointer goes to the sensitive debug channel (topic `store`) when it is on:
 * at `sensitive` without its credentials (the S3 secret key, header values, credentials in
 * the URL), at `secrets` whole.
 *
 * Kept out of the package's exports.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import { debugEnabled, debugRaw } from '../log/debug.js'

export const REDACTED = '<redacted>'

/** `REDACTED` as it reads inside a URL once the URL parser has encoded it. */
const REDACTED_IN_URL = encodeURIComponent(REDACTED)

export function redactPointer<T extends StorageObject>(pointer: T): T {
  if (!pointer || typeof pointer !== 'object') return pointer

  if (debugEnabled('sensitive', 'store'))
    debugRaw(
      'store',
      'storage pointer before redaction',
      pointer,
      headerValues((pointer as { headers?: unknown }).headers)
    )

  const copy = JSON.parse(JSON.stringify(pointer)) as Record<string, unknown>

  const s3Access = copy.s3Access as Record<string, unknown> | undefined
  if (s3Access && typeof s3Access === 'object' && 'secretAccessKey' in s3Access)
    s3Access.secretAccessKey = REDACTED

  if (copy.headers && typeof copy.headers === 'object')
    copy.headers = redactHeaders(copy.headers)

  if (typeof copy.url === 'string') copy.url = redactUrlQuietly(copy.url)

  return copy as T
}

/** The header values of a pointer: credentials, hidden below the `secrets` tier. */
function headerValues(headers: unknown): string[] {
  if (Array.isArray(headers)) return headers.flatMap(headerValues)
  if (!headers || typeof headers !== 'object') return []
  return Object.values(headers).map(String)
}

function redactHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) return headers.map(redactHeaders)
  if (!headers || typeof headers !== 'object') return REDACTED

  return Object.fromEntries(
    Object.keys(headers).map((name) => [name, REDACTED])
  )
}

/**
 * A URL with every component that can carry a credential replaced, and the rest kept so the
 * pointer still says where the object is:
 *
 *   - user info: the user name and the password, each when set. A token is often the user
 *     name alone (`https://<token>@host/…`);
 *   - the query: every parameter's value, whatever its name (`?X-Amz-Signature=…`,
 *     `?sig=…`, `?token=…`, `?apikey=…`). Parameter names stay, so a signed URL still reads
 *     as one. A part without `=` is replaced whole: it is a value without a name;
 *   - the fragment, whole. It is never sent to a server, so nothing reads it but a person.
 *
 * Scheme, host, port and path stay. A credential inside the path is not recognised; pass it
 * in a header or the query instead. A URL with none of the above comes back unchanged, and
 * a string that does not parse as a URL is replaced whole.
 */
export function redactUrl(url: string): string {
  const redacted = redactUrlQuietly(url)
  if (redacted !== url && debugEnabled('sensitive', 'store'))
    debugRaw('store', 'URL before redaction', url)
  return redacted
}

/** `redactUrl` without the debug output: `redactPointer` hands over the whole pointer. */
function redactUrlQuietly(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return REDACTED
  }

  if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash)
    return url

  if (parsed.username) parsed.username = REDACTED
  if (parsed.password) parsed.password = REDACTED

  const query = parsed.search.slice(1)
  if (query)
    parsed.search = query
      .split('&')
      .map((part) => {
        if (!part) return part

        const separator = part.indexOf('=')
        if (separator === -1) return REDACTED_IN_URL

        return separator === part.length - 1
          ? part
          : `${part.slice(0, separator)}=${REDACTED_IN_URL}`
      })
      .join('&')

  if (parsed.hash) parsed.hash = REDACTED_IN_URL

  return parsed.toString()
}
