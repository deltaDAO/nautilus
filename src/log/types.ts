import type { OperationName } from './context.js'
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
  /**
   * The operation (the public call) the event belongs to: 12 random hex characters, the
   * same on every event of one call and on the error it throws (`error.opId`). Unset
   * outside an operation, and in a browser on events of code the call does not hand its
   * logger (see `configureLogging`).
   */
  opId?: string
  /** The public call `opId` belongs to, e.g. `publish` or `getComputeResult`. */
  operation?: OperationName
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
 * What to do with ocean.js's own log output (its process-wide `LoggerInstance`).
 *
 * - `'capture'` (the default): route it through nautilus's process-wide logger as
 *   `oceanjs.logger.*` events (component `oceanjs`), redacted like every other event, at
 *   nautilus's level and to its sink; the raw lines reach only the debug channel: its
 *   `sensitive` tier, or `secrets` for a credential (an RPC key, a Bearer token);
 * - `'passthrough'`: leave it as ocean.js prints it, to the console, **unredacted**: its
 *   payload dump after a refused compute start holds the request's nonce and the
 *   policy-server session ids;
 * - `'silent'`: drop it.
 */
export type OceanJsLogMode = 'capture' | 'passthrough' | 'silent'

/** The process-wide logging configuration, see `Nautilus.configureLogging`. */
export interface LoggingConfig extends LoggingOptions {
  /**
   * What to do with ocean.js's own log output. Default `'capture'`. ocean.js's own level
   * (`LoggerInstance.setLevel`, errors only by default) still decides first which lines it
   * emits. `LoggerInstance` is process-wide, so this applies to every ocean.js user in the
   * process. Going back to the default: `oceanjs: undefined`.
   */
  oceanjs?: OceanJsLogMode
}
