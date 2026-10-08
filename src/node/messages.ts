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

/** Query values and JSON fields that carry a credential. */
const SECRET_QUERY =
  /([?&](?:signature|token|authorization|jwt|access_token)=)[^&\s"'#]*/gi
const SECRET_FIELD =
  /("(?:signature|token|authorization|jwt|access_token)"\s*:\s*")(?:[^"\\]|\\.)*"/gi
const BEARER = /(Bearer\s+)[\w.~+/=-]+/gi

/** `text` with signatures, tokens and bearer credentials replaced by `<redacted>`. */
export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_QUERY, '$1<redacted>')
    .replace(SECRET_FIELD, '$1<redacted>"')
    .replace(BEARER, '$1<redacted>')
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

  return bounded(redactSecrets(message))
}

/** A value the node returned in place of the expected one, as bounded text. */
export function boundedNodeMessage(value: unknown): string {
  return typeof value === 'string'
    ? nodeText(value)
    : bounded(redactSecrets(JSON.stringify(value) ?? String(value)))
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
