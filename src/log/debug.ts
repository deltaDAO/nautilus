/**
 * The sensitive debug channel: the raw data nautilus redacts everywhere else. Off by
 * default. Kept out of the package's exports, except `Nautilus.setDebug` and the types.
 *
 * Debug mode does not switch redaction off. Errors, `PolicyDeniedError`,
 * `PublishResponse.stored`, warnings and log events stay exactly as redacted as without it.
 * Instead, each place that redacts (the sanitisers in `node/messages.ts`, `remote/redact.ts`
 * and the logger's field redaction in `log/redact.ts`) also hands the raw value to this
 * channel, which prints it only when its tier and topic are on:
 *
 * - `sensitive`: the raw value with long-lived credentials still replaced
 *   (`credentials.ts`): node, wallet, verifier and RPC bodies, session ids, redirect URIs,
 *   policy results, request payloads, signatures, nonces, presented VP/VC JWTs, storage
 *   pointers without their credentials;
 * - `secrets`: also the credentials: the RPC URL with its token, S3 secret keys,
 *   Pinata/IPFS JWTs, `Authorization` headers.
 *
 * The signer's private key and mnemonic are never shown: nautilus never holds them.
 *
 * Switched on by `setDebug` or, in Node, by `NAUTILUS_DEBUG` (and `NAUTILUS_DEBUG_TOPICS`),
 * read once at import. `setDebug` overrides the environment. Turning it on prints a warning
 * on stderr that no log setting suppresses, once per tier.
 *
 * When off, `debugEnabled` is one comparison and no raw value is copied or kept.
 */
import { maskCredentials, maskNeverShown } from './credentials.js'
import {
  DEBUG_LEVELS,
  DEBUG_TOPICS,
  type DebugEnv,
  type DebugLevel,
  type DebugTopic,
  processEnv,
  readDebugEnv
} from './env.js'
import { writeLine } from './sinks.js'

export type { DebugLevel, DebugTopic }

/** A tier of the debug channel: `sensitive`, or `secrets` (`sensitive` plus credentials). */
export type DebugTier = Exclude<DebugLevel, 'off'>

/** One event of the debug channel, as a custom sink receives it. */
export interface DebugEvent {
  /** When it happened, as an ISO 8601 timestamp. */
  time: string
  /**
   * `sensitive`, or `secrets` when the data holds a long-lived credential (only with the
   * `secrets` tier on).
   */
  tier: DebugTier
  topic: DebugTopic
  /** What the data is, e.g. `node answer HTTP 400 Bad Request`. */
  message: string
  /**
   * The raw value, as plain data (strings, numbers, booleans, `null`, arrays, objects):
   * an error becomes `{ name, message, code, …, cause }`. Long strings are cut at 32,768
   * characters.
   */
  data?: unknown
}

/** Receives the debug events instead of stderr. A sink that throws is ignored. */
export type DebugSink = (event: DebugEvent) => void

/** The settings of `Nautilus.setDebug`. */
export interface DebugOptions {
  /** `'off'` (the default), `'sensitive'` or `'secrets'`. */
  level: DebugLevel
  /** Only these topics print. Default: all. */
  topics?: DebugTopic[]
  /** Receives the events instead of stderr (one line per event). */
  sink?: DebugSink
}

interface State {
  level: DebugLevel
  topics?: ReadonlySet<DebugTopic>
  sink?: DebugSink
}

/** How long a string in an event's data may be. */
const MAX_STRING_LENGTH = 32_768
/** How deep an event's data is kept. */
const MAX_DEPTH = 8
/** How many entries of an array or object are kept. */
const MAX_ENTRIES = 200

const atImport: DebugEnv = readDebugEnv(processEnv()).settings

let state: State = fromEnv(atImport)
/** The highest tier the banner has been printed for. */
let announced: DebugLevel = 'off'

function fromEnv(env: DebugEnv): State {
  return {
    level: env.level ?? 'off',
    topics: env.topics && new Set(env.topics)
  }
}

/**
 * Sets the debug channel for the whole process, overriding `NAUTILUS_DEBUG` and
 * `NAUTILUS_DEBUG_TOPICS`: the options given replace the whole setting (topics left out:
 * all; sink left out: stderr). Throws for an unknown level or topic.
 */
