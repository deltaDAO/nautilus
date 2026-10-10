import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import { makeError } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PolicySessionResolver } from '../../src/identity/PolicySessionResolver.js'
import { MemorySessionStore } from '../../src/identity/session.js'
import { processEnv, readLoggingEnv } from '../../src/log/env.js'
import { isLogEventName, LOG_COMPONENTS } from '../../src/log/events.js'
import {
  createLogger,
  LOG_EVENTS,
  type LogEvent,
  type LogEventName
} from '../../src/log/index.js'
import { LOG_LEVELS } from '../../src/log/levels.js'
import {
  configureLogging,
  getLoggingConfig,
  log,
  resetLogging,
  setLogTap
} from '../../src/log/logger.js'
import { formatPretty } from '../../src/log/sinks.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import { captureLog } from '../helpers.js'
import { allowMadeUpFields, FAKE, findSecrets } from '../secretScan.js'

/** A spy on stderr, where the default logger prints, returning the lines. */
function stderrLines() {
  const lines: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    lines.push(...String(chunk).split('\n').filter(Boolean))
    return true
  })
  return lines
}

/** Sets `process.stderr.isTTY` for the duration of `run`. */
function withTty(isTTY: boolean, run: () => void) {
  const before = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
  Object.defineProperty(process.stderr, 'isTTY', {
    value: isTTY,
    configurable: true
  })
  try {
    run()
  } finally {
    if (before) Object.defineProperty(process.stderr, 'isTTY', before)
    else delete (process.stderr as { isTTY?: boolean }).isTTY
  }
}

/** Every secret of the fixtures, in every place a call site could put one. */
function leakyFields() {
  return {
    url: FAKE.rpcUrl,
    rpcUrl: FAKE.rpcUrl,
    nodeUri: `https://user:pass@node.example.org/api?sessionId=${FAKE.sessionId}`,
    endpoint: FAKE.rpcUrl,
    sessionId: FAKE.sessionId,
    signature: FAKE.signature,
    nonce: FAKE.nonce,
    jwt: FAKE.jwt,
    token: FAKE.rpcQueryToken,
    authorization: `Bearer ${FAKE.jwt}`,
    secretAccessKey: FAKE.s3Secret,
    error: new Error(
      `\u001b[31mserver response 500 (requestUrl="${FAKE.rpcUrl}", body={"sessionId":"${FAKE.sessionId}","signature":"${FAKE.signature}"}, id_token=${FAKE.jwt})`
    ),
    pointer: {
      type: 's3',
      s3Access: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: FAKE.s3Secret },
      headers: { Authorization: `Bearer ${FAKE.jwt}` }
    },
    note: `see ${FAKE.rpcUrl} with ${FAKE.jwt} and ${FAKE.signature}`,
    causes: [new Error(`at ${FAKE.rpcUrl}`)]
  }
}

/** A token contract's address, which a `…Token` key keeps. */
const PAYMENT_TOKEN = '0x1B3fC2A9e4d5E6f708192a3b4C5d6E7f80912a3B'

const LEAKY_MESSAGE = `Failed at ${FAKE.rpcUrl}: signature=${FAKE.signature} sessionId=${FAKE.sessionId} ${FAKE.jwt}`

afterEach(() => {
  vi.restoreAllMocks()
  LoggerInstance.setLevel(LogLevel.Error)
})

describe('secret scan (V b)', () => {
  it('no format and no sink sees an RPC token, session id, signature, JWT or S3 secret', () => {
    allowMadeUpFields()
    const sunk: LogEvent[] = []
    const lines = stderrLines()
    // One event per level the catalogue has, through all three outputs.
    const names: LogEventName[] = [
      'publish.preflight.denies_all', // warn
      'compute.result.not_ready', // info
      'publish.tokens.created' // debug
    ]

    for (const output of [
      { format: 'json' as const },
      { format: 'pretty' as const },
      { sink: (event: LogEvent) => sunk.push(event) }
    ]) {
      resetLogging({})
      configureLogging({ level: 'trace', ...output })
      for (const name of names) log.emit(name, LEAKY_MESSAGE, leakyFields())
    }

    const outputs = [...lines, ...sunk.map((event) => JSON.stringify(event))]
    expect(outputs).to.have.length(9)
    for (const output of outputs) {
      expect(findSecrets(output)).to.deep.equal([])
      for (const secret of [
        FAKE.rpcPathToken,
        FAKE.rpcQueryToken,
        FAKE.sessionId,
        FAKE.signature,
        FAKE.jwt,
        FAKE.s3Secret,
        FAKE.nonce
      ])
        expect(output).not.to.contain(secret)
    }
  })

  it('the scan finds each kind of secret in unredacted text', () => {
    expect(findSecrets(FAKE.rpcUrl)).to.include('URL with more than its origin')
    expect(findSecrets(`id ${FAKE.jwt}`)).to.include('JWT')
    expect(findSecrets(FAKE.signature)).to.include('65-byte hex signature')
    expect(findSecrets(`sessionId=${FAKE.sessionId}`)).to.include(
      'credential as key=value'
    )
    expect(findSecrets(`{"secretAccessKey":"${FAKE.s3Secret}"}`)).to.include(
      'credential as a JSON field'
    )
    expect(findSecrets('https://rpc.example.org')).to.deep.equal([])
  })
})

