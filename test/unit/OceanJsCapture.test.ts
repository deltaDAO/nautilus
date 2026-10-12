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
import { captureLog, cpuTime } from '../helpers.js'
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
    const out = output()
    const events: LogEvent[] = []
    configureLogging({
      sink: (event) => {
        events.push(event)
        LoggerInstance.error(`[app] ${event.msg}`)
      }
    })

    LoggerInstance.error('once')
    LoggerInstance.error('twice')

    // The nested lines are dropped, and said so once.
    expect(events.map((event) => [event.event, event.msg])).to.deep.equal([
      ['oceanjs.logger.error', 'once'],
      [
        'oceanjs.capture.nested_dropped',
        'ocean.js logged a line while nautilus was capturing one of its lines (a sink or a debug sink that logs through LoggerInstance): the nested line is dropped, not printed, so it cannot print unredacted. Log from a sink through something other than LoggerInstance.'
      ],
      ['oceanjs.logger.error', 'twice']
    ])
    for (const spy of Object.values(out.console))
      expect(spy).not.toHaveBeenCalled()
  })

  it('never prints a nested line raw: a sink that logs a session id through ocean.js', () => {
    const out = output()
    configureLogging({
      sink: () => LoggerInstance.error({ sessionId: FAKE.policySessionId })
    })

    LoggerInstance.error('outer')

    for (const spy of Object.values(out.console))
      expect(spy).not.toHaveBeenCalled()
    expect(out.text()).not.to.contain(FAKE.policySessionId)
  })

  it('never prints a nested line raw: a debug sink that logs through ocean.js', () => {
    const out = output()
    setDebug({
      level: 'sensitive',
      sink: (event) => LoggerInstance.error('[debug]', event)
    })
    const log = captureLog()

    LoggerInstance.error('Payload was:', j1Payload())

    for (const spy of Object.values(out.console))
      expect(spy).not.toHaveBeenCalled()
    expectNoJ1Secret(out.text())
    expect(log.events.map((event) => event.event)).to.deep.equal([
      'oceanjs.logger.error',
      'oceanjs.capture.nested_dropped'
    ])
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

type LoggerModule = typeof import('../../src/log/logger.js')

/** A second copy of nautilus's logger in the process, as a bundled copy or a reload gives. */
async function anotherCopy(): Promise<LoggerModule> {
  vi.resetModules()
  return import('../../src/log/logger.js')
}

/** An ocean.js logger of its own: methods on the prototype, as ocean.js's `Logger` has. */
function fakeOceanJsLogger() {
  const printed: unknown[][] = []
  class Logger {
    logLevel = 0
    error(...args: unknown[]) {
      printed.push(['ocean.js', ...args])
    }
    warn(...args: unknown[]) {
      printed.push(['ocean.js', ...args])
    }
    log(...args: unknown[]) {
      printed.push(['ocean.js', ...args])
    }
    debug(...args: unknown[]) {
      printed.push(['ocean.js', ...args])
    }
    bypass(...args: unknown[]) {
      printed.push(['ocean.js', ...args])
    }
  }
  return { logger: new Logger(), printed }
}

/** A fresh copy of nautilus's logger, loaded against `logger` as ocean.js's `LoggerInstance`. */
async function copyWithOceanJsLogger(logger: object): Promise<LoggerModule> {
  vi.resetModules()
  vi.doMock('@oceanprotocol/lib', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    LoggerInstance: logger
  }))
  try {
    return await import('../../src/log/logger.js')
  } finally {
    vi.doUnmock('@oceanprotocol/lib')
  }
}

