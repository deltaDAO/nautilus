/**
 * nautilus's own logger: catalogued, structured events, redacted by field before any sink
 * sees them. Independent of ocean.js's `LoggerInstance`.
 *
 * The pipeline of one event: level and component filter → (lazy) fields evaluated →
 * redaction → the sink, else stderr. The process-wide configuration comes from
 * `configureLogging`, over the environment variables read once at import; a `Logger` made
 * with options (`Nautilus.create({ logger })`) overrides it for one instance.
 */

import { id } from 'ethers'
import {
  currentOperation,
  type OperationContext,
  type OperationName
} from './context.js'
import {
  type LoggingEnv,
  type LoggingEnvProblem,
  processEnv,
  readLoggingEnv
} from './env.js'
import {
  LOG_COMPONENTS,
  LOG_EVENTS,
  type LogComponent,
  type LogEventName
} from './events.js'
import {
  DEFAULT_LOGGING_LEVEL,
  isLoggingLevel,
  type LoggingLevel,
  type LogLevelName,
  passes
} from './levels.js'
import {
  DEFAULT_OCEANJS_MODE,
  describeLine,
  getOceanJsMode,
  initOceanJsCapture,
  isOceanJsLoggerFrozen,
  OCEANJS_EVENT,
  type OceanJsCapture,
  type OceanJsMethod,
  setOceanJsMode
} from './oceanjs.js'
import {
  argsAsFields,
  debugUnredacted,
  redactError,
  redactFields,
  redactMessage
} from './redact.js'
import { defaultFormat, formatJson, formatPretty, writeLine } from './sinks.js'
import type {
  LogEvent,
  LogFields,
  LoggingConfig,
  LoggingOptions
} from './types.js'

/** How many `once` keys a logger remembers; the oldest are forgotten first. */
export const MAX_ONCE_KEYS = 1_000
/**
 * How long a `once` key is kept as it is. A longer one (it can hold a node's text, such as
 * an environment id or an asset name) is kept as its keccak256 hash.
 */
const MAX_ONCE_KEY_LENGTH = 256

interface Settings {
  level: LoggingLevel
  format?: LoggingOptions['format']
  components?: LogComponent[]
  sink?: LoggingOptions['sink']
}

/** What the environment set at import. */
const atImport = readLoggingEnv(processEnv())

/** The environment in force: the one at import, unless a test replaced it. */
let environment: { settings: LoggingEnv; problems: LoggingEnvProblem[] } =
  atImport

let settings: Settings = fromEnvironment()

function fromEnvironment(): Settings {
  return {
    level: environment.settings.level ?? DEFAULT_LOGGING_LEVEL,
    format: environment.settings.format,
    components: environment.settings.components
  }
}

/**
 * Receives every event built, printed or not, with every level on, and whether the call
 * site asked for it `once`. Only for tests (the secret scan of the unit suite); kept out of
 * the package's exports. Unlike a sink, a tap that throws fails the call it logs.
 */
export type LogTap = (
  event: LogEvent,
  printed: boolean,
  call: { once: boolean }
) => void

let tap: LogTap | undefined

/** Installs (or, with `undefined`, removes) the tap, returning the one before. Only for tests. */
export function setLogTap(next: LogTap | undefined): LogTap | undefined {
  const previous = tap
  tap = next
  return previous
}

/**
 * Sets the process-wide logging configuration, for every instance without a `logger` of
 * its own. Only the options given change; one given as `undefined` goes back to its
 * default (the environment variable, else the built-in default). Overrides the
 * `NAUTILUS_LOG_*` environment variables. Throws for an unknown level, format or component.
 */
export function configureLogging(options: LoggingConfig): void {
  assertOptions(options, 'configureLogging')
  const defaults = fromEnvironment()

  if ('level' in options) settings.level = options.level ?? defaults.level
  if ('format' in options) settings.format = options.format ?? defaults.format
  if ('components' in options)
    settings.components = options.components
      ? [...options.components]
      : defaults.components
  if ('sink' in options) settings.sink = options.sink
  // This copy of nautilus now receives ocean.js's lines (see `oceanjs.ts`).
  if ('oceanjs' in options)
    setOceanJsMode(options.oceanjs ?? DEFAULT_OCEANJS_MODE, oceanJsCapture)
}

/**
 * The process-wide logging configuration in force. `oceanjs` is the mode in force in the
 * process, whichever copy of nautilus set it, and `'passthrough'` when nautilus could not
 * take over ocean.js's logger (frozen): ocean.js then prints its lines itself.
 */
