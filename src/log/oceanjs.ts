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
 *   printed at nautilus's level and to its sink, and its raw arguments go to the
 *   `sensitive` debug tier (topic `node`) when that is on. ocean.js's own level still
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

/** Receives one captured line: ocean.js's method and its arguments, untouched. */
export type OceanJsCapture = (method: OceanJsMethod, args: unknown[]) => void

type LoggerMethod = (...args: unknown[]) => void

/**
 * What nautilus keeps on `LoggerInstance` itself, under a registered symbol: ocean.js's own
 * methods and the mode in force. On the object, not in this module, so a second copy of
 * nautilus in the process (or a test runner that loads this module again) finds ocean.js's
 * methods instead of the first copy's, and every copy follows the last `configureLogging`.
 */
interface Shared {
  /** The methods as they were before nautilus replaced them, for `passthrough`. */
  originals: Partial<Record<OceanJsMethod, LoggerMethod>>
  mode: OceanJsLogMode
  capture?: OceanJsCapture
  /** Set while a line is being captured: a sink that logs through ocean.js again is not. */
  capturing: boolean
}

const SHARED = Symbol.for('@deltadao/nautilus/oceanjs-capture')

/** ocean.js's logger, with nautilus's state on it. */
const target = LoggerInstance as unknown as Record<string | symbol, unknown>

let installed = false

/** The mode in force. */
export function getOceanJsMode(): OceanJsLogMode {
  return shared().mode
}

/**
 * Sets the mode, and installs nautilus's methods on `LoggerInstance` the first time. Called
 * by the logger when it loads and by `configureLogging`; `onLine` receives the captured
 * lines.
 */
export function setOceanJsMode(
  next: OceanJsLogMode,
  onLine: OceanJsCapture
): void {
  const state = shared()
  state.mode = next
  state.capture = onLine
  install(state)
}

function shared(): Shared {
  let state = target[SHARED] as Shared | undefined
  if (!state) {
    state = { originals: {}, mode: DEFAULT_OCEANJS_MODE, capturing: false }
    // Not enumerable: kept out of anything that lists the logger's properties.
    Object.defineProperty(target, SHARED, { value: state })
  }
  return state
}

/** Whether ocean.js's own level lets `method` print. */
function oceanJsAllows(method: OceanJsMethod): boolean {
  const level = target.logLevel
  // ocean.js's default (`LogLevel.Error`) when the level can't be read.
  return (typeof level === 'number' ? level : 0) >= METHODS[method]
}

function install(state: Shared): void {
  if (installed) return
  installed = true

  for (const method of Object.keys(METHODS) as OceanJsMethod[]) {
    // ocean.js's method, unless an earlier copy of this module already replaced it.
    const original = state.originals[method] ?? target[method]
    // Not ocean.js's logger as nautilus knows it: leave that method alone.
    if (typeof original !== 'function') continue
    state.originals[method] = original as LoggerMethod

    target[method] = function (this: unknown, ...args: unknown[]): void {
      const { mode, capture } = state
      if (mode === 'passthrough' || state.capturing || !capture) {
        ;(original as LoggerMethod).apply(this ?? LoggerInstance, args)
        return
      }
      if (mode === 'silent' || !oceanJsAllows(method)) return

      state.capturing = true
      try {
        capture(method, args)
      } catch {
        // Logging must not fail the ocean.js call it logs.
      } finally {
        state.capturing = false
      }
    }
  }
}

/**
 * One captured line as an event's message and fields: the leading text arguments (strings,
 * numbers, booleans) joined as the console would, and every argument after them in `args`,
 * a string that holds a JSON object or array parsed, so its keys are redacted by field. The
 * logger redacts both before any sink sees them.
 */
export function describeLine(
  method: OceanJsMethod,
  args: readonly unknown[]
): { msg: string; fields: { method: OceanJsMethod; args?: unknown[] } } {
  const words: string[] = []
  let index = 0
  for (; index < args.length; index++) {
    const arg = args[index]
    if (
      (typeof arg !== 'string' || asJson(arg) !== undefined) &&
      typeof arg !== 'number' &&
      typeof arg !== 'boolean' &&
      typeof arg !== 'bigint'
    )
      break
    words.push(String(arg))
  }

  const rest = args
    .slice(index)
    .map((arg) => (typeof arg === 'string' ? (asJson(arg) ?? arg) : arg))
  const msg = words.join(' ').trim() || `ocean.js ${method}`
  return { msg, fields: rest.length ? { method, args: rest } : { method } }
}

/** The object or array `text` holds as JSON, else `undefined`. */
function asJson(text: string): object | undefined {
  const trimmed = text.trim()
  const ends = `${trimmed[0]}${trimmed[trimmed.length - 1]}`
  if (trimmed.length > MAX_JSON_ARGUMENT || (ends !== '{}' && ends !== '[]'))
    return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    return value && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}
