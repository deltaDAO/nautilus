/**
 * `createKeyedLock()` runs tasks with one key one after the other, and tasks with
 * different keys freely; a task that throws still lets the next one run. `Nautilus` uses one
 * per instance to serialise paid compute jobs per (chain, payer, token, payee).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKeyedLock } from '../../src/utils/keyedLock.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A task that logs its start and end, and takes `ms` of (fake) time. */
function task(log: string[], name: string, ms: number, fail = false) {
  return async () => {
    log.push(`${name}:start`)
    await new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
    log.push(`${name}:end`)
    if (fail) throw new Error(`${name} failed`)
    return name
  }
}

describe('createKeyedLock()', () => {
  it('runs tasks with one key one after the other, in order', async () => {
    const lock = createKeyedLock()
    const log: string[] = []

    const all = Promise.all([
      lock('a', task(log, 'first', 2000)),
      lock('a', task(log, 'second', 1000))
    ])
    await vi.runAllTimersAsync()

    expect(await all).to.deep.equal(['first', 'second'])
    expect(log).to.deep.equal([
      'first:start',
      'first:end',
      'second:start',
      'second:end'
    ])
  })

  it('runs tasks with different keys concurrently', async () => {
    const lock = createKeyedLock()
    const log: string[] = []

    const all = Promise.all([
      lock('a', task(log, 'a', 2000)),
      lock('b', task(log, 'b', 1000))
    ])
    await vi.runAllTimersAsync()
    await all

    expect(log).to.deep.equal(['a:start', 'b:start', 'b:end', 'a:end'])
  })

  it('lets the next task run after one throws, and passes the error on', async () => {
    const lock = createKeyedLock()
    const log: string[] = []

    const first = lock('a', task(log, 'first', 1000, true)).catch(
      (error: Error) => error.message
    )
    const second = lock('a', task(log, 'second', 1000))
    await vi.runAllTimersAsync()

    expect(await first).to.equal('first failed')
    expect(await second).to.equal('second')
    expect(log).to.deep.equal([
      'first:start',
      'first:end',
      'second:start',
      'second:end'
    ])
  })

  it('keeps separate locks apart', async () => {
    const log: string[] = []

    const all = Promise.all([
      createKeyedLock()('a', task(log, 'one', 2000)),
      createKeyedLock()('a', task(log, 'two', 1000))
    ])
    await vi.runAllTimersAsync()
    await all

    expect(log).to.deep.equal(['one:start', 'two:start', 'two:end', 'one:end'])
  })
})
