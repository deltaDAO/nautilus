/**
 * Redaction of log events by field, before any sink sees them. Kept out of the package's
 * exports.
 *
 * Call sites pass structured fields, never pre-formatted secrets, and this module decides
 * by the field's key, compared lower-cased and without `-`, `_` and whitespace (so
 * `session_id`, `Session-Id` and `sessionId` are one key; see `keys.ts`, which the free-text
 * redaction of `src/node/messages.ts` shares):
 *
 * - a credential or a one-time value is replaced by `<redacted>`: the exact keys `nonce`,
 *   `sid`, `auth`, `bearer`, `seed`, `pk`, `privkey`, `otp`, `pin`, `hmac` and `requestUri`,
 *   and any key ending in a credential name (`secret`, `secretKey`, `password`, `apiKey`,
 *   `privateKey`, `sessionId`, `signature`, `cookie`, `jwt`, `authorization`, `accessToken`,
 *   `sessionToken`, `authorizationCode`, `credentials`, `presentation`, `signedTx`, `rawTx`,
 *   …). A key ending in `token` is redacted unless its value is an EVM address, so
 *   `paymentToken` stays readable; a key ending in `code` unless its value reads as an
 *   error code (`SERVER_ERROR`, `-32005`) or, for a `statusCode`, an HTTP status. A key
 *   is matched whole, before it is cut to the 100 characters it may be printed with;
 * - a URL (`url`, `uri`, `endpoint`, or a key ending in `Url`/`Uri`) is reduced to its
 *   origin, without user info;
 * - an `error`, and any `Error` value, goes through `sanitize` (`src/node/messages.ts`):
 *   its name, its message and the messages of up to two `cause`s, control characters
 *   stripped, credentials redacted, bounded. A thrown non-`Error` with a string `message`
 *   (and `code`) shows those;
 * - a byte array (`Uint8Array`, `Buffer`, `ArrayBuffer`) is shown as `[N bytes]`.
 *
 * Nested objects, class instances included, are redacted the same way, key by key (own
 * enumerable properties only). Keys are stripped of control characters and bounded. Every
 * other string goes through `sanitize` too, so a URL or a token inside free text is
 * redacted as well. The message of the event goes through `sanitize`.
 */

import {
  isErrorCode,
  sanitize,
  stripControlCharacters
} from '../node/messages.js'
import { isSecretKey, normalizeKey, redactsValue } from './keys.js'

export const REDACTED = '<redacted>'

/** How long a message may be. */
const MAX_MESSAGE_LENGTH = 2_000
/** How long a string field may be. */
const MAX_FIELD_LENGTH = 1_000
/** How long an error's message, or one of its causes', may be. */
const MAX_ERROR_LENGTH = 500
/** How long an error with its causes may be. */
const MAX_ERROR_CHAIN_LENGTH = 1_200
/** How long an error's name or code may be. */
const MAX_NAME_LENGTH = 100
/** How many levels of `cause` an error shows. */
const MAX_CAUSE_DEPTH = 2
/** How long a field's key may be. */
const MAX_KEY_LENGTH = 100
/** How deep nested fields are kept. */
const MAX_DEPTH = 4
/** How many entries of an array or object are kept. */
const MAX_ENTRIES = 50

/** Normalised `url`, `uri`, `endpoint`, `nodeUri`, `requestUrl`, `redirect_uri`, … */
const URL_KEY = /^endpoint$|(?:url|uri)$/

export { isSecretKey, normalizeKey }

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

/**
 * An error as `Name: message`, sanitised (`Error: …` is just the message), followed by up
 * to two levels of its `cause` as `(cause: …)` when they add something.
 */
export function redactError(error: unknown): string {
  const parts = [describeError(error)]
  let current = error

  for (let level = 0; level < MAX_CAUSE_DEPTH; level++) {
    const cause = causeOf(current)
    if (cause === undefined || cause === null || cause === current) break
    const text = describeError(cause)
    if (text && !parts.some((part) => part.includes(text))) parts.push(text)
    current = cause
  }

  const [first, ...causes] = parts
  const text = causes.length
    ? `${first} (cause: ${causes.join('; cause: ')})`
    : first
  return text.length > MAX_ERROR_CHAIN_LENGTH
    ? `${text.slice(0, MAX_ERROR_CHAIN_LENGTH)}…`
    : text
}

/** One error, without its cause. Never throws. */
function describeError(error: unknown): string {
  try {
    if (error instanceof Error) {
      const name = sanitize(String(error.name), MAX_NAME_LENGTH)
      const message = sanitize(String(error.message), MAX_ERROR_LENGTH)
      return name && name !== 'Error' ? `${name}: ${message}` : message
    }

    if (error && typeof error === 'object') {
      const { message, code } = error as { message?: unknown; code?: unknown }
      if (typeof message === 'string') {
        const text = sanitize(message, MAX_ERROR_LENGTH)
        const shown =
          (typeof code === 'string' || typeof code === 'number') &&
          isErrorCode(String(code))
            ? sanitize(String(code), MAX_NAME_LENGTH)
            : undefined
        return shown ? `${shown}: ${text}` : text
      }
      // Some other object: its fields, redacted by key like any other.
      return sanitize(
        JSON.stringify(redactPlain(error, MAX_DEPTH - 1)) ?? String(error),
        MAX_ERROR_LENGTH
      )
    }

    return sanitize(String(error), MAX_ERROR_LENGTH)
  } catch {
    return '[an error that cannot be read]'
  }
}

function causeOf(error: unknown): unknown {
  try {
    return error && typeof error === 'object'
      ? (error as { cause?: unknown }).cause
      : undefined
  } catch {
    return undefined
  }
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

  const normalized = normalizeKey(key)
  if (isSecretKey(key)) return redactsValue(key, value) ? REDACTED : value
  if (normalized === 'error' || value instanceof Error)
    return redactError(value)
  if (
    URL_KEY.test(normalized) &&
    (typeof value === 'string' || value instanceof URL)
  )
    return originOf(String(value))

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
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
    return `[${value.byteLength} bytes]`
  if (value instanceof URL) return originOf(value.href)
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
    // Matched whole, before the cut to `MAX_KEY_LENGTH`, and without control characters
    // and escapes, so neither a long key nor a `session\u0000Id` hides a credential.
    const value = redactValue(stripControlCharacters(key), object[key], depth)
    if (value !== undefined) out[sanitize(key, MAX_KEY_LENGTH)] = value
  }
  if (keys.length > MAX_ENTRIES) out['…'] = `${keys.length - MAX_ENTRIES} more`

  return out
}
