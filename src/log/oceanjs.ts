/**
 * ocean.js's own log output, routed through nautilus's logger. Kept out of the package's
 * exports; switched by `configureLogging({ oceanjs })`.
 *
 * ocean.js logs through one process-wide object, the `LoggerInstance` both of its bundles
 * export: `LoggerInstance.error(…)` and so on call `console[method](...args)` when
 * ocean.js's own level allows it. Among those lines is the payload dump of a refused compute
 * start or initialize (`LoggerInstance.error('Payload was:', payload)`), with the request's
 * nonce and the policy-server session ids (J1). ocean.js can't be changed, so nautilus
 * replaces the five logging methods of that object (`error`, `warn`, `log`, `debug`,
 * `bypass`) with its own, as own properties of the instance, once, when the logger loads.
 * Each call then follows the mode in force:
 *
 * - `'capture'` (the default): the line becomes a catalogued `oceanjs.logger.*` event of
 *   the process-wide logger: redacted by field and by `sanitize` like every other event,
 *   printed at nautilus's level and to its sink, and its raw arguments go to the debug
 *   channel (topic `node`) when that is on: its `sensitive` tier, or `secrets` for a
 *   credential (an RPC key, a Bearer token, a signed transaction). ocean.js's own level still
 *   decides first which lines it emits (errors only by default), so a line ocean.js would
 *   not have printed is not captured either;
 * - `'passthrough'`: ocean.js's own method, unchanged: unredacted, to the console;
 * - `'silent'`: nothing.
 *
 * Nothing else is touched: `console` is not patched, ocean.js's level is not changed, and
 * ocean.js's few direct `console.log`/`console.error` calls (not through `LoggerInstance`)
 * still print as they do. `LoggerInstance` is process-wide, so the mode applies to every
 * ocean.js user in the process, not only to nautilus's calls. PR 11's contract test pins
 * that ocean.js logs through this object.
 *
 * Several copies of nautilus in one process (a bundled copy, a test runner's reload) share
 * one state on `LoggerInstance`: the first copy loaded installs the methods, a later copy
 * keeps the mode in force, and the lines go to the copy that last set the mode
 * (`configureLogging({ oceanjs })`), else to the first. A line ocean.js logs while one is
 * being captured (a sink that logs through `LoggerInstance`) is dropped, never printed raw.
 * A `LoggerInstance` nautilus can't change (frozen) is left alone: nothing is captured, and
 * the logger warns once.
 */

import { LoggerInstance } from '@oceanprotocol/lib'
import type { LogEventName } from './events.js'
import type { OceanJsLogMode } from './types.js'

/** The mode when none is configured. */
export const DEFAULT_OCEANJS_MODE: OceanJsLogMode = 'capture'

/** ocean.js's logging methods, each with the lowest ocean.js level that prints it. */
const METHODS = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  // ocean.js prints `bypass` at every level, `None` included.
  bypass: Number.NEGATIVE_INFINITY
} as const

export type OceanJsMethod = keyof typeof METHODS

/** The catalogued event of each method. */
export const OCEANJS_EVENT: Record<OceanJsMethod, LogEventName> = {
  error: 'oceanjs.logger.error',
  warn: 'oceanjs.logger.warn',
  log: 'oceanjs.logger.log',
  debug: 'oceanjs.logger.debug',
  bypass: 'oceanjs.logger.log'
}

/** How long a string argument may be to be read as JSON. A longer one stays text. */
const MAX_JSON_ARGUMENT = 65_536

/** Receives the captured lines. */
export interface OceanJsCapture {
  /** One captured line: ocean.js's method and its arguments, untouched. */
  line(method: OceanJsMethod, args: unknown[]): void
  /** ocean.js logged a line while one was being captured; that line was dropped. */
  nestedDropped(): void
}

type LoggerMethod = (...args: unknown[]) => void

/**
 * What nautilus keeps on `LoggerInstance` itself, under a registered symbol: ocean.js's own
 * methods, the mode in force and where the lines go. On the object, not in this module, so
 * every copy of nautilus in the process (or a test runner that loads this module again)
 * shares them.
 */
interface Shared {
  /** The methods as they were before nautilus replaced them, for `passthrough`. */
  originals: Partial<Record<OceanJsMethod, LoggerMethod>>
  mode: OceanJsLogMode
  /** The copy that last set the mode, else the first copy loaded. */
  capture?: OceanJsCapture
  /** Whether a copy installed its methods on `LoggerInstance`. */
  installed: boolean
  /** Set while a line is being captured: a line logged meanwhile is dropped. */
  capturing: boolean
  /** Set when a line was dropped during the capture in progress. */
  dropped: boolean
}

/**
 * Versioned: a copy whose `Shared` differs uses a key of its own (and wraps the methods it
 * finds, so both still work) instead of misreading this one.
 */
const SHARED = Symbol.for('@deltadao/nautilus/oceanjs-capture/v1')

/** ocean.js's logger, with nautilus's state on it. */
const target = LoggerInstance as unknown as Record<string | symbol, unknown>

/** The state, when `LoggerInstance` can't hold it (frozen): this copy's own. */
let local: Shared | undefined

let installed = false

/** The mode in force. */
export function getOceanJsMode(): OceanJsLogMode {
  return shared().mode
}

/**
 * Installs nautilus's methods on `LoggerInstance`, unless an earlier copy did, and sends the
 * lines to `capture` unless an earlier copy already receives them; the mode in force stays.
 * Called once, when the logger loads. Returns the methods that could not be replaced (all
 * five for a frozen `LoggerInstance`): ocean.js prints those itself, whatever the mode.
 */
