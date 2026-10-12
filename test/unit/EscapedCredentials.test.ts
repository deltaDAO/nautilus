/**
 * Credentials hidden by JSON escaping in an RPC's answer, as a real ethers error quotes it:
 * the JSON-RPC `error` of a 200 answer in `could not coalesce error (error={ … })`, the
 * body of a 500 answer in `info={ "responseBody": … }`. Each level of quoting adds a level
 * of escaping, so a key the body itself quoted (`{"body":"{\"apiToken\":…}"}`) reaches the
 * redaction as `\\\"apiToken\\\"`. The redaction undoes the escapes before it matches keys
 * (`redactSecrets`, `src/node/messages.ts`), on every path an error reaches the output by:
 * an `error` field, `OceanNodeError.from`, an operation's `failed` event and the nonce
 * guard's scrub of a failed send.
 *
 * The errors come from ethers' own `JsonRpcProvider` against a local HTTP stub, so the
 * escaping is ethers', not a fixture's. Fake credentials only.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { JsonRpcProvider } from 'ethers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOperation } from '../../src/log/context.js'
import {
  maskCredentials,
  maskNeverShown,
  maskText,
  maskUrl
} from '../../src/log/credentials.js'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import { log } from '../../src/log/logger.js'
import { redactFields, redactMessage } from '../../src/log/redact.js'
import { formatJson, formatPretty } from '../../src/log/sinks.js'
import {
  MAX_UNESCAPE_LEVELS,
  undoEscapes,
  withEscapesUndone
} from '../../src/log/textShapes.js'
import { redactSecrets, sanitize } from '../../src/node/messages.js'
import { OceanNodeError } from '../../src/node/OceanNodeClient.js'
import { withoutSignedTransaction } from '../../src/utils/nonceGuard.js'
import { captureLog, cpuTime } from '../helpers.js'
import {
  CREDENTIAL_SHAPES,
  FAKE,
  findCredentials,
  findSecrets
} from '../secretScan.js'

const SHAPES = CREDENTIAL_SHAPES.split('\n')

/** The credential shapes an RPC's answer hid from the redaction, and the secret in each. */
const HIDDEN: [string, string, string][] = [
  ['a JSON `pinataGatewayToken`', SHAPES[2], FAKE.pinataGatewayToken],
  ['an `apiToken` in JSON inside JSON', SHAPES[7], FAKE.nestedApiToken],
  [
    'an `apiToken` with `\\u0022` quotes',
    `{\\u0022apiToken\\u0022:\\u0022${FAKE.nestedApiToken}\\u0022}`,
    FAKE.nestedApiToken
  ],
  [
    'a `pinataGatewayToken` quoted three times',
    JSON.stringify(
      JSON.stringify(
        JSON.stringify({ pinataGatewayToken: FAKE.pinataGatewayToken })
      )
    ),
    FAKE.pinataGatewayToken
  ],
  ['a percent-encoded RPC URL', SHAPES[8], FAKE.rpcPathToken],
  [
    'a percent-encoded `apiToken=` and JSON field',
    SHAPES[9],
    FAKE.nestedApiToken
  ],
  [
    "an `apiToken` with `\\'` quotes",
    `{\\'apiToken\\': \\'${FAKE.nestedApiToken}\\'}`,
    FAKE.nestedApiToken
  ]
]

let server: Server
let answer = { status: 200, body: '' }
let rpcUrl = ''

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(answer.status, { 'content-type': 'application/json' })
      response.end(answer.body)
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  )
  rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** The error ethers throws for an RPC that answers `status` with `text` in its error. */
async function rpcError(status: number, text: string): Promise<Error> {
  answer = {
    status,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: `upstream failed: ${text}` }
    })
  }
  const provider = new JsonRpcProvider(rpcUrl, 1, { staticNetwork: true })
  try {
    await provider.getBlockNumber()
  } catch (error) {
    return error as Error
  } finally {
    provider.destroy()
  }
  throw new Error('the stub RPC answered without an error')
}

