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
 *   `sid`, `auth`, `bearer`, `seed`, `pk`, `privkey`, `otp`, `pin`, `hmac`, `dkey`, `sig`,
 *   `pass`, `pwd` and `requestUri`, any key holding `privateKey`, any key ending in the word
 *   `pass` (`DB_PASS`), any key ending in a credential name (`secret`, `secretKey`,
 *   `password`, `apiKey`, `privateKey`, `sessionId`, `signature`, `cookie`, `jwt`,
 *   `authorization`, `accessToken`, `sessionToken`, `authorizationCode`, `credentials`,
 *   `presentation`, `signedTx`, `rawTx`, …), and any other key ending in `key` or `auth`
 *   but `key`, `publicKey` and `objectKey`. A key ending in `token` is redacted unless its
 *   value is an EVM address, so `paymentToken` stays readable; `code` and one-time codes
 *   (`otpCode`, `recoveryCode`, …) unless the value reads as an error code
 *   (`SERVER_ERROR`, `-32005`). See `keys.ts`. A key is matched whole, before it is cut to the 100 characters it may be printed with;
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
 *
 * What the redaction removed is not lost: `debugUnredacted` hands the raw message and
 * fields of a printed event to the sensitive debug channel (`debug.ts`), when it is on.
 */

import {
  isErrorCode,
  sanitize,
  stripControlCharacters
} from '../node/messages.js'
import { type DebugTopic, debugEnabled, debugRaw } from './debug.js'
import type { LogComponent, LogEventName } from './events.js'
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

/** `sanitize` without its own debug output: `debugUnredacted` hands over the whole event. */
function scrub(text: string, maxLength: number): string {
  return sanitize(text, maxLength, null)
}

/** The message of an event, made safe to print. */
export function redactMessage(message: string): string {
  return scrub(message, MAX_MESSAGE_LENGTH)
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
      const name = scrub(String(error.name), MAX_NAME_LENGTH)
      const message = scrub(String(error.message), MAX_ERROR_LENGTH)
      return name && name !== 'Error' ? `${name}: ${message}` : message
    }

    if (error && typeof error === 'object') {
      const { message, code } = error as { message?: unknown; code?: unknown }
      if (typeof message === 'string') {
        const text = scrub(message, MAX_ERROR_LENGTH)
        const shown =
          (typeof code === 'string' || typeof code === 'number') &&
          isErrorCode(String(code))
            ? scrub(String(code), MAX_NAME_LENGTH)
            : undefined
        return shown ? `${shown}: ${text}` : text
      }
      // Some other object: its fields, redacted by key like any other.
      return scrub(
        JSON.stringify(redactPlain(error, MAX_DEPTH - 1)) ?? String(error),
        MAX_ERROR_LENGTH
      )
    }

    return scrub(String(error), MAX_ERROR_LENGTH)
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
    return scrub(value, MAX_FIELD_LENGTH)
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
  // `null` or `undefined` in a list: kept (JSON writes both as `null`).
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'string':
      return scrub(value, MAX_FIELD_LENGTH)
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
    if (value !== undefined) out[scrub(key, MAX_KEY_LENGTH)] = value
  }
  if (keys.length > MAX_ENTRIES) out['…'] = `${keys.length - MAX_ENTRIES} more`

  return out
}

// #region debug channel

/** The debug topic of a component's events; `config` has none (nothing to redact). */
const COMPONENT_TOPIC: Partial<Record<LogComponent, DebugTopic>> = {
  publish: 'rpc',
  edit: 'rpc',
  lifecycle: 'rpc',
  chain: 'rpc',
  access: 'order',
  compute: 'compute',
  node: 'node',
  store: 'store',
  identity: 'policy',
  oceanjs: 'node'
}

/** Events whose topic is not their component's. */
const EVENT_TOPIC: Partial<Record<LogEventName, DebugTopic>> = {
  'publish.preflight.publisher_is_node': 'node',
  'publish.preflight.node_address_unreadable': 'node',
  'publish.preflight.denies_all': 'policy',
  'publish.preflight.policy_server_unknown': 'policy',
  'publish.preflight.indexer_nonce_unreadable': 'nonce',
  'publish.preflight.indexer_nonce_will_stick': 'nonce',
  'publish.preflight.pending_unreadable': 'nonce',
  'node.policy_server.empty_url': 'policy'
}

/**
 * Hands the raw message and fields of a printed log event to the sensitive debug channel,
 * when its topic is on and the redaction changed something. Never throws.
 */
export function debugUnredacted(
  name: LogEventName,
  component: LogComponent,
  msg: string,
  fields: Record<string, unknown>,
  printedMsg: string
): void {
  const topic = EVENT_TOPIC[name] ?? COMPONENT_TOPIC[component]
  if (!topic || !debugEnabled('sensitive', topic)) return
  try {
    if (msg === printedMsg && !touches(fields)) return
    debugRaw(topic, `log event ${name} before redaction`, { msg, fields })
  } catch {
    // Debug output must never fail the operation it describes.
  }
}

/**
 * Whether the redaction of `fields` changes anything: the redacted copy (`redactFields`,
 * the same code that redacts the printed event, so the two cannot drift apart) compared
 * with a plain JSON copy of the raw fields. Fields that do not serialise (a cycle) count
 * as changed.
 */
function touches(fields: Record<string, unknown>): boolean {
  let raw: string | undefined
  try {
    raw = JSON.stringify(fields, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  } catch {
    return true
  }
  return JSON.stringify(redactFields(fields)) !== raw
}

// #endregion
