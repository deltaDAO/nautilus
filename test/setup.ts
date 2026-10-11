import { format } from 'node:util'
import { afterAll, beforeEach } from 'vitest'
import {
  type DebugLevel,
  formatDebugLine,
  getDebugLevel,
  resetDebug,
  setDebug,
  setDebugTap
} from '../src/log/debug.js'
import {
  isLogEventName,
  LOG_EVENTS,
  type LogEventSpec
} from '../src/log/events.js'
import { resetLogging, setLogTap } from '../src/log/logger.js'
import { formatJson, formatPretty } from '../src/log/sinks.js'
import { catalogueCheck, findCredentials, findSecrets } from './secretScan.js'

/**
 * Loads `.env` for the integration suite, which needs PRIVATE_KEY_TESTS_1/2, NODE_URL
 * and optionally RPC. Uses Node's built-in env-file loader rather than `dotenv`.
 *
 * Missing or unreadable `.env` is not an error: the unit suite needs none of these, and
 * the integration suite already skips itself when the variables are absent.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // no .env present — fine
}

/**
 * The secret scan over the whole suite, failing the test file on a leak and naming the
 * event (or the stream) and the kind of secret, but not the secret:
 *
 * - every event any test makes nautilus build, at every level, printed or not, in both
 *   output formats. An event that is not in the catalogue, a field the catalogue does not
 *   list for it, or a `once` that does not match the catalogue's flag fails too;
 * - everything written to `process.stderr`, `process.stdout` and through `console.warn`,
 *   `console.error`, `console.log`, `console.info` and `console.debug` while the suite runs,
 *   whoever wrote it (ocean.js, a stray `console.*` or `write`).
 *   The spies pass the text on unchanged; a test's own spy replaces them while it runs.
 *
 * And the default safety of the sensitive debug channel (`src/log/debug.ts`): each test
 * starts with it off, whatever `NAUTILUS_DEBUG` the suite runs with, and
 *
 * - a debug line or the debug banner on stderr or the console while it is off fails the
 *   suite, and so does a debug event delivered while it is off;
 * - every debug event a test turns on is one line, and a `sensitive` one holds no
 *   long-lived credential of the fixtures (RPC URL token, S3 secret).
 *
 * `NAUTILUS_TEST_DEBUG=sensitive` (or `secrets`) runs the whole suite with the channel on,
 * into a sink that keeps nothing: every test must pass unchanged (errors and return values
 * do not depend on it), and the scan above still applies to everything else.
 */
const leaks: string[] = []

const suiteDebug = process.env.NAUTILUS_TEST_DEBUG?.trim().toLowerCase() as
  | DebugLevel
  | undefined

setDebugTap((event) => {
  if (getDebugLevel() === 'off')
    leaks.push(`debug event '${event.message}' delivered while debug is off`)

  const line = formatDebugLine(event)
  if (/[\n\r\u2028\u2029]/.test(line))
    leaks.push(`debug event '${event.message}' is not one line`)
  if (event.tier === 'sensitive')
    for (const found of findCredentials(JSON.stringify(event)))
      leaks.push(`sensitive debug event '${event.message}': ${found}`)
})

/** A debug line or banner written while the debug channel is off. */
function scanDebugOutput(channel: string, text: string): void {
  if (getDebugLevel() !== 'off') return
  if (/\[nautilus:debug:|debug logging is ON/.test(text))
    leaks.push(`${channel}: debug output while debug is off`)
}

setLogTap((event, _printed, call) => {
  if (!isLogEventName(event.event)) {
    leaks.push(`'${event.event}' is not in the catalogue`)
    return
  }

  const spec: LogEventSpec = LOG_EVENTS[event.event]
  const allowed = new Set([...(spec.fields ?? []), 'fieldsError'])
  if (catalogueCheck.fields)
    for (const key of Object.keys(event.fields))
      if (!allowed.has(key))
        leaks.push(`${event.event}: field '${key}' is not in the catalogue`)
  if (catalogueCheck.once && call.once !== Boolean(spec.once))
    leaks.push(
      `${event.event}: emitted ${call.once ? 'with' : 'without'} once, but the catalogue says once: ${Boolean(spec.once)}`
    )

  const json = formatJson(event)
  JSON.parse(json)
  for (const line of [json, formatPretty(event)])
    for (const found of findSecrets(line))
      leaks.push(`${event.event}: ${found}`)
})

function scanText(channel: string, text: string): void {
  scanDebugOutput(channel, text)
  for (const found of findSecrets(text)) leaks.push(`${channel}: ${found}`)
}

/** Puts back what `passThrough` replaced, when the file's tests are done. */
const restores: (() => void)[] = []

/** Replaces `target[method]` with a spy that scans its text and calls the original. */
function passThrough(
  target: object,
  method: string,
  channel: string,
  toText: (args: unknown[]) => string
): void {
  const methods = target as Record<string, (...args: unknown[]) => unknown>
  const original = methods[method]
  if (typeof original !== 'function') return

  restores.push(() => {
    methods[method] = original
  })
  methods[method] = function (this: unknown, ...args: unknown[]) {
    try {
      scanText(channel, toText(args))
    } catch {
      // the text could not be read: nothing to scan
    }
    return original.apply(this, args)
  }
}

for (const stream of ['stderr', 'stdout'] as const)
  passThrough(process[stream], 'write', `process.${stream}`, ([chunk]) =>
    typeof chunk === 'string'
      ? chunk
      : Buffer.from(chunk as Uint8Array).toString()
  )
for (const method of ['warn', 'error', 'log', 'info', 'debug'])
  passThrough(console, method, `console.${method}`, (args) => format(...args))

/**
 * Each test starts from the default logging configuration, without the `NAUTILUS_LOG_*`
 * variables of the developer's shell, and with the debug channel off (or, under
 * `NAUTILUS_TEST_DEBUG`, on into a sink that keeps nothing).
 */
beforeEach(() => {
  resetLogging({})
  resetDebug({})
  if (suiteDebug === 'sensitive' || suiteDebug === 'secrets')
    setDebug({ level: suiteDebug, sink: () => undefined })
  catalogueCheck.fields = true
  catalogueCheck.once = true
})

afterAll(() => {
  for (const restore of restores.splice(0)) restore()
  setLogTap(undefined)
  setDebugTap(undefined)
  if (leaks.length)
    throw new Error(
      `The suite's log output carried secrets, or events that do not match the catalogue:\n${[...new Set(leaks)].join('\n')}`
    )
})
