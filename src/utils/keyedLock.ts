/**
 * Runs tasks that share a key one after the other, and tasks with different keys freely.
 *
 * Each key keeps a promise chain: a task starts once every earlier task with its key has
 * settled, whether it resolved or threw. In-process only: it orders the tasks of whoever
 * holds the lock, not other processes or other holders.
 */
export type KeyedLock = <T>(key: string, task: () => Promise<T>) => Promise<T>

export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<void>>()

  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve()

    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    tails.set(key, tail)

    try {
      await previous
      return await task()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}
