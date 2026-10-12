/**
 * Runs tasks that share a key one after the other, and tasks with different keys freely.
 *
 * Each key keeps a promise chain: a task starts once every earlier task with its key has
 * settled, whether it resolved or threw. In-process only: it orders the tasks of whoever
 * holds the lock, not other processes or other holders.
 *
 * `wait`, when given, bounds how long a task waits for the earlier ones: past `ms`, the
 * call throws `error()` without running the task, and the tasks after it still wait for
 * the earlier ones, so no two tasks with one key ever run at once.
 */
export type KeyedLock = <T>(
  key: string,
  task: () => Promise<T>,
  wait?: LockWait
) => Promise<T>

export interface LockWait {
  ms: number
  error: () => Error
}

export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<void>>()

  return async <T>(
    key: string,
    task: () => Promise<T>,
    wait?: LockWait
  ): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve()

    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    tails.set(key, tail)

    try {
      await (wait ? atMost(previous, wait) : previous)
      return await task()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}

/** `promise`, or `wait.error()` once `wait.ms` have passed first. */
export function atMost<T>(promise: Promise<T>, wait: LockWait): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(wait.error()), wait.ms)
    })
  ]).finally(() => clearTimeout(timer))
}
