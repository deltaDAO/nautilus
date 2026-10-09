/**
 * Compute job ids, results and logs against ocean-node's job commands.
 *
 * ocean-node names a job `<environmentHash>-<jobId>`. Its status command filters on a job
 * only when given that form; given a bare id it lists every job of the consumer, and
 * nautilus used to take the first of those, so an unknown id returned another job. A job
 * has finished once the node sets its `dateFinished`, whatever its status: failed jobs end
 * below `70`. On a finished job the results are `imageLog`, `configurationLog`,
 * `algorithmLog`, `output`, and the streamable logs are gone.
 *
 * `ProviderInstance` is stubbed, so these run the real `OceanNodeClient` and `Nautilus`
 * code down to the ocean.js call. Over HTTP the streamable logs are requested by nautilus
 * itself, so `fetch` is stubbed for them.
 */

import {
  type ComputeResult,
  LoggerInstance,
  type NodeComputeJob,
  ProviderInstance
} from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertQualifiedJobId,
  findResultIndex,
  withQualifiedJobId
} from '../../src/compute/jobs.js'
import { Nautilus } from '../../src/index.js'
import { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import { expectThrowsAsync } from '../helpers.js'

const ADDRESS = '0x0000000000000000000000000000000000000001'
/** As ocean-node builds them: `0x` and a sha256 for the engine, a sha256 for the job. */
const ENV_HASH = `0x${'9f86d081'.repeat(8)}`
const ENVIRONMENT = `${ENV_HASH}-0x${'2c26b46b'.repeat(8)}`
const BARE_ID = '3a7bd3e2'.repeat(8)
const JOB_ID = `${ENV_HASH}-${BARE_ID}`
const OTHER_BARE_ID = 'b5bb9d80'.repeat(8)
const FINISHED_AT = '1760000000.123'

/**
 * The results ocean-node 4.2 lists for a finished job whose results stay on the node.
 * ocean.js's `ComputeResultType` has neither `imageLog` nor `configurationLog`.
 */
const RESULTS = [
  { filename: 'image.log', filesize: 10, type: 'imageLog', index: 0 },
  {
    filename: 'configuration.log',
    filesize: 10,
    type: 'configurationLog',
    index: 1
  },
  { filename: 'algorithm.log', filesize: 10, type: 'algorithmLog', index: 2 },
  { filename: 'outputs.tar', filesize: 10, type: 'output', index: 3 }
] as unknown as ComputeResult[]

/**
 * A finished job as the status command reports it: bare id, environment beside it.
 * `running()` gives one that has not finished.
 */
function statusJob(overrides: Partial<NodeComputeJob> = {}): NodeComputeJob {
  return {
    owner: ADDRESS,
    jobId: BARE_ID,
    environment: ENVIRONMENT,
    dateCreated: '1760000000',
    dateFinished: FINISHED_AT,
    status: 70,
    statusText: 'Job finished',
    results: RESULTS,
    expireTimestamp: 0,
    ...overrides
  } as NodeComputeJob
}

/** A job that has not finished: the node has not set its `dateFinished`. */
const running = (overrides: Partial<NodeComputeJob> = {}) =>
  statusJob({
    status: 40,
    statusText: 'Running algorithm',
    dateFinished: null as unknown as string,
    results: [],
    ...overrides
  })

const stream = (text: string) =>
  (async function* () {
    yield new TextEncoder().encode(text)
  })()

async function read(source: AsyncIterable<Uint8Array>): Promise<string> {
  let text = ''
  for await (const chunk of source) text += new TextDecoder().decode(chunk)
  return text
}

/** A peer id: the libp2p transport, where the logs still go through ocean.js. */
const PEER = '16Uiu2HAmPeerIdOnly'

function client(nodeUri = 'https://node.test.invalid'): OceanNodeClient {
  return new OceanNodeClient({
    nodeUri,
    chainId: 32456,
    auth: Wallet.createRandom()
  })
}

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

/** The node's status answer: `jobs`, whatever id it was asked for. */
function statusAnswers(...answers: NodeComputeJob[][]) {
  const spy = vi.spyOn(ProviderInstance, 'computeStatus')
  for (const jobs of answers) spy.mockResolvedValueOnce(jobs)
  return spy
}

/** The job id each status call asked for. */
const askedFor = (spy: ReturnType<typeof statusAnswers>) =>
  spy.mock.calls.map((call) => call[2])

/**
 * Answers the streamable-logs request with `status` and `body`; any other request fails.
 * The signer's nonce is stubbed too.
 */
function logsAnswer(status: number, body: string) {
  vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(0)
  const fetch = vi.fn(async (url: string | URL | Request) => {
    if (!String(url).includes('/api/services/computeStreamableLogs'))
      throw new Error(`unexpected request ${String(url)}`)

    return new Response(body, { status })
  })
  vi.stubGlobal('fetch', fetch)

  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compute job ids', () => {
  it('qualifies a bare id from its environment, and leaves a qualified one', () => {
    const qualified = (job: { jobId: string; environment?: string }) =>
      withQualifiedJobId(job).jobId

    expect(qualified({ jobId: BARE_ID, environment: ENVIRONMENT })).to.equal(
      JOB_ID
    )
    expect(qualified({ jobId: JOB_ID, environment: ENVIRONMENT })).to.equal(
      JOB_ID
    )
    expect(qualified({ jobId: BARE_ID })).to.equal(BARE_ID)
  })

  it('accepts only the id the node builds', () => {
    expect(() => assertQualifiedJobId(JOB_ID)).not.to.throw()

    for (const jobId of [
      BARE_ID,
      `-${BARE_ID}`,
      `${ENV_HASH}-`,
      `${ENV_HASH.slice(2)}-${BARE_ID}`,
      `${ENV_HASH}-${BARE_ID.slice(1)}`,
      `${ENV_HASH}-${BARE_ID}0`,
      `${ENV_HASH}-${BARE_ID.toUpperCase()}`,
      `${ENV_HASH}-${BARE_ID}\n`,
      `${ENV_HASH}-${BARE_ID}-${BARE_ID}`,
      'h-x'
    ])
      expect(() => assertQualifiedJobId(jobId)).to.throw(
        /not in the form <environmentHash>-<jobId>/
      )
  })

  it('does not echo a malformed id, only its length', () => {
    const jobId = `${JOB_ID}&index=3`

    const error = (() => {
      try {
        assertQualifiedJobId(jobId)
      } catch (caught) {
        return caught as Error
      }
    })()

    expect(error?.message).to.contain(
      `Malformed job id (${jobId.length} characters)`
    )
    expect(error?.message).not.to.contain(BARE_ID)
    expect(error?.message).not.to.contain('index=3')
  })

  it('finds a result by type, by the index the node gave it', () => {
    expect(findResultIndex({ results: RESULTS }, 'output')).to.equal(3)
    expect(findResultIndex({ results: RESULTS }, 'algorithmLog')).to.equal(2)
    expect(
      findResultIndex({ results: RESULTS.slice(0, 3) }, 'output')
    ).to.equal(undefined)
  })
})

