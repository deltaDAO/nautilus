/**
 * The operation context (`src/log/context.ts`, PR 10c): the `opId` of each public call, how
 * it reaches the events with and without `AsyncLocalStorage`, `error.opId`, the operation
 * events with `durationMs`, and where the `opId` shows in the output.
 *
 * `ParallelOperations.test.ts` holds the regression test with real calls in a
 * `Promise.all`; this file covers the mechanism.
 */
import { type NodeComputeJob, ProviderInstance } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Nautilus } from '../../src/index.js'
import {
  currentOperation,
  runOperation,
  useAsyncContext
} from '../../src/log/context.js'
import {
  type DebugEvent,
  debug,
  formatDebugLine,
  setDebug
} from '../../src/log/debug.js'
import { isLogEventName, LOG_EVENTS } from '../../src/log/events.js'
import type { LogEvent } from '../../src/log/index.js'
import {
  configureLogging,
  createLogger,
  log,
  setLogTap
} from '../../src/log/logger.js'
import { formatJson, formatPretty } from '../../src/log/sinks.js'
import { getAssetFixture } from '../fixtures/Asset.js'
import { captureLog, cpuTime } from '../helpers.js'
import { FAKE, findSecrets } from '../secretScan.js'

const ADDRESS = '0x0000000000000000000000000000000000000001'
const JOB_ID = `0x${'9f86d081'.repeat(8)}-${'3a7bd3e2'.repeat(8)}`
const OP_ID = /^[0-9a-f]{8}$/

function createNautilus() {
  return Nautilus.create(
    Wallet.createRandom().connect({
      getNetwork: async () => ({ chainId: 32456n })
    } as never),
    {
      config: {
        oceanNodeUri: 'https://ocean-node.example.com',
        nftFactoryAddress: ADDRESS,
        fixedRateExchangeAddress: ADDRESS,
        dispenserAddress: ADDRESS
      }
    }
  )
}

/** A promise and the function that settles it. */
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  useAsyncContext(true)
  vi.restoreAllMocks()
})

