/**
 * ocean.js's own log lines (`LoggerInstance`) through nautilus's logger (10e):
 * `configureLogging({ oceanjs })`, default `'capture'`.
 *
 * The J1 case: on a refused compute start ocean.js logs the request payload,
 * `LoggerInstance.error('Payload was:', payload)`, with the request's nonce and the
 * policy-server session ids (and a signature, where ocean.js does not replace it itself).
 * Before 10e that went straight to `console.error`, in util.inspect form, whatever nautilus
 * was configured to do.
 */
import { format } from 'node:util'
import { LoggerInstance, LogLevel, ProviderInstance } from '@oceanprotocol/lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DebugEvent } from '../../src/log/debug.js'
import { resetDebug, setDebug } from '../../src/log/debug.js'
import {
  configureLogging,
  getLoggingConfig,
  resetLogging
} from '../../src/log/logger.js'
import type { LogEvent } from '../../src/log/types.js'
import { captureLog } from '../helpers.js'
import { FAKE } from '../secretScan.js'

const NODE = 'https://node.test.invalid'
const CONSUMER = `0x${'11'.repeat(20)}`
const ALGO_DID = `did:ope:${'bb'.repeat(32)}`
const DATA_DID = `did:ope:${'aa'.repeat(32)}`
/** A second policy-server session, as for a second dataset. */
const SECOND_SESSION = `${'c1'.repeat(32)}-${'d2'.repeat(32)}`

/** The secrets of the J1 payload, none of which may be printed. */
const J1_SECRETS = [
  FAKE.signature,
  FAKE.nonce,
  FAKE.policySessionId,
  SECOND_SESSION
]

/**
 * The payload of the beta.2 case 16 dump (a free compute start, refused because the dataset
 * does not trust the algorithm), field for field, with fake values and an unreplaced
 * signature.
 */
function j1Payload() {
  return {
    consumerAddress: CONSUMER,
    signature: FAKE.signature,
    nonce: FAKE.nonce,
    environment: `0x${'ee'.repeat(32)}-0x${'ff'.repeat(32)}`,
    resources: [
      { id: 'cpu', amount: 1 },
      { id: 'ram', amount: 1 },
      { id: 'disk', amount: 1 }
    ],
    dataset: { documentId: DATA_DID, serviceId: 'svc' },
    datasets: [{ documentId: DATA_DID, serviceId: 'svc' }],
    algorithm: {
      documentId: ALGO_DID,
      serviceId: 'algo',
      meta: { language: 'javascript', version: '1.0.0', container: {} }
    },
    policyServer: [
      {
        sessionId: FAKE.policySessionId,
        successRedirectUri: '',
        errorRedirectUri: '',
        responseRedirectUri: '',
        presentationDefinitionUri: '',
        documentId: DATA_DID,
        serviceId: 'svc'
      },
      {
        sessionId: SECOND_SESSION,
        successRedirectUri: '',
        errorRedirectUri: '',
        responseRedirectUri: '',
        presentationDefinitionUri: '',
        documentId: DATA_DID,
        serviceId: 'svc2'
      }
    ]
  }
}

/** The case 16 refusal, through ocean.js's real `freeComputeStart`, against a stubbed node. */
async function refusedFreeCompute(): Promise<Error> {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: `Algorithm ${ALGO_DID} not allowed to run on the dataset: ${DATA_DID}`
          }),
          { status: 400, statusText: 'Bad Request' }
        )
    )
  )
  const payload = j1Payload()
  try {
    await ProviderInstance.freeComputeStart(
      NODE,
      {
        consumerAddress: CONSUMER,
        nonce: FAKE.nonce,
        signature: FAKE.signature
      },
      payload.environment,
      payload.datasets,
      { documentId: ALGO_DID, serviceId: 'algo' },
      payload.resources,
      undefined,
      undefined,
      undefined,
      payload.policyServer
    )
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the compute start to be refused')
}

/** Everything written to stderr and through the console while the test runs. */
function output() {
  const lines: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk))
    return true
  })
  const console_ = {} as Record<string, ReturnType<typeof vi.spyOn>>
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const)
    console_[method] = vi
      .spyOn(console, method)
      .mockImplementation((...args: unknown[]) => {
        lines.push(format(...args))
      })
  return { lines, console: console_, text: () => lines.join('\n') }
}

