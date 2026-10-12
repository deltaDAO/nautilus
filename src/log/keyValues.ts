/**
 * Credentials in free text, found by the key before them: the scanner shared by the
 * redaction of log text (`src/node/messages.ts`, with `SECRET_KEYS`) and the `sensitive`
 * debug tier (`credentials.ts`, with `LONG_LIVED_CREDENTIALS`), so both read text the same
 * way and differ only in which keys they hide (`keys.ts`). Kept out of the package's
 * exports.
 *
 * Free text is matched by pattern, not parsed: a credential without a key in front of it
 * (`my password is hunter2`) is not recognised.
 */

/** Which keys a scan redacts. */
export interface KeyRule {
  /** Whether the value of `key` may be redacted; when not, the scan goes on inside it. */
  candidate(key: string): boolean
  /** Whether `value` (unquoted), under a candidate `key`, is redacted. */
  redacts(key: string, value: string): boolean
  /**
   * Whether an unquoted value of `key` runs to the end of its line rather than to the next
   * space or `;` (a `Cookie` header, a mnemonic).
   */
  toLineEnd?(key: string): boolean
}

/** The forms free text gives a credential in, by the key before it. */
export type KeyValueForm = 'escaped' | 'json' | 'assignment' | 'bare'

/**
 * A key and its separator, in each form: `\"key\": value` in JSON inside a JSON string
 * (ethers quotes a response body so; `\\\"key\\\": value` a level deeper, and so on, the
 * run of backslashes in group 1, read whole so a long run is scanned in linear time),
 * `"key": value` in JSON, `key=value` in a query, a form body or prose (ethers'
 * `code=…, info={ … }`), and `key: value` or `'key': value` (headers, prose,
 * `util.inspect`). A quoted key is any quoted text; an unquoted one a word of
 * letters, digits, `-` and `_` (so `DB_PASSWORD` and `S3_SECRET_KEY` are read whole), read
 * from its last 64 characters when it is longer. Which keys are secret is the rule's call.
 */
const KEY_VALUE_FORMS: [KeyValueForm, RegExp][] = [
  ['escaped', /(?<!\\)(\\+)"([^"\\]{1,256})\1"\s*:\s*/g],
  ['json', /"([^"\\]{1,256})"\s*:\s*/g],
  ['assignment', /([A-Za-z][\w-]{0,63})[ \t]*=[ \t]*/g],
  ['bare', /([A-Za-z][\w-]{0,63})'?[ \t]*:[ \t]*/g]
]
/** Where an unquoted value ends, by form. */
const UNQUOTED_VALUE: Record<KeyValueForm, RegExp> = {
  escaped: /[^\s,}\]\\]+/y,
  json: /[^\s,}\]]+/y,
  assignment: /[^&\s"'#,;)]+/y,
  bare: /[^\s,;"'&)}\]]+/y
}
/** What a redacted value becomes, by form, given the run of backslashes before a quote. */
const REDACTED_VALUE: Record<KeyValueForm, (quoting: string) => string> = {
  escaped: (quoting) => `${quoting}"<redacted>${quoting}"`,
  json: () => '"<redacted>"',
  assignment: () => '<redacted>',
  bare: () => '<redacted>'
}
/** An authorization scheme before its credential (`Authorization: Basic …`), kept. */
const SCHEME = /(?:Bearer|Basic|Token|Digest|Negotiate|AWS4-HMAC-SHA256)\s+/iy
/** How far a value is followed into nested braces and strings. */
const MAX_VALUE_LENGTH = 10_000
/** A value that runs to the end of its line (a cookie header), unquoted. */
const LINE_VALUE = /[^\r\n"'\\]+/y
/** A value redacted already, by an earlier pass. */
const ALREADY_REDACTED = '<redacted>'

/** `text` with the value of every key `rule` redacts replaced, in each form in turn. */
export function redactKeyValues(text: string, rule: KeyRule): string {
  let result = text
  for (const [form, pattern] of KEY_VALUE_FORMS)
    result = redactForm(result, form, pattern, rule)
  return result
}

function redactForm(
  text: string,
  form: KeyValueForm,
  pattern: RegExp,
  rule: KeyRule
): string {
  let out = ''
  let copied = 0
  pattern.lastIndex = 0

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const key = match[match.length - 1]
    const quoting = form === 'escaped' ? match[1] : ''
    // Not a secret key: the search goes on after it, inside its value if it has one.
    if (!rule.candidate(key)) continue
    const start = match.index + match[0].length
    const valueStart = afterScheme(text, start, form)
    const end = rule.toLineEnd?.(key)
      ? lineValueEnd(text, valueStart, form, quoting)
      : valueEnd(text, valueStart, form, quoting)
    if (
      end > valueStart &&
      rule.redacts(key, unquoted(text.slice(valueStart, end)))
    ) {
      out += text.slice(copied, valueStart) + REDACTED_VALUE[form](quoting)
      copied = end
      pattern.lastIndex = end
    }
    // Otherwise the search goes on inside the value: `info={ "responseBody": … }`.
  }

  return out + text.slice(copied)
}

/** Past an authorization scheme (`Basic `) at `start`, outside JSON. */
function afterScheme(text: string, start: number, form: KeyValueForm): number {
  if (form === 'json' || form === 'escaped') return start
  SCHEME.lastIndex = start
  return SCHEME.test(text) ? SCHEME.lastIndex : start
}

/**
 * Where the value at `start` ends: a quoted string at its closing quote, an object or an
 * array at its closing bracket (strings inside skipped, at most `MAX_VALUE_LENGTH` on), and
 * anything else where the form's unquoted value ends. An unclosed string or bracket runs
 * to the end of the text. `quoting` is the run of backslashes that quotes the key, in JSON
 * nested in JSON strings.
 */
function valueEnd(
  text: string,
  start: number,
  form: KeyValueForm,
  quoting: string
): number {
  const level = quoting.length
  const first = text[start]

  if (level > 0 && text.startsWith(`${quoting}"`, start))
    return escapedStringEnd(text, start, level)
  if (text.startsWith('\\"', start)) return escapedStringEnd(text, start, 1)
  if (level === 0 && (first === '"' || first === "'"))
    return stringEnd(text, start, first)
  if (first === '{' || first === '[') return nestedEnd(text, start, level)

  const unquotedValue = UNQUOTED_VALUE[form]
  unquotedValue.lastIndex = start
  return unquotedValue.test(text) ? unquotedValue.lastIndex : start
}

/**
 * Where a value that runs to the end of its line ends (`Cookie: a=1; session=…`, every
 * cookie of it): a quoted one at its closing quote, any other at a line break, a quote or
 * a backslash. One redacted already stays as it is, so a second pass over the same text
 * (after control characters are stripped) does not swallow the lines after it.
 */
function lineValueEnd(
  text: string,
  start: number,
  form: KeyValueForm,
  quoting: string
): number {
  if (text.startsWith(ALREADY_REDACTED, start))
    return start + ALREADY_REDACTED.length
  const first = text[start]
  if (
    text.startsWith(`${quoting}"`, start) ||
    text.startsWith('\\"', start) ||
    first === '"' ||
    first === "'"
  )
    return valueEnd(text, start, form, quoting)
  LINE_VALUE.lastIndex = start
  return LINE_VALUE.test(text) ? LINE_VALUE.lastIndex : start
}

/** The end of the string quoted by `quote` at `start`, backslash escapes skipped. */
function stringEnd(text: string, start: number, quote: string): number {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++
    else if (text[index] === quote) return index + 1
  }
  return text.length
}