describe('several copies of nautilus in one process', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('a copy loaded later keeps the mode in force and the first copy keeps the lines', async () => {
    const log = captureLog()
    configureLogging({ oceanjs: 'silent' })
    const out = output()

    const copy = await anotherCopy()

    expect(copy.getLoggingConfig().oceanjs).to.equal('silent')
    expect(getLoggingConfig().oceanjs).to.equal('silent')
    LoggerInstance.error('dropped')
    configureLogging({ oceanjs: 'capture' })
    LoggerInstance.error('to the first copy')

    expect(log.events.map((event) => event.msg)).to.deep.equal([
      'to the first copy'
    ])
    expect(out.lines).to.deep.equal([])
  })

  it('getLoggingConfig().oceanjs is the mode in force, whichever copy set it', async () => {
    const copy = await anotherCopy()
    // Each change warns the copy that received the lines (see below), on stderr here.
    output()

    copy.configureLogging({ oceanjs: 'passthrough' })
    expect(getLoggingConfig().oceanjs).to.equal('passthrough')
    configureLogging({ oceanjs: 'silent' })
    expect(copy.getLoggingConfig().oceanjs).to.equal('silent')
  })

  it('the lines go to the copy that last set oceanjs', async () => {
    const first = captureLog()
    const copy = await anotherCopy()
    const second: LogEvent[] = []
    copy.configureLogging({ sink: (event) => second.push(event) })

    LoggerInstance.error('one')
    copy.configureLogging({ oceanjs: 'capture' })
    LoggerInstance.error('two')
    configureLogging({ oceanjs: 'capture' })
    LoggerInstance.error('three')

    const lines = (events: LogEvent[]) =>
      events
        .filter((event) => event.event === 'oceanjs.logger.error')
        .map((event) => event.msg)
    expect(lines(first.events)).to.deep.equal(['one', 'three'])
    expect(lines(second)).to.deep.equal(['two'])
  })

  it('the copy that received the lines warns when another copy takes them or sets passthrough', async () => {
    const first = captureLog()
    const copy = await anotherCopy()
    const second: LogEvent[] = []
    copy.configureLogging({ sink: (event) => second.push(event) })
    const moved = (events: LogEvent[]) =>
      events
        .filter((event) => event.event === 'oceanjs.capture.moved')
        .map((event) => [event.level, event.fields.mode])

    copy.configureLogging({ oceanjs: 'passthrough' })
    // The copy that already receives them: nothing moves.
    copy.configureLogging({ oceanjs: 'passthrough' })
    configureLogging({ oceanjs: 'silent' })
    copy.configureLogging({ oceanjs: 'capture' })

    expect(moved(first.events)).to.deep.equal([
      ['warn', 'passthrough'],
      ['warn', 'capture']
    ])
    expect(moved(second)).to.deep.equal([['warn', 'silent']])
    const [passthrough] = first.events.filter(
      (event) => event.event === 'oceanjs.capture.moved'
    )
    expect(passthrough.msg).to.contain('unredacted')
  })

  it('keeps its state on LoggerInstance under a versioned key, and wraps ocean.js once', async () => {
    const before = LoggerInstance.error
    await anotherCopy()

    expect(LoggerInstance.error).to.equal(before)
    expect(Object.getOwnPropertySymbols(LoggerInstance)).to.include(
      Symbol.for('@deltadao/nautilus/oceanjs-capture/v1')
    )
  })
})