export function getLoggingConfig(): Readonly<LoggingConfig> & {
  level: LoggingLevel
} {
  return {
    ...settings,
    components: settings.components && [...settings.components],
    oceanjs: getOceanJsMode()
  }
}

/**
 * Back to the state at import (the environment variables, else the defaults), or to the
 * state `env` would give, and the default logger forgets which `once` events it printed.
 * Only for tests.
 */
export function resetLogging(env?: Record<string, string | undefined>): void {
  environment = env === undefined ? atImport : readLoggingEnv(env)
  settings = fromEnvironment()
  setOceanJsMode(DEFAULT_OCEANJS_MODE, oceanJsCapture)
  log.forget()
  reportEnvironment()
}

/** Options for one `emit`. */
export interface EmitOptions {
  /**
   * Print the event at most once per this logger for this key (with the event name), e.g.
   * a node URI. The logger remembers the last `MAX_ONCE_KEYS` keys.
   */
  once?: string
}

/**
 * A logger. `Nautilus` uses the process-wide one unless it was created with a `logger`, and
 * passes its logger down to the node client, the policy-session resolver and the functions
 * it calls. Exported as a type only: make one with `createLogger(options)`. Its methods are
 * nautilus's own, not part of the public API.
 */
export class Logger {
  private readonly options: LoggingOptions
  private readonly shown = new Set<string>()
  /** The operation this logger is bound to, see `withOperation`. */
  private readonly operation?: OperationContext

  /** Options left out follow the process-wide configuration (`configureLogging`). */
  constructor(options: LoggingOptions = {}) {
    assertOptions(options, 'logger')
    this.options = {
      ...options,
      components: options.components && [...options.components]
    }
  }

  /** Whether an event of `level` from `component` is printed. @internal */
  enabled(level: LogLevelName, component: LogComponent): boolean {
    if (!passes(level, this.options.level ?? settings.level)) return false
    if (level === 'error' || level === 'warn') return true

    const components = this.options.components ?? settings.components
    return !components || components.includes(component)
  }

  /**
   * Logs the catalogued event `name` at its level. `fields` (and `msg`) may be functions,
   * called only when the event is printed. `did`, `txHash` and `durationMs` in `fields` go
   * to the event's own properties.
   *
   * Never throws: fields that cannot be read (a throwing getter, a throwing `fields()`)
   * become one `fieldsError` field, and an event that cannot be built or written at all is
   * dropped, so logging never fails the operation it logs.
   *
   * @internal
   */
  emit(
    name: LogEventName,
    msg: string | (() => string),
    fields?: LogFields,
    options: EmitOptions = {}
  ): void {
    const spec = LOG_EVENTS[name]
    const printed = this.enabled(spec.level, spec.component)
    if (!printed && !tap) return

    const onceKey =
      options.once === undefined ? undefined : onceKeyOf(name, options.once)
    if (onceKey !== undefined && this.shown.has(onceKey)) return

    const event = safeBuild(
      name,
      msg,
      fields,
      printed,
      this.operation ?? currentOperation()
    )
    if (!event) return
    tap?.(event, printed, { once: options.once !== undefined })
    if (!printed) return

    if (onceKey !== undefined) this.remember(onceKey)
    try {
      this.deliver(event)
    } catch {
      // stderr (or the console) refused the line: logging must not fail the operation.
    }
  }

  /**
   * This logger, bound to `operation`: its events carry the operation's `opId` even
   * where `AsyncLocalStorage` cannot tell (a browser). Shares this logger's options and
   * its `once` memory. @internal
   */
  withOperation(operation: OperationContext): Logger {
    const bound = Object.create(this) as Logger
    Object.defineProperty(bound, 'operation', { value: operation })
    return bound
  }

  /** The logger this one was bound from (`withOperation`), else this one. @internal */
  root(): Logger {
    return this.operation
      ? (Object.getPrototypeOf(this) as Logger).root()
      : this
  }

  /** Forgets which `once` events were printed. @internal */
  forget(): void {
    this.shown.clear()
  }

  private remember(key: string): void {
    if (this.shown.size >= MAX_ONCE_KEYS) {
      const oldest = this.shown.values().next().value
      if (oldest !== undefined) this.shown.delete(oldest)
    }
    this.shown.add(key)
  }

