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

/** How many levels of JSON string escaping `unescapeJson` undoes. */
const MAX_UNESCAPE_LEVELS = 6

/**
 * One level of JSON string escaping: `\"`, `\\`, `\/`, and `\u00XX` for a printable ASCII
 * character (`"`, as an HTML-safe serialiser writes a quote). Matched from left to
 * right in one pass, so `\\u0022` is a backslash and `u0022` at this level.
 */
const JSON_ESCAPE = /\\(?:(["\\/])|u00([2-6][0-9a-f]|7[0-9a-e]))/gi

/**
 * `text` with up to `MAX_UNESCAPE_LEVELS` levels of JSON string escaping undone: a body
 * quoted in JSON inside JSON (an RPC's answer inside an ethers error message) hides a key
 * (`\\\"apiToken\\\"`) or a URL from the patterns. Linear in the length of `text` per level.
 */
export function unescapeJson(text: string): string {
  let current = text
  for (let level = 0; level < MAX_UNESCAPE_LEVELS; level++) {
    const next = current.replace(
      JSON_ESCAPE,
      (_match, char: string | undefined, code: string | undefined) =>
        char ?? String.fromCharCode(Number.parseInt(code ?? '', 16))
    )
    if (next === current) break
    current = next
  }
  return current
}
