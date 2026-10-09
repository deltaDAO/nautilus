/**
 * How the node's error text becomes part of an error message. Kept out of the package's
 * exports.
 *
 * ocean-node answers errors in plain text (`Use the initializeCompute endpoint…`), as a JSON
 * string (`"Error: Access to asset … was denied"`) or as a JSON object (`{ "error": … }`).
 * `nodeText` turns each into the message itself.
 */

/** A non-2xx answer of the node. A `FetchedText` is one. */
export interface NodeAnswer {
  status: number
  statusText: string
  /** The body as text. */
  body: string
}

/** How much of a node's text goes into an error message. */
const MAX_NODE_MESSAGE_LENGTH = 200

/** Keys whose value is a credential, a session secret or a one-time value. */
const SECRET_KEYS =
  'signature|consumerSignature|token|authorization|jwt|access_token|vp_token|id_token|request_uri|code|nonce|password|apiKey|api_key'

/** `scheme://authority/path?query#fragment`, up to whitespace or a quote. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]*/gi
/** `key=value` in a query, a form body or prose: `?signature=…`, `nonce=…`. */
const SECRET_ASSIGNMENT = new RegExp(`\\b(${SECRET_KEYS})=[^&\\s"'#,;)]*`, 'gi')
/** `"key": "value"` or `"key": 123` in JSON. */
const SECRET_FIELD = new RegExp(
  `("(?:${SECRET_KEYS})"\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|[^\\s,}\\]]+)`,
  'gi'
)
/** The same in JSON that is itself inside a JSON string: `\"key\":\"value\"`. */
const ESCAPED_SECRET_FIELD = new RegExp(
  `(\\\\"(?:${SECRET_KEYS})\\\\"\\s*:\\s*)(?:\\\\"(?:[^"\\\\]|\\\\[^"])*\\\\"|[^\\s,}\\]\\\\]+)`,
  'gi'
)
/** `signature: 0x…` without quotes. */
const BARE_SIGNATURE = /\b((?:consumer)?signature\s*:\s*)0x[0-9a-f]+/gi
/** `password: …`, `apiKey: …`, `access_token: …` without quotes. */
const BARE_SECRET =
  /\b((?:password|apiKey|api_key|jwt|access_token|vp_token|id_token)\s*:\s*)[^\s,;"'&)}\]]+/gi
const BEARER = /(Bearer\s+)[\w.~+/=-]+/gi
/** A JWT (`eyJ…` header, payload and signature, base64url). */
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g
/** A 65-byte ECDSA signature in hex, wherever it stands. */
const HEX_SIGNATURE = /\b0x[0-9a-f]{130}\b/gi

/** ANSI escape sequences: CSI (`ESC [ … m`), OSC (`ESC ] … BEL`) and two-byte ones. */
const ANSI_ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
/** C0 and C1 controls (CR and LF included), DEL and the bidi overrides and isolates. */
const CONTROL_CHARACTERS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]+/g

/**
 * `text` with credentials replaced by `<redacted>`: signatures, tokens, nonces, codes and
 * passwords given as `key=value`, as JSON fields or (signatures, passwords, API keys,
 * tokens) as `key: value`; bearer credentials, JWTs and 65-byte hex signatures anywhere.
 * A URL keeps its origin only: its path and query (an openid4vp `request_uri`, a policy
 * server's redirect URI, an internal path) are dropped, and so are its user and password.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(URL_PATTERN, originOnly)
    .replace(SECRET_FIELD, '$1"<redacted>"')
    .replace(ESCAPED_SECRET_FIELD, '$1\\"<redacted>\\"')
    .replace(SECRET_ASSIGNMENT, '$1=<redacted>')
    .replace(BARE_SIGNATURE, '$1<redacted>')
    .replace(BARE_SECRET, '$1<redacted>')
    .replace(BEARER, '$1<redacted>')
    .replace(JWT, '<redacted>')
    .replace(HEX_SIGNATURE, '<redacted>')
}

/** A URL as `scheme://host[:port]`, with the punctuation that ended its sentence kept. */
function originOnly(url: string): string {
  const trailing = /[.,;:!?)\]}]*$/.exec(url)?.[0] ?? ''
  const core = url.slice(0, url.length - trailing.length)
  const [, scheme, authority = ''] = /^([^:]+):\/\/([^/?#]*)/.exec(core) ?? []
  const host = authority.replace(/^.*@/, '')

  return `${scheme}://${host}${trailing}`
}

/** `text` without ANSI escapes and control characters, whitespace runs as one space. */
export function stripControlCharacters(text: string): string {
  return text
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Text from the node, or from an error carrying it, made safe for an error message. */
function sanitize(text: string): string {
  return bounded(redactSecrets(stripControlCharacters(text)))
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

function bounded(text: string): string {
  return text.length > MAX_NODE_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_NODE_MESSAGE_LENGTH)}…`
    : text
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