export function setDebug(options: DebugOptions): void {
  if (!options || typeof options !== 'object')
    throw new TypeError('setDebug: expected an options object.')

  const { level, topics, sink } = options
  if (!(DEBUG_LEVELS as readonly string[]).includes(level as string))
    throw new TypeError(
      `setDebug: unknown level '${String(level)}'; use ${DEBUG_LEVELS.join(', ')}.`
    )
  if (topics !== undefined) {
    if (!Array.isArray(topics))
      throw new TypeError('setDebug: topics must be an array.')
    const unknown = topics.filter(
      (topic) => !(DEBUG_TOPICS as readonly string[]).includes(topic)
    )
    if (unknown.length)
      throw new TypeError(
        `setDebug: unknown topic(s) ${unknown.join(', ')}; use ${DEBUG_TOPICS.join(', ')}.`
      )
  }
  if (sink !== undefined && typeof sink !== 'function')
    throw new TypeError('setDebug: sink must be a function.')

  state = { level, topics: topics && new Set(topics), sink }
  announce()
}

/** The debug level in force. */
export function getDebugLevel(): DebugLevel {
  return state.level
}

/**
 * Back to the state at import, or to the state `env` would give, and the banner forgets
 * it was printed. Only for tests.
 */
export function resetDebug(env?: Record<string, string | undefined>): void {
  state = fromEnv(env === undefined ? atImport : readDebugEnv(env).settings)
  announced = 'off'
  announce(env)
}

/** Whether events of `tier` about `topic` are printed. */
export function debugEnabled(tier: DebugTier, topic: DebugTopic): boolean {
  if (state.level === 'off') return false
  if (tier === 'secrets' && state.level !== 'secrets') return false
  return !state.topics || state.topics.has(topic)
}

/**
 * Prints `data` at `tier`, when that tier and `topic` are on. `data` may be a function,
 * called only then. At `sensitive`, long-lived credentials in it are still replaced; at
 * `secrets` only the never-shown keys are. Never throws.
 */
export function debug(
  tier: DebugTier,
  topic: DebugTopic,
  message: string,
  data?: unknown
): void {
  if (!debugEnabled(tier, topic)) return
  try {
    const plain = toPlain(typeof data === 'function' ? data() : data)
    deliver(
      tier,
      topic,
      message,
      tier === 'secrets' ? maskNeverShown(plain) : maskCredentials(plain)
    )
  } catch {
    // Debug output must never fail the operation it describes.
  }
}

/**
 * A raw value a redaction site removed, at the tier it needs: `sensitive` with long-lived
 * credentials replaced; or, when the `secrets` tier is on and the value holds one,
 * `secrets` with it shown. `credentials` are strings the caller knows to be credentials (a
 * store's configured header values), replaced at `sensitive` wherever they appear. `raw`
 * may be a function, called only when the topic is on. Never throws.
 */
export function debugRaw(
  topic: DebugTopic,
  message: string,
  raw: unknown,
  credentials?: readonly string[]
): void {
  if (!debugEnabled('sensitive', topic)) return
  try {
    const plain = toPlain(typeof raw === 'function' ? raw() : raw)
    const masked = maskCredentials(plain, credentials)

    if (
      debugEnabled('secrets', topic) &&
      JSON.stringify(masked) !== JSON.stringify(plain)
    )
      deliver('secrets', topic, message, maskNeverShown(plain))
    else deliver('sensitive', topic, message, masked)
  } catch {
    // Debug output must never fail the operation it describes.
  }
}

/** Receives every event delivered. Only for tests; kept out of the package's exports. */
export type DebugTap = (event: DebugEvent) => void

let tap: DebugTap | undefined

/** Installs (or removes) the tap, returning the one before. Only for tests. */
export function setDebugTap(next: DebugTap | undefined): DebugTap | undefined {
  const previous = tap
  tap = next
  return previous
}

function deliver(
  tier: DebugTier,
  topic: DebugTopic,
  message: string,
  data: unknown
): void {
  const event: DebugEvent = {
    time: new Date().toISOString(),
    tier,
    topic,
    message,
    ...(data === undefined ? {} : { data })
  }
  tap?.(event)

  if (state.sink) {
    try {
      state.sink(event)
    } catch {
      // A failing sink must not fail the operation.
    }
    return
  }

  try {
    // `info`: without stderr (a browser), `console.info`, which consoles show by default.
    writeLine(formatDebugLine(event), 'info')
  } catch {
    // stderr refused the line.
  }
}

/** The stderr prefix of a debug line of `tier`. */
export function debugPrefix(tier: DebugTier): string {
  return `[nautilus:debug:${tier === 'secrets' ? 'SECRETS' : 'sensitive'}]`
}

/**
 * One line, whatever the data holds:
 * `[nautilus:debug:sensitive] [node] <time> <message> <data as JSON>`. Line breaks,
 * terminal escapes and other control characters are written as JSON escapes (`\n`,
 * `\u001b`).
 */
