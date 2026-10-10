/**
 * How the node's error text becomes part of an error message. Kept out of the package's
 * exports.
 *
 * ocean-node answers errors in plain text (`Use the initializeCompute endpoint…`), as a JSON
 * string (`"Error: Access to asset … was denied"`) or as a JSON object (`{ "error": … }`).
 * `nodeText` turns each into the message itself.
 *
 * Every sanitiser here also hands the raw value to the sensitive debug channel
 * (`log/debug.ts`), under a topic (`node` by default), so that redaction never makes a
 * failure undiagnosable. That channel is off by default; when off, nothing is copied. The
 * values returned here are the same with it on or off.
 */

import { type DebugTopic, debugEnabled, debugRaw } from '../log/debug.js'
import { isErrorCode, isSecretKey, redactsValue } from '../log/keys.js'

/** A non-2xx answer of the node. A `FetchedText` is one. */
export interface NodeAnswer {
  status: number
  statusText: string
  /** The body as text. */
  body: string
}

/** How much of a node's text goes into an error message. */
const MAX_NODE_MESSAGE_LENGTH = 200

/** `scheme://authority/path?query#fragment`, up to whitespace or a quote. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]*/gi

/** The forms free text gives a credential in, by the key before it. */
type KeyValueForm = 'escaped' | 'json' | 'assignment' | 'bare'

/**
 * A key and its separator, in each form: `\"key\": value` in JSON inside a JSON string
 * (ethers quotes a response body so), `"key": value` in JSON, `key=value` in a query, a form
 * body or prose (ethers' `code=…, info={ … }`), and `key: value` or `'key': value` (headers,
 * prose, `util.inspect`). A quoted key is any quoted text; an unquoted one a word of
 * letters, digits, `-` and `_`, read from its last 64 characters when it is longer. Which
 * keys are secret is `redactsValue`'s call (`log/keys.ts`), as for log fields.
 */
