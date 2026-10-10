import { expect } from 'vitest'
import {
  configureLogging,
  type LogEvent,
  type LogEventName,
  type LoggingLevel
} from '../src/log/index.js'

/** Asserts an async call rejects, optionally matching the message. */
export async function expectThrowsAsync(
  method: () => Promise<unknown>,
  errorMessage?: string | RegExp
): Promise<void> {
  let error: Error | undefined

  try {
    await method()
  } catch (thrown) {
    error = thrown as Error
  }

  expect(error, 'expected the call to reject, but it resolved').to.be.an(
    'Error'
  )

  if (errorMessage === undefined) return

  if (errorMessage instanceof RegExp)
    expect(error?.message).to.match(errorMessage)
  else expect(error?.message).to.equal(errorMessage)
}

/** The events nautilus logged since `captureLog()`, through a sink. */
export interface CapturedLog {
  events: LogEvent[]
  /** The events named `name`. */
  named: (name: LogEventName) => LogEvent[]
}

/**
 * Routes the process-wide logger to a sink that records each event it prints, at the
 * level in force (the default, `warn`, unless `level`). `test/setup.ts` resets logging
 * before each test.
 */
export function captureLog(
  options: { level?: LoggingLevel } = {}
): CapturedLog {
  const events: LogEvent[] = []

  configureLogging({ ...options, sink: (event) => events.push(event) })

  return {
    events,
    named: (name) => events.filter((event) => event.event === name)
  }
}
