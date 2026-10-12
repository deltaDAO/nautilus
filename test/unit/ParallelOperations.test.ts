/**
 * Log lines of operations that run at the same time (PR 10c, the plan's L6).
 *
 * Before the operation context, two `getComputeResult()` calls for the same job printed the
 * same line with the same fields, and a line a lower layer printed on the process-wide
 * logger named no call at all: in a `Promise.all` nothing tied a line, or a thrown error, to
 * the call it came from. Now every event of a call carries the call's `opId` and
 * `operation`, and the error it throws carries the same `opId`.
 *
 * The node's answers are released in an order the test chooses, so the calls' lines
 * interleave: the second call's lines come before the first's.
 */
import { type NodeComputeJob, ProviderInstance } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Nautilus } from '../../src/index.js'
import type { LogEvent } from '../../src/log/index.js'
import { log } from '../../src/log/logger.js'
import { ASSET_DID, getAssetFixture } from '../fixtures/Asset.js'
import { captureLog } from '../helpers.js'

const ADDRESS = '0x0000000000000000000000000000000000000001'
const ENV_HASH = `0x${'9f86d081'.repeat(8)}`
const BARE_ID = '3a7bd3e2'.repeat(8)
const JOB_ID = `${ENV_HASH}-${BARE_ID}`

/** A job that has not finished, so `getComputeResult` logs `compute.result.not_ready`. */
const running = {
  owner: ADDRESS,
  jobId: BARE_ID,
  environment: `${ENV_HASH}-0x${'2c26b46b'.repeat(8)}`,
  dateCreated: '1760000000',
  dateFinished: null,
  status: 40,
  statusText: 'Running algorithm',
  results: [],
  expireTimestamp: 0
} as unknown as NodeComputeJob

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
function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parallel operations (10c)', () => {
  it('every line of a Promise.all names its call, and a thrown error carries the opId of its lines', async () => {
    const nautilus = await createNautilus()
    const first = deferred()
    const second = deferred()
    const third = deferred()
    const gates = [first, second, third]

    // Each status request waits for its gate. The third one logs on the process-wide
    // logger, as a lower layer does, and then fails.
    let calls = 0
    vi.spyOn(ProviderInstance, 'computeStatus').mockImplementation(async () => {
      const gate = gates[calls++]
      await gate.promise
      if (gate === third) {
        log.emit('node.status.unreadable', 'the node answered nonsense', {
          nodeUri: 'https://ocean-node.example.com'
        })
        throw new Error('the node answered nonsense')
      }
      return [running]
    })
    const captured = captureLog({ level: 'trace' })

    const results = Promise.allSettled([
      nautilus.getComputeResult({ jobId: JOB_ID }),
      nautilus.getComputeResult({ jobId: JOB_ID }),
      nautilus.getComputeStatus({ jobId: JOB_ID }),
      nautilus.setAssetLifecycleState(getAssetFixture(), 0)
    ])
    await tick()
    second.release()
    await tick()
    third.release()
    await tick()
    first.release()
    const [a, b, status, lifecycle] = await results

    expect(a.status).to.equal('fulfilled')
    expect(b.status).to.equal('fulfilled')
    expect(lifecycle.status).to.equal('fulfilled')
    expect(status.status).to.equal('rejected')

    // Every line belongs to exactly one call: an opId and the operation's name.
    const events = captured.events
    expect(events.length).to.be.greaterThan(0)
    for (const event of events) {
      expect(event.opId, event.event).to.match(/^[0-9a-f]{12}$/)
      expect(event.operation, event.event).to.be.a('string')
    }

    // The two identical lines now name different calls: the second call's first.
    const notReady = captured.named('compute.result.not_ready')
    expect(notReady).to.have.length(2)
    const [secondLine, firstLine] = notReady
    expect(secondLine.opId).not.to.equal(firstLine.opId)
    expect(secondLine.operation).to.equal('getComputeResult')
    expect(firstLine.operation).to.equal('getComputeResult')

    // Each call's lines share its opId, and no other call's line does.
    const byOp = new Map<string, LogEvent[]>()
    for (const event of events) {
      const list = byOp.get(event.opId as string) ?? []
      list.push(event)
      byOp.set(event.opId as string, list)
    }
    expect(byOp.size).to.equal(4)
    for (const lines of byOp.values())
      expect(new Set(lines.map((line) => line.operation)).size).to.equal(1)

    const [unchanged] = captured.named('lifecycle.state.unchanged')
    expect(unchanged.operation).to.equal('setAssetLifecycleState')
    expect(unchanged.did).to.equal(ASSET_DID)

    // The line the lower layer printed names the call that failed, and so does the error.
    const [unreadable] = captured.named('node.status.unreadable')
    expect(unreadable.operation).to.equal('getComputeStatus')
    const error = (status as PromiseRejectedResult).reason as {
      opId?: string
    }
    expect(error.opId).to.equal(unreadable.opId)
    expect(
      byOp.get(unreadable.opId as string)?.map((line) => line.operation)
    ).to.satisfy((names: string[]) =>
      names.every((name) => name === 'getComputeStatus')
    )
  })
})
