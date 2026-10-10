import { afterAll, beforeEach } from 'vitest'
import { isLogEventName } from '../src/log/events.js'
import { resetLogging, setLogTap } from '../src/log/logger.js'
import { formatJson, formatPretty } from '../src/log/sinks.js'
import { findSecrets } from './secretScan.js'

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
 * The secret scan of the logger, over the whole suite: every event any test makes nautilus
 * build, at every level, printed or not, in both output formats. A leak fails the test
 * file, naming the event and the kind of secret but not the secret. So does an event name
 * that is not in the catalogue.
 */
const leaks: string[] = []

setLogTap((event) => {
  if (!isLogEventName(event.event))
    leaks.push(`'${event.event}' is not in the catalogue`)

  const json = formatJson(event)
  JSON.parse(json)
  for (const line of [json, formatPretty(event)])
    for (const found of findSecrets(line))
      leaks.push(`${event.event}: ${found}`)
})

/** Each test starts from the default logging configuration. */
beforeEach(() => {
  resetLogging()
})

afterAll(() => {
  if (leaks.length)
    throw new Error(
      `The logger's output carried secrets or uncatalogued events:\n${[...new Set(leaks)].join('\n')}`
    )
})