  private deliver(event: LogEvent): void {
    const sink = this.options.sink ?? settings.sink
    if (sink) {
      try {
        sink(event)
      } catch {
        // A failing sink must not fail the operation it logs.
      }
      return
    }

    const format = this.options.format ?? settings.format ?? defaultFormat()
    writeLine(
      format === 'json' ? formatJson(event) : formatPretty(event),
      event.level
    )
  }
}

/** A logger with its own options, e.g. one per tenant. See `Nautilus.create({ logger })`. */
export function createLogger(options: LoggingOptions = {}): Logger {
  return new Logger(options)
}

/** The process-wide logger, which follows `configureLogging`. */
export const log = new Logger()

/** The `Logger` for `options`: the process-wide one when none are given. */
export function loggerFor(options?: LoggingOptions | Logger): Logger {
  if (options instanceof Logger) return options
  return options ? new Logger(options) : log
}

/** The key a `once` event is remembered by: the event's name and its key, bounded. */
function onceKeyOf(name: LogEventName, key: string): string {
  return `${name}\u0000${key.length > MAX_ONCE_KEY_LENGTH ? id(key) : key}`
}

/** `build`, else the event with its fields replaced by `fieldsError`, else nothing. */
function safeBuild(
  name: LogEventName,
  msg: string | (() => string),
  fields: LogFields | undefined,
  printed: boolean,
  operation: OperationContext | undefined
): LogEvent | undefined {
  try {
    return build(name, msg, fields, printed, operation)
  } catch (error) {
    try {
      // `msg` again: `build` falls back to the event's name if it throws this time.
      return build(
        name,
        msg,
        { fieldsError: redactError(error) },
        false,
        operation
      )
    } catch {
      return undefined
    }
  }
}

/**
 * The event, redacted, with the `operation`'s `opId` and name. When it is `printed`, what
 * the redaction removed goes to the sensitive debug channel (`debugUnredacted`), if that
 * is on.
 */
function build(
  name: LogEventName,
  msg: string | (() => string),
  fields: LogFields | undefined,
  printed: boolean,
  operation: OperationContext | undefined
): LogEvent {
  const spec = LOG_EVENTS[name]
  let text: string
  let raw: Record<string, unknown>
  try {
    text = typeof msg === 'function' ? msg() : msg
    raw = (typeof fields === 'function' ? fields() : fields) ?? {}
  } catch (error) {
    text = typeof msg === 'string' ? msg : name
    raw = { fieldsError: redactError(error) }
  }

  const { did, txHash, durationMs, ...rest } = raw
  const event: LogEvent = {
    time: new Date().toISOString(),
    level: spec.level,
    event: name,
    component: spec.component,
    msg: redactMessage(String(text)),
    ...stamp(operation),
    fields: redactFields(rest, {
      argsAsFields: argsAsFields(spec.component)
    })
  }

  const top = redactFields({ did, txHash })
  if (typeof top.did === 'string') event.did = top.did
  if (typeof top.txHash === 'string') event.txHash = top.txHash
  if (typeof durationMs === 'number' && Number.isFinite(durationMs))
    event.durationMs = durationMs

  if (printed)
    debugUnredacted(name, spec.component, String(text), raw, event.msg)

  return event
}

/**
 * The `opId` and `operation` an event carries. Random and from a fixed list, but redacted
 * like every other field all the same.
 */
function stamp(
  operation: OperationContext | undefined
): Pick<LogEvent, 'opId' | 'operation'> {
  if (!operation) return {}
  const { opId, operation: name } = redactFields({
    opId: operation.opId,
    operation: operation.operation
  })
  return {
    ...(typeof opId === 'string' && { opId }),
    ...(typeof name === 'string' && { operation: name as OperationName })
  }
}

function assertOptions(options: LoggingConfig, where: string): void {
  if (!options || typeof options !== 'object')
    throw new TypeError(`${where}: expected an options object.`)

  const { level, format, components, sink, oceanjs } = options

  if (level !== undefined && !isLoggingLevel(level))
    throw new TypeError(
      `${where}: unknown level '${String(level)}'; use silent, error, warn, info, debug or trace.`
    )
  if (format !== undefined && format !== 'pretty' && format !== 'json')
    throw new TypeError(
      `${where}: unknown format '${String(format)}'; use 'pretty' or 'json'.`
    )
  if (components !== undefined) {
    if (!Array.isArray(components))
      throw new TypeError(`${where}: components must be an array.`)
    const unknown = components.filter(
      (component) => !LOG_COMPONENTS.includes(component)
    )
    if (unknown.length)
      throw new TypeError(
        `${where}: unknown component(s) ${unknown.join(', ')}; use ${LOG_COMPONENTS.join(', ')}.`
      )
  }
  if (sink !== undefined && typeof sink !== 'function')
    throw new TypeError(`${where}: sink must be a function.`)
  if (
    oceanjs !== undefined &&
    oceanjs !== 'capture' &&
    oceanjs !== 'passthrough' &&
    oceanjs !== 'silent'
  )
    throw new TypeError(
      `${where}: unknown oceanjs mode '${String(oceanjs)}'; use 'capture', 'passthrough' or 'silent'.`
    )
}

