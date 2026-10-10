import { format } from 'node:util'
import { afterAll, beforeEach } from 'vitest'
import {
  isLogEventName,
  LOG_EVENTS,
  type LogEventSpec
} from '../src/log/events.js'
import { resetLogging, setLogTap } from '../src/log/logger.js'
import { formatJson, formatPretty } from '../src/log/sinks.js'
import { catalogueCheck, findSecrets } from './secretScan.js'

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
 * - everything written to `process.stderr` and through `console.warn`, `console.error` and
 *   `console.log` while the suite runs, whoever wrote it (ocean.js, a stray `console.*`).
 *   The spies pass the text on unchanged; a test's own spy replaces them while it runs.
 */
const leaks: string[] = []

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
  if (call.once !== Boolean(spec.once))
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
  for (const found of findSecrets(text)) leaks.push(`${channel}: ${found}`)
}

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

  methods[method] = function (this: unknown, ...args: unknown[]) {
    try {
      scanText(channel, toText(args))
    } catch {
      // the text could not be read: nothing to scan
    }
    return original.apply(this, args)
  }
}

passThrough(process.stderr, 'write', 'process.stderr', ([chunk]) =>
  typeof chunk === 'string'
    ? chunk
    : Buffer.from(chunk as Uint8Array).toString()
)
for (const method of ['warn', 'error', 'log'])
  passThrough(console, method, `console.${method}`, (args) => format(...args))

/** Each test starts from the default logging configuration. */
beforeEach(() => {
  resetLogging()
  catalogueCheck.fields = true
})

afterAll(() => {
  if (leaks.length)
    throw new Error(
      `The suite's log output carried secrets, or events that do not match the catalogue:\n${[...new Set(leaks)].join('\n')}`
    )
})