describe('an operation', () => {
  it('carries one opId through timers and awaits, on the process-wide logger too', async () => {
    const captured = captureLog({ level: 'trace' })

    const result = await runOperation(log, 'access', async () => {
      log.emit('access.order.sending', 'before the timer', {})
      await sleep(1)
      await Promise.resolve()
      setTimeout(() =>
        log.emit('access.order.sending', 'in a timer callback', {})
      )
      await sleep(5)
      return currentOperation()?.opId
    })

    const opIds = new Set(captured.events.map((event) => event.opId))
    expect(opIds.size).to.equal(1)
    expect(result).to.match(OP_ID)
    expect([...opIds][0]).to.equal(result)
    expect(captured.events.map((event) => event.event)).to.deep.equal([
      'access.operation.started',
      'access.order.sending',
      'access.order.sending',
      'access.operation.finished'
    ])
    for (const event of captured.events)
      expect(event.operation).to.equal('access')
  })

  it('gives every call its own opId, and none outside a call', async () => {
    const captured = captureLog({ level: 'trace' })

    log.emit('access.order.sending', 'outside', {})
    // Three calls, released in the order 2nd, 3rd, 1st.
    const gates = [gate(), gate(), gate()]
    const calls = Promise.all(
      gates.map((open, index) =>
        runOperation(log, 'compute', async () => {
          await open.promise
          log.emit('access.order.sending', `call ${index + 1}`, {})
        })
      )
    )
    for (const index of [1, 2, 0]) {
      gates[index].release()
      await sleep(0)
    }
    await calls

    expect(captured.events[0].opId).to.equal(undefined)
    expect(captured.events[0].operation).to.equal(undefined)
    const started = captured.named('compute.operation.started')
    expect(new Set(started.map((event) => event.opId)).size).to.equal(3)
    // Each line's opId is the one of the call that printed it.
    const lines = captured.named('access.order.sending').slice(1)
    expect(lines.map((event) => event.msg)).to.deep.equal([
      'call 2',
      'call 3',
      'call 1'
    ])
    expect(lines.map((event) => event.opId)).to.deep.equal([
      started[1].opId,
      started[2].opId,
      started[0].opId
    ])
  })

  it('ends in finished or failed with durationMs, at the catalogue levels', async () => {
    const captured = captureLog({ level: 'trace' })

    await runOperation(log, 'publish', async () => sleep(15))
    await runOperation(log, 'getComputeStatus', async () => {
      throw new Error('no')
    }).catch(() => undefined)

    const [finished] = captured.named('publish.operation.finished')
    expect(finished.level).to.equal('info')
    expect(finished.durationMs).to.be.a('number')
    expect(finished.durationMs).to.be.at.least(10)
    expect(finished.fields).to.deep.equal({})
    expect(captured.named('publish.operation.started')[0].level).to.equal(
      'debug'
    )

    const [failed] = captured.named('compute.query.failed')
    expect(failed.level).to.equal('debug')
    expect(failed.durationMs).to.be.a('number')
    expect(failed.fields.error).to.match(/no/)
  })

  it('prints nothing by default: started is debug, finished and failed info or debug', async () => {
    const captured = captureLog()

    await runOperation(log, 'edit', async () => undefined)
    await runOperation(log, 'waitForIndexer', async () => {
      throw new Error('no')
    }).catch(() => undefined)

    expect(captured.events).to.deep.equal([])
  })

  it('sets error.opId, not enumerable, so the error compares and serialises as before', async () => {
    const captured = captureLog({ level: 'trace' })
    const thrown = new Error('refused')

    const caught = await runOperation(log, 'compute', async () => {
      throw thrown
    }).catch((error) => error)

    expect(caught).to.equal(thrown)
    expect(caught.opId).to.equal(captured.events[0].opId)
    expect(Object.keys(caught)).to.deep.equal([])
    expect(JSON.stringify(caught)).to.equal('{}')
    expect(caught).to.deep.equal(new Error('refused'))
  })

  it('keeps an opId the error already has, and rethrows what it cannot tag unchanged', async () => {
    const tagged = Object.assign(new Error('earlier'), { opId: 'deadbeef' })
    expect(
      await runOperation(log, 'access', async () => {
        throw tagged
      }).catch((error) => error.opId)
    ).to.equal('deadbeef')

    const frozen = Object.freeze(new Error('frozen'))
    expect(
      await runOperation(log, 'access', async () => {
        throw frozen
      }).catch((error) => error)
    ).to.equal(frozen)

    for (const value of ['text', 42, null, undefined])
      expect(
        await runOperation(log, 'access', async () => {
          throw value
        }).then(
          () => 'resolved',
          (error) => error
        )
      ).to.equal(value)
  })

  it('joins the operation it is called from: one opId, no events of its own', async () => {
    const captured = captureLog({ level: 'trace' })

    const [outer, inner] = await runOperation(log, 'compute', async () => {
      const opId = currentOperation()?.opId
      const nested = await runOperation(log, 'waitForIndexer', async () => {
        log.emit('access.order.sending', 'nested', {})
        return currentOperation()?.opId
      })
      return [opId, nested]
    })

    expect(inner).to.equal(outer)
    expect(captured.events.map((event) => event.event)).to.deep.equal([
      'compute.operation.started',
      'access.order.sending',
      'compute.operation.finished'
    ])
    expect(captured.named('access.order.sending')[0].operation).to.equal(
      'compute'
    )
  })

  it('redacts the error of failed, like every error field', async () => {
    const captured = captureLog({ level: 'trace' })

    await runOperation(log, 'access', async () => {
      throw new Error(`could not reach ${FAKE.rpcUrl}`)
    }).catch(() => undefined)

    const [failed] = captured.named('access.operation.failed')
    expect(String(failed.fields.error)).to.match(/rpc\.example\.org/)
    for (const line of [formatJson(failed), formatPretty(failed)])
      expect(findSecrets(line)).to.deep.equal([])
  })

  it('shows opId and operation in both formats', async () => {
    const captured = captureLog({ level: 'trace' })

    await runOperation(log, 'access', async () => {
      log.emit('access.order.sending', 'sending', { did: 'did:ope:1' })
    })

    const [event] = captured.named('access.order.sending')
    const json = JSON.parse(formatJson(event)) as LogEvent
    expect(json.opId).to.match(OP_ID)
    expect(json.operation).to.equal('access')
    expect(formatPretty(event)).to.contain(
      `(access.order.sending opId=${event.opId} operation=access did=did:ope:1`
    )
  })

  it('reaches an instance logger and the sensitive debug channel', async () => {
    const events: LogEvent[] = []
    const own = createLogger({ level: 'trace', sink: (e) => events.push(e) })
    const debugged: DebugEvent[] = []
    setDebug({ level: 'sensitive', sink: (event) => debugged.push(event) })

    const opId = await runOperation(own, 'access', async () => {
      debug('sensitive', 'node', 'node answer', { body: 'raw' })
      return currentOperation()?.opId
    })
    debug('sensitive', 'node', 'outside', {})

    expect(events.map((event) => event.opId)).to.deep.equal([opId, opId])
    expect(debugged[0].opId).to.equal(opId)
    expect(debugged[0].operation).to.equal('access')
    expect(formatDebugLine(debugged[0])).to.match(
      new RegExp(
        `^\\[nautilus:debug:sensitive\\] \\[node\\] \\S+ \\[access ${opId}\\] node answer `
      )
    )
    expect(formatDebugLine(debugged[1])).not.to.contain('[access')
    expect(debugged[1].opId).to.equal(undefined)
  })
})

