/**
 * The default output: stderr in Node, the console elsewhere. Kept out of the package's
 * exports. The sensitive debug channel writes through `writeLine` too, with its own prefix.
 */
import type { LogFormat } from './env.js'
import type { LogLevelName } from './levels.js'
import type { LogEvent } from './types.js'

interface Stderr {
  write: (chunk: string) => unknown
  isTTY?: boolean
}

/** This process's stderr, or `undefined` without `process` (a browser bundle). */
export function stderr(): Stderr | undefined {
  try {
    const stream = (globalThis as { process?: { stderr?: Stderr } }).process
      ?.stderr
    return typeof stream?.write === 'function' ? stream : undefined
  } catch {
    return undefined
  }
}

/** `'pretty'` on a terminal, and without stderr (the browser console); `'json'` otherwise. */
export function defaultFormat(): LogFormat {
  const stream = stderr()
  return !stream || stream.isTTY ? 'pretty' : 'json'
}

/** One JSON object, without line breaks. */
export function formatJson(event: LogEvent): string {
  return JSON.stringify(event)
}

/**
 * `[nautilus] [publish] warn: <message> (publish.preflight.denies_all endpoint=https://…)`.
 */
export function formatPretty(event: LogEvent): string {
  const details = [
    event.event,
    ...pairs({
      opId: event.opId,
      did: event.did,
      txHash: event.txHash,
      durationMs: event.durationMs,
      ...event.fields
    })
  ]

  return `[nautilus] [${event.component}] ${event.level}: ${event.msg} (${details.join(' ')})`
}

function pairs(values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${text(value)}`)
}

function text(value: unknown): string {
  if (typeof value === 'string')
    return /^[^\s"=()]+$/.test(value) ? value : JSON.stringify(value)
  return JSON.stringify(value) ?? String(value)
}

/**
 * Writes one line to stderr, or, without it, to the console method of `level`
 * (`console.error`, `console.warn`, `console.info`, `console.debug`).
 */
export function writeLine(line: string, level: LogLevelName): void {
  const stream = stderr()
  if (stream) {
    stream.write(`${line}\n`)
    return
  }

  const method =
    level === 'error'
      ? 'error'
      : level === 'warn'
        ? 'warn'
        : level === 'info'
          ? 'info'
          : 'debug'
  globalThis.console?.[method]?.(line)
}
