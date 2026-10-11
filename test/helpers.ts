import { expect } from 'vitest'
import type { LogEvent, LogEventName, LoggingLevel } from '../src/log/index.js'
import { configureLogging } from '../src/log/logger.js'

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

/**
 * The processor time `run` takes, in ms: user and system time of this test process (a
 * worker of its own, one test at a time). Timing tests bound this rather than the time on
 * the clock, which grows whenever other processes, the suite's other workers among them,
 * hold the processor.
 */
export async function cpuTime(run: () => unknown): Promise<number> {
  const started = process.cpuUsage()
  await run()
  const { user, system } = process.cpuUsage(started)
  return (user + system) / 1_000
}

/** The code points `stripControlCharacters` deletes: invisible to a reader. */
export const INVISIBLE_CODES = [
  [0x00, 0x08],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
].flatMap(([from, to]) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)
)
