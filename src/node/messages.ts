/**
 * How the node's error text becomes part of an error message. Kept out of the package's
 * exports.
 *
 * ocean-node answers errors in plain text (`Use the initializeCompute endpoint…`), as a JSON
 * string (`"Error: Access to asset … was denied"`) or as a JSON object (`{ "error": … }`).
 * `nodeText` turns each into the message itself.
 */

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

/**
 * A JSON escape for `/` or a `\uXXXX` character, after any number of backslashes: JSON
 * nested in JSON strings doubles them at each level (`\/`, `\\/`, `\\\u0049`). Read
 * from the start of a backslash run only, so a long run is scanned in linear time.
 */
const JSON_ESCAPE = /(?<!\\)\\+(?:\/|u([0-9a-fA-F]{4}))/g
/**
 * What a `\uXXXX` escape may be decoded to: characters that are part of a key or a URL and
 * that end no value in any form. A quote, a backslash or a delimiter stays escaped, so it
 * cannot cut a value short.
 */
const DECODABLE = /^[A-Za-z0-9_\-.:/@~+]$/

/** The forms free text gives a credential in, by the key before it. */
type KeyValueForm = 'escaped' | 'json' | 'assignment' | 'bare'

/**
 * A key and its separator, in each form: `\"key\": value` in JSON inside a JSON string
 * (ethers quotes a response body so; `\\\"key\\\": value` a level deeper, and so on, the
 * run of backslashes in group 1, read whole so a long run is scanned in linear time),
 * `"key": value` in JSON, `key=value` in a query, a form body or prose (ethers'
 * `code=…, info={ … }`), and `key: value` or `'key': value` (headers, prose,
 * `util.inspect`). A quoted key is any quoted text; an unquoted one a word of letters,
 * digits, `-` and `_`, read from its last 64 characters when it is longer. Which keys are
 * secret is `redactsValue`'s call (`log/keys.ts`), as for log fields.
 */
