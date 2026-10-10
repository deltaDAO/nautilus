import { LogLevel } from '@oceanprotocol/lib'

/**
 * How important a log event is, most important first:
 *
 * - `error`: a failure that is not thrown to the caller (a background task);
 * - `warn`: something you must act on or know about. Printed by default;
 * - `info`: one line per operation milestone, with tx hashes, DIDs and durations;
 * - `debug`: step detail: requests, retries, decisions;
 * - `trace`: per-request detail, such as each chunk of a chain scan.
 *
 * No level prints unredacted data.
 */
export type LogLevelName = 'error' | 'warn' | 'info' | 'debug' | 'trace'

/** The lowest level that is printed, or `'silent'` for nothing. */
export type LoggingLevel = LogLevelName | 'silent'

/** Every level, most important first. */
export const LOG_LEVELS: readonly LogLevelName[] = [
  'error',
  'warn',
  'info',
  'debug',
  'trace'
]

const RANK: Record<LoggingLevel, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
}

/** The default level: warnings and errors. */
export const DEFAULT_LOGGING_LEVEL: LoggingLevel = 'warn'

/** Whether `value` names a level or `'silent'`. */
export function isLoggingLevel(value: unknown): value is LoggingLevel {
  return typeof value === 'string' && Object.hasOwn(RANK, value)
}

/** Whether an event of `level` passes the `threshold`. */
export function passes(level: LogLevelName, threshold: LoggingLevel): boolean {
  return RANK[level] <= RANK[threshold]
}

/**
 * The nautilus level for one of ocean.js's `LogLevel`s, for the deprecated
 * `Nautilus.setLogLevel`: `None` is `silent`, `Error` is `error`, `Warn` is `warn`, `Log` is
 * `info` and `Verbose` is `trace`. Anything else is `undefined`.
 */
export function fromOceanLogLevel(level: LogLevel): LoggingLevel | undefined {
  switch (level) {
    case LogLevel.None:
      return 'silent'
    case LogLevel.Error:
      return 'error'
    case LogLevel.Warn:
      return 'warn'
    case LogLevel.Log:
      return 'info'
    case LogLevel.Verbose:
      return 'trace'
    default:
      return undefined
  }
}
