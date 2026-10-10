import type { LogFormat } from './env.js'
import type { LogComponent, LogEventName } from './events.js'
import type { LoggingLevel, LogLevelName } from './levels.js'

export type { LogFormat }

/**
 * One log event, as a sink receives it. Every field is already redacted: secrets by key,
 * URLs reduced to their origin, errors and the message sanitised.
 */
export interface LogEvent {
  /** When it happened, as an ISO 8601 timestamp. */
  time: string
  level: LogLevelName
  /** The catalogued name, e.g. `publish.preflight.denies_all`. Stable; filter on it. */
  event: LogEventName
  component: LogComponent
  /** A human-readable sentence. It may change between versions; `event` does not. */
  msg: string
  /** The operation the event belongs to. Not set yet. */
  opId?: string
  /** The asset the event is about, when it has one. */
  did?: string
  /** The transaction the event is about, when there is one. */
  txHash?: string
  /** How long the step took, for milestones. */
  durationMs?: number
  /**
   * The event's own data: see the catalogue for each event's fields. When they could not
   * be read (a getter or a fields function threw), only `fieldsError`, the redacted error.
   */
  fields: Record<string, unknown>
}

/**
 * Receives every event that passes the level and component filters, instead of the
 * default stderr output. A sink that throws is ignored.
 */
export type LogSink = (event: LogEvent) => void

/** An event's data, or a function returning it, evaluated only when the event is printed. */
export type LogFields =
  | Record<string, unknown>
  | (() => Record<string, unknown>)

/** Where and how much one logger prints. Options left out follow `configureLogging`. */
export interface LoggingOptions {
  /** The lowest level printed. Default `'warn'`, or `NAUTILUS_LOG_LEVEL`. */
  level?: LoggingLevel
  /**
   * How the default stderr output is written: `'pretty'` (one readable line) or `'json'`
   * (one JSON object per line). Default: `'pretty'` when stderr is a terminal, `'json'`
   * otherwise, or `NAUTILUS_LOG_FORMAT`. Ignored when a `sink` is set.
   */
  format?: LogFormat
  /**
   * Only these components print `info`, `debug` and `trace` events. Warnings and errors of
   * every component always print. Default: all, or `NAUTILUS_LOG_COMPONENTS`.
   */
  components?: LogComponent[]
  /** Receives the events instead of stderr, e.g. to hand them to your own logger. */
  sink?: LogSink
}

/**
 * What to do with ocean.js's own log output (its global `LoggerInstance`).
 *
 * - `'capture'`: route it through nautilus's logger, redacted;
 * - `'passthrough'`: leave it as ocean.js prints it, unredacted;
 * - `'silent'`: drop it.
 */
export type OceanJsLogMode = 'capture' | 'passthrough' | 'silent'

/** The process-wide logging configuration, see `Nautilus.configureLogging`. */
export interface LoggingConfig extends LoggingOptions {
  /**
   * What to do with ocean.js's own log output. Accepted and stored, but **not active
   * yet**: until a later release implements it, ocean.js prints as it always did,
   * unredacted, at the level `Nautilus.setLogLevel` (or ocean.js's
   * `LoggerInstance.setLevel`) sets; its default is errors only. `'passthrough'` and
   * `'silent'` warn once (`config.oceanjs.not_active`). To silence ocean.js now, call
   * `LoggerInstance.setLevel(LogLevel.None)`.
   */
  oceanjs?: OceanJsLogMode
}
