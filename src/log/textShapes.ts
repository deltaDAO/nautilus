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

/**
 * How many levels of escaping `undoEscapes` undoes. Escaping deeper than that is still
 * read, flattened (`flattenEscapes`, `withEscapesUndone`).
 */
export const MAX_UNESCAPE_LEVELS = 8

/**
 * One level of escaping: in JSON (or a JS or Python literal) `\"`, `\'`, `\\`, `\/`, and
 * `\u00XX` for a printable ASCII character (`\u0022`, as an HTML-safe serialiser writes a
 * quote); percent-encoding of a printable ASCII character (`%3D`, `%22`, `%2F`). Matched
 * from left to right in one pass, so `\\u0022` is a backslash and `u0022` at this level.
 * Never a control character: `\n` stays two characters, and `%0A` three.
 */
const ESCAPE =
  /\\(?:(["'\\/])|u00([2-6][0-9a-fA-F]|7[0-9a-eA-E]))|%([2-6][0-9a-fA-F]|7[0-9a-eA-E])/g

/** Whether `text` still holds an escape `ESCAPE` undoes. */
const HAS_ESCAPE =
  /\\(?:["'\\/]|u00(?:[2-6][0-9a-fA-F]|7[0-9a-eA-E]))|%(?:[2-6][0-9a-fA-F]|7[0-9a-eA-E])/

/**
 * Percent-encoding of any depth, for `flattenEscapes`: a printable character behind a chain
 * of encoded percent signs (`%3D`, `%253D`, `%25253D`). The chain is matched to its end and
 * gives back at most one `25`, so a long chain costs linear time.
 */
const PERCENT_RUN = /%(?:25)*([2-6][0-9a-fA-F]|7[0-9a-eA-E])/g

/**
 * JSON escaping of any depth, for `flattenEscapes`: a run of backslashes with the quote,
 * slash or `u00XX` it escapes. The run is matched whatever follows it, so a long run costs
 * linear time.
 */
const BACKSLASH_RUN = /\\+(?:u00([2-6][0-9a-fA-F]|7[0-9a-eA-E])|(["'/]))?/g

/** A printable ASCII character by its hex code. */
function fromHex(code: string): string {
  return String.fromCharCode(Number.parseInt(code, 16))
}

/**
 * `text` with up to `MAX_UNESCAPE_LEVELS` levels of escaping undone (`ESCAPE`): a body
 * quoted in JSON inside JSON (an RPC's answer inside an ethers error message) hides a key
 * (`\\\"apiToken\\\"`) or a URL from the patterns, and so does percent-encoding
 * (`apiToken%3D…`, `https%3A%2F%2F…`). Linear in the length of `text` per level.
 */
export function undoEscapes(text: string): string {
  let current = text
  for (let level = 0; level < MAX_UNESCAPE_LEVELS; level++) {
    const next = current.replace(
      ESCAPE,
      (
        _match,
        char: string | undefined,
        json: string | undefined,
        percent: string | undefined
      ) => char ?? fromHex(json ?? percent ?? '')
    )
    if (next === current) break
    current = next
  }
  return current
}

/** `text` with every percent chain (`PERCENT_RUN`) read as the character it encodes. */
function flattenPercent(text: string): string {
  return text.replace(PERCENT_RUN, (_match, code: string) => fromHex(code))
}

/**
 * `text` with escaping of any depth flattened: a percent chain becomes the character it
 * encodes, then a run of backslashes before a quote, a slash or `u00XX` what it escapes and
 * any other run one backslash, then percent chains again (a `\u0025` the backslash pass
 * made). Percent first, so the backslashes a percent chain encodes (`%255C`) are flattened
 * too. Coarser than `undoEscapes` (it cannot tell the levels apart), so it is used only
 * past `MAX_UNESCAPE_LEVELS`. Three linear replacements.
 */
function flattenEscapes(text: string): string {
  const backslashes = flattenPercent(text).replace(
    BACKSLASH_RUN,
    (_match, json: string | undefined, char: string | undefined) =>
      json ? fromHex(json) : (char ?? '\\')
  )
  return flattenPercent(backslashes)
}

/**
 * `text` through `pass` (a redaction), as it is and with its escapes undone: the pass runs
 * on `text`, then again on its own output with up to `MAX_UNESCAPE_LEVELS` levels of
 * escaping undone (`undoEscapes`), so what the first pass redacted stays redacted. When
 * escapes are still left after that (deeper escaping), the output is read once more with
 * them all flattened (`flattenEscapes`), so a credential deeper than the limit is still
 * redacted rather than shown. The first pass's output, with its escapes kept, is returned
 * unless a later pass redacts more; then that pass's output, with its escapes undone, is.
 * Linear: at most three passes and `MAX_UNESCAPE_LEVELS` + 3 replacements.
 */
export function withEscapesUndone(
  text: string,
  pass: (text: string) => string
): string {
  const once = pass(text)
  const unescaped = undoEscapes(once)
  if (unescaped === once) return once

  const deep = pass(unescaped)
  const found = deep !== unescaped
  // Escapes left after `MAX_UNESCAPE_LEVELS`: escaping deeper than the limit.
  if (HAS_ESCAPE.test(unescaped)) {
    const flat = flattenEscapes(deep)
    const deeper = pass(flat)
    if (deeper !== flat) return deeper
  }
  return found ? deep : once
}