describe('an ocean.js logger nautilus cannot take over', () => {
  it('a frozen LoggerInstance: nautilus loads, captures nothing and warns once', async () => {
    const { logger, printed } = fakeOceanJsLogger()
    Object.freeze(logger)
    const out = output()

    const copy = await copyWithOceanJsLogger(logger)

    const warnings = out.lines.map((line) => JSON.parse(line) as LogEvent)
    expect(warnings.map((event) => [event.event, event.level])).to.deep.equal([
      ['oceanjs.capture.unavailable', 'warn']
    ])
    expect(warnings[0].fields).to.deep.equal({
      methods: ['error', 'warn', 'log', 'debug', 'bypass']
    })
    // ocean.js prints as it always did; configuring a mode does not throw.
    logger.error('raw')
    expect(printed).to.deep.equal([['ocean.js', 'raw']])
    expect(() => copy.configureLogging({ oceanjs: 'silent' })).not.to.throw()
  })

  it("a frozen LoggerInstance: the mode reads 'passthrough', what ocean.js does, whatever is set", async () => {
    const { logger } = fakeOceanJsLogger()
    Object.freeze(logger)
    output()
    const copy = await copyWithOceanJsLogger(logger)

    expect(copy.getLoggingConfig().oceanjs).to.equal('passthrough')
    copy.configureLogging({ oceanjs: 'silent' })
    expect(copy.getLoggingConfig().oceanjs).to.equal('passthrough')
  })

  it("one read-only method (error): that method prints itself, so the mode reads 'passthrough'", async () => {
    const { logger, printed } = fakeOceanJsLogger()
    Object.defineProperty(logger, 'error', {
      value: (...args: unknown[]) => printed.push(['ocean.js', ...args]),
      writable: false
    })
    const out = output()
    const copy = await copyWithOceanJsLogger(logger)
    copy.configureLogging({ oceanjs: 'capture' })

    expect(copy.getLoggingConfig().oceanjs).to.equal('passthrough')
    const [warning] = out.lines.map((line) => JSON.parse(line) as LogEvent)
    expect(warning.fields).to.deep.equal({ methods: ['error'] })
  })

  it('tells how to silence ocean.js in a way that works: before freezing it, for a frozen logger', async () => {
    const frozen = fakeOceanJsLogger().logger
    Object.freeze(frozen)
    const sealed = fakeOceanJsLogger().logger
    // `setLevel` still works on a sealed logger: its level stays writable.
    Object.seal(sealed)
    const advice: Record<string, string> = {}

    for (const [name, logger] of [
      ['frozen', frozen],
      ['sealed', sealed]
    ] as const) {
      const out = output()
      await copyWithOceanJsLogger(logger)
      const [warning] = out.lines.map((line) => JSON.parse(line) as LogEvent)
      expect(warning.event).to.equal('oceanjs.capture.unavailable')
      advice[name] = warning.msg
      vi.restoreAllMocks()
    }

    expect(advice.frozen).to.contain('before freezing it')
    expect(() => {
      ;(frozen as { logLevel: number }).logLevel = 0
    }).to.throw(TypeError)
    expect(advice.sealed).not.to.contain('before freezing it')
    expect(advice.sealed).to.contain(
      'call LoggerInstance.setLevel(LogLevel.None) from @oceanprotocol/lib'
    )
  })

  it("an app's own replacement made before nautilus loads: bypassed in 'capture', called in 'passthrough'", async () => {
    const { logger, printed } = fakeOceanJsLogger()
    const app: unknown[][] = []
    ;(logger as unknown as Record<string, unknown>).error = (
      ...args: unknown[]
    ) => app.push(args)
    const copy = await copyWithOceanJsLogger(logger)
    const events: LogEvent[] = []
    copy.configureLogging({ sink: (event) => events.push(event) })

    logger.error('captured')
    copy.configureLogging({ oceanjs: 'passthrough' })
    logger.error('to the app')

    expect(events.map((event) => event.msg)).to.deep.equal(['captured'])
    expect(app).to.deep.equal([['to the app']])
    expect(printed).to.deep.equal([])
  })
})