function expectNoJ1Secret(text: string) {
  for (const secret of J1_SECRETS) expect(text).not.to.contain(secret)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  LoggerInstance.setLevel(LogLevel.Error)
})

describe('ocean.js payload dump (J1), at the default settings', () => {
  it('prints the refusal through nautilus, with the nonce, signature and session ids redacted', async () => {
    const out = output()

    await refusedFreeCompute()

    // Nothing reaches the console: ocean.js's lines are nautilus's events on stderr.
    for (const spy of Object.values(out.console))
      expect(spy).not.toHaveBeenCalled()
    const events = out.lines.map((line) => JSON.parse(line) as LogEvent)
    expect(events.map((event) => [event.event, event.msg])).to.deep.equal([
      ['oceanjs.logger.error', 'Compute start failed: 400 Bad Request'],
      ['oceanjs.logger.error', 'Payload was:']
    ])
    const [payload] = events[1].fields.args as [Record<string, unknown>]
    expect(payload.nonce).to.equal('<redacted>')
    // ocean.js replaces the signature itself; nautilus would too (below).
    expect(payload.signature).to.be.oneOf(['<redacted>', '[REDACTED]'])
    expect(
      (payload.policyServer as { sessionId: string }[]).map(
        (session) => session.sessionId
      )
    ).to.deep.equal(['<redacted>', '<redacted>'])
    // What is not secret stays readable.
    expect(payload.consumerAddress).to.equal(CONSUMER)
    expect(payload.algorithm).to.deep.include({ documentId: ALGO_DID })
    expectNoJ1Secret(out.text())
  })

  it('redacts the dump fed to the logger directly, with an unreplaced signature', () => {
    const log = captureLog()

    LoggerInstance.error('Payload was:', j1Payload())

    expect(log.events).to.have.length(1)
    const [event] = log.events
    expect(event).to.deep.include({
      level: 'error',
      event: 'oceanjs.logger.error',
      component: 'oceanjs',
      msg: 'Payload was:'
    })
    expect(event.fields.method).to.equal('error')
    expect((event.fields.args as [Record<string, unknown>])[0]).to.deep.include(
      { signature: '<redacted>', nonce: '<redacted>' }
    )
    expectNoJ1Secret(JSON.stringify(event))
  })

  it('redacts the util.inspect form of the dump, single-line and as console.error prints it', () => {
    const log = captureLog()
    const payload = j1Payload()

    // The beta.2 case 16 log, as text: what `console.error('Payload was:', payload)` prints.
    LoggerInstance.error(format('Payload was:', payload))
    LoggerInstance.error(
      `Payload was: ${format('%o', payload).replace(/\s+/g, ' ')}`
    )
    // The shape the harness fixture uses: unquoted keys, a number nonce, double quotes.
    LoggerInstance.error(
      [
        'Payload was: {',
        `  nonce: '${FAKE.nonce}',`,
        `  signature: '${FAKE.signature}',`,
        `  policyServer: [ { sessionId: '${FAKE.policySessionId}', serviceId: '0x1' } ],`,
        `  retry: { nonce: 1760000000456, sessionId: "${SECOND_SESSION}" }`,
        '}'
      ].join('\n')
    )

    expect(log.events).to.have.length(3)
    for (const event of log.events) {
      expect(event.event).to.equal('oceanjs.logger.error')
      expect(event.msg).to.match(/^Payload was: \{/)
      expect(event.msg).to.match(/nonce: <redacted>/)
      expect(event.msg).to.match(/sessionId: <redacted>/)
      expectNoJ1Secret(JSON.stringify(event))
    }
    expect(JSON.stringify(log.events)).not.to.contain('1760000000456')
  })

  it('reads a JSON payload (initializeCompute, PolicyServerPassthrough) by field', () => {
    const log = captureLog()

    LoggerInstance.error('Initialize compute failed: ', 400, 'Bad Request', {
      error: 'Missing algorithm'
    })
    LoggerInstance.error('Payload was:', JSON.stringify(j1Payload()))

    expect(log.events.map((event) => event.msg)).to.deep.equal([
      'Initialize compute failed: 400 Bad Request',
      'Payload was:'
    ])
    expect(log.events[0].fields.args).to.deep.equal([
      { error: 'Missing algorithm' }
    ])
    const [payload] = log.events[1].fields.args as [Record<string, unknown>]
    expect(payload).to.deep.include({
      nonce: '<redacted>',
      signature: '<redacted>'
    })
    expectNoJ1Secret(JSON.stringify(log.events))
  })

  it("redacts an ocean.js error argument (a failed send's ethers error)", () => {
    const log = captureLog()

    LoggerInstance.error(
      'Send tx error: ',
      new Error(
        `could not send to ${FAKE.rpcUrl} (signature=${FAKE.signature})`
      )
    )

    const [event] = log.events
    expect(event.msg).to.equal('Send tx error:')
    expect(event.fields.args).to.have.length(1)
    expect(JSON.stringify(event)).not.to.contain(FAKE.rpcPathToken)
    expect(JSON.stringify(event)).not.to.contain(FAKE.signature)
    expect(JSON.stringify(event)).to.contain('https://rpc.example.org')
  })
})

describe('the raw lines on the sensitive debug tier', () => {
  it('hands the raw payload to the sensitive tier only', async () => {
    const debugEvents: DebugEvent[] = []
    setDebug({ level: 'sensitive', sink: (event) => debugEvents.push(event) })
    const log = captureLog()

    await refusedFreeCompute()

    expectNoJ1Secret(JSON.stringify(log.events))
    const raw = debugEvents.filter(
      (event) =>
        event.message === 'log event oceanjs.logger.error before redaction'
    )
    expect(raw.length).to.be.greaterThan(0)
    expect(raw.every((event) => event.tier === 'sensitive')).to.equal(true)
    expect(raw.every((event) => event.topic === 'node')).to.equal(true)
    const text = JSON.stringify(raw)
    expect(text).to.contain(FAKE.nonce)
    expect(text).to.contain(FAKE.policySessionId)
    expect(text).to.contain(SECOND_SESSION)
  })

  it('hands nothing on with the debug channel off', async () => {
    resetDebug({})
    const debugEvents: DebugEvent[] = []
    const out = output()

    await refusedFreeCompute()

    expect(debugEvents).to.deep.equal([])
    expect(out.text()).not.to.contain('[nautilus:debug:')
    expectNoJ1Secret(out.text())
  })
})

describe("configureLogging's oceanjs option", () => {
  it("is 'capture' by default, and again after oceanjs: undefined", () => {
    expect(getLoggingConfig().oceanjs).to.equal('capture')

    configureLogging({ oceanjs: 'silent' })
    expect(getLoggingConfig().oceanjs).to.equal('silent')
    configureLogging({ oceanjs: undefined })
    expect(getLoggingConfig().oceanjs).to.equal('capture')
  })

  it("'silent': ocean.js prints nothing, and nautilus logs nothing for it", async () => {
    configureLogging({ oceanjs: 'silent', level: 'trace' })
    const out = output()

    await refusedFreeCompute()
    LoggerInstance.setLevel(LogLevel.Verbose)
    LoggerInstance.warn('a warning')
    LoggerInstance.log('a line')
    LoggerInstance.debug('a detail')
    LoggerInstance.bypass('always')

    expect(out.lines).to.deep.equal([])
  })

  it("'passthrough': ocean.js prints its own lines, unredacted, as before", async () => {
    configureLogging({ oceanjs: 'passthrough' })
    const out = output()

    await refusedFreeCompute()

    expect(out.console.error).toHaveBeenCalledTimes(2)
    expect(out.console.error.mock.calls[1][0]).to.equal('Payload was:')
    // ocean.js's own text: the nonce and session ids as they are.
    expect(out.text()).to.contain(FAKE.nonce)
    expect(out.text()).to.contain(FAKE.policySessionId)
    expect(out.lines.some((line) => line.includes('oceanjs.logger'))).to.equal(
      false
    )
  })

  it('switches back and forth', () => {
    const log = captureLog()

    configureLogging({ oceanjs: 'silent' })
    LoggerInstance.error('one')
    configureLogging({ oceanjs: 'capture' })
    LoggerInstance.error('two')

    expect(log.events.map((event) => event.msg)).to.deep.equal(['two'])
  })

  it("patches neither console nor ocean.js's level, only the logger's own methods", () => {
    const before = { ...console }
    const level = (LoggerInstance as unknown as { logLevel: LogLevel }).logLevel

    for (const oceanjs of ['passthrough', 'silent', 'capture'] as const)
      configureLogging({ oceanjs })

    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const)
      expect(console[method]).to.equal(before[method])
    expect(
      (LoggerInstance as unknown as { logLevel: LogLevel }).logLevel
    ).to.equal(level)
    for (const method of ['error', 'warn', 'log', 'debug', 'bypass'])
      expect(Object.hasOwn(LoggerInstance, method)).to.equal(true)
  })

  it('is reset with the rest of the configuration', () => {
    configureLogging({ oceanjs: 'passthrough' })
    resetLogging({})
    expect(getLoggingConfig().oceanjs).to.equal('capture')
  })
})