describe('OceanNodeClient compute jobs', () => {
  it('asks the node for the qualified id and reports the job under it', async () => {
    const spy = statusAnswers([statusJob()])

    const job = await client().getComputeJob(JOB_ID)

    expect(askedFor(spy)).to.deep.equal([JOB_ID])
    expect(job?.jobId).to.equal(JOB_ID)
    expect(job?.environment).to.equal(ENVIRONMENT)
  })

  it('returns undefined when the answer holds only other jobs', async () => {
    statusAnswers([statusJob({ jobId: OTHER_BARE_ID })])

    expect(await client().getComputeJob(JOB_ID)).to.equal(undefined)
  })

  it('returns undefined when the node knows no such job', async () => {
    statusAnswers([])

    expect(await client().getComputeJob(JOB_ID)).to.equal(undefined)
  })

  it('refuses a bare id before asking the node', async () => {
    const spy = statusAnswers([statusJob()])

    await expectThrowsAsync(
      () => client().getComputeJob(BARE_ID),
      /not in the form <environmentHash>-<jobId>/
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns started jobs under their qualified id', async () => {
    vi.spyOn(ProviderInstance, 'freeComputeStart').mockResolvedValue([
      { ...statusJob({ status: 0 }), jobId: JOB_ID }
    ])

    const [job] = await client().freeComputeStart({
      computeEnv: ENVIRONMENT,
      datasets: [],
      algorithm: {}
    })

    expect(job.jobId).to.equal(JOB_ID)
  })

  it('fails clearly when the node streams no logs over P2P', async () => {
    vi.spyOn(ProviderInstance, 'computeStreamableLogs').mockResolvedValue(null)

    await expectThrowsAsync(
      () => client(PEER).getComputeLogs(JOB_ID),
      '[ocean-node] computeStreamableLogs: the node returned no logs for the job'
    )
  })

  it('asks for the logs under the qualified id, and reports a refusal with its status', async () => {
    const fetch = logsAnswer(404, 'Job not found or not running')

    const error = await client()
      .getComputeLogs(JOB_ID)
      .catch((caught) => caught)

    expect(error.message).to.equal(
      '[ocean-node] computeStreamableLogs: HTTP 404: Job not found or not running'
    )
    expect(error.status).to.equal(404)
    expect(
      new URL(String(fetch.mock.calls[0][0])).searchParams.get('jobId')
    ).to.equal(JOB_ID)
  })

  it('refuses an id that would add query parameters, before any request', async () => {
    const url = vi.spyOn(ProviderInstance, 'getComputeResultUrl')
    const result = vi.spyOn(ProviderInstance, 'getComputeResult')
    const logs = vi.spyOn(ProviderInstance, 'computeStreamableLogs')
    const stop = vi.spyOn(ProviderInstance, 'computeStop')
    const status = statusAnswers()
    const injected = 'h-x&index=3'

    for (const call of [
      () => client().getComputeResultUrl(injected, 0),
      () => client().getComputeResult(injected, 0),
      () => client().getComputeLogs(injected),
      () => client().computeStop(injected),
      () => client().computeStatus(injected)
    ])
      await expectThrowsAsync(call, /Malformed job id \(11 characters\)/)

    for (const spy of [url, result, logs, stop, status])
      expect(spy).not.toHaveBeenCalled()
  })

  it('refuses a result index that is not a non-negative safe integer', async () => {
    const url = vi.spyOn(ProviderInstance, 'getComputeResultUrl')
    const result = vi.spyOn(ProviderInstance, 'getComputeResult')

    for (const index of [-1, 1.5, Number.NaN, 2 ** 53])
      for (const call of [
        () => client().getComputeResultUrl(JOB_ID, index),
        () => client().getComputeResult(JOB_ID, index)
      ])
        await expectThrowsAsync(
          call,
          'resultIndex must be a non-negative safe integer'
        )

    expect(url).not.toHaveBeenCalled()
    expect(result).not.toHaveBeenCalled()
  })
})

describe('Nautilus compute jobs', () => {
  it('getComputeStatus returns the job under the id compute() returned', async () => {
    const nautilus = await createNautilus()
    const spy = statusAnswers([running()])

    const job = await nautilus.getComputeStatus({ jobId: JOB_ID })

    expect(askedFor(spy)).to.deep.equal([JOB_ID])
    expect(job?.jobId).to.equal(JOB_ID)
    expect(job?.status).to.equal(40)
  })

  it('getComputeStatus returns undefined for an unknown job, not another one', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ jobId: OTHER_BARE_ID })])

    expect(await nautilus.getComputeStatus({ jobId: JOB_ID })).to.equal(
      undefined
    )
  })

  it("getComputeResult returns the URL of the job's output", async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob()])
    const url = vi
      .spyOn(ProviderInstance, 'getComputeResultUrl')
      .mockResolvedValue('https://node.test.invalid/result')

    expect(await nautilus.getComputeResult({ jobId: JOB_ID })).to.equal(
      'https://node.test.invalid/result'
    )
    expect(url.mock.calls[0].slice(2)).to.deep.equal([JOB_ID, 3])
  })

  it('getComputeResult returns undefined for an unknown or unfinished job', async () => {
    const nautilus = await createNautilus()
    statusAnswers(
      [statusJob({ jobId: OTHER_BARE_ID })],
      [running({ results: RESULTS.slice(0, 1) })]
    )
    const url = vi.spyOn(ProviderInstance, 'getComputeResultUrl')

    expect(await nautilus.getComputeResult({ jobId: JOB_ID })).to.equal(
      undefined
    )
    expect(await nautilus.getComputeResult({ jobId: JOB_ID })).to.equal(
      undefined
    )
    expect(url).not.toHaveBeenCalled()
  })

  it('getComputeResult reads at 71 (JobSettle) once the output is listed', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ status: 71 })])
    vi.spyOn(ProviderInstance, 'getComputeResultUrl').mockResolvedValue('url')

    expect(await nautilus.getComputeResult({ jobId: JOB_ID })).to.equal('url')
  })

  it('getComputeResult reports a 71 job without its output yet as pending, not missing', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ status: 71, results: RESULTS.slice(0, 3) })])
    const url = vi.spyOn(ProviderInstance, 'getComputeResultUrl')
    const log = vi.spyOn(LoggerInstance, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(LoggerInstance, 'warn').mockImplementation(() => {})

    expect(await nautilus.getComputeResult({ jobId: JOB_ID })).to.equal(
      undefined
    )
    expect(log.mock.calls[0][0]).to.match(
      /has not listed its 'output' result yet \(status 71/
    )
    expect(warn).not.toHaveBeenCalled()
    expect(url).not.toHaveBeenCalled()
  })

  it('streamComputeResult throws for a 71 job without its output yet, saying so', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ status: 71, results: RESULTS.slice(0, 3) })])

    await expectThrowsAsync(
      () => nautilus.streamComputeResult({ jobId: JOB_ID }),
      /has not listed its 'output' result yet/
    )
  })

  it('getComputeResult reports a failed job (41) as finished without output, not pending', async () => {
    const nautilus = await createNautilus()
    statusAnswers([
      statusJob({
        status: 41,
        statusText: 'Failed to run algorithm',
        results: RESULTS.slice(0, 3)
      })
    ])
    const url = vi.spyOn(ProviderInstance, 'getComputeResultUrl')
    const log = vi.spyOn(LoggerInstance, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(LoggerInstance, 'warn').mockImplementation(() => {})

    expect(await nautilus.getComputeResult({ jobId: JOB_ID })).to.equal(
      undefined
    )
    expect(warn.mock.calls[0][0]).to.match(
      /the job has no 'output' result \(status 41/
    )
    expect(log).not.toHaveBeenCalled()
    expect(url).not.toHaveBeenCalled()
  })

  it('getComputeResult reads an explicit result of a failed job', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ status: 11, results: RESULTS.slice(0, 1) })])
    const url = vi
      .spyOn(ProviderInstance, 'getComputeResultUrl')
      .mockResolvedValue('url')

    expect(
      await nautilus.getComputeResult({ jobId: JOB_ID, resultIndex: 0 })
    ).to.equal('url')
    expect(url.mock.calls[0].slice(2)).to.deep.equal([JOB_ID, 0])
  })

  it('getComputeResult refuses a bad resultIndex before any request', async () => {
    const nautilus = await createNautilus()
    const status = statusAnswers()

    await expectThrowsAsync(
      () => nautilus.getComputeResult({ jobId: JOB_ID, resultIndex: -1 }),
      'resultIndex must be a non-negative safe integer'
    )
    expect(status).not.toHaveBeenCalled()
  })

  it('names the node by its origin only', async () => {
    const nautilus = await createNautilus()
    statusAnswers([], [])
    const warn = vi.spyOn(LoggerInstance, 'warn').mockImplementation(() => {})
    const nodeUri = 'https://user:secret@other-node.test.invalid/path?token=t'

    await nautilus.getComputeResult({ jobId: JOB_ID, nodeUri })
    await expectThrowsAsync(
      () => nautilus.getComputeLogs({ jobId: JOB_ID, nodeUri }),
      '[compute] node https://other-node.test.invalid does not know the job'
    )

    expect(warn.mock.calls[0][0]).to.equal(
      '[compute] node https://other-node.test.invalid does not know the job'
    )
  })

  it('streamComputeResult streams the output, not the first result', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob()])
    const result = vi
      .spyOn(ProviderInstance, 'getComputeResult')
      .mockResolvedValue(stream('outputs.tar'))

    const body = await nautilus.streamComputeResult({ jobId: JOB_ID })

    expect(await read(body)).to.equal('outputs.tar')
    expect(result.mock.calls[0].slice(2, 4)).to.deep.equal([JOB_ID, 3])
  })

  it('streamComputeResult honours resultIndex', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob()])
    const result = vi
      .spyOn(ProviderInstance, 'getComputeResult')
      .mockResolvedValue(stream('image log'))

    await nautilus.streamComputeResult({ jobId: JOB_ID, resultIndex: 0 })

    expect(result.mock.calls[0].slice(2, 4)).to.deep.equal([JOB_ID, 0])
  })

  it('streamComputeResult throws for an unknown job, an unfinished one, or no output', async () => {
    const nautilus = await createNautilus()
    statusAnswers(
      [],
      [running()],
      [statusJob({ results: RESULTS.slice(0, 3) })]
    )
    const result = vi.spyOn(ProviderInstance, 'getComputeResult')

    await expectThrowsAsync(
      () => nautilus.streamComputeResult({ jobId: JOB_ID }),
      /does not know the job/
    )
    await expectThrowsAsync(
      () => nautilus.streamComputeResult({ jobId: JOB_ID }),
      /is not finished yet \(status 40/
    )
    await expectThrowsAsync(
      () => nautilus.streamComputeResult({ jobId: JOB_ID }),
      /has no 'output' result/
    )
    expect(result).not.toHaveBeenCalled()
  })

  it('getComputeLogs streams the live logs of a running job', async () => {
    const nautilus = await createNautilus()
    statusAnswers([running()])
    const logs = logsAnswer(200, 'live')

    expect(
      await read(await nautilus.getComputeLogs({ jobId: JOB_ID }))
    ).to.equal('live')
    expect(
      new URL(String(logs.mock.calls[0][0])).searchParams.get('jobId')
    ).to.equal(JOB_ID)
  })

  it('getComputeLogs passes its signal to the log request', async () => {
    const nautilus = await createNautilus()
    statusAnswers([running()])
    const logs = logsAnswer(200, 'live')
    const stop = new AbortController()

    await nautilus.getComputeLogs({ jobId: JOB_ID, signal: stop.signal })
    stop.abort()

    expect((logs.mock.calls[0] as unknown[])[1]).to.have.nested.property(
      'signal.aborted',
      true
    )
  })

  it("getComputeLogs reads a finished job's algorithmLog result", async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob()])
    const logs = logsAnswer(200, 'live')
    const result = vi
      .spyOn(ProviderInstance, 'getComputeResult')
      .mockResolvedValue(stream('algorithm log'))

    expect(
      await read(await nautilus.getComputeLogs({ jobId: JOB_ID }))
    ).to.equal('algorithm log')
    expect(logs).not.toHaveBeenCalled()
    expect(result.mock.calls[0].slice(2, 4)).to.deep.equal([JOB_ID, 2])
  })

  it('getComputeLogs falls back to the algorithmLog when the job finishes meanwhile', async () => {
    const nautilus = await createNautilus()
    statusAnswers([running()], [statusJob()])
    // How the node refuses the logs of a job that is no longer running.
    logsAnswer(404, 'Job not found or not running')
    const result = vi
      .spyOn(ProviderInstance, 'getComputeResult')
      .mockResolvedValue(stream('algorithm log'))

    expect(
      await read(await nautilus.getComputeLogs({ jobId: JOB_ID }))
    ).to.equal('algorithm log')
    expect(result.mock.calls[0].slice(2, 4)).to.deep.equal([JOB_ID, 2])
  })

  it('getComputeLogs rejects with the abort reason, even when the job has finished meanwhile', async () => {
    const nautilus = await createNautilus()
    const status = statusAnswers([running()], [statusJob()])
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(0)
    const stop = new AbortController()
    const reason = new Error('stop')
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        stop.abort(reason)
        return Promise.reject(init.signal?.reason)
      })
    )
    const result = vi.spyOn(ProviderInstance, 'getComputeResult')

    const thrown = await nautilus
      .getComputeLogs({ jobId: JOB_ID, signal: stop.signal })
      .catch((error: unknown) => error)

    expect(thrown).to.equal(reason)
    expect(status).toHaveBeenCalledOnce()
    expect(result).not.toHaveBeenCalled()
  })

  it("getComputeLogs reads a failed job's algorithmLog instead of streaming", async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ status: 41, results: RESULTS.slice(0, 3) })])
    const logs = vi.spyOn(ProviderInstance, 'computeStreamableLogs')
    const result = vi
      .spyOn(ProviderInstance, 'getComputeResult')
      .mockResolvedValue(stream('Traceback'))

    expect(
      await read(await nautilus.getComputeLogs({ jobId: JOB_ID }))
    ).to.equal('Traceback')
    expect(logs).not.toHaveBeenCalled()
    expect(result.mock.calls[0].slice(2, 4)).to.deep.equal([JOB_ID, 2])
  })

  it('getComputeLogs says a job that failed before running has no algorithm log', async () => {
    const nautilus = await createNautilus()
    statusAnswers([
      statusJob({
        status: 11,
        statusText: 'Pulling algorithm image failed',
        results: RESULTS.slice(0, 1)
      })
    ])
    const logs = vi.spyOn(ProviderInstance, 'computeStreamableLogs')

    await expectThrowsAsync(
      () => nautilus.getComputeLogs({ jobId: JOB_ID }),
      /has finished \(status 11: Pulling algorithm image failed\) and has no 'algorithmLog'/
    )
    expect(logs).not.toHaveBeenCalled()
  })

  it('getComputeLogs throws for an unknown job', async () => {
    const nautilus = await createNautilus()
    statusAnswers([statusJob({ jobId: OTHER_BARE_ID })])

    await expectThrowsAsync(
      () => nautilus.getComputeLogs({ jobId: JOB_ID }),
      /does not know the job/
    )
  })

  it('stopCompute sends the id as given, without a status lookup', async () => {
    const nautilus = await createNautilus()
    const status = statusAnswers()
    const stop = vi
      .spyOn(ProviderInstance, 'computeStop')
      .mockResolvedValue([running()])

    const [job] = await nautilus.stopCompute({ jobId: JOB_ID })

    expect(stop.mock.calls[0][0]).to.equal(JOB_ID)
    expect(job.jobId).to.equal(JOB_ID)
    expect(status).not.toHaveBeenCalled()
  })

  it('refuses a bare id on every job method', async () => {
    const nautilus = await createNautilus()
    const status = statusAnswers()
    const stop = vi.spyOn(ProviderInstance, 'computeStop')

    for (const call of [
      () => nautilus.getComputeStatus({ jobId: BARE_ID }),
      () => nautilus.getComputeResult({ jobId: BARE_ID }),
      () => nautilus.streamComputeResult({ jobId: BARE_ID }),
      () => nautilus.getComputeLogs({ jobId: BARE_ID }),
      () => nautilus.stopCompute({ jobId: BARE_ID })
    ])
      await expectThrowsAsync(call, /not in the form <environmentHash>-<jobId>/)

    expect(status).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })
})