/**
 * The secrets and credentials the scans find in `text`; with `masked` (the `sensitive`
 * debug tier, which keeps what is not a long-lived credential), the credentials only.
 */
function leaks(text: string, masked = false): string[] {
  return masked
    ? findCredentials(text)
    : [...new Set([...findSecrets(text), ...findCredentials(text)])]
}

describe('a credential in an RPC answer quoted in an ethers error', () => {
  for (const [label, shape, secret] of HIDDEN)
    for (const status of [200, 500])
      it(`is redacted on every path: ${label}, HTTP ${status}`, async () => {
        const error = await rpcError(status, shape)
        // The control: ethers' message holds it.
        expect(error.message).to.contain(secret)

        expect(
          leaks(JSON.stringify(redactFields({ error }))),
          'field'
        ).to.deep.equal([])

        const nodeError = OceanNodeError.from('initialize', error)
        expect(
          leaks(
            `${nodeError.message} ${JSON.stringify(redactFields({ error: nodeError }))} ${(nodeError.cause as Error).message}`
          ),
          'OceanNodeError.from'
        ).to.deep.equal([])

        const captured = captureLog({ level: 'trace' })
        await expect(
          runOperation(log, 'access', async () => {
            throw error
          })
        ).rejects.toBe(error)
        const [failed] = captured.named('access.operation.failed')
        expect(
          leaks(`${formatJson(failed)}\n${formatPretty(failed)}`),
          'access.operation.failed'
        ).to.deep.equal([])

        const send = Object.assign(new Error(error.message), {
          shortMessage: error.message
        })
        withoutSignedTransaction(send)
        expect(
          leaks(`${send.message} ${send.shortMessage}`),
          'nonce guard'
        ).to.deep.equal([])
      })

  it('goes to the secrets debug tier whole, and not to the sensitive one', async () => {
    const error = await rpcError(500, SHAPES[7])

    for (const level of ['sensitive', 'secrets'] as const) {
      const events: DebugEvent[] = []
      setDebug({
        level,
        topics: ['order'],
        sink: (event) => events.push(event)
      })
      captureLog({ level: 'trace' })
      await runOperation(log, 'access', async () => {
        throw error
      }).catch(() => undefined)

      const raw = events.filter(
        (event) =>
          event.message === 'log event access.operation.failed before redaction'
      )
      expect(
        raw.map((event) => event.tier),
        level
      ).to.deep.equal([level])
      if (level === 'secrets')
        expect(JSON.stringify(raw[0].data)).to.contain(FAKE.nestedApiToken)
      else
        expect(findCredentials(JSON.stringify(raw[0].data))).to.deep.equal([])
    }
  })
})

describe('JSON escapes and the redaction', () => {
  it('keep their form when they hide nothing', () => {
    // A revert reason quoted twice: nothing to redact, so it reads as ethers wrote it.
    const text =
      'could not coalesce error (error={ "message": "{\\"reason\\":\\"execution reverted\\",\\"path\\":\\"a\\\\/b\\"}" })'
    expect(redactSecrets(text)).to.equal(text)
    expect(sanitize(text, 500, null)).to.equal(text)
  })

  it('stay redacted after the escapes are undone', () => {
    // The first pass redacts the URL and the signature; the second, unescaped, finds the
    // token. What the first pass removed does not come back.
    const text = `see https:\\/\\/rpc.example.org\\/v3\\/${FAKE.rpcPathToken} sig ${FAKE.signature} {\\\\\\"apiToken\\\\\\":\\\\\\"${FAKE.nestedApiToken}\\\\\\"}`
    const clean = redactSecrets(text)
    expect(leaks(clean)).to.deep.equal([])
    expect(clean).to.contain('https://rpc.example.org')
    expect(clean).to.contain('"apiToken":"<redacted>"')
  })

  it('a `\\u0022` key is masked at the sensitive debug tier too', () => {
    const masked = maskText(
      `{\\u0022apiToken\\u0022:\\u0022${FAKE.nestedApiToken}\\u0022}`
    )
    expect(findCredentials(masked)).to.deep.equal([])
  })

  it('undoes the escapes of hostile text in linear time (security regression)', async () => {
    // Runs of backslashes and `\u0022` escapes: each level of unescaping is one pass, and
    // there are at most six. A log message reads 16,000 characters.
    const slow: string[] = []
    for (const [label, text] of [
      ['backslashes', `${'\\'.repeat(15_999)}"`],
      ['escaped quotes', '\\\\\\"'.repeat(4_000)],
      ['u0022', '\\u0022'.repeat(2_700)],
      ['escaped keys', '\\\\\\"token\\\\\\":'.repeat(1_000)]
    ] as const) {
      const elapsed = await cpuTime(() => {
        redactMessage(text)
      })
      if (elapsed >= 60) slow.push(`${label}: ${elapsed.toFixed(0)} ms`)
    }
    expect(slow).to.deep.equal([])
  })
})

