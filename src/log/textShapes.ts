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

/** The value of a hex digit's character code, or -1. */
function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 65 && code <= 70) return code - 55
  if (code >= 97 && code <= 102) return code - 87
  return -1
}

/**
 * The printable ASCII character (as `ESCAPE` reads one) two hex digits stand for, by their
 * character codes, or -1.
 */
function printableCode(high: number, low: number): number {
  const code = hexValue(high) * 16 + hexValue(low)
  return hexValue(high) < 0 || hexValue(low) < 0 || code < 0x20 || code > 0x7e
    ? -1
    : code
}

const BACKSLASH = 92
const PERCENT = 37
/** What a backslash escapes as itself: `\"`, `\'`, `\\` and `\/`. */
const ESCAPED_AS_ITSELF = new Set([34, 39, BACKSLASH, 47])

/**
 * The character code the escape at the end of `out[0, length)` stands for, or -1 when it
 * does not end in one (`ESCAPE`, and a backslash escaping another as one). `out` holds
 * character codes.
 */
function escapeAtEnd(out: Uint16Array, length: number): [number, number] {
  const last = out[length - 1]

  if (
    length >= 2 &&
    out[length - 2] === BACKSLASH &&
    ESCAPED_AS_ITSELF.has(last)
  )
    return [last, 2]
  if (length >= 3 && out[length - 3] === PERCENT) {
    const code = printableCode(out[length - 2], last)
    if (code >= 0) return [code, 3]
  }
  if (
    length >= 6 &&
    out[length - 6] === BACKSLASH &&
    out[length - 5] === 117 && // u
    out[length - 4] === 48 && // 0
    out[length - 3] === 48
  ) {
    const code = printableCode(out[length - 2], last)
    if (code >= 0) return [code, 6]
  }
  return [-1, 0]
}

/**
 * `text` with escaping of any depth and mix flattened: every escape is undone, and so is
 * every escape that undoing makes (`\u005cu003d` is `\u003d`, then `=`; `%5Cu0022` is
 * `"`; `\u0025` and `3D` make `%3D`, then `=`), until none is left. A run of backslashes
 * is read as one. The characters are pushed one by one, and whenever the text pushed so far
 * ends in an escape, the escape is replaced by its character, which may end another one.
 * Each replacement shortens the text, so the work is linear in the length of `text`,
 * however deep the chains. Coarser than `undoEscapes` (it cannot tell the levels apart), so
 * it is used only past `MAX_UNESCAPE_LEVELS`.
 */
function flattenEscapes(text: string): string {
  const out = new Uint16Array(text.length)
  let length = 0

  for (let index = 0; index < text.length; index++) {
    out[length++] = text.charCodeAt(index)
    for (let [code, size] = escapeAtEnd(out, length); code >= 0; ) {
      length -= size
      out[length++] = code
      ;[code, size] = escapeAtEnd(out, length)
    }
  }

  let flat = ''
  for (let index = 0; index < length; index += 8_192)
    flat += String.fromCharCode(
      ...out.subarray(index, Math.min(length, index + 8_192))
    )
  return flat
}

/**
 * `text` through `pass` (a redaction), as it is and with its escapes undone: the pass runs
 * on `text`, then again on its own output with up to `MAX_UNESCAPE_LEVELS` levels of
 * escaping undone (`undoEscapes`), so what the first pass redacted stays redacted. When
 * escapes are still left after that (deeper escaping), the output is read once more with
 * them all flattened (`flattenEscapes`), so a credential deeper than the limit is still
 * redacted rather than shown. The first pass's output, with its escapes kept, is returned
 * unless a later pass redacts more; then that pass's output, with its escapes undone, is.
 * Linear: at most three passes, `MAX_UNESCAPE_LEVELS` replacements and one flatten.
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
