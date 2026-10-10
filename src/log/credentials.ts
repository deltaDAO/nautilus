/**
 * What the `sensitive` debug tier still hides: long-lived credentials. Kept out of the
 * package's exports.
 *
 * The `sensitive` tier shows the raw data nautilus redacts elsewhere (session ids,
 * signatures, nonces, presented VP/VC JWTs, node and wallet bodies, redirect URIs), but not
 * the credentials that stay valid after the run: those need `secrets`. Replaced by
 * `<redacted>`:
 *
 * - in a URL: the user info, the value of a query (or fragment) parameter named like a
 *   credential (`apikey`, `key`, `token`, `access_token`, `secret`, `password`, `sig`,
 *   `X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, …) and a path segment
 *   that looks like an API key (20 or more letters, digits, `-` and `_`, with both letters
 *   and digits; a UUID, a `0x` hex value or an IPFS CID is kept): the token of an RPC URL
 *   such as `https://…/v3/<key>`;
 * - `Bearer`, `Basic` and `Token` credentials, and `Authorization` and `Cookie` headers;
 * - a credential given as `key=value`, `key: value` or a JSON field: S3 secret keys, OAuth
 *   client secrets and access and refresh tokens, passwords, API keys, JWT fields (a
 *   Pinata JWT), node auth tokens;
 * - in an object, the value of a key named like one of those;
 * - any string the caller names as a credential (a store's configured header values).
 *
 * The signer's private key and mnemonic are never shown at any tier (nautilus never holds
 * them; a key named so is still replaced, also at `secrets`).
 */

export const REDACTED = '<redacted>'

/** Normalised (lower case, no `-`, `_`, whitespace) keys whose value is never shown. */
const NEVER_KEYS = /(?:privatekey|mnemonic|seedphrase)$/

/** Normalised keys whose value is a long-lived credential: shown at `secrets` only. */
const CREDENTIAL_KEY =
  /^token$|(?:secret|secretkey|secretaccesskey|password|passwd|passphrase|apikey|authorization|cookie|refreshtoken|accesstoken|authtoken|bearertoken|jwt|securitytoken|sessiontoken|privatekey|mnemonic|seedphrase|xamzsignature|xamzcredential|xgoogsignature|xgoogcredential)$/

/** Normalised query parameter names that carry a credential, besides `CREDENTIAL_KEY`. */
const CREDENTIAL_PARAMETER = /^(?:auth|key|sig|apitoken|accesskey)$/

/** The same names as they are written in free text (`key=value`, `"key": value`). */
const CREDENTIAL_NAMES =
  'secretAccessKey|secret_access_key|aws_secret_access_key|secretKey|secret_key|client_secret|clientSecret|password|passwd|apiKey|api_key|api-key|x-api-key|privateKey|private_key|mnemonic|refresh_token|refreshToken|access_token|accessToken|authorization|proxy-authorization|cookie|set-cookie|jwt|pinata_api_key|pinata_secret_api_key|x-amz-security-token|sessionToken|session_token|token'

/** `"key": "value"`, `key=value`, `key: value`, also inside escaped JSON (`\"key\":\"v\"`). */
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `((?:\\\\?["'])?\\b(?:${CREDENTIAL_NAMES})(?:\\\\?["'])?\\s*[:=]\\s*)(\\\\"(?:[^"\\\\]|\\\\[^"])*\\\\"|"(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,;&)}\\]"'\\\\]+)`,
  'gi'
)

const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[^\s"',;\\]+/gi

/**
 * `scheme://authority/path?query#fragment`, up to whitespace, a quote or a backslash. The
 * scheme is bounded, so a hostile body of letters and dots is scanned in linear time.
 */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>\\]*/gi

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/
const TOKEN_LIKE = /^[A-Za-z0-9_-]{20,}$/

/** `key` lower-cased, without `-`, `_` and whitespace. */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '')
}

/** Whether the value of `key` is never shown, at any tier. */
export function isNeverShownKey(key: string): boolean {
  return NEVER_KEYS.test(normalize(key))
}

