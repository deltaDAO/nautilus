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
