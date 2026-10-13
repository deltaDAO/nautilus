/**
 * Shapes of text that both redactions read the same way: that of log text and errors
 * (`src/node/messages.ts`) and the `sensitive` debug tier (`credentials.ts`). Kept out of
 * the package's exports.
 */

/**
 * Invisible characters: C0 controls but the whitespace ones, DEL, C1 controls, the soft
 * hyphen, zero-width characters, word joiners, the BOM, and the bidi marks, overrides and
 * isolates. A reader does not see them, so a URL or a token they split reads as one.
 */
export const INVISIBLE_CHARACTERS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]+/g

/**
 * A URL without a scheme whose host is an IPv4 address, `localhost` or a bracketed IPv6
 * address, with a path, a query or a fragment after it: `127.0.0.1:8545/v3/<key>`,
 * `localhost:8545/<key>`, `[::1]:8545/<key>`, as an error quotes a local RPC endpoint.
 * Group 1 is the host and port. Not after a letter, digit, `_`, `.`, `:`, `/`, `@`, `[`
 * or `-`, so it is never part of a URL with a scheme, a longer host name or a version
 * number; any other `host:port/path` without a scheme (`a:b/c`) is read as prose. Ends as
 * a URL with a scheme does (`URL_PATTERN`, `messages.ts`); the host is bounded, so the scan
 * is linear.
 */
export const SCHEMELESS_URL =
  /(?<![\w.:/@[-])((?:\d{1,3}(?:\.\d{1,3}){3}|localhost|\[[0-9a-f:.]{2,45}\])(?::\d{1,5})?)(?=[/?#\\])(?:[^\s"'<>\\]|﻿|\\+(?!["'\s<>\\]))*/gi

/**
 * A URL's scheme and user info where a quote or `<`/`>` stands in the user info
 * (`https://user:12345'secret@host`, also escaped, `\"`, or as a JSON escape the redaction
 * does not decode, `'`, `\\u0022`, `<`): the URL patterns end at it, or read the
 * backslash as the end of the authority, so they would read the user info before it as the
 * host and port, and leave the rest of it after the URL. Also percent-encoded, as
 * `encodeURIComponent` leaves a `'` in a URL it encodes for a query
 * (`https%3A%2F%2Fuser%3A12345'secret%40host`); there the user info ends at `%2F` or `%40`.
 * Group 1 is the scheme and its `//`. No whitespace, `/`, `?`, `#` or backslash but before
 * a quote, so prose with a URL in quotes and an address after it is not read as one. Each
 * part ends at the next one's first character, so the scan is linear.
 */
export const QUOTED_USER_INFO =
  /([a-z][a-z0-9+.-]{0,31}(?::(?:\\*\/){2}|%3a%2f%2f))(?:(?<=\/)[^\s"'<>\\/?#@]*(?:(?:\\*["'<>]|\\+u00(?:2[27]|3[ce]))[^\s"'<>\\/?#@]*)+@|(?<=%2f)(?:[^\s"'<>\\/?#@%]|%(?!2f|40))*(?:(?:\\*["'<>]|\\+u00(?:2[27]|3[ce]))(?:[^\s"'<>\\/?#@%]|%(?!2f|40))*)+%40)/gi

/**
 * A URL's scheme and authority read on past a quote or a comma, as `QUOTED_USER_INFO`
 * reads user info: a cut in `https://user:12345'secret…` leaves no `@`, so a URL pattern
 * ends at the quote and the user info before it would read as the host and port. A text
 * cut inside one drops it whole. One class after the scheme, so the scan is linear.
 */
export const URL_AUTHORITY = /[a-z][a-z0-9+.-]{0,31}:(?:\\*\/){2}[^\s/?#@]*/gi

/** `text` without the URL whose authority (`URL_AUTHORITY`) runs up to its end. */
export function beforeOpenAuthority(text: string): string {
  for (const match of text.matchAll(URL_AUTHORITY))
    if (match.index + match[0].length === text.length)
      return text.slice(0, match.index)
  return text
}

/** What ends a sentence after a URL, and is not part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]/

/**
 * The punctuation at the end of `url` that ended the sentence it stood in. A loop from the
 * end, not a regular expression anchored at `$`, which would rescan a run of punctuation
 * inside the URL from each of its characters.
 */
export function trailingPunctuation(url: string): string {
  let start = url.length
  while (start > 0 && TRAILING_PUNCTUATION.test(url[start - 1])) start--
  return url.slice(start)
}
