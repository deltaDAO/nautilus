/**
 * What the `sensitive` debug tier still hides: long-lived credentials. Best effort, by name
 * and shape: a credential under a name nothing here knows, or without any name, prints.
 * Kept out of the package's exports.
 *
 * The `sensitive` tier shows the raw data nautilus redacts elsewhere (session ids,
 * signatures, nonces, presented VP/VC JWTs, node and wallet bodies, redirect URIs), but not
 * the credentials that stay valid after the run: those need `secrets`. Which names are
 * credentials is `isLongLivedCredential` (`keys.ts`, next to the rule of the log
 * redaction): any key or parameter ending in `token`, `key`, `secret`, `password`, `auth`,
 * `cookie`, `jwt`, `credential(s)`, …, and `dkey`, except session-scoped and public names
 * (`vp_token`, `state`, `sessionId`, `nonce`, `signature`, `id`, `publicKey`, …).
 * Replaced by `<redacted>`:
 *
 * - in a URL: the user info, the value of a query (or fragment) parameter named like a
 *   credential (also `key`, `sig` and a `Signature` that is not `0x` hex: a Google API key,
 *   an Azure SAS or CloudFront signature), a query value holding a URL (plain or
 *   percent-encoded) masked as a URL in turn, and a path segment that looks like an API key
 *   (20 or more letters, digits, `-` and `_`, with both letters and digits; a UUID, a `0x`
 *   hex value or an IPFS CID is kept): the token of an RPC URL such as `https://…/v3/<key>`.
 *   That heuristic also masks other long ids in a path (a 64-hex compute job id without
 *   `0x`, an Arweave id, an S3 object key segment). A URL without a scheme on an IP
 *   address, `localhost` or an IPv6 address in brackets (`127.0.0.1:8545/v3/<key>`) is
 *   masked the same way;
 * - `Bearer`, `Basic` and `Token` credentials, and provider tokens known by their prefix
 *   (`ghp_…`, `glpat-…`, `xoxb-…`, `sk-…`, `AIza…`) wherever they stand;
 * - in free text, the value of a credential named before it, as `key=value`, `key: value`,
 *   a JSON field or a JSON field inside a JSON string (the scanner of the log redaction,
 *   `keyValues.ts`); an `Authorization` or `Cookie` header to the end of its line. The
 *   masked text is also read with its escapes undone (`https:\/\/…`,
 *   `\\\"apiToken\\\"`, `\u0022`, `\'`, `apiToken%3D…`, `https%3A%2F%2F…`;
 *   `withEscapesUndone`, `textShapes.ts`), and when that finds more, that text, masked, is
 *   what is shown. So is it without its invisible characters (a BOM, a zero-width space, a
 *   NUL), which a reader does not see but which split a URL or a token out of the
 *   patterns' view;
 * - in an object, the value of a key named like a credential;
 * - any string the caller names as a credential (a store's configured header values and
 *   secret keys), also percent-encoded and in base64.
 *
 * The signer's private key and mnemonic are never shown at any tier (nautilus never holds
 * them; a key named so is still replaced, in objects and in text, also at `secrets`).
 */
import {
  isLongLivedCredential,
  isNeverShownKey,
  LONG_LIVED_CREDENTIALS,
  NEVER_SHOWN_KEYS
} from './keys.js'
import { redactKeyValues } from './keyValues.js'
import {
  INVISIBLE_CHARACTERS,
  SCHEMELESS_URL,
  trailingPunctuation,
  withEscapesUndone
} from './textShapes.js'

export const REDACTED = '<redacted>'

const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[^\s"',;\\]+/gi

/**
 * Provider tokens recognisable by their prefix, with or without a name before them: GitHub
 * (`ghp_…`, `github_pat_…`), GitLab (`glpat-…`), Slack (`xoxb-…`), OpenAI-style `sk-…`
 * and Google API keys (`AIza…`).
 */
const PREFIXED_TOKEN =
  /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abprs]-[\w-]{10,}|sk-[\w-]{20,}|AIza[\w-]{35})/g

/**
 * `scheme://authority/path?query#fragment`, up to whitespace or a quote, also with its
 * slashes JSON-escaped at any depth (`https:\/\/host\/path`), as `messages.ts` reads it. A
 * backslash is part of the URL unless a quote follows it (`\"` ends a JSON string), so a
 * path such as `/x\y/v3/<key>` is masked as a whole. The scheme is bounded, so a hostile
 * body of letters and dots is scanned in linear time.
 */