describe('reading a captured line', () => {
  /** The J1 payload with the algorithm's container, as ocean.js sends it. */
  function withContainer() {
    const payload = j1Payload()
    payload.algorithm.meta.container = {
      image: 'node',
      tag: '22',
      entrypoint: 'node $ALGO',
      checksum: `sha256:${'ab'.repeat(32)}`
    } as never
    return payload
  }

  it('keeps the payload as deep as an event field: algorithm.meta.container is readable', () => {
    const log = captureLog()

    LoggerInstance.error('Payload was:', withContainer())
    LoggerInstance.error('Payload was:', JSON.stringify(withContainer()))

    for (const event of log.events) {
      const [payload] = event.fields.args as [
        { algorithm: { meta: { container: unknown } }; nonce: string }
      ]
      expect(payload.algorithm.meta.container).to.deep.equal(
        withContainer().algorithm.meta.container
      )
      expect(payload.nonce).to.equal('<redacted>')
    }
    expectNoJ1Secret(JSON.stringify(log.events))
  })

  it("bounds a node's large answer body: 31.7 MB costs milliseconds, not seconds (D42)", async () => {
    // ocean.js logs a node's error body at error level, and the node is the asset
    // publisher's choice. The round-2 review's shape: 20 keys a level, 5 levels, 3.2 million
    // leaves, 31.7 MB as JSON. Each level reuses one object, so it builds at once; the
    // redaction walks it as it would the parsed body.
    let body: unknown = 'x'
    for (let level = 0; level < 5; level++) {
      const next: Record<string, unknown> = {}
      for (let key = 0; key < 20; key++) next[`k${key}`] = body
      body = next
    }
    expect(JSON.stringify(body).length).to.be.greaterThan(31_000_000)
    // The capture is timed, not the debug channel's hand-over of the raw body, which runs
    // only when a user turns debug on: off here, also under NAUTILUS_TEST_DEBUG.
    setDebug({ level: 'off' })
    const log = captureLog()

    const spent = await cpuTime(() =>
      LoggerInstance.error('Compute start failed:', body)
    )

    // 6.6 s with the deeper args and no budget; 12 ms before the deeper args.
    expect(spent).to.be.below(300)
    const printed = JSON.stringify(log.events)
    expect(log.events).to.have.length(1)
    expect(printed.length).to.be.below(100_000)
    // Where the budget ran out, each level says how much it left out.
    const [arg] = log.events[0].fields.args as [Record<string, unknown>]
    expect(arg.k0).to.have.property('k0')
    expect(arg['…']).to.match(/^\d+ more$/)
  })

  it('puts a JSON string over 64 KB in args, as text, redacted', () => {
    const log = captureLog()
    const large = JSON.stringify({
      ...j1Payload(),
      padding: 'x'.repeat(70_000)
    })

    LoggerInstance.error('Payload was:', large)

    const [event] = log.events
    expect(event.msg).to.equal('Payload was:')
    expect(event.fields.args).to.have.length(1)
    expect(typeof (event.fields.args as unknown[])[0]).to.equal('string')
    expectNoJ1Secret(JSON.stringify(event))
  })

  it("redacts a policy-server state by its shape, and keeps a lifecycle state readable (no 'state' key rule)", () => {
    const log = captureLog()

    LoggerInstance.error('checkSessionId failed:', {
      tokenResponse: { state: FAKE.policySessionId },
      lifecycle: { state: 2 }
    })

    const [record] = log.events[0].fields.args as [
      {
        tokenResponse: { state: string }
        lifecycle: { state: number }
      }
    ]
    expect(record.tokenResponse.state).not.to.contain(FAKE.policySessionId)
    expect(record.lifecycle.state).to.equal(2)
  })

  it('parses a JSON argument once', () => {
    const log = captureLog()
    const text = JSON.stringify(j1Payload())
    const parse = vi.spyOn(JSON, 'parse')

    LoggerInstance.error('Payload was:', text)

    expect(log.events).to.have.length(1)
    expect(
      parse.mock.calls.filter(([argument]) => argument === text)
    ).to.have.length(1)
  })
})

describe('the build', () => {
  it("tells bundlers that the logger's import has a side effect (the capture)", async () => {
    const { readFile } = await import('node:fs/promises')
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    ) as { scripts: Record<string, string> }
    const written = /printf '(.*)' > \.\/src\/_esm\/package\.json/.exec(
      manifest.scripts['build:esm']
    )?.[1]

    expect(JSON.parse(written ?? '{}')).to.deep.equal({
      type: 'module',
      sideEffects: ['./log/logger.js', './log/oceanjs.js']
    })
  })
})
