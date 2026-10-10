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
import { isErrorCode, SECRET_KEYS } from '../log/keys.js'
import { redactKeyValues } from '../log/keyValues.js'

/** A non-2xx answer of the node. A `FetchedText` is one. */
export interface NodeAnswer {
  status: number
  statusText: string
  /** The body as text. */
  body: string
}

/** How much of a node's text goes into an error message. */
const MAX_NODE_MESSAGE_LENGTH = 200

/**
 * `scheme://authority/path?query#fragment`, up to whitespace or a quote, also with its
 * slashes JSON-escaped (`https:\/\/host\/path`, as a body quoted in JSON has it). The
 * scheme is bounded, so hostile text of letters and dots is scanned in linear time.
 */
const URL_PATTERN =
  /[a-z][a-z0-9+.-]{0,31}:(?:\\*\/){2}(?:[^\s"'<>\\]|\\+\/)*/gi

/** A `Bearer` or `Basic` credential, wherever it stands. */
const BEARER = /((?:Bearer|Basic)\s+)[\w.~+/=-]+/gi
/** A JWT (`eyJ…` header, payload and signature, base64url). */
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g
/** A 65-byte ECDSA signature in hex, wherever it stands. */
const HEX_SIGNATURE = /\b0x[0-9a-f]{130}\b/gi
/**
 * A raw signed transaction (ethers quotes it in `transaction="0x02f8…"` of a failed
 * `eth_sendRawTransaction`): an RLP list, typed (`0x01`-`0x04`) or legacy, of 100 bytes or
 * more. Whoever holds one that was never mined can still send it. Ended by a lookahead, not
 * `\b`, so one followed by `_` or a letter is caught too. False positives: about 1 in 85
 * other hex blobs of 100 bytes or more (calldata, ECIES ciphertext) starts like an RLP list
 * and is redacted too; the raw value is in the debug channel, so nothing is lost.
 */
const SIGNED_TRANSACTION = /\b0x(?:0[1-4])?f[89a][0-9a-f]{196,}(?![0-9a-f])/gi

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
  return redactKeyValues(text.replace(URL_PATTERN, originOnly), SECRET_KEYS)
    .replace(BEARER, '$1<redacted>')
    .replace(JWT, '<redacted>')
    .replace(HEX_SIGNATURE, '<redacted>')
    .replace(SIGNED_TRANSACTION, '<redacted>')
}

/** Whether `value` reads as an error code: see `log/keys.ts`. */
export { isErrorCode }

/** A URL as `scheme://host[:port]`, with the punctuation that ended its sentence kept. */
function originOnly(url: string): string {
  const trailing = /[.,;:!?)\]}]*$/.exec(url)?.[0] ?? ''
  const core = url.slice(0, url.length - trailing.length).replace(/\\+\//g, '/')
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
  if (topic && debugEnabled('sensitive', topic) && clean !== trimmed)
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
  if (topic && debugEnabled('sensitive', topic) && clean !== text)
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
  if (topic && debugEnabled('sensitive', topic) && copy.message !== message)
    debugRaw(topic, 'error before redaction', error)
  if (error instanceof Error) copy.name = error.name

  return copy
}