describe('levels', () => {
  it("follows nautilus's level: nothing at 'silent'", async () => {
    configureLogging({ level: 'silent' })
    const out = output()

    await refusedFreeCompute()

    expect(out.lines).to.deep.equal([])
  })

  it("keeps ocean.js's own level as the first filter: nothing at LogLevel.None", () => {
    const log = captureLog({ level: 'trace' })
    LoggerInstance.setLevel(LogLevel.None)

    LoggerInstance.error('hidden')
    LoggerInstance.bypass('shown')

    expect(log.events.map((event) => [event.event, event.msg])).to.deep.equal([
      ['oceanjs.logger.log', 'shown']
    ])
    expect(log.events[0].fields.method).to.equal('bypass')
  })

  it('maps each method to its event and level', () => {
    const log = captureLog({ level: 'trace' })
    LoggerInstance.setLevel(LogLevel.Verbose)

    LoggerInstance.error('e')
    LoggerInstance.warn('w')
    LoggerInstance.log('l')
    LoggerInstance.debug('d')

    expect(
      log.events.map((event) => [event.event, event.level, event.msg])
    ).to.deep.equal([
      ['oceanjs.logger.error', 'error', 'e'],
      ['oceanjs.logger.warn', 'warn', 'w'],
      ['oceanjs.logger.log', 'info', 'l'],
      ['oceanjs.logger.debug', 'debug', 'd']
    ])
  })

  it("prints ocean.js's info and debug lines only for the components asked for", () => {
    const log = captureLog({ level: 'trace' })
    LoggerInstance.setLevel(LogLevel.Verbose)

    configureLogging({ components: ['publish'] })
    LoggerInstance.log('hidden')
    LoggerInstance.error('errors always print')
    configureLogging({ components: ['oceanjs'] })
    LoggerInstance.debug('shown')

    expect(log.events.map((event) => event.msg)).to.deep.equal([
      'errors always print',
      'shown'
    ])
  })

  it('never throws on an argument that cannot be read', () => {
    const log = captureLog({ level: 'error' })
    LoggerInstance.setLevel(LogLevel.Verbose)
    const unreadable = {
      get secret(): string {
        throw new Error('read')
      }
    }

    expect(() => LoggerInstance.warn('not printed', unreadable)).not.to.throw()
    expect(() => LoggerInstance.error('printed', unreadable)).not.to.throw()

    expect(log.events.map((event) => [event.msg, event.fields])).to.deep.equal([
      ['printed', { fieldsError: 'read' }]
    ])
  })
})

describe('robustness', () => {
  it('never fails the ocean.js call: a throwing sink is ignored', () => {
    configureLogging({
      sink: () => {
        throw new Error('sink down')
      }
    })

    expect(() =>
      LoggerInstance.error('Payload was:', j1Payload())
    ).not.to.throw()
  })

  it('a sink that logs through ocean.js again does not loop', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    configureLogging({
      sink: (event) => {
        calls++
        LoggerInstance.error(`[app] ${event.msg}`)
      }
    })

    LoggerInstance.error('once')

    expect(calls).to.equal(1)
    // The nested line goes to ocean.js's own method, which prints the already-redacted text.
    expect(consoleError).toHaveBeenCalledWith('[app] once')
  })

  it('reads a line without text arguments', () => {
    const log = captureLog()

    LoggerInstance.error({ sessionId: FAKE.policySessionId })
    LoggerInstance.error()

    expect(log.events.map((event) => [event.msg, event.fields])).to.deep.equal([
      [
        'ocean.js error',
        { method: 'error', args: [{ sessionId: '<redacted>' }] }
      ],
      ['ocean.js error', { method: 'error' }]
    ])
  })
})