/** `text` quoted in JSON `times` times. */
function stringified(text: string, times: number): string {
  let quoted = text
  for (let time = 0; time < times; time++) quoted = JSON.stringify(quoted)
  return quoted
}

/** `text` percent-encoded `times` times. */
function percentEncoded(text: string, times: number): string {
  let encoded = text
  for (let time = 0; time < times; time++) encoded = encodeURIComponent(encoded)
  return encoded
}

/** A fake private key, for the never-shown keys of the `secrets` tier. */
const PRIVATE_KEY = `0x${'c0ffee'.repeat(10)}beef`

/**
 * Each output path a credential in `text` can reach, with what it shows. The `sensitive`
 * debug tier (`mask…`) keeps a URL's path and query, credentials masked.
 */
function everyPath(text: string): [string, string, boolean][] {
  const send = Object.assign(new Error(text), { shortMessage: text })
  withoutSignedTransaction(send)
  return [
    ['redactSecrets', redactSecrets(text), false],
    ['sanitize', sanitize(text, 20_000, null), false],
    ['redactMessage', redactMessage(text), false],
    [
      'error field',
      JSON.stringify(redactFields({ error: new Error(text) })),
      false
    ],
    ['string field', JSON.stringify(redactFields({ detail: text })), false],
    ['nonce guard', `${send.message} ${send.shortMessage}`, false],
    ['maskText', maskText(text), true],
    ['maskCredentials', JSON.stringify(maskCredentials({ note: text })), true]
  ]
}