/** Whether the value of `key` is a long-lived credential (or never shown). */
export function isCredentialKey(key: string): boolean {
  const normalized = normalize(key)
  return CREDENTIAL_KEY.test(normalized) || NEVER_KEYS.test(normalized)
}

/**
 * `value` (plain data: strings, numbers, arrays, plain objects) with long-lived credentials
 * replaced, for the `sensitive` tier. `credentials` are strings to replace wherever they
 * appear.
 */
export function maskCredentials(
  value: unknown,
  credentials: readonly string[] = []
): unknown {
  const known = credentials.filter(
    (credential) => typeof credential === 'string' && credential.length >= 4
  )
  return mask(value, known, isCredentialKey, true)
}

/** `value` with only the never-shown keys replaced, for the `secrets` tier. */
export function maskNeverShown(value: unknown): unknown {
  return mask(value, [], isNeverShownKey, false)
}

function mask(
  value: unknown,
  credentials: readonly string[],
  hidden: (key: string) => boolean,
  text: boolean
): unknown {
  if (typeof value === 'string')
    return text ? maskText(value, credentials) : value
  if (Array.isArray(value))
    return value.map((entry) => mask(entry, credentials, hidden, text))
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value))
    out[key] =
      hidden(key) && entry !== undefined && entry !== null && entry !== ''
        ? REDACTED
        : mask(entry, credentials, hidden, text)
  return out
}

/** `text` with long-lived credentials replaced (see the module comment). */
export function maskText(
  text: string,
  credentials: readonly string[] = []
): string {
  let masked = text
  for (const credential of credentials)
    masked = masked.split(credential).join(REDACTED)

  return masked
    .replace(URL_PATTERN, maskUrl)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(CREDENTIAL_ASSIGNMENT, (_match, key: string, value: string) => {
      const quote = /^\\"/.test(value)
        ? '\\"'
        : /^["']/.test(value)
          ? value[0]
          : ''
      return `${key}${quote}${REDACTED}${quote}`
    })
}

/** A URL with its credentials replaced and everything else kept (see the module comment). */
export function maskUrl(url: string): string {
  // Punctuation that ended the sentence is not part of the URL.
  const trailing = /[.,;:!?)\]}]*$/.exec(url)?.[0] ?? ''
  const core = url.slice(0, url.length - trailing.length)

  const match =
    /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(core)
  if (!match)
    return `${core.replace(/\/\/[^/]*@/, `//${REDACTED}@`)}${trailing}`

  const [, scheme, authority, path, query = '', fragment = ''] = match
  const at = authority.lastIndexOf('@')
  const host = at === -1 ? authority : `${REDACTED}@${authority.slice(at + 1)}`

  const maskedPath = path
    .split('/')
    .map((segment) => (isTokenLike(segment) ? REDACTED : segment))
    .join('/')

  return `${scheme}${host}${maskedPath}${maskParameters(query)}${maskParameters(fragment)}${trailing}`
}

/** `?a=1&key=…` or `#…` with the values of credential-named parameters replaced. */
function maskParameters(part: string): string {
  if (!part) return part
  const [lead, rest] = [part[0], part.slice(1)]

  return `${lead}${rest
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      if (separator === -1) return isTokenLike(pair) ? REDACTED : pair
      const name = decodeName(pair.slice(0, separator))
      return isCredentialKey(name) || CREDENTIAL_PARAMETER.test(normalize(name))
        ? `${pair.slice(0, separator)}=${REDACTED}`
        : pair
    })
    .join('&')}`
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * A path segment that reads as an API key: 20+ of `[A-Za-z0-9_-]`, with letters and
 * digits, and not a UUID, a `0x` hex value or an IPFS CID.
 */
function isTokenLike(segment: string): boolean {
  return (
    TOKEN_LIKE.test(segment) &&
    /\d/.test(segment) &&
    /[a-z]/i.test(segment) &&
    !UUID.test(segment) &&
    !/^0x[0-9a-f]+$/i.test(segment) &&
    !IPFS_CID.test(segment)
  )
}