/** How many backslashes stand right before `index`, not counting any before `from`. */
function backslashesBefore(text: string, index: number, from: number): number {
  let count = 0
  while (index - count - 1 >= from && text[index - count - 1] === '\\') count++
  return count
}

/**
 * The end of a string quoted by `level` backslashes and a quote at `start` (`\"…\"` in JSON
 * inside a JSON string, `\\\"…\\\"` a level deeper), in JSON nested in JSON strings. Inside
 * it, a quote of its own is escaped once more (`2 * level + 1` backslashes) and a backslash
 * of its own takes `2 * (level + 1)`, so a quote ends it when the run before it leaves
 * `level` over, and is its own when it leaves `2 * level + 1`. Any other quote ends an
 * outer string, and with it this one.
 */
function escapedStringEnd(text: string, start: number, level: number): number {
  const contentStart = start + level + 1
  const backslash = 2 * (level + 1)

  for (
    let index = text.indexOf('"', contentStart);
    index >= 0;
    index = text.indexOf('"', index + 1)
  ) {
    const run = backslashesBefore(text, index, contentStart)
    const rest = run % backslash
    if (rest === level) return index + 1
    if (rest !== 2 * level + 1) return index - run
  }
  return text.length
}

/**
 * The end of the object or array at `start`, strings inside it skipped. At `level` (the
 * backslashes that quote a string in JSON nested in JSON strings, 0 outside), a quote with
 * fewer backslashes before it ends the outer string, and with it the value.
 */
function nestedEnd(text: string, start: number, level: number): number {
  const limit = Math.min(text.length, start + MAX_VALUE_LENGTH)
  let depth = 0
  let index = start

  while (index < limit) {
    const char = text[index]
    if (level > 0 && (char === '\\' || char === '"')) {
      let run = 0
      while (text[index + run] === '\\') run++
      if (text[index + run] !== '"') {
        index += Math.max(run, 1)
        continue
      }
      if (run === level) {
        index = escapedStringEnd(text, index, level)
        continue
      }
      // An escaped quote of a deeper string, or else the end of an outer one.
      if (run % (2 * (level + 1)) !== 2 * level + 1) return index
      index += run + 1
      continue
    }
    if (level === 0 && (char === '"' || char === "'")) {
      index = stringEnd(text, index, char)
      continue
    }
    if (char === '{' || char === '[') depth++
    else if ((char === '}' || char === ']') && --depth === 0) return index + 1
    index++
  }
  return index
}

/** A value without the quotes around it, for the rule. */
function unquoted(value: string): string {
  const escaped = /^(\\+)"(.*)\1"$/s.exec(value)
  if (escaped) return escaped[2]
  if (value.length >= 2 && /^(["']).*\1$/s.test(value))
    return value.slice(1, -1)
  return value
}