const KEY_VALUE_FORMS: [KeyValueForm, RegExp][] = [
  ['escaped', /\\"([^"\\]{1,256})\\"\s*:\s*/g],
  ['json', /"([^"\\]{1,256})"\s*:\s*/g],
  ['assignment', /([A-Za-z][\w-]{0,63})[ \t]*=[ \t]*/g],
  ['bare', /([A-Za-z][\w-]{0,63})'?[ \t]*:[ \t]*/g]
]
/** Where an unquoted value ends, by form. */
const UNQUOTED_VALUE: Record<KeyValueForm, RegExp> = {
  escaped: /[^\s,}\]\\]+/y,
  json: /[^\s,}\]]+/y,
  assignment: /[^&\s"'#,;)]+/y,
  bare: /[^\s,;"'&)}\]]+/y
}
/** What a redacted value becomes, by form. */
const REDACTED_VALUE: Record<KeyValueForm, string> = {
  escaped: '\\"<redacted>\\"',
  json: '"<redacted>"',
  assignment: '<redacted>',
  bare: '<redacted>'
}
/** An authorization scheme before its credential (`Authorization: Basic …`), kept. */
const SCHEME = /(?:Bearer|Basic|Token|Digest|Negotiate|AWS4-HMAC-SHA256)\s+/iy
/** How far a value is followed into nested braces and strings. */
const MAX_VALUE_LENGTH = 10_000
/** A `Bearer` or `Basic` credential, wherever it stands. */
const BEARER = /((?:Bearer|Basic)\s+)[\w.~+/=-]+/gi
/** A JWT (`eyJ…` header, payload and signature, base64url). */
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g
/** A 65-byte ECDSA signature in hex, wherever it stands. */
const HEX_SIGNATURE = /\b0x[0-9a-f]{130}\b/gi
/**
 * A raw signed transaction (ethers quotes it in `transaction="0x02f8…"` of a failed
 * `eth_sendRawTransaction`): an RLP list, typed (`0x01`-`0x04`) or legacy, of 100 bytes or
 * more. Whoever holds one that was never mined can still send it.
 */
const SIGNED_TRANSACTION = /\b0x(?:0[1-4])?f[89a][0-9a-f]{196,}\b/gi

/** ANSI escape sequences: CSI (`ESC [ … m`), OSC (`ESC ] … BEL`) and two-byte ones. */
const ANSI_ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
/**
 * Invisible characters: C0 controls but the whitespace ones, DEL, C1 controls, the soft
 * hyphen, zero-width characters, word joiners, the BOM, and the bidi marks, overrides and
 * isolates. They are deleted, not turned into a space, so none can split a key
 * (`session\0Id=…`) or a value out of the redaction's view.
 */
const INVISIBLE_CHARACTERS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g

/**
 * `text` with credentials replaced by `<redacted>`:
 *
 * - the value of every key the log-field redaction treats as secret (`redactsValue`,
 *   `log/keys.ts`: signatures, tokens, nonces, session ids, passwords, API keys, S3 and
 *   OAuth secrets, private keys, cookies, presentations, signed transactions, …), given as
 *   `key=value`, as a JSON field (also inside a JSON string, `\"key\":\"value\"`), or as
 *   `key: value` or `'key': 'value'`; a quoted, bracketed or `Bearer`/`Basic` value is
 *   redacted whole. As for fields, a `…token` holding an EVM address is kept, and so is a
 *   `…code` that reads as an error code (`code=SERVER_ERROR`, `"code": -32005`), so RPC
 *   failures stay legible;
 * - `Bearer` and `Basic` credentials, JWTs, 65-byte hex signatures and raw signed
 *   transactions anywhere.
 *
 * A URL keeps its origin only: its path and query (an openid4vp `request_uri`, a policy
 * server's redirect URI, an internal path) are dropped, and so are its user and password.
 */
export function redactSecrets(text: string): string {
  return redactKeyValues(text.replace(URL_PATTERN, originOnly))
    .replace(BEARER, '$1<redacted>')
    .replace(JWT, '<redacted>')
    .replace(HEX_SIGNATURE, '<redacted>')
    .replace(SIGNED_TRANSACTION, '<redacted>')
}

/** `text` with the value of every secret key redacted, in each form in turn. */
function redactKeyValues(text: string): string {
  let result = text
  for (const [form, pattern] of KEY_VALUE_FORMS)
    result = redactForm(result, form, pattern)
  return result
}

function redactForm(text: string, form: KeyValueForm, pattern: RegExp): string {
  let out = ''
  let copied = 0
  pattern.lastIndex = 0

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    // Not a secret key: the search goes on after it, inside its value if it has one.
    if (!isSecretKey(match[1])) continue
    const start = match.index + match[0].length
    const valueStart = afterScheme(text, start, form)
    const end = valueEnd(text, valueStart, form)
    if (
      end > valueStart &&
      redactsValue(match[1], unquoted(text.slice(valueStart, end)))
    ) {
      out += text.slice(copied, valueStart) + REDACTED_VALUE[form]
      copied = end
      pattern.lastIndex = end
    }
    // Otherwise the search goes on inside the value: `info={ "responseBody": … }`.
  }

  return out + text.slice(copied)
}

/** Past an authorization scheme (`Basic `) at `start`, outside JSON. */
function afterScheme(text: string, start: number, form: KeyValueForm): number {
  if (form === 'json' || form === 'escaped') return start
  SCHEME.lastIndex = start
  return SCHEME.test(text) ? SCHEME.lastIndex : start
}

/**
 * Where the value at `start` ends: a quoted string at its closing quote, an object or an
 * array at its closing bracket (strings inside skipped, at most `MAX_VALUE_LENGTH` on), and
 * anything else where the form's unquoted value ends. An unclosed string or bracket runs
 * to the end of the text.
 */