export function initOceanJsCapture(capture: OceanJsCapture): OceanJsMethod[] {
  const state = shared()
  state.capture ??= capture
  return install(state)
}

/**
 * Sets the mode, and sends the lines to `capture`: the copy that last sets the mode
 * receives them. Called by `configureLogging` and `resetLogging`.
 */
export function setOceanJsMode(
  next: OceanJsLogMode,
  capture: OceanJsCapture
): void {
  const state = shared()
  state.mode = next
  state.capture = capture
}

function shared(): Shared {
  if (local) return local
  const found = target[SHARED]
  if (isShared(found)) return found

  const state: Shared = {
    originals: {},
    mode: DEFAULT_OCEANJS_MODE,
    installed: false,
    capturing: false,
    dropped: false
  }
  try {
    // Not enumerable: kept out of anything that lists the logger's properties.
    Object.defineProperty(target, SHARED, { value: state })
  } catch {
    // Frozen, or the key is taken by something else: this copy keeps its state itself.
    local = state
  }
  return state
}

function isShared(value: unknown): value is Shared {
  const state = value as Shared | undefined
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof state.originals === 'object' &&
    typeof state.installed === 'boolean' &&
    typeof state.capturing === 'boolean'
  )
}

/** Whether ocean.js's own level lets `method` print. */
function oceanJsAllows(method: OceanJsMethod): boolean {
  const level = target.logLevel
  // ocean.js's default (`LogLevel.Error`) when the level can't be read.
  return (typeof level === 'number' ? level : 0) >= METHODS[method]
}

function install(state: Shared): OceanJsMethod[] {
  if (installed || state.installed) return []
  installed = true

  const failed: OceanJsMethod[] = []
  for (const method of Object.keys(METHODS) as OceanJsMethod[]) {
    // ocean.js's method, or an app's own replacement made before nautilus loaded, which
    // `passthrough` then calls.
    const original = state.originals[method] ?? target[method]
    // Not ocean.js's logger as nautilus knows it: leave that method alone.
    if (typeof original !== 'function') continue
    const replacement = capturing(state, method, original as LoggerMethod)
    try {
      target[method] = replacement
    } catch {
      // Frozen, or the method is read-only.
    }
    if (target[method] !== replacement) {
      failed.push(method)
      continue
    }
    state.originals[method] = original as LoggerMethod
  }
  // Another copy wraps nothing again; a copy with its own state (frozen) has nothing to share.
  if (state !== local) state.installed = true
  return failed
}

/** nautilus's replacement of ocean.js's `method`. */
function capturing(
  state: Shared,
  method: OceanJsMethod,
  original: LoggerMethod
): LoggerMethod {
  return function (this: unknown, ...args: unknown[]): void {
    const { mode, capture } = state
    if (mode === 'passthrough') {
      original.apply(this ?? LoggerInstance, args)
      return
    }
    if (mode === 'silent' || !capture || !oceanJsAllows(method)) return
    // Logged from inside a capture (a sink, or a debug sink, that logs through ocean.js):
    // printing it through ocean.js's method would print it unredacted, capturing it would
    // loop.
    if (state.capturing) {
      state.dropped = true
      return
    }

    state.capturing = true
    try {
      capture.line(method, args)
      if (state.dropped) {
        state.dropped = false
        capture.nestedDropped()
      }
    } catch {
      // Logging must not fail the ocean.js call it logs.
    } finally {
      state.capturing = false
      state.dropped = false
    }
  }
}

/**
 * One captured line as an event's message and fields: the leading text arguments (strings,
 * numbers, booleans) joined as the console would, and every argument after them in `args`.
 * A string that reads as a JSON object or array starts `args` too: parsed when it is at most
 * `MAX_JSON_ARGUMENT` long, so its keys are redacted by field, else kept as text. The logger
 * redacts both before any sink sees them.
 */
export function describeLine(
  method: OceanJsMethod,
  args: readonly unknown[]
): { msg: string; fields: { method: OceanJsMethod; args?: unknown[] } } {
  const read = args.map((arg) =>
    typeof arg === 'string' ? jsonOf(arg) : undefined
  )
  const words: string[] = []
  let index = 0
  for (; index < args.length; index++) {
    const arg = args[index]
    if (
      (typeof arg !== 'string' || read[index] !== undefined) &&
      typeof arg !== 'number' &&
      typeof arg !== 'boolean' &&
      typeof arg !== 'bigint'
    )
      break
    words.push(String(arg))
  }

  const rest = args.slice(index).map((arg, at) => {
    const json = read[index + at]
    return json === undefined || json === TOO_LONG ? arg : json
  })
  const msg = words.join(' ').trim() || `ocean.js ${method}`
  return { msg, fields: rest.length ? { method, args: rest } : { method } }
}

/** A JSON text longer than `MAX_JSON_ARGUMENT`: an argument, but not parsed. */
const TOO_LONG = Symbol('too long')

/**
 * The object or array `text` holds as JSON, `TOO_LONG` when it looks like one (`{…}`,
 * `[…]`) but is too long to parse, else `undefined`.
 */
function jsonOf(text: string): object | typeof TOO_LONG | undefined {
  const trimmed = text.trim()
  const ends = `${trimmed[0]}${trimmed[trimmed.length - 1]}`
  if (ends !== '{}' && ends !== '[]') return undefined
  if (trimmed.length > MAX_JSON_ARGUMENT) return TOO_LONG
  try {
    const value: unknown = JSON.parse(trimmed)
    return value && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}