describe('without AsyncLocalStorage (a browser)', () => {
  it('stamps what the operation hands its bound logger, and leaves the rest unstamped, never wrong', async () => {
    useAsyncContext(false)
    const captured = captureLog({ level: 'trace' })

    // Two calls, the second released first.
    const gates = [gate(), gate()]
    const calls = Promise.all(
      gates.map((open, index) =>
        runOperation(log, 'compute', async (bound) => {
          await open.promise
          bound.emit('access.order.sending', `bound ${index + 1}`, {})
          log.emit('access.order.sending', `ambient ${index + 1}`, {})
          return currentOperation()
        })
      )
    )
    gates[1].release()
    await sleep(0)
    gates[0].release()
    const results = await calls

    expect(results).to.deep.equal([undefined, undefined])
    const started = captured.named('compute.operation.started')
    const lines = captured.named('access.order.sending')
    const byMessage = Object.fromEntries(
      lines.map((event) => [event.msg, event.opId])
    )
    expect(lines.map((event) => event.msg)).to.deep.equal([
      'bound 2',
      'ambient 2',
      'bound 1',
      'ambient 1'
    ])
    expect(byMessage['bound 1']).to.equal(started[0].opId)
    expect(byMessage['bound 2']).to.equal(started[1].opId)
    expect(byMessage['ambient 1']).to.equal(undefined)
    expect(byMessage['ambient 2']).to.equal(undefined)
    for (const event of captured.named('compute.operation.finished'))
      expect(event.opId).to.match(OP_ID)
  })

  it('still tags the error, and Nautilus hands its bound logger down', async () => {
    useAsyncContext(false)
    const nautilus = await createNautilus()
    vi.spyOn(ProviderInstance, 'computeStatus').mockImplementation(async () => {
      await sleep(1)
      return [
        {
          jobId: JOB_ID.split('-')[1],
          environment: `${JOB_ID.split('-')[0]}-0x1`,
          dateFinished: null,
          status: 40,
          statusText: 'Running algorithm',
          results: []
        } as unknown as NodeComputeJob
      ]
    })
    const captured = captureLog({ level: 'trace' })

    await Promise.all([
      nautilus.getComputeResult({ jobId: JOB_ID }),
      nautilus.setAssetLifecycleState(getAssetFixture(), 0)
    ])
    const thrown = await nautilus
      .getComputeStatus({ jobId: 'not-qualified' })
      .catch((error) => error)

    for (const name of [
      'compute.result.not_ready',
      'lifecycle.state.unchanged'
    ] as const) {
      const [event] = captured.named(name)
      expect(event.opId, name).to.match(OP_ID)
    }
    expect(captured.named('compute.result.not_ready')[0].opId).to.equal(
      captured.named('compute.query.started')[0].opId
    )
    expect(thrown.opId).to.equal(captured.named('compute.query.failed')[0].opId)
  })
})

describe('the catalogue', () => {
  it('has the three events of every kind of operation', () => {
    for (const kind of [
      'publish.operation',
      'edit.operation',
      'lifecycle.operation',
      'access.operation',
      'compute.operation',
      'compute.query',
      'node.operation'
    ])
      for (const end of ['started', 'finished', 'failed'])
        expect(isLogEventName(`${kind}.${end}`), `${kind}.${end}`).to.equal(
          true
        )
    expect(LOG_EVENTS['compute.query.finished'].level).to.equal('debug')
    expect(LOG_EVENTS['access.operation.finished'].level).to.equal('info')
  })
})

describe('cost', () => {
  it('adds next to nothing to events at a level that is off', async () => {
    // The suite's tap builds every event; take it out to measure the logger itself.
    const tap = setLogTap(undefined)
    try {
      configureLogging({ level: 'warn' })
      let evaluated = 0
      const fields = () => {
        evaluated++
        return {}
      }

      const time = await cpuTime(() =>
        runOperation(log, 'compute', async () => {
          for (let i = 0; i < 200_000; i++)
            log.emit('access.order.sending', 'off', fields)
        })
      )

      expect(evaluated).to.equal(0)
      // The context is read only for an event that is built; the bound catches any
      // per-event work added at a level that is off.
      expect(time).to.be.lessThan(1_500)
    } finally {
      setLogTap(tap)
    }
  })
})
