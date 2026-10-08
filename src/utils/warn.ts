/**
 * One-time warnings for things a user must see whatever the log level.
 *
 * ocean.js's `LoggerInstance` only prints errors by default, so a security-relevant warning
 * sent through it would stay invisible. These go to `console.warn`, once per process and
 * key, so a loop does not flood the output. Kept out of the package's exports.
 */
const warned = new Set<string>()

export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return

  warned.add(key)
  console.warn(`[nautilus] ${message}`)
}

/** Forgets which warnings were shown. Only for tests. */
export function resetWarnings(): void {
  warned.clear()
}
