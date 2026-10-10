/**
 * Redaction of log events by field, before any sink sees them. Kept out of the package's
 * exports.
 *
 * Call sites pass structured fields, never pre-formatted secrets, and this module decides
 * by the field's key:
 *
 * - a credential or one-time value (`sessionId`, `signature`, `nonce`, `jwt`, `token`,
 *   `authorization`, `secretAccessKey` and the like) is replaced by `<redacted>`;
 * - a URL (`url`, `uri`, `endpoint`, or a key ending in `Url`/`Uri`) is reduced to its
 *   origin, without user info;
 * - an `error`, and any `Error` value, goes through `sanitize` (`src/node/messages.ts`):
 *   its name and its message, control characters stripped, credentials redacted, bounded.
 *
 * Every other string goes through `sanitize` too, so a URL or a token inside free text is
 * redacted as well. The message of the event goes through `sanitize`.
 */
import { sanitize } from '../node/messages.js'

export const REDACTED = '<redacted>'

/** How long a message may be. */
const MAX_MESSAGE_LENGTH = 2_000
/** How long a string field may be. */
const MAX_FIELD_LENGTH = 1_000
/** How long an error's message may be. */
const MAX_ERROR_LENGTH = 500
/** How deep nested fields are kept. */
const MAX_DEPTH = 4
/** How many entries of an array or object are kept. */
const MAX_ENTRIES = 50

/** Keys (lower-cased) whose value is a credential, a session secret or a one-time value. */
const SECRET_KEYS = new Set([
  'sessionid',
  'signature',
  'consumersignature',
  'nonce',
  'jwt',
  'token',
  'accesstoken',
  'access_token',
  'idtoken',
  'id_token',
  'vp_token',
  'authorization',
  'cookie',
  'password',
  'apikey',
  'api_key',
  'secretaccesskey',
  'privatekey',
  'mnemonic'
])

/** `url`, `uri`, `endpoint`, `nodeUri`, `requestUrl`, `redirect_uri`, … */
const URL_KEY = /^(?:url|uri|endpoint)$|(?:url|uri)$/i

/** The message of an event, made safe to print. */
export function redactMessage(message: string): string {
  return sanitize(message, MAX_MESSAGE_LENGTH)
}

/** A copy of `fields` with every value redacted by its key, safe to serialise as JSON. */
export function redactFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return redactObject(fields, 0)
}

/** An error as `Name: message`, sanitised (`Error: …` is just the message). */
export function redactError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined
  const message = sanitize(
    error instanceof Error ? error.message : String(error),
    MAX_ERROR_LENGTH
  )

  return name && name !== 'Error' ? `${name}: ${message}` : message
}

/** `scheme://host[:port]` of an http(s) URL; any other text sanitised. */
export function originOf(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
    // `ws:`, `p2p` multiaddrs parsed as URLs and the like: no origin, so no path either.
    return `${url.protocol}//${url.host}`
  } catch {
    // A libp2p peer id or multiaddr, or not a URL at all: free text.
    return sanitize(value, MAX_FIELD_LENGTH)
  }
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (value === undefined || value === null) return value

  const lower = key.toLowerCase()
  if (SECRET_KEYS.has(lower)) return REDACTED
  if (lower === 'error' || value instanceof Error) return redactError(value)
  if (URL_KEY.test(key) && typeof value === 'string') return originOf(value)

  return redactPlain(value, depth)
}

function redactPlain(value: unknown, depth: number): unknown {
  switch (typeof value) {
    case 'string':
      return sanitize(value, MAX_FIELD_LENGTH)
    case 'number':
    case 'boolean':
      return value
    case 'bigint':
      return value.toString()
    case 'function':
    case 'symbol':
      return undefined
  }

  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[…]'

  if (Array.isArray(value)) {
    const kept = value
      .slice(0, MAX_ENTRIES)
      .map((entry) =>
        entry instanceof Error
          ? redactError(entry)
          : redactPlain(entry, depth + 1)
      )
    if (value.length > MAX_ENTRIES)
      kept.push(`… ${value.length - MAX_ENTRIES} more`)
    return kept
  }

  return redactObject(value as Record<string, unknown>, depth + 1)
}

function redactObject(
  object: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys = Object.keys(object)

  for (const key of keys.slice(0, MAX_ENTRIES)) {
    const value = redactValue(key, object[key], depth)
    if (value !== undefined) out[key] = value
  }
  if (keys.length > MAX_ENTRIES) out['…'] = `${keys.length - MAX_ENTRIES} more`

  return out
}