function valueEnd(text: string, start: number, form: KeyValueForm): number {
  const escaped = form === 'escaped'
  const first = text[start]

  if (text.startsWith('\\"', start)) return escapedStringEnd(text, start)
  if (!escaped && (first === '"' || first === "'"))
    return stringEnd(text, start, first)
  if (first === '{' || first === '[') return nestedEnd(text, start, escaped)

  const unquotedValue = UNQUOTED_VALUE[form]
  unquotedValue.lastIndex = start
  return unquotedValue.test(text) ? unquotedValue.lastIndex : start
}

/** The end of the string quoted by `quote` at `start`, backslash escapes skipped. */
function stringEnd(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++
    else if (text[index] === quote) return index + 1
  }
  return text.length
}

/**
 * The end of a string quoted by `\"` at `start`, in JSON inside a JSON string: decoded on
 * the fly, so `\\\"` (an escaped quote inside it) does not end it. A bare `"` ends the
 * outer string, and with it this one.
 */
function escapedStringEnd(text: string, start: number): number {
  let inEscape = false
  for (let index = start + 2; index < text.length; index++) {
    let char = text[index]
    if (char === '"') return index
    if (char === '\\') char = text[++index] ?? ''
    if (inEscape) inEscape = false
    else if (char === '\\') inEscape = true
    else if (char === '"') return index + 1
  }
  return text.length
}

/** The end of the object or array at `start`, strings inside it skipped. */
function nestedEnd(text: string, start: number, escaped: boolean): number {
  const limit = Math.min(text.length, start + MAX_VALUE_LENGTH)
  let depth = 0
  let index = start

  while (index < limit) {
    const char = text[index]
    if (escaped && text.startsWith('\\"', index)) {
      index = escapedStringEnd(text, index)
      continue
    }
    if (escaped && char === '"') return index
    if (!escaped && (char === '"' || char === "'")) {
      index = stringEnd(text, index, char)
      continue
    }
    if (char === '{' || char === '[') depth++
    else if ((char === '}' || char === ']') && --depth === 0) return index + 1
    index++
  }
  return index
}