/** Warns once per variable whose value the environment parser ignored. */
function reportEnvironment(): void {
  for (const problem of environment.problems)
    log.emit(
      'config.env.invalid',
      `${problem.variable}='${problem.value}' is not understood and is ignored; use one of: ${problem.allowed}.`,
      { ...problem },
      { once: problem.variable }
    )
}

reportEnvironment()

// #region ocean.js

/**
 * The logger a captured ocean.js line goes to: the process-wide one, because ocean.js's
 * `LoggerInstance` is process-wide too.
 *
 * A line ocean.js logs during a nautilus operation still carries that operation's `opId` and
 * name: `emit` reads the current operation (`AsyncLocalStorage`, where there is one), also
 * when the operation runs on an instance's own logger or in another copy of nautilus (the
 * copies share the storage, see `context.ts`). Its level and sink stay the
 * process-wide ones: `LoggerInstance` cannot tell which instance called ocean.js.
 */
function oceanJsLogger(): Logger {
  return log
}

/** One line ocean.js logged, as an `oceanjs.logger.*` event, built only when printed. */
function captureOceanJsLine(method: OceanJsMethod, args: unknown[]): void {
  let line: ReturnType<typeof describeLine> | undefined
  const read = () => {
    line ??= describeLine(method, args)
    return line
  }
  oceanJsLogger().emit(
    OCEANJS_EVENT[method],
    () => read().msg,
    () => read().fields
  )
}

const oceanJsCapture: OceanJsCapture = {
  line: captureOceanJsLine,
  nestedDropped: () =>
    oceanJsLogger().emit(
      'oceanjs.capture.nested_dropped',
      'ocean.js logged a line while nautilus was capturing one of its lines (a sink or a debug sink that logs through LoggerInstance): the nested line is dropped, not printed, so it cannot print unredacted. Log from a sink through something other than LoggerInstance.',
      undefined,
      { once: 'nested' }
    ),
  moved: (mode) =>
    oceanJsLogger().emit(
      'oceanjs.capture.moved',
      mode === 'passthrough'
        ? "Another copy of nautilus in this process set ocean.js's log mode to 'passthrough': ocean.js now prints its lines itself, unredacted (the payload dump after a refused compute start holds the request's nonce and the policy-server session ids), and this copy's logger no longer receives them."
        : `Another copy of nautilus in this process set ocean.js's log mode to '${mode}' and now ${mode === 'silent' ? 'drops' : 'receives'} ocean.js's lines: this copy's logger and sink no longer receive them.`,
      { mode }
    )
}

/** Installs the capture, unless another copy of nautilus did; the mode in force stays. */
function startOceanJsCapture(): void {
  const methods = initOceanJsCapture(oceanJsCapture)
  if (!methods.length) return
  // A frozen logger's level can't change either: `setLevel` would throw.
  const advice = isOceanJsLoggerFrozen()
    ? "it is frozen, so its level can't change either: to silence them, call LoggerInstance.setLevel(LogLevel.None) from @oceanprotocol/lib before freezing it, or don't freeze it"
    : 'to silence them, call LoggerInstance.setLevel(LogLevel.None) from @oceanprotocol/lib'
  log.emit(
    'oceanjs.capture.unavailable',
    `ocean.js's LoggerInstance can't be changed (it is frozen, sealed or not extensible, or a method is read-only), so its lines are not captured: ocean.js prints them itself, unredacted, whatever configureLogging's oceanjs mode (the payload dump after a refused compute start holds the request's nonce and the policy-server session ids), and the mode in force reads 'passthrough'. ${advice[0].toUpperCase()}${advice.slice(1)}.`,
    { methods },
    { once: 'unavailable' }
  )
}

// #endregion

startOceanJsCapture()