const KEY_VALUE_FORMS: [KeyValueForm, RegExp][] = [
  ['escaped', /(?<!\\)(\\+)"([^"\\]{1,256})\1"\s*:\s*/g],
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
/** What a redacted value becomes, by form, given the run of backslashes before a quote. */
const REDACTED_VALUE: Record<KeyValueForm, (quoting: string) => string> = {
  escaped: (quoting) => `${quoting}"<redacted>${quoting}"`,
  json: () => '"<redacted>"',
  assignment: () => '<redacted>',
  bare: () => '<redacted>'
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
 *   `key=value`, as a JSON field (also inside a JSON string, `\"key\":\"value\"`, at any
 *   depth, JSON escapes in keys and URLs decoded first: `decodeJsonEscapes`), or as
 *   `key: value` or `'key': 'value'`; a quoted, bracketed or `Bearer`/`Basic` value is
 *   redacted whole. As for fields, a `…token` holding an EVM address is kept, and so is a
 *   `…code` that reads as an error code (`code=SERVER_ERROR`, `"code": -32005`), so RPC
 *   failures stay legible;
 * - `Bearer` and `Basic` credentials, JWTs and 65-byte hex signatures anywhere.
 *
 * A URL keeps its origin only: its path and query (an openid4vp `request_uri`, a policy
 * server's redirect URI, an internal path) are dropped, and so are its user and password.
 */
export function redactSecrets(text: string): string {
  return redactKeyValues(
    decodeJsonEscapes(text).replace(URL_PATTERN, originOnly)
  )
    .replace(BEARER, '$1<redacted>')
    .replace(JWT, '<redacted>')
    .replace(HEX_SIGNATURE, '<redacted>')
}

/**
 * `text` with the JSON escapes a key or a URL may hide behind decoded, at any level of
 * nesting: `session\u0049d` is `sessionId`, `https:\/\/host\/path` a URL, as a JSON parser
 * reads them. An invisible character is dropped, as `stripControlCharacters` does. Only
 * characters that end no value are decoded (`DECODABLE`), so the structure stays as it was.
 */
function decodeJsonEscapes(text: string): string {
  return text.replace(JSON_ESCAPE, (sequence, hex: string | undefined) => {
    if (hex === undefined) return '/'
    const char = String.fromCharCode(Number.parseInt(hex, 16))
    INVISIBLE_CHARACTERS.lastIndex = 0
    if (INVISIBLE_CHARACTERS.test(char)) return ''
    return DECODABLE.test(char) ? char : sequence
  })
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
    const key = match[match.length - 1]
    const quoting = form === 'escaped' ? match[1] : ''
    // Not a secret key: the search goes on after it, inside its value if it has one.
    if (!isSecretKey(key)) continue
    const start = match.index + match[0].length
    const valueStart = afterScheme(text, start, form)
    const end = valueEnd(text, valueStart, form, quoting)
    if (
      end > valueStart &&
      redactsValue(key, unquoted(text.slice(valueStart, end)))
    ) {
      out += text.slice(copied, valueStart) + REDACTED_VALUE[form](quoting)
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
 * to the end of the text. `quoting` is the run of backslashes that quotes the key, in JSON
 * nested in JSON strings.
 */
function valueEnd(
  text: string,
  start: number,
  form: KeyValueForm,
  quoting: string
): number {
  const level = quoting.length
  const first = text[start]

  if (level > 0 && text.startsWith(`${quoting}"`, start))
    return escapedStringEnd(text, start, level)
  if (text.startsWith('\\"', start)) return escapedStringEnd(text, start, 1)
  if (level === 0 && (first === '"' || first === "'"))
    return stringEnd(text, start, first)
  if (first === '{' || first === '[') return nestedEnd(text, start, level)

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

/** How many backslashes stand right before `index`, not counting any before `from`. */
function backslashesBefore(text: string, index: number, from: number): number {
  let count = 0
  while (index - count - 1 >= from && text[index - count - 1] === '\\') count++
  return count
}

/**
 * The end of a string quoted by `level` backslashes and a quote at `start` (`\"…\"` in JSON
 * inside a JSON string, `\\\"…\\\"` a level deeper), in JSON nested in JSON strings. Inside
 * it, a quote of its own is escaped once more (`2 * level + 1` backslashes) and a backslash
 * of its own takes `2 * (level + 1)`, so a quote ends it when the run before it leaves
 * `level` over, and is its own when it leaves `2 * level + 1`. Any other quote ends an
 * outer string, and with it this one.
 */
function escapedStringEnd(text: string, start: number, level: number): number {
  const contentStart = start + level + 1
  const backslash = 2 * (level + 1)

  for (
    let index = text.indexOf('"', contentStart);
    index >= 0;
    index = text.indexOf('"', index + 1)
  ) {
    const run = backslashesBefore(text, index, contentStart)
    const rest = run % backslash
    if (rest === level) return index + 1
    if (rest !== 2 * level + 1) return index - run
  }
  return text.length
}

/**
 * The end of the object or array at `start`, strings inside it skipped. At `level` (the
 * backslashes that quote a string in JSON nested in JSON strings, 0 outside), a quote with
 * fewer backslashes before it ends the outer string, and with it the value.
 */
function nestedEnd(text: string, start: number, level: number): number {
  const limit = Math.min(text.length, start + MAX_VALUE_LENGTH)
  let depth = 0
  let index = start

  while (index < limit) {
    const char = text[index]
    if (level > 0 && (char === '\\' || char === '"')) {
      let run = 0
      while (text[index + run] === '\\') run++
      if (text[index + run] !== '"') {
        index += Math.max(run, 1)
        continue
      }
      if (run === level) {
        index = escapedStringEnd(text, index, level)
        continue
      }
      // An escaped quote of a deeper string, or else the end of an outer one.
      if (run % (2 * (level + 1)) !== 2 * level + 1) return index
      index += run + 1
      continue
    }
    if (level === 0 && (char === '"' || char === "'")) {
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
  const escaped = /^(\\+)"(.*)\1"$/s.exec(value)
  if (escaped) return escaped[2]
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
 */
export function sanitize(
  text: string,
  maxLength = MAX_NODE_MESSAGE_LENGTH
): string {
  return bounded(
    redactSecrets(stripControlCharacters(redactSecrets(text))),
    maxLength
  )
}

/**
 * The node's message in `text`: a JSON string unquoted, the `error` (or `message`) of a JSON
 * object, anything else as it is. Credentials are redacted and the result is bounded.
 */
export function nodeText(text: string): string {
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

  return sanitize(message)
}

/** A value the node returned in place of the expected one, as bounded text. */
export function boundedNodeMessage(value: unknown): string {
  return typeof value === 'string'
    ? nodeText(value)
    : sanitize(JSON.stringify(value) ?? String(value))
}

function bounded(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** `HTTP 400 Bad Request: <the node's text>`. */
export function describeAnswer(answer: NodeAnswer): string {
  const status = `HTTP ${answer.status}${answer.statusText ? ` ${answer.statusText}` : ''}`
  const text = nodeText(answer.body)

  return text ? `${status}: ${text}` : status
}

/**
 * The message of an error ocean.js threw, with a quoted or JSON node message unwrapped.
 *
 * ocean.js reads error answers with `response.json()`, so a plain-text answer fails with a
 * JSON parse error that has neither the status nor more than the first characters of the
 * text. That fragment is not the node's message: it stays on `cause`.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (error instanceof SyntaxError && /JSON/.test(message))
    return "the node's error answer is not JSON, and ocean.js passes on neither its status nor its text (see cause)"

  return nodeText(message)
}

/**
 * A stand-in for an error that may carry the node's text, to keep on `cause`: its name and
 * its message sanitized as `nodeText` does, without its stack or its own `cause`.
 */
export function sanitizedError(error: unknown): Error {
  const copy = new Error(
    sanitize(error instanceof Error ? error.message : String(error))
  )
  if (error instanceof Error) copy.name = error.name

  return copy
}