/** A value without the quotes around it, for `redactsValue`. */
function unquoted(value: string): string {
  if (value.length >= 4 && value.startsWith('\\"') && value.endsWith('\\"'))
    return value.slice(2, -2)
  if (value.length >= 2 && /^(["']).*\1$/s.test(value))
    return value.slice(1, -1)
  return value
}

/** Whether `value` reads as an error code: see `log/keys.ts`. */
export { isErrorCode }

/** A URL as `scheme://host[:port]`, with the punctuation that ended its sentence kept. */
function originOnly(url: string): string {
  const trailing = /[.,;:!?)\]}]*$/.exec(url)?.[0] ?? ''
  const core = url.slice(0, url.length - trailing.length)
  const [, scheme, authority = ''] = /^([^:]+):\/\/([^/?#]*)/.exec(core) ?? []
  const host = authority.replace(/^.*@/, '')

  return `${scheme}://${host}${trailing}`
}

/**
 * `text` without ANSI escapes and invisible characters, whitespace runs (line breaks
 * included) as one space.
 */
export function stripControlCharacters(text: string): string {
  return text
    .replace(ANSI_ESCAPE, '')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Text from the node, or from an error carrying it, made safe for an error message or a
 * log line: credentials redacted (`redactSecrets`), control characters stripped, credentials
 * redacted again (a key split by a control character, `session\u0000Id=…`, or a value
 * split by a line break, is whole only once they are gone), and at most `maxLength`
 * characters (200 by default, an ellipsis marking the cut).
 *
 * When that changes the text, the raw text goes to the debug channel under `topic`
 * (`null`: not, because the caller hands it over itself).
 */
export function sanitize(
  text: string,
  maxLength = MAX_NODE_MESSAGE_LENGTH,
  topic: DebugTopic | null = 'node'
): string {
  const clean = bounded(
    redactSecrets(stripControlCharacters(redactSecrets(text))),
    maxLength
  )
  if (topic && debugEnabled('sensitive', topic) && clean !== text)
    debugRaw(topic, 'text before redaction', text)
  return clean
}

/**
 * The node's message in `text`: a JSON string unquoted, the `error` (or `message`) of a JSON
 * object, anything else as it is. Credentials are redacted and the result is bounded. When
 * that is not the whole text, the raw text goes to the debug channel under `topic`.
 */
export function nodeText(
  text: string,
  topic: DebugTopic | null = 'node'
): string {
  const trimmed = text.trim()
  let message = trimmed

  if (/^["{]/.test(trimmed))
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'string') message = parsed.trim()
      else if (parsed && typeof parsed === 'object') {
        const { error, message: text } = parsed as {
          error?: unknown
          message?: unknown
        }
        if (typeof error === 'string' && error.trim()) message = error.trim()
        else if (typeof text === 'string' && text.trim()) message = text.trim()
      }
    } catch {
      // not JSON: the text as it is
    }

  const clean = sanitize(message, MAX_NODE_MESSAGE_LENGTH, null)
  if (topic && clean !== trimmed && debugEnabled('sensitive', topic))
    debugRaw(topic, 'node text before redaction', text)
  return clean
}

/**
 * A value the node returned in place of the expected one, as bounded text. The raw value
 * goes to the debug channel under `topic` when the text is not all of it.
 */
export function boundedNodeMessage(
  value: unknown,
  topic: DebugTopic | null = 'node'
): string {
  if (typeof value === 'string') return nodeText(value, topic)

  const text = JSON.stringify(value) ?? String(value)
  const clean = sanitize(text, MAX_NODE_MESSAGE_LENGTH, null)
  if (topic && clean !== text && debugEnabled('sensitive', topic))
    debugRaw(topic, 'node value before redaction', value)
  return clean
}

function bounded(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * `HTTP 400 Bad Request: <the node's text>`. The whole answer (status and raw body) goes to
 * the debug channel under `topic`.
 */
export function describeAnswer(
  answer: NodeAnswer,
  topic: DebugTopic | null = 'node'
): string {
  const status = `HTTP ${answer.status}${answer.statusText ? ` ${answer.statusText}` : ''}`
  if (topic && debugEnabled('sensitive', topic))
    debugRaw(topic, `answer ${status}`, {
      status: answer.status,
      statusText: answer.statusText,
      body: answer.body
    })
  const text = nodeText(answer.body, null)

  return text ? `${status}: ${text}` : status
}

/**
 * The message of an error ocean.js threw, with a quoted or JSON node message unwrapped.
 *
 * ocean.js reads error answers with `response.json()`, so a plain-text answer fails with a
 * JSON parse error that has neither the status nor more than the first characters of the
 * text. That fragment is not the node's message: it stays on `cause`.
 *
 * The whole error (its message, its own properties and its causes) goes to the debug
 * channel under `topic`.
 */
export function describeError(
  error: unknown,
  topic: DebugTopic | null = 'node'
): string {
  const message = error instanceof Error ? error.message : String(error)
  if (topic && debugEnabled('sensitive', topic))
    debugRaw(topic, 'error before redaction', error)

  if (error instanceof SyntaxError && /JSON/.test(message))
    return "the node's error answer is not JSON, and ocean.js passes on neither its status nor its text (see cause)"

  return nodeText(message, null)
}

/**
 * A stand-in for an error that may carry the node's text, to keep on `cause`: its name and
 * its message sanitized as `nodeText` does, without its stack or its own `cause`. The raw
 * error goes to the debug channel under `topic` when its message changed.
 */
export function sanitizedError(
  error: unknown,
  topic: DebugTopic | null = 'node'
): Error {
  const message = error instanceof Error ? error.message : String(error)
  const copy = new Error(sanitize(message, MAX_NODE_MESSAGE_LENGTH, null))
  if (topic && copy.message !== message && debugEnabled('sensitive', topic))
    debugRaw(topic, 'error before redaction', error)
  if (error instanceof Error) copy.name = error.name

  return copy
}