describe('JSON format and the catalogue (V c)', () => {
  it('prints one parsable JSON object per line, each a catalogued event', () => {
    const lines = stderrLines()
    configureLogging({ level: 'trace', format: 'json' })

    log.emit('publish.preflight.denies_all', 'one', { endpoint: FAKE.rpcUrl })
    log.emit('access.order.settled', 'two\nlines', {
      did: 'did:ope:1',
      txHash: '0xabc',
      reused: true
    })
    log.emit('compute.job.started', 'three', () => ({ jobIds: ['a', 'b'] }))

    expect(lines).to.have.length(3)
    const events = lines.map((line) => JSON.parse(line) as LogEvent)
    for (const event of events) {
      expect(isLogEventName(event.event)).to.equal(true)
      expect(event.level).to.equal(LOG_EVENTS[event.event].level)
      expect(event.component).to.equal(LOG_EVENTS[event.event].component)
      expect(Date.parse(event.time)).to.be.a('number').and.not.NaN
    }
    expect(events[0].fields).to.deep.equal({
      endpoint: 'https://rpc.example.org'
    })
    expect(events[1]).to.deep.include({
      msg: 'two lines',
      did: 'did:ope:1',
      txHash: '0xabc',
      fields: { reused: true }
    })
  })

  it('names every event component.step.outcome, under its own component', () => {
    for (const [name, spec] of Object.entries(LOG_EVENTS)) {
      expect(name).to.match(/^[a-z]+\.[a-z0-9_]+\.[a-z0-9_]+$/)
      expect(name.split('.')[0]).to.equal(spec.component)
      expect(LOG_COMPONENTS).to.include(spec.component)
      expect(LOG_LEVELS).to.include(spec.level)
      expect(spec.description.length).to.be.greaterThan(20)
    }
  })

  it('every event name in the source is catalogued, and every catalogued event is emitted', () => {
    const sources = files(join(import.meta.dirname, '../../src')).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.includes('/_esm/') &&
        !file.includes('/_types/') &&
        !file.endsWith('/log/events.ts')
    )
    const components = LOG_COMPONENTS.join('|')
    const pattern = new RegExp(
      `'((?:${components})\\.[a-z0-9_]+\\.[a-z0-9_]+)'`,
      'g'
    )
    const used = new Set<string>()
    for (const file of sources)
      for (const [, name] of readFileSync(file, 'utf8').matchAll(pattern))
        used.add(name)

    expect([...used].filter((name) => !isLogEventName(name))).to.deep.equal([])
    expect(
      Object.keys(LOG_EVENTS).filter((name) => !used.has(name))
    ).to.deep.equal([])
  })
})

describe('the default level (V d)', () => {
  it('is warn: only warnings and errors print', () => {
    resetLogging({})
    const lines = stderrLines()

    expect(getLoggingConfig().level).to.equal('warn')
    expect(
      LOG_LEVELS.filter((level) => log.enabled(level, 'publish'))
    ).to.deep.equal(['error', 'warn'])

    log.emit('publish.preflight.denies_all', 'a warning', {})
    log.emit('compute.result.not_ready', 'an info', {})
    log.emit('publish.tokens.created', 'a debug', {})
    log.emit('node.indexer_wait.rate_limited', 'another debug', {})

    expect(lines).to.have.length(1)
    expect(lines[0]).to.contain('publish.preflight.denies_all')
  })

  it('components narrow info, debug and trace, never warnings', () => {
    const log = captureLog({ level: 'trace' })
    configureLogging({ components: ['compute'] })

    for (const name of [
      'publish.preflight.denies_all',
      'publish.tokens.created',
      'compute.job.started'
    ] as const)
      createLogger().emit(name, name)

    expect(log.events.map((event) => event.event)).to.deep.equal([
      'publish.preflight.denies_all',
      'compute.job.started'
    ])
  })
})

