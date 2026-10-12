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
import {
  INVISIBLE_CHARACTERS,
  SCHEMELESS_URL,
  trailingPunctuation
} from '../log/textShapes.js'

/** A non-2xx answer of the node. A `FetchedText` is one. */
export interface NodeAnswer {
  status: number
  statusText: string
  /** The body as text. */
  body: string
}

/** How much of a node's text goes into an error message. */
const MAX_NODE_MESSAGE_LENGTH = 200
/** How much of a text `sanitize` reads at least, however short the message: see `readLimit`. */
const MIN_READ_LENGTH = 8_192

/**
 * `scheme://authority/path?query#fragment`, up to whitespace or a quote, also with its
 * slashes JSON-escaped (`https:\/\/host\/path`, as a body quoted in JSON has it). A
 * backslash is part of the URL unless a quote follows it (`\"` ends a JSON string), so a
 * path such as `/x\y/v3/<key>` is not cut at the backslash with its key left in the text.
 * A BOM is part of it too, though `\s` matches it: `stripControlCharacters` deletes it, which
 * would join what follows it (`/v3/\ufeff<key>`) to the origin left of the URL. The
 * scheme is bounded, so hostile text of letters and dots is scanned in linear time.
 */
const URL_PATTERN =
  /[a-z][a-z0-9+.-]{0,31}:(?:\\*\/){2}(?:[^\s"'<>\\]|\ufeff|\\+(?!["'\s<>\\]))*/gi

/**
 * A JSON escape for `/` or a `\uXXXX` character, after any number of backslashes: JSON
 * nested in JSON strings doubles them at each level (`\/`, `\\/`, `\\\u0049`).
 */
const JSON_ESCAPE = /\\+(?:\/|u([0-9a-fA-F]{4}))/g
/**
 * What a `\uXXXX` escape may be decoded to: characters that are part of a key or a URL and
 * that end no value in any form. A quote, a backslash or a delimiter stays escaped, so it
 * cannot cut a value short.
 */
const DECODABLE = /^[A-Za-z0-9_\-.:/@~+]$/

/** A `Bearer` or `Basic` credential, wherever it stands. */
const BEARER = /((?:Bearer|Basic)\s+)[\w.~+/=-]+/gi
/** A JWT (`eyJ…` header, payload and signature, base64url). */
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g
/** A 65-byte ECDSA signature in hex, wherever it stands. */
const HEX_SIGNATURE = /\b0x[0-9a-f]{130}\b/gi
/**
 * A raw signed transaction (ethers quotes it in `transaction="0x02f8…"` of a failed
 * `eth_sendRawTransaction`): an RLP list, typed (`0x01`-`0x04`) or legacy, in long form
 * (`f8`-`fa` and the payload length: a signature alone is 65 bytes). Whoever holds one that
 * was never mined can still send it. Ended by a lookahead, not `\b`, so one followed by `_`
 * or a letter is caught too. `isSignedTransaction` decides which matches are redacted.
 */
const SIGNED_TRANSACTION = /\b0x(?:0[1-4])?f[89a][0-9a-f]*(?![0-9a-f])/gi
/**
 * From this many bytes, every match is redacted. False positives: about 1 in 85 other hex
 * blobs of that size (calldata, ECIES ciphertext) starts like an RLP list and is redacted
 * too; the raw value is in the debug channel, so nothing is lost.
 */
const SIGNED_TRANSACTION_BYTES = 100

/**
 * Whether `hex` (a `SIGNED_TRANSACTION` match) is redacted: 100 bytes or more, or a shorter
 * one-byte-length list (`f8`, 56 to 255 bytes of payload) whose length matches what follows
 * exactly, as a minimal legacy transfer's (97 bytes) or a contract creation's does.
 */
function isSignedTransaction(hex: string): boolean {
  const body = hex.slice(2)
  if (body.length >= 2 * SIGNED_TRANSACTION_BYTES) return true
  const list = /^(?:0[1-4])?f8([0-9a-f]{2})/i.exec(body)
  if (!list) return false
  const payload = Number.parseInt(list[1], 16)
  return payload >= 56 && body.length - list[0].length === 2 * payload
}

/** ANSI escape sequences: CSI (`ESC [ … m`), OSC (`ESC ] … BEL`) and two-byte ones. */
const ANSI_ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g

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
 * - `Bearer` and `Basic` credentials, JWTs, 65-byte hex signatures and raw signed
 *   transactions anywhere.
 *
 * A URL keeps its origin only: its path and query (an openid4vp `request_uri`, a policy
 * server's redirect URI, an internal path) are dropped, and so are its user and password.
 * So does a URL without a scheme on an IP address, `localhost` or an IPv6 address in
 * brackets (`127.0.0.1:8545/v3/<key>` reads `127.0.0.1:8545`): see `SCHEMELESS_URL`.
 */
export function redactSecrets(text: string): string {
  return redactKeyValues(
    decodeJsonEscapes(text)
      .replace(URL_PATTERN, originOnly)
      .replace(SCHEMELESS_URL, hostOnly),
    SECRET_KEYS
  )
    .replace(BEARER, '$1<redacted>')
    .replace(JWT, '<redacted>')
    .replace(HEX_SIGNATURE, '<redacted>')
    .replace(SIGNED_TRANSACTION, (hex) =>
      isSignedTransaction(hex) ? '<redacted>' : hex
    )
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

/** Whether `value` reads as an error code: see `log/keys.ts`. */
export { isErrorCode }

/**
 * A URL as `scheme://host[:port]`, with the punctuation that ended its sentence kept. An
 * authority that is no host and port reads `<redacted>`.
 */
function originOnly(url: string): string {
  const trailing = trailingPunctuation(url)
  const core = url.slice(0, url.length - trailing.length).replace(/\\+\//g, '/')
  // A backslash ends the authority, as a URL parser reads `https://host\path`.
  const [, scheme, authority = ''] = /^([^:]+):\/\/([^/?#\\]*)/.exec(core) ?? []
  const host = authority.replace(/^.*@/, '')
  // `host`, `host:port` or `[ipv6]:port`. Anything else is user info whose `@` the URL
  // never reached (a quote or a space in the password ended it, `https://user:se'cret@…`).
  const origin = /^(?:\[[^\]]*\]|[^:[\]]*)(?::\d*)?$/.test(host)
    ? host
    : '<redacted>'

  return `${scheme}://${origin}${trailing}`
}

/** A `SCHEMELESS_URL` as its host and port, with the punctuation that ended its sentence. */
function hostOnly(url: string, host: string): string {
  return `${host}${trailingPunctuation(url)}`
}

/**
 * `text` without ANSI escapes and invisible characters (`INVISIBLE_CHARACTERS`), whitespace
 * runs (line breaks included) as one space. Invisible characters are deleted, not turned
 * into a space, so none can split a key (`session\0Id=…`) or a value out of the
 * redaction's view.
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
 * Only the start of a long text is read (`readLimit`): a node can send any amount, and
 * the redaction costs time in proportion to what it reads.
 *
 * When that changes the text, the raw text goes to the debug channel under `topic`
 * (`null`: not, because the caller hands it over itself).
 */
export function sanitize(
  text: string,
  maxLength = MAX_NODE_MESSAGE_LENGTH,
  topic: DebugTopic | null = 'node'
): string {
  const limit = readLimit(maxLength)
  const read =
    text.length > limit
      ? beforeLastWord(beforeOpenUrl(text.slice(0, limit)))
      : text
  const redacted = redactSecrets(stripControlCharacters(redactSecrets(read)))
  const clean =
    read !== text && redacted.length <= maxLength
      ? `${redacted}…`
      : bounded(redacted, maxLength)
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

/**
 * How much of a text `sanitize` reads for a message of `maxLength` characters: enough that
 * the redaction (a URL shrinks to its origin, a JWT to `<redacted>`) still leaves
 * `maxLength` characters to show, and never so much that hostile text costs real time.
 */
function readLimit(maxLength: number): number {
  return Math.max(8 * maxLength, MIN_READ_LENGTH)
}

/**
 * `text` without the URL it ends in, for a text `sanitize` cut: `,`, `;`, a bracket or a
 * quote ends a word but may stand in a URL's user info (`https://user:secret,…@host`), so
 * dropping the last word alone could leave `https://user:secret` and the redaction read
 * the credential as the host. A URL that runs up to the cut, with a scheme or without
 * (`URL_PATTERN`, `SCHEMELESS_URL`), is dropped whole. Both are scanned in linear time.
 */
function beforeOpenUrl(text: string): string {
  let end = text.length
  for (const pattern of [URL_PATTERN, SCHEMELESS_URL])
    for (const match of text.matchAll(pattern))
      if (match.index + match[0].length === text.length)
        end = Math.min(end, match.index)
  return text.slice(0, end)
}

/** What ends a word for `beforeLastWord`: whitespace, quotes, brackets, `,` and `;`. */
const WORD_END = /[\s"'`,;{}[\]()<>]/

/**
 * `text` without its last word, for a text `sanitize` cut: the cut can split a credential
 * (a JWT, a signature, a URL, a value) so that its start no longer reads as one, so the word
 * it split is dropped, back to the last whitespace, quote or JSON punctuation. A loop from
 * the end, not a regular expression anchored at `$`: that one rescans the word from each of
 * its characters, which costs time in the square of its length.
 */
function beforeLastWord(text: string): string {
  let end = text.length
  while (end > 0 && !WORD_END.test(text[end - 1])) end--
  return text.slice(0, end)
}

function bounded(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * `text` as the end of a sentence, for a message that goes on after it: a period appended
 * unless it ends in `.`, `!`, `?` or `…` already (a node's reason often has its own, and a
 * bounded one ends in `…`), so no message reads `..`.
 */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd()
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
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
