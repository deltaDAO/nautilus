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
import { maskText } from '../../src/log/credentials.js'
import { type DebugEvent, setDebug } from '../../src/log/debug.js'
import { log } from '../../src/log/logger.js'
import { redactFields, redactMessage } from '../../src/log/redact.js'
import { formatJson, formatPretty } from '../../src/log/sinks.js'
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

/** The secrets and credentials the scans find in `text`. */
function leaks(text: string): string[] {
  return [...new Set([...findSecrets(text), ...findCredentials(text)])]
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