describe('disabled levels (V e)', () => {
  it('evaluate no lazy fields and cost next to nothing', () => {
    // The suite's tap builds every event; take it out to measure the logger itself.
    const tap = setLogTap(undefined)
    try {
      resetLogging({})
      let evaluated = 0
      const fields = () => {
        evaluated++
        return { nftAddress: '0x1', datatokenAddress: '0x2' }
      }

      const runs = 200_000
      const started = performance.now()
      for (let i = 0; i < runs; i++)
        log.emit('publish.tokens.created', () => `run ${i}`, fields)
      const elapsed = performance.now() - started

      expect(evaluated).to.equal(0)
      // About 10 ms on a laptop; the bound only catches building or redacting the event.
      expect(elapsed).to.be.lessThan(1_500)

      const sunk: LogEvent[] = []
      configureLogging({ level: 'debug', sink: (event) => sunk.push(event) })
      log.emit('publish.tokens.created', 'on', fields)
      expect(evaluated).to.equal(1)
      expect(sunk[0].fields).to.deep.equal({
        nftAddress: '0x1',
        datatokenAddress: '0x2'
      })
    } finally {
      setLogTap(tap)
    }
  })
})

describe('regressions (V f)', () => {
  describe('environment variables', () => {
    it('reads level, format and components, in any case', () => {
      expect(
        readLoggingEnv({
          NAUTILUS_LOG_LEVEL: ' DEBUG ',
          NAUTILUS_LOG_FORMAT: 'Json',
          NAUTILUS_LOG_COMPONENTS: 'publish, Compute'
        })
      ).to.deep.equal({
        settings: {
          level: 'debug',
          format: 'json',
          components: ['publish', 'compute']
        },
        problems: []
      })
      expect(
        readLoggingEnv({ NAUTILUS_LOG_LEVEL: '  ' }).settings
      ).to.deep.equal({})
    })

    it('ignores an invalid value, with one warning per variable', () => {
      const lines = stderrLines()

      resetLogging({
        NAUTILUS_LOG_LEVEL: 'verbose',
        NAUTILUS_LOG_FORMAT: 'xml',
        NAUTILUS_LOG_COMPONENTS: 'publish,nope'
      })

      expect(getLoggingConfig()).to.deep.include({
        level: 'warn',
        format: undefined,
        components: ['publish']
      })
      expect(lines).to.have.length(3)
      expect(
        lines.every((line) => line.includes('config.env.invalid'))
      ).to.equal(true)
      expect(lines[0]).to.match(
        /NAUTILUS_LOG_LEVEL='verbose' is not understood/
      )
    })

    it('is overridden by configureLogging, and comes back when an option is unset', () => {
      resetLogging({ NAUTILUS_LOG_LEVEL: 'debug' })
      expect(getLoggingConfig().level).to.equal('debug')

      configureLogging({ level: 'error' })
      expect(getLoggingConfig().level).to.equal('error')

      configureLogging({ level: undefined })
      expect(getLoggingConfig().level).to.equal('debug')
    })

    it('rejects an unknown option value in code', () => {
      expect(() => configureLogging({ level: 'verbose' as never })).to.throw(
        /unknown level 'verbose'/
      )
      expect(() =>
        configureLogging({ components: ['nope' as never] })
      ).to.throw(/unknown component\(s\) nope/)
      expect(() => createLogger({ format: 'xml' as never })).to.throw(
        /unknown format 'xml'/
      )
    })
  })

  describe('the stderr output', () => {
    it('is pretty in a terminal', () => {
      const lines = stderrLines()
      withTty(true, () =>
        log.emit('publish.preflight.denies_all', 'denies every consumer', {
          endpoint: 'https://node.example.org/x'
        })
      )

      expect(lines).to.deep.equal([
        '[nautilus] [publish] warn: denies every consumer (publish.preflight.denies_all endpoint=https://node.example.org)'
      ])
    })

    it('is JSON lines otherwise', () => {
      const lines = stderrLines()
      withTty(false, () =>
        log.emit('publish.preflight.denies_all', 'denies every consumer')
      )

      expect(JSON.parse(lines[0])).to.deep.include({
        event: 'publish.preflight.denies_all',
        level: 'warn',
        msg: 'denies every consumer'
      })
    })

    it('follows an explicit format in either case', () => {
      const lines = stderrLines()
      configureLogging({ format: 'json' })
      withTty(true, () => log.emit('publish.preflight.denies_all', 'x'))
      configureLogging({ format: 'pretty' })
      withTty(false, () => log.emit('publish.preflight.denies_all', 'x'))

      expect(() => JSON.parse(lines[0])).not.to.throw()
      expect(lines[1]).to.match(/^\[nautilus\] \[publish\] warn: x/)
    })
  })

  describe('a sink', () => {
    it('receives the structured, redacted event instead of stderr', () => {
      const lines = stderrLines()
      const received: LogEvent[] = []
      configureLogging({ sink: (event) => received.push(event) })

      log.emit('access.order.lookup_failed', 'lookup failed', {
        datatokenAddress: '0xdt',
        error: new Error(`timeout at ${FAKE.rpcUrl}`)
      })

      expect(lines).to.deep.equal([])
      expect(received).to.have.length(1)
      expect(received[0]).to.deep.include({
        level: 'warn',
        event: 'access.order.lookup_failed',
        component: 'access',
        msg: 'lookup failed',
        fields: {
          datatokenAddress: '0xdt',
          error: 'timeout at https://rpc.example.org'
        }
      })
    })

    it('adapts to an app logger in a few lines', () => {
      const pinoLike = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
      configureLogging({
        level: 'debug',
        sink: ({ level, event, msg, fields }) =>
          pinoLike[level as 'warn' | 'info' | 'debug'](
            { event, ...fields },
            msg
          )
      })

      log.emit('compute.duration.capped', 'capped', {
        requested: 9000,
        ceiling: 3600
      })

      expect(pinoLike.warn).toHaveBeenCalledWith(
        { event: 'compute.duration.capped', requested: 9000, ceiling: 3600 },
        'capped'
      )
    })

    it('that throws does not break the operation', () => {
      configureLogging({
        sink: () => {
          throw new Error('sink down')
        }
      })

      expect(() =>
        log.emit('publish.preflight.denies_all', 'still fine')
      ).not.to.throw()
    })
  })

  describe('redaction by key', () => {
    function redacted(fields: Record<string, unknown>, msg = 'm') {
      allowMadeUpFields()
      const log = captureLog({ level: 'trace' })
      createLogger().emit('publish.tokens.created', msg, fields)
      return log.events[0]
    }

    it('replaces credentials and one-time values', () => {
      const { fields } = redacted({
        sessionId: FAKE.sessionId,
        signature: FAKE.signature,
        nonce: FAKE.nonce,
        jwt: FAKE.jwt,
        token: 'tok',
        Authorization: 'Bearer x',
        secretAccessKey: FAKE.s3Secret,
        nested: { consumerSignature: '0x12', apiKey: 'k' },
        paymentToken: PAYMENT_TOKEN,
        accessKeyId: 'AKIDEXAMPLE'
      })

      expect(fields).to.deep.equal({
        sessionId: '<redacted>',
        signature: '<redacted>',
        nonce: '<redacted>',
        jwt: '<redacted>',
        token: '<redacted>',
        Authorization: '<redacted>',
        secretAccessKey: '<redacted>',
        nested: { consumerSignature: '<redacted>', apiKey: '<redacted>' },
        paymentToken: PAYMENT_TOKEN,
        accessKeyId: 'AKIDEXAMPLE'
      })
    })

    it('reduces a url or uri to its origin, without user info', () => {
      const { fields } = redacted({
        url: FAKE.rpcUrl,
        nodeUri: 'https://user:pass@node.example.org:8443/api?x=1#y',
        endpoint: 'http://127.0.0.1:8001/',
        requestUrl: 'https://rpc.example.org/key',
        redirect_uri: 'openid4vp://authorize?request_uri=https://v.example/abc',
        peer: '16Uiu2HAmPeerId'
      })

      expect(fields).to.deep.equal({
        url: 'https://rpc.example.org',
        nodeUri: 'https://node.example.org:8443',
        endpoint: 'http://127.0.0.1:8001',
        requestUrl: 'https://rpc.example.org',
        redirect_uri: 'openid4vp://authorize',
        peer: '16Uiu2HAmPeerId'
      })
    })

    it('passes an error through the sanitiser', () => {
      const error = new TypeError(
        `\u001b[31mfetch failed\u001b[0m\nat ${FAKE.rpcUrl} signature=${FAKE.signature}`
      )
      const { fields } = redacted({ error, cause: new Error('x'.repeat(900)) })

      expect(fields.error).to.equal(
        'TypeError: fetch failed at https://rpc.example.org signature=<redacted>'
      )
      expect(String(fields.cause)).to.have.length(501)
    })

    it('sanitises and bounds the message and free text', () => {
      const event = redacted(
        { note: `token at ${FAKE.rpcUrl}`, big: 10n, when: new Date(0) },
        `\u001b[2Jsee ${FAKE.rpcUrl}\r\n${'y'.repeat(3000)}`
      )

      expect(event.msg.startsWith('see https://rpc.example.org y')).to.equal(
        true
      )
      expect(event.msg).to.have.length(2001)
      expect(event.fields).to.deep.equal({
        note: 'token at https://rpc.example.org',
        big: '10',
        when: '1970-01-01T00:00:00.000Z'
      })
    })
  })

  describe('redaction by key, every spelling (fix round)', () => {
    function redacted(fields: Record<string, unknown>) {
      allowMadeUpFields()
      const log = captureLog({ level: 'trace' })
      createLogger().emit('publish.tokens.created', 'm', fields)
      return log.events[0].fields
    }

    it('redacts every spelling and suffix of a credential key', () => {
      const keys = [
        'session_id',
        'Session-Id',
        'policySessionId',
        'secret',
        'clientSecret',
        'client_secret',
        'secretKey',
        'secret_access_key',
        'AWS_SECRET_ACCESS_KEY',
        'refresh_token',
        'accessToken',
        'idToken',
        'vpToken',
        'bearerToken',
        'x-api-key',
        'private_key',
        'passphrase',
        'setCookie',
        'credentials',
        'credential',
        'presentation',
        'vpPresentation',
        'rawTx',
        'signed_tx',
        'consumer_signature',
        'proxyAuthorization',
        'mnemonic',
        'sid',
        'SID',
        'nonce',
        'token'
      ]
      const fields = redacted(
        Object.fromEntries(keys.map((key) => [key, 'value-that-must-not-show']))
      )

      expect(fields).to.deep.equal(
        Object.fromEntries(keys.map((key) => [key, '<redacted>']))
      )
    })

    it('keeps nonce and sid exact, and a token address, so ids and addresses stay readable', () => {
      const kept = {
        decryptNonce: 7,
        paymentToken: PAYMENT_TOKEN,
        baseToken: PAYMENT_TOKEN.toLowerCase(),
        datatokenAddress: '0xdt',
        orderTxId: '0xorder',
        accessKeyId: 'AKIDEXAMPLE',
        consideration: 'sid as part of a word'
      }

      expect(redacted(kept)).to.deep.equal(kept)
    })

    it('keeps a code that reads as an error code, and redacts any other', () => {
      expect(
        redacted({
          code: 'SERVER_ERROR',
          errorCode: 'ECONNREFUSED',
          nested: { code: -32005 },
          list: [{ code: 'CALL_EXCEPTION' }]
        })
      ).to.deep.equal({
        code: 'SERVER_ERROR',
        errorCode: 'ECONNREFUSED',
        nested: { code: -32005 },
        list: [{ code: 'CALL_EXCEPTION' }]
      })
      for (const code of ['SplxlOBeZQQYbYS6WxSbIA', 'abc', 4001, '123456'])
        expect(redacted({ code }).code).to.equal('<redacted>')
    })

    it("redacts a class instance's own properties, and a URL object to its origin", () => {
      class Credentials {
        constructor(
          readonly accessKeyId: string,
          readonly secretAccessKey: string
        ) {}
      }
      class Pointer {
        readonly type = 's3'
        readonly s3Access = new Credentials('AKIDEXAMPLE', FAKE.s3Secret)
        readonly endpoint = new URL(FAKE.rpcUrl)
      }

      expect(
        redacted({ pointer: new Pointer(), where: new URL(FAKE.rpcUrl) })
      ).to.deep.equal({
        pointer: {
          type: 's3',
          s3Access: {
            accessKeyId: 'AKIDEXAMPLE',
            secretAccessKey: '<redacted>'
          },
          endpoint: 'https://rpc.example.org'
        },
        where: 'https://rpc.example.org'
      })
    })

    it('strips control characters from keys, so a key can neither forge a line nor hide a credential', () => {
      const fields = redacted({
        'a\u001b[2J\nb': 1,
        'session\u0000Id': FAKE.sessionId,
        ['k'.repeat(300)]: 2
      })

      expect(Object.keys(fields)).to.deep.equal([
        'a b',
        'sessionId',
        `${'k'.repeat(100)}…`
      ])
      expect(fields.sessionId).to.equal('<redacted>')
      const line = formatPretty({
        time: '',
        level: 'warn',
        event: 'publish.tokens.created',
        component: 'publish',
        msg: 'm',
        fields
      })
      expect([...line].some((char) => char.charCodeAt(0) < 0x20)).to.equal(
        false
      )
    })
  })

  describe('redaction by key, round 3', () => {
    function redacted(fields: Record<string, unknown>) {
      allowMadeUpFields()
      const log = captureLog({ level: 'trace' })
      createLogger().emit('publish.tokens.created', 'm', fields)
      return log.events[0].fields
    }

    it('redacts the exact keys and the credential suffixes of round 2', () => {
      const keys = [
        'auth',
        'Bearer',
        'seed',
        'pk',
        'privkey',
        'otp',
        'PIN',
        'hmac',
        'sid',
        'requestUri',
        'seedPhrase',
        'walletMnemonic',
        'privKey',
        'sessionToken',
        'securityToken',
        'x-amz-security-token',
        'authorizationCode',
        'preAuthorizedCode',
        'pre-authorized_code',
        'authCode',
        'csrfToken',
        'apiToken',
        'secretToken',
        'basicAuth',
        'pinataGatewayToken',
        'aws_session_token'
      ]
      const fields = redacted(
        Object.fromEntries(keys.map((key) => [key, 'value-that-must-not-show']))
      )

      expect(fields).to.deep.equal(
        Object.fromEntries(keys.map((key) => [key, '<redacted>']))
      )
    })

    it('redacts a …token key unless it holds an EVM address', () => {
      expect(
        redacted({
          paymentToken: PAYMENT_TOKEN,
          datatoken: PAYMENT_TOKEN.toLowerCase(),
          feeToken: '0xabc',
          token: PAYMENT_TOKEN.slice(0, 41),
          baseToken: { address: PAYMENT_TOKEN },
          gatewayToken: 42
        })
      ).to.deep.equal({
        paymentToken: PAYMENT_TOKEN,
        datatoken: PAYMENT_TOKEN.toLowerCase(),
        feeToken: '<redacted>',
        token: '<redacted>',
        baseToken: '<redacted>',
        gatewayToken: '<redacted>'
      })
    })

    it('applies the code rule to every …code key, keeping an HTTP status for statusCode', () => {
      expect(
        redacted({
          errorCode: 'ECONNREFUSED',
          reasonCode: 'TIMEOUT',
          rpcCode: -32603,
          statusCode: 404,
          httpStatusCode: '503',
          authCode: 'SERVER_ERROR',
          otherCode: 404,
          code: 'JBSWY3DPEHPK3PXP',
          verifyCode: 'abc',
          bigStatusCode: 999
        })
      ).to.deep.equal({
        errorCode: 'ECONNREFUSED',
        reasonCode: 'TIMEOUT',
        rpcCode: -32603,
        statusCode: 404,
        httpStatusCode: '503',
        // Every suffix rule wins over the code rule.
        authCode: '<redacted>',
        otherCode: '<redacted>',
        code: '<redacted>',
        verifyCode: '<redacted>',
        bigStatusCode: '<redacted>'
      })
    })

    it('matches a key longer than it is printed, whole', () => {
      const long = `${'x'.repeat(150)}SessionId`
      const fields = redacted({
        [long]: 'value-that-must-not-show',
        ['y'.repeat(150)]: 'kept'
      })

      expect(Object.values(fields)).to.deep.equal(['<redacted>', 'kept'])
      expect(Object.keys(fields).every((key) => key.length === 101)).to.equal(
        true
      )
    })

    it('prints a byte array as its length', () => {
      expect(
        redacted({
          bytes: new Uint8Array(32),
          buffer: Buffer.from('a secret in bytes'),
          raw: new ArrayBuffer(4),
          nested: { list: [new Uint8Array(2)] }
        })
      ).to.deep.equal({
        bytes: '[32 bytes]',
        buffer: '[17 bytes]',
        raw: '[4 bytes]',
        nested: { list: ['[2 bytes]'] }
      })
    })

    it("redacts an ethers SERVER_ERROR's response body on an error's cause, in every output", () => {
      // ethers quotes `info` into its message: the body ends up as JSON in a JSON string.
      const rpc = makeError(
        'server response 500 Internal Server Error',
        'SERVER_ERROR',
        {
          request: FAKE.rpcUrl,
          info: {
            requestUrl: FAKE.rpcUrl,
            responseBody: `{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"accessToken":"rb-access-1","refresh_token":"rb-refresh-2","sid":"rb-sid-3","cookie":"rb-cookie-4","Authorization":"Basic cmItYmFzaWM6NQ==","sessionId":"${FAKE.sessionId}"}}`,
            responseStatus: '500 Internal Server Error'
          }
        }
      )
      const error = new Error('could not look up the order', { cause: rpc })
      const secrets = [
        'rb-access-1',
        'rb-refresh-2',
        'rb-sid-3',
        'rb-cookie-4',
        'cmItYmFzaWM6NQ==',
        FAKE.sessionId,
        FAKE.rpcPathToken,
        FAKE.rpcQueryToken
      ]
      // The raw message carries them all: the test would prove nothing otherwise.
      for (const secret of secrets) expect(rpc.message).to.contain(secret)

      const sunk: LogEvent[] = []
      const lines = stderrLines()
      for (const output of [
        { format: 'json' as const },
        { format: 'pretty' as const },
        { sink: (event: LogEvent) => sunk.push(event) }
      ]) {
        resetLogging({})
        configureLogging({ level: 'trace', ...output })
        log.emit('access.order.lookup_failed', 'm', {
          datatokenAddress: PAYMENT_TOKEN,
          error
        })
      }
      const outputs = [...lines, ...sunk.map((event) => JSON.stringify(event))]

      expect(outputs).to.have.length(3)
      for (const output of outputs) {
        for (const secret of secrets) expect(output).not.to.contain(secret)
        expect(output).to.contain('SERVER_ERROR')
        expect(output).to.contain('https://rpc.example.org')
        expect(findSecrets(output)).to.deep.equal([])
      }
      expect(String(sunk[0].fields.error)).to.contain(
        '\\"accessToken\\":\\"<redacted>\\"'
      )
    })
  })

  describe('errors (fix round)', () => {
    function error(value: unknown) {
      const log = captureLog({ level: 'trace' })
      createLogger().emit('access.order.lookup_failed', 'm', {
        error: value
      })
      return String(log.events[0].fields.error)
    }

    it('shows the cause, two levels deep, each sanitised, without repeating it', () => {
      const third = new Error('third level')
      const second = new Error(
        `connect ECONNREFUSED at ${FAKE.rpcUrl} sessionId=${FAKE.sessionId}`,
        { cause: third }
      )
      const first = new Error('could not detect network', { cause: second })
      const deeper = new Error('outer', { cause: first })

      expect(error(first)).to.equal(
        `could not detect network (cause: connect ECONNREFUSED at https://rpc.example.org sessionId=<redacted>; cause: third level)`
      )
      // Two levels at most: `third` is a third level of `deeper`.
      expect(error(deeper)).to.equal(
        'outer (cause: could not detect network; cause: connect ECONNREFUSED at https://rpc.example.org sessionId=<redacted>)'
      )
      // A cause that says the same adds nothing.
      expect(
        error(new Error('timeout', { cause: new Error('timeout') }))
      ).to.equal('timeout')
      // A cycle ends.
      const cyclic = new Error('a') as Error & { cause?: unknown }
      cyclic.cause = cyclic
      expect(error(cyclic)).to.equal('a')
    })

    it('shows a thrown non-Error by its message and code, never [object Object]', () => {
      expect(
        error({ code: 'ACTION_REJECTED', message: 'user rejected action' })
      ).to.equal('ACTION_REJECTED: user rejected action')
      expect(error({ code: 'oauth-code-xyz', message: 'refused' })).to.equal(
        'refused'
      )
      expect(error({ status: 500, secretAccessKey: FAKE.s3Secret })).to.equal(
        '{"status":500,"secretAccessKey":"<redacted>"}'
      )
      expect(error('plain text')).to.equal('plain text')
    })

    it("sanitises the error's name", () => {
      const evil = new Error('m')
      evil.name = `\u001b[31mEvil\nName ${FAKE.jwt}`

      expect(error(evil)).to.equal('Evil Name <redacted>: m')
    })
  })

  describe('emit never throws (fix round)', () => {
    it('turns fields that cannot be read into fieldsError', () => {
      const received: LogEvent[] = []
      configureLogging({ sink: (event) => received.push(event) })
      const fields = {
        get nodeUri(): string {
          throw new Error(`getter failed at ${FAKE.rpcUrl}`)
        }
      }

      expect(() =>
        log.emit('publish.preflight.denies_all', 'still logged', fields)
      ).not.to.throw()
      expect(received).to.have.length(1)
      expect(received[0].msg).to.equal('still logged')
      expect(received[0].fields).to.deep.equal({
        fieldsError: 'getter failed at https://rpc.example.org'
      })
    })

    it('drops a line stderr refuses', () => {
      vi.spyOn(process.stderr, 'write').mockImplementation(() => {
        throw new Error('EPIPE')
      })

      expect(() =>
        log.emit('publish.preflight.denies_all', 'lost')
      ).not.to.throw()
    })
  })

  describe("configureLogging's oceanjs option (not active yet)", () => {
    it("warns once per mode, 'capture' included", () => {
      const log = captureLog()

      configureLogging({ oceanjs: 'capture' })
      configureLogging({ oceanjs: 'silent' })
      configureLogging({ oceanjs: 'silent' })
      configureLogging({ oceanjs: 'passthrough' })

      expect(
        log.events.map((event) => [event.event, event.fields.mode])
      ).to.deep.equal([
        ['config.oceanjs.not_active', 'capture'],
        ['config.oceanjs.not_active', 'silent'],
        ['config.oceanjs.not_active', 'passthrough']
      ])
      expect(log.events[0].msg).to.contain('LoggerInstance.setLevel')
      expect(getLoggingConfig().oceanjs).to.equal('passthrough')
    })
  })

  describe('Nautilus.setLogLevel (deprecated)', () => {
    it("maps ocean.js's levels and still sets ocean.js's own", () => {
      const cases: [LogLevel, string][] = [
        [LogLevel.None, 'silent'],
        [LogLevel.Error, 'error'],
        [LogLevel.Warn, 'warn'],
        [LogLevel.Log, 'info'],
        [LogLevel.Verbose, 'trace']
      ]

      for (const [level, expected] of cases) {
        Nautilus.setLogLevel(level)
        expect(getLoggingConfig().level).to.equal(expected)
        expect(
          (LoggerInstance as unknown as { logLevel: LogLevel }).logLevel
        ).to.equal(level)
      }
    })

    it('silences nautilus with None', () => {
      const lines = stderrLines()
      Nautilus.setLogLevel(LogLevel.None)

      log.emit('publish.preflight.denies_all', 'hidden')

      expect(lines).to.deep.equal([])
    })
  })

  describe('a logger of its own', () => {
    it('overrides the process-wide options it sets, and follows the rest', () => {
      const global = captureLog()
      const own: LogEvent[] = []
      const tenant = createLogger({
        level: 'debug',
        sink: (event) => own.push(event)
      })

      tenant.emit('publish.tokens.created', 'debug, tenant')
      log.emit('publish.tokens.created', 'debug, global')
      tenant.emit('publish.preflight.denies_all', 'warn, tenant')

      expect(own.map((event) => event.msg)).to.deep.equal([
        'debug, tenant',
        'warn, tenant'
      ])
      expect(global.events).to.deep.equal([])

      // No level of its own: it follows configureLogging.
      const follower: LogEvent[] = []
      const quiet = createLogger({ sink: (event) => follower.push(event) })
      configureLogging({ level: 'silent' })
      quiet.emit('publish.preflight.denies_all', 'hidden')
      expect(follower).to.deep.equal([])
    })

    it('reaches the components Nautilus hands it to', () => {
      const global = captureLog()
      const own: LogEvent[] = []

      new PolicySessionResolver({
        sessionStore: new MemorySessionStore(),
        persistPresentedSessions: true,
        logger: createLogger({ sink: (event) => own.push(event) })
      })

      expect(own.map((event) => event.event)).to.deep.equal([
        'identity.sessions.presented_persisted'
      ])
      expect(global.events).to.deep.equal([])
    })

    it('prints a once event once per key, and forgets the oldest of many keys', () => {
      const own: LogEvent[] = []
      const logger = createLogger({ sink: (event) => own.push(event) })

      for (let i = 0; i < 3; i++)
        logger.emit('node.policy_server.empty_url', 'a', {}, { once: 'a' })
      expect(own).to.have.length(1)

      for (let i = 0; i < 1_000; i++)
        logger.emit('node.policy_server.empty_url', 'k', {}, { once: `k${i}` })
      logger.emit('node.policy_server.empty_url', 'a again', {}, { once: 'a' })
      expect(own.at(-1)?.msg).to.equal('a again')
    })
  })

  describe('without process (a browser bundle)', () => {
    it('reads no environment and writes to the console', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const saved = globalThis.process
      let env: unknown
      try {
        // Synchronous, so nothing else runs without `process`.
        ;(globalThis as { process?: unknown }).process = undefined
        env = readLoggingEnv(processEnv())
        log.emit('publish.preflight.denies_all', 'in a browser', {
          endpoint: 'https://node.example.org/x'
        })
      } finally {
        globalThis.process = saved
      }

      expect(env).to.deep.equal({ settings: {}, problems: [] })
      expect(warn).toHaveBeenCalledWith(
        '[nautilus] [publish] warn: in a browser (publish.preflight.denies_all endpoint=https://node.example.org)'
      )
    })
  })
})

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