export function formatDebugLine(event: DebugEvent): string {
  const data =
    event.data === undefined
      ? ''
      : ` ${escapeControls(JSON.stringify(event.data))}`
  return `${debugPrefix(event.tier)} [${event.topic}] ${event.time} ${escapeControls(event.message)}${data}`
}

/** Control characters, DEL, C1, the line and paragraph separators and bidi controls. */
const CONTROLS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping them is the point
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

function escapeControls(text: string): string {
  return text.replace(CONTROLS, (character) => {
    const code = character.charCodeAt(0)
    if (code === 0x0a) return '\\n'
    if (code === 0x0d) return '\\r'
    if (code === 0x09) return '\\t'
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/**
 * `value` as plain, JSON-safe data, a copy: errors as `{ name, message, …own properties,
 * cause }` (without the stack), bytes as hex, URLs as their `href`, long strings cut, deep
 * or large structures bounded, cycles marked.
 */
export function toPlain(value: unknown): unknown {
  return plain(value, 0, new WeakSet())
}

function plain(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}…(${value.length - MAX_STRING_LENGTH} more characters)`
        : value
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'boolean':
      return value
    case 'bigint':
      return value.toString()
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }
  if (value === null) return null

  const object = value as object
  if (seen.has(object)) return '[circular]'
  if (depth >= MAX_DEPTH) return '[…]'

  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return value.href
  if (value instanceof Uint8Array)
    return plain(
      `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
      depth,
      seen
    )

  seen.add(object)
  try {
    if (Array.isArray(value)) {
      const kept = value
        .slice(0, MAX_ENTRIES)
        .map((entry) => plain(entry, depth + 1, seen) ?? null)
      if (value.length > MAX_ENTRIES)
        kept.push(`… ${value.length - MAX_ENTRIES} more`)
      return kept
    }
    if (value instanceof Map)
      return plain(Object.fromEntries(value), depth, seen)
    if (value instanceof Set) return plain([...value], depth, seen)
    if (typeof Headers !== 'undefined' && value instanceof Headers) {
      const headers: Record<string, string> = {}
      value.forEach((entry, name) => {
        headers[name] = entry
      })
      return headers
    }

    const out: Record<string, unknown> = {}
    if (value instanceof Error) {
      out.name = value.name
      out.message = value.message
    }
    const keys = Object.keys(object).filter((key) => key !== 'stack')
    for (const key of keys.slice(0, MAX_ENTRIES)) {
      let entry: unknown
      try {
        entry = (value as Record<string, unknown>)[key]
      } catch {
        entry = '[unreadable]'
      }
      const converted = plain(entry, depth + 1, seen)
      if (converted !== undefined) out[key] = converted
    }
    if (keys.length > MAX_ENTRIES)
      out['…'] = `${keys.length - MAX_ENTRIES} more`
    if (
      value instanceof Error &&
      !('cause' in out) &&
      value.cause !== undefined
    )
      out.cause = plain(value.cause, depth + 1, seen)
    return out
  } finally {
    seen.delete(object)
  }
}

// #region banner

/**
 * Prints the warning for the tier now on, once per tier: on stderr (the console without
 * one), whatever the log level, the log sink or the debug sink.
 */
function announce(env?: Record<string, string | undefined>): void {
  const { level } = state
  if (level === 'off' || rank(level) <= rank(announced)) return
  announced = level

  const production =
    (env === undefined ? processEnv() : env)?.NODE_ENV?.trim().toLowerCase() ===
    'production'

  try {
    writeLine(debugBanner(level, production), 'warn')
  } catch {
    // stderr refused the line.
  }
}

/** The warning printed when the debug channel is turned on. */
export function debugBanner(level: DebugTier, production: boolean): string {
  const what =
    level === 'secrets'
      ? 'sensitive debug logging is ON at the SECRETS tier: the output contains session ids, signatures and request data, and also credentials (RPC URL tokens, S3 secret keys, IPFS JWTs, auth headers).'
      : 'sensitive debug logging is ON: the output contains session ids, signatures and request data.'
  const advice =
    level === 'secrets'
      ? "Don't use it in production, don't share the output, and rotate every credential it printed."
      : "Don't use it in production, and don't share the output."

  return production
    ? `[nautilus] WARNING: NODE_ENV is production and ${what} Turn it off now (unset NAUTILUS_DEBUG, or setDebug({ level: 'off' })). ${advice}`
    : `[nautilus] WARNING: ${what} ${advice}`
}

function rank(level: DebugLevel): number {
  return DEBUG_LEVELS.indexOf(level)
}

announce()

// #endregion