const URL_PATTERN =
  /[a-z][a-z0-9+.-]{0,31}:(?:\\*\/){2}(?:[^\s"'<>\\]|\\+(?!["'\s<>\\]))*/gi

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IPFS_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/
const TOKEN_LIKE = /^[A-Za-z0-9_-]{20,}$/

/** How many levels of URLs nested in query values are masked. */
const MAX_URL_NESTING = 3

export { isNeverShownKey }

/**
 * A string the debug channel read only in part (`debug.ts`): `text` is its start, up to
 * the last space or punctuation before the cut, so a credential the cut went through is
 * left out whole rather than shown in part; `total` is the whole string's length. Masked
 * like any string; the cut is marked only after masking, so the marker can neither be
 * masked away nor stick to a value and change its shape.
 */
export class CutText {
  constructor(
    readonly text: string,
    readonly total: number
  ) {}
}

/** Whether the value of `key` is a long-lived credential (or never shown), at any value. */
export function isCredentialKey(key: string): boolean {
  return isLongLivedCredential(key, '')
}

/**
 * `value` (plain data: strings, numbers, arrays, plain objects) with long-lived credentials
 * replaced, for the `sensitive` tier. `credentials` are strings to replace wherever they
 * appear, also percent-encoded and in base64.
 */
export function maskCredentials(
  value: unknown,
  credentials: readonly string[] = []
): unknown {
  return mask(value, knownForms(credentials), (key, entry) =>
    isLongLivedCredential(key, entry)
  )
}

/** `value` with only the never-shown keys replaced, in objects and text, for `secrets`. */
export function maskNeverShown(value: unknown): unknown {
  return mask(value, undefined, isNeverShownKey)
}

/**
 * `known` undefined: the `secrets` tier, where strings are scanned for never-shown keys
 * only.
 */
function mask(
  value: unknown,
  known: readonly string[] | undefined,
  hidden: (key: string, value: unknown) => boolean
): unknown {
  if (typeof value === 'string')
    return known ? maskText(value, known) : maskNeverShownText(value)
  if (value instanceof CutText)
    return new CutText(mask(value.text, known, hidden) as string, value.total)
  if (Array.isArray(value))
    return value.map((entry) => mask(entry, known, hidden))
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const read = entry instanceof CutText ? entry.text : entry
    const masked =
      hidden(key, read) && read !== undefined && read !== null && read !== ''
        ? REDACTED
        : mask(entry, known, hidden)
    // A `__proto__` own key (from `JSON.parse`) is kept as a key, not as the prototype.
    Object.defineProperty(out, key, {
      value: masked,
      enumerable: true,
      writable: true,
      configurable: true
    })
  }
  return out
}

/** `text` with the values of never-shown keys replaced (`privateKey=0x…`, `mnemonic: …`). */
function maskNeverShownText(text: string): string {
  return withEscapesUndone(text, (part) =>
    redactKeyValues(part, NEVER_SHOWN_KEYS)
  )
}

/**
 * `text` with long-lived credentials replaced (see the module comment). `credentials` are
 * replaced as they are given (callers pass them through `knownForms`, or plain).
 */
export function maskText(
  text: string,
  credentials: readonly string[] = []
): string {
  const known = credentials.filter(
    (credential) => typeof credential === 'string' && credential.length >= 4
  )
  const masked = maskEscaped(text, known)
  const visible = text.replace(INVISIBLE_CHARACTERS, '')
  if (visible === text) return masked

  // Invisible characters split a URL (`https:/\u200b/…`) or a token (`/v3/ab\ufeffcd`)
  // that a reader sees whole: the text is masked without them too, and shown so when that
  // hides more.
  const deep = maskEscaped(visible, known)
  return masked.replace(INVISIBLE_CHARACTERS, '') === deep ? masked : deep
}

/**
 * `maskText` of the text as it is, and with its escapes undone: they hide a URL
 * (`https:\/\/…`, `https%3A%2F%2F…`) or a key (`\\\"apiToken\\\"`) from the patterns.
 */
function maskEscaped(text: string, known: readonly string[]): string {
  return withEscapesUndone(text, (part) => maskOnce(part, known))
}

function maskOnce(text: string, known: readonly string[]): string {
  let masked = text
  for (const credential of known)
    masked = masked.split(credential).join(REDACTED)

  return redactKeyValues(
    masked
      .replace(URL_PATTERN, (url) => maskUrl(url))
      .replace(SCHEMELESS_URL, (url) => maskUrl(`x://${url}`).slice(4))
      .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
      .replace(PREFIXED_TOKEN, REDACTED),
    LONG_LIVED_CREDENTIALS
  )
}

/**
 * Each known credential as given, percent-encoded, and in base64 and base64url, so an
 * encoded copy is replaced too. Shorter than 4 characters: left out.
 */
export function knownForms(credentials: readonly string[]): string[] {
  const forms = new Set<string>()
  for (const credential of credentials) {
    if (typeof credential !== 'string' || credential.length < 4) continue
    forms.add(credential)
    forms.add(encodeURIComponent(credential))
    const base64 = toBase64(credential)
    if (base64) {
      forms.add(base64)
      forms.add(base64.replace(/=+$/, ''))
      forms.add(
        base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      )
    }
  }
  // Longest first, so a form inside another is not replaced first and splits it.
  return [...forms]
    .filter((form) => form.length >= 4)
    .sort((a, b) => b.length - a.length)
}

function toBase64(text: string): string | undefined {
  try {
    const bytes = new TextEncoder().encode(text)
    return btoa(String.fromCharCode(...bytes))
  } catch {
    return undefined
  }
}

/**
 * The credentials in a configured URL: its user info and the values `maskUrl` would
 * replace (credential-named query parameters, API-key path segments). For stores, which
 * pass them to the debug channel as known credentials.
 */
export function credentialsInUrl(url: string | undefined): string[] {
  if (!url) return []
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  const found: string[] = []
  if (parsed.username) found.push(decodePart(parsed.username))
  if (parsed.password) found.push(decodePart(parsed.password))
  for (const segment of parsed.pathname.split('/'))
    if (isTokenLike(segment)) found.push(segment)
  parsed.searchParams.forEach((value, name) => {
    if (value && isLongLivedCredential(name, value, 'query')) found.push(value)
  })
  return found
}

/** A URL with its credentials replaced and everything else kept (see the module comment). */
export function maskUrl(url: string, nesting = 0): string {
  // Punctuation that ended the sentence is not part of the URL. JSON-escaped slashes
  // (`https:\/\/host\/v3\/<key>`) are read as slashes, as `originOnly` (`messages.ts`)
  // reads them.
  const trailing = trailingPunctuation(url)
  const core = url.slice(0, url.length - trailing.length).replace(/\\+\//g, '/')

  // A backslash ends the authority and splits the path, as a URL parser reads it.
  const match =
    /^([a-z][a-z0-9+.-]*:\/\/)([^/?#\\]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(core)
  if (!match)
    return `${core.replace(/\/\/[^/]*@/, `//${REDACTED}@`)}${trailing}`

  const [, scheme, authority, path, query = '', fragment = ''] = match
  const at = authority.lastIndexOf('@')
  // Without an `@`, anything but `host`, `host:port` or `[ipv6]:port` is user info whose
  // `@` the URL never reached (a quote or a space in the password ended it).
  const host =
    at !== -1
      ? `${REDACTED}@${authority.slice(at + 1)}`
      : /^(?:\[[^\]]*\]|[^:[\]]*)(?::\d*)?$/.test(authority)
        ? authority
        : REDACTED

  const maskedPath = path
    .split(/([/\\])/)
    .map((segment) => (isTokenLike(segment) ? REDACTED : segment))
    .join('')

  return `${scheme}${host}${maskedPath}${maskParameters(query, nesting)}${maskParameters(fragment, nesting)}${trailing}`
}

/**
 * `?a=1&key=…` or `#…` with the values of credential-named parameters replaced, and a value
 * holding a URL (`?redirect=https://…`, `?u=https%3A%2F%2F…`) masked as a URL, decoded.
 */
function maskParameters(part: string, nesting: number): string {
  if (!part) return part
  const [lead, rest] = [part[0], part.slice(1)]

  return `${lead}${rest
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      if (separator === -1) return isTokenLike(pair) ? REDACTED : pair
      const rawName = pair.slice(0, separator)
      const rawValue = pair.slice(separator + 1)
      const value = decodePart(rawValue)
      if (value && isLongLivedCredential(decodePart(rawName), value, 'query'))
        return `${rawName}=${REDACTED}`
      if (value.includes('://') && nesting < MAX_URL_NESTING) {
        const masked = value.replace(URL_PATTERN, (url) =>
          maskUrl(url, nesting + 1)
        )
        if (masked !== value) return `${rawName}=${masked}`
      }
      return pair
    })
    .join('&')}`
}

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '))
  } catch {
    return part
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
