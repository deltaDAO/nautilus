/**
 * The logging environment variables, read once when nautilus is imported. Kept out of the
 * package's exports.
 *
 * - `NAUTILUS_LOG_LEVEL`: `silent`, `error`, `warn` (the default), `info`, `debug` or
 *   `trace`;
 * - `NAUTILUS_LOG_FORMAT`: `json` or `pretty`;
 * - `NAUTILUS_LOG_COMPONENTS`: a comma-separated list of components (`publish,access`);
 * - `NAUTILUS_DEBUG`: the sensitive debug tier, `off`, `sensitive` or `secrets` (see
 *   `debug.ts`);
 * - `NAUTILUS_DEBUG_TOPICS`: a comma-separated list of debug topics (`node,wallet`).
 *
 * Case and surrounding spaces do not matter. An unknown value is ignored, with a warning.
 * Without `process` (a browser bundle) nothing is read.
 */
import { LOG_COMPONENTS, type LogComponent } from './events.js'
import { isLoggingLevel, LOG_LEVELS, type LoggingLevel } from './levels.js'

export type LogFormat = 'pretty' | 'json'

/** What the environment sets. */
export interface LoggingEnv {
  level?: LoggingLevel
  format?: LogFormat
  components?: LogComponent[]
}

/** A variable whose value was not understood. */
export interface LoggingEnvProblem {
  variable: string
  value: string
  allowed: string
}

/** The environment of this process, or `undefined` where there is none. */
export function processEnv(): Record<string, string | undefined> | undefined {
  try {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env
    return env && typeof env === 'object' ? env : undefined
  } catch {
    // A `process` getter that throws, as some bundler shims do.
    return undefined
  }
}

/** The logging settings in `env`, and the values that were not understood. */
export function readLoggingEnv(
  env: Record<string, string | undefined> | undefined
): { settings: LoggingEnv; problems: LoggingEnvProblem[] } {
  const settings: LoggingEnv = {}
  const problems: LoggingEnvProblem[] = []
  if (!env) return { settings, problems }

  const level = value(env.NAUTILUS_LOG_LEVEL)
  if (level !== undefined) {
    if (isLoggingLevel(level)) settings.level = level
    else
      problems.push({
        variable: 'NAUTILUS_LOG_LEVEL',
        value: level,
        allowed: ['silent', ...LOG_LEVELS].join(', ')
      })
  }

  const format = value(env.NAUTILUS_LOG_FORMAT)
  if (format !== undefined) {
    if (format === 'json' || format === 'pretty') settings.format = format
    else
      problems.push({
        variable: 'NAUTILUS_LOG_FORMAT',
        value: format,
        allowed: 'json, pretty'
      })
  }

  const components = value(env.NAUTILUS_LOG_COMPONENTS)
  if (components !== undefined) {
    const names = components
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const known = names.filter((name): name is LogComponent =>
      (LOG_COMPONENTS as readonly string[]).includes(name)
    )
    const unknown = names.filter((name) => !known.includes(name as never))

    if (unknown.length)
      problems.push({
        variable: 'NAUTILUS_LOG_COMPONENTS',
        value: unknown.join(','),
        allowed: LOG_COMPONENTS.join(', ')
      })
    if (known.length) settings.components = known
  }

  problems.push(...readDebugEnv(env).problems)

  return { settings, problems }
}

/** The debug tiers, from the least to the most revealing. */
export const DEBUG_LEVELS = ['off', 'sensitive', 'secrets'] as const

/** `off`, or the tier of unredacted data the debug channel shows. */
export type DebugLevel = (typeof DEBUG_LEVELS)[number]

/** Where a debug event comes from. */
export const DEBUG_TOPICS = [
  'node',
  'wallet',
  'policy',
  'rpc',
  'order',
  'nonce',
  'store',
  'compute'
] as const

/**
 * What a debug event is about: `node` (ocean-node answers), `wallet` (the walt.id wallet),
 * `policy` (policy-server sessions and the verifier's records), `rpc` (the chain RPC),
 * `order` (orders and the previous-order lookup), `nonce` (nonce reads), `store` (remote
 * stores and storage pointers) and `compute` (compute jobs).
 */
export type DebugTopic = (typeof DEBUG_TOPICS)[number]

/** What `NAUTILUS_DEBUG` and `NAUTILUS_DEBUG_TOPICS` set. */
export interface DebugEnv {
  level?: DebugLevel
  topics?: DebugTopic[]
}

/**
 * The debug settings in `env`, and the values that were not understood. Only the exact
 * tier names count: `NAUTILUS_DEBUG=1`, `true` or `all` turn nothing on, so `secrets` is
 * reached only by naming it. `NAUTILUS_DEBUG_TOPICS` alone turns nothing on either.
 */
export function readDebugEnv(
  env: Record<string, string | undefined> | undefined
): {
  settings: DebugEnv
  problems: LoggingEnvProblem[]
} {
  const settings: DebugEnv = {}
  const problems: LoggingEnvProblem[] = []
  if (!env) return { settings, problems }

  const level = value(env.NAUTILUS_DEBUG)
  if (level !== undefined) {
    if ((DEBUG_LEVELS as readonly string[]).includes(level))
      settings.level = level as DebugLevel
    else
      problems.push({
        variable: 'NAUTILUS_DEBUG',
        value: level,
        allowed: DEBUG_LEVELS.join(', ')
      })
  }

  const topics = value(env.NAUTILUS_DEBUG_TOPICS)
  if (topics !== undefined) {
    const names = topics
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const known = names.filter((name): name is DebugTopic =>
      (DEBUG_TOPICS as readonly string[]).includes(name)
    )
    const unknown = names.filter((name) => !known.includes(name as never))

    if (unknown.length)
      problems.push({
        variable: 'NAUTILUS_DEBUG_TOPICS',
        value: unknown.join(','),
        allowed: DEBUG_TOPICS.join(', ')
      })
    if (known.length) settings.topics = known
  }

  return { settings, problems }
}

/** A set variable, trimmed and lower-cased; `undefined` when unset or blank. */
function value(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().toLowerCase()
  return trimmed ? trimmed : undefined
}