describe('how deep escaping is undone (security regression)', () => {
  it('undoes eight levels, and no more, level by level', () => {
    expect(MAX_UNESCAPE_LEVELS).to.equal(8)
    // A quote under 9 levels is 511 backslashes and the quote; each level halves the run.
    expect(undoEscapes(`${'\\'.repeat(511)}"`)).to.equal('\\"')
    expect(undoEscapes(`${'\\'.repeat(255)}"`)).to.equal('"')
  })

  it('undoes `\\u` escapes only, not `\\U`, which JSON does not have', () => {
    expect(undoEscapes('\\u0022 \\u005C\\u0022')).to.equal('" "')
    expect(undoEscapes('\\U0022')).to.equal('\\U0022')
  })

  for (let depth = 0; depth <= 10; depth++)
    it(`redacts a key quoted ${depth} times on every path`, () => {
      const text = stringified(`{"apiToken":"${FAKE.nestedApiToken}"}`, depth)
      for (const [path, shown, masked] of everyPath(text))
        expect(leaks(shown, masked), `${path}, depth ${depth}`).to.deep.equal(
          []
        )

      const secret = stringified(`{"privateKey":"${PRIVATE_KEY}"}`, depth)
      expect(
        JSON.stringify(maskNeverShown(secret)),
        `maskNeverShown, depth ${depth}`
      ).not.to.contain(PRIVATE_KEY)
    })

  for (let depth = 1; depth <= 6; depth++)
    it(`redacts a key with \`\\u0022\` quotes quoted ${depth} times on every path`, () => {
      const text = stringified(
        `{"apiToken":"${FAKE.nestedApiToken}"}`,
        depth
      ).replace(/"/g, '\\u0022')
      for (const [path, shown, masked] of everyPath(text))
        expect(leaks(shown, masked), `${path}, depth ${depth}`).to.deep.equal(
          []
        )
    })

  for (const [label, text, secret] of [
    [
      'a percent-encoded URL',
      `see ${encodeURIComponent(FAKE.rpcUrl)}`,
      FAKE.rpcPathToken
    ],
    [
      'a percent-encoded `apiToken=` in a URL',
      `https://cb.example.org/cb?state=${encodeURIComponent(`apiToken=${FAKE.nestedApiToken}`)}`,
      FAKE.nestedApiToken
    ],
    [
      'a percent-encoded JSON field',
      encodeURIComponent(`{"apiToken":"${FAKE.nestedApiToken}"}`),
      FAKE.nestedApiToken
    ],
    [
      'a percent-encoded `apiToken=` quoted twice',
      stringified(
        JSON.stringify({
          q: encodeURIComponent(`apiToken=${FAKE.nestedApiToken}`)
        }),
        2
      ),
      FAKE.nestedApiToken
    ],
    [
      'escaped single quotes',
      `{\\'apiToken\\': \\'${FAKE.nestedApiToken}\\'}`,
      FAKE.nestedApiToken
    ]
  ] as const)
    it(`redacts ${label} on every path`, () => {
      for (const [path, shown, masked] of everyPath(text)) {
        expect(shown, path).not.to.contain(secret)
        expect(leaks(shown, masked), path).to.deep.equal([])
      }
    })

  // Past the eight undone levels, a chain of encoded percent signs (`%25…3D`) is read to
  // its end, and the backslashes it encodes are flattened after it.
  for (const levels of [10, 12, 16])
    for (const [label, text, secret] of [
      [
        'a JSON key',
        `{"apiToken":"${FAKE.nestedApiToken}"}`,
        FAKE.nestedApiToken
      ],
      ['`apiToken=`', `apiToken=${FAKE.nestedApiToken}`, FAKE.nestedApiToken],
      ['a URL', `see ${FAKE.rpcUrl} now`, FAKE.rpcPathToken]
    ] as const)
      it(`redacts ${label} percent-encoded ${levels} times on every path`, () => {
        for (const [path, shown, masked] of everyPath(
          percentEncoded(text, levels)
        )) {
          expect(shown, path).not.to.contain(secret)
          expect(leaks(shown, masked), path).to.deep.equal([])
        }
      })

  for (const [label, text] of [
    [
      'percent-encoded 9 times around 2 JSON levels',
      percentEncoded(stringified(`{"apiToken":"${FAKE.nestedApiToken}"}`, 2), 9)
    ],
    [
      'percent-encoded 10 times around 6 JSON levels',
      percentEncoded(
        stringified(`{"apiToken":"${FAKE.nestedApiToken}"}`, 6),
        10
      )
    ],
    [
      'quoted 4 times around 12 percent levels',
      stringified(
        percentEncoded(`{"apiToken":"${FAKE.nestedApiToken}"}`, 12),
        4
      )
    ],
    [
      'percent and JSON alternating, 20 levels',
      (() => {
        let mixed = `{"apiToken":"${FAKE.nestedApiToken}"}`
        for (let level = 0; level < 20; level++)
          mixed = level % 2 ? JSON.stringify(mixed) : encodeURIComponent(mixed)
        return mixed
      })()
    ]
  ] as const)
    it(`redacts a key ${label} on every path`, () => {
      for (const [path, shown, masked] of everyPath(text)) {
        expect(shown, path).not.to.contain(FAKE.nestedApiToken)
        expect(leaks(shown, masked), path).to.deep.equal([])
      }
    })

  it('flattens hostile percent chains in linear time', async () => {
    // 4 MB of `%25…` chains: one long chain, chains that end in no character, and chains
    // that encode backslashes and quotes. Each is read past the eight undone levels.
    const chain = (length: number) => `%${'25'.repeat(length)}`
    const slow: string[] = []
    for (const [label, text] of [
      ['one chain', `${chain(2_000_000)}3D`],
      ['dangling chains', `${chain(60)}zz `.repeat(32_000)],
      ['encoded backslashes', `${chain(12)}5C`.repeat(140_000)],
      ['encoded quotes', `apiToken${chain(12)}22:`.repeat(110_000)]
    ] as const) {
      expect(text.length, label).to.be.above(3_700_000)
      // The flatten pass runs: three passes, not two.
      let passes = 0
      withEscapesUndone(text, (read) => {
        passes++
        return `${read}.`
      })
      expect(passes, label).to.equal(3)

      for (const [name, run] of [
        ['redactSecrets', () => redactSecrets(text)],
        ['maskText', () => maskText(text)]
      ] as const) {
        // Linear takes 0.05-2 s here; quadratic would take hours.
        const elapsed = await cpuTime(run)
        if (elapsed >= 10_000)
          slow.push(`${label}, ${name}: ${elapsed.toFixed(0)} ms`)
      }
    }
    expect(slow).to.deep.equal([])
  }, 120_000)

  it("reads the first pass's output again, so what it redacted stays redacted", () => {
    // A toy pass that redacts `KEY` and, only when it reads it plainly, `"x"`.
    const pass = (text: string) =>
      text.replace(/KEY/g, '<r>').replace(/"x"/g, '<x>')
    expect(withEscapesUndone('KEY \\"y\\"', pass)).to.equal('<r> \\"y\\"')
    expect(withEscapesUndone('KEY \\"x\\"', pass)).to.equal('<r> <x>')
    // Past the limit, the flattened text is read too.
    expect(
      withEscapesUndone(`KEY ${'\\'.repeat(1023)}"x${'\\'.repeat(1023)}"`, pass)
    ).to.equal('<r> <x>')
  })
})

describe('the sensitive tier and JSON-escaped URLs (security regression)', () => {
  it('masks a URL with JSON-escaped slashes', () => {
    const masked = maskUrl(FAKE.rpcUrl.replace(/\//g, '\\/'))
    expect(findCredentials(masked)).to.deep.equal([])
    expect(masked).to.contain('rpc.example.org')
  })

  for (const more of [2, 3])
    it(`masks the RPC key of a nested body quoted ${more} more times, HTTP 500`, async () => {
      const error = await rpcError(500, stringified(SHAPES[7], more))
      expect(error.message).to.contain(FAKE.rpcPathToken)

      const events: DebugEvent[] = []
      setDebug({
        level: 'sensitive',
        topics: ['node'],
        sink: (event) => events.push(event)
      })
      OceanNodeError.from('initialize', error)
      setDebug({ level: 'off' })

      expect(events.length).to.be.greaterThan(0)
      for (const event of events)
        expect(
          findCredentials(JSON.stringify(event.data)),
          event.message
        ).to.deep.equal([])
    })
})

describe('the nonce guard and hostile RPC text (security regression)', () => {
  it('scrubs a failed send with a 4 MB error body in bounded time', async () => {
    // A hostile or broken RPC's answer: ethers quotes it in a 16 MB message.
    const error = await rpcError(500, `${'\\'.repeat(4_000_000)}"`)
    const elapsed = await cpuTime(() => {
      withoutSignedTransaction(error)
    })
    expect(elapsed).to.be.below(300)
    // Not the message itself: a failure would print 16 MB.
    expect(error.message.length).to.be.below(40_000)
  })

  it("strips the RPC's ANSI escapes and control characters from the messages", () => {
    const text = 'nonce too low\u001b[2J\u001b]0;title\u0007 again'
    const send = Object.assign(new Error(text), {
      shortMessage: text,
      error: { message: text }
    })
    withoutSignedTransaction(send)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
    const control = /[\u0000-\u001f\u007f]/
    for (const shown of [send.message, send.shortMessage, send.error.message])
      expect(shown).not.to.match(control)
    expect(send.message).to.equal('nonce too low again')
  })
})
