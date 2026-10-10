/**
 * The sensitive debug channel (`src/log/debug.ts`): off by default; when on, the raw values
 * nautilus redacts reach it at the right tier, and errors, return values and log events
 * stay exactly as redacted as without it.
 *
 * `test/setup.ts` turns it off before each test, and fails the suite on debug output while
 * it is off, on a debug event that is not one line, and on a `sensitive` event holding a
 * long-lived fixture credential.
 */
import { FetchRequest, makeError } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '../../src/identity/CredentialProvider.js'
import { PolicySessionResolver } from '../../src/identity/PolicySessionResolver.js'
import { addRequestCredentials } from '../../src/identity/policy.js'
import {
  CredentialPresentationError,
  WaltIdCredentialProvider
} from '../../src/identity/WaltIdProvider.js'
import {
  WaltIdHttpWallet,
  type WaltIdWallet
} from '../../src/identity/waltid/client.js'
import { maskText, maskUrl } from '../../src/log/credentials.js'
import {
  debug,
  debugBanner,
  debugEnabled,
  debugRaw,
  formatDebugLine,
  getDebugLevel,
  resetDebug,
  setDebug
} from '../../src/log/debug.js'
import { processEnv, readDebugEnv } from '../../src/log/env.js'
import type { DebugEvent, DebugTopic } from '../../src/log/index.js'
import { log, resetLogging } from '../../src/log/logger.js'
import { Nautilus } from '../../src/Nautilus/index.js'
import { sanitize } from '../../src/node/messages.js'
import {
  OceanNodeClient,
  type OceanNodeError,
  PolicyServerAction
} from '../../src/node/OceanNodeClient.js'
import { IpfsRemoteStore } from '../../src/remote/IpfsRemoteStore.js'
import { redactPointer } from '../../src/remote/redact.js'
import {
  CHAIN_ID,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { captureLog } from '../helpers.js'
import { FAKE, findSecrets } from '../secretScan.js'

const NODE = 'https://node.test.invalid'
const SID = FAKE.sessionId
const WALLET_400 = JSON.stringify({
  redirectUri: `http://verifier.test.invalid/error?id=${SID}`,
  errorMessage: 'Presentation failed - redirecting to error page'
})
const S3_POINTER = {
  type: 's3',
  s3Access: {
    endpoint: 'https://s3.test.invalid',
    region: 'eu-1',
    bucket: 'ddos',
    objectKey: 'ddo/abc.json',
    accessKeyId: 'AKIA-read',
    secretAccessKey: FAKE.s3Secret,
    forcePathStyle: true
  }
}
/** A raw signed EIP-1559 transaction, as ethers quotes it in a failed send. */
const RAW_TX = `0x02f8${'5a'.repeat(110)}`

/** The debug events delivered to a sink from now on. */
function captureDebug(
  level: 'sensitive' | 'secrets' = 'sensitive',
  topics?: DebugTopic[]
): DebugEvent[] {
  const events: DebugEvent[] = []
  // The banner goes to stderr: kept out of the test output.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  setDebug({ level, topics, sink: (event) => events.push(event) })
  return events
}

/** Every line written to stderr and the console from now on, written nowhere. */
function captureOutput(): string[] {
  const lines: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk))
    return true
  })
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })
  return lines
}

/** The message, `details` and `cause` chain of an error, as one text. */
function errorText(error: unknown): string {
  const parts: string[] = []
  let current = error as
    | { message?: unknown; details?: unknown; cause?: unknown }
    | undefined
  for (let depth = 0; current && depth < 5; depth++) {
    parts.push(String(current.message), JSON.stringify(current.details ?? null))
    current = current.cause as typeof current
  }
  return parts.join('\n')
}

function nodeClient() {
  return new OceanNodeClient({
    nodeUri: NODE,
    chainId: CHAIN_ID,
    auth: { consumerAddress: NFT_ADDRESS, nonce: '1', signature: '0xsigned' },
    consumerAddress: NFT_ADDRESS
  })
}

/** A node 400 whose body has more than its `error`. */
function stubNode400() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Invalid fileIndex',
            detail: 'only-in-the-raw-body',
            url: `${NODE}/api/services/download?signature=${FAKE.signature}`
          }),
          { status: 400, statusText: 'Bad Request' }
        )
    )
  )
}

/** The error ethers' JsonRpcProvider throws for a failed request to the RPC URL. */
function rpcError() {
  const request = new FetchRequest(FAKE.rpcUrl)
  return makeError(
    'server response 500 Internal Server Error',
    'SERVER_ERROR',
    {
      request,
      info: {
        requestUrl: FAKE.rpcUrl,
        responseBody: '{"error":"backend down"}',
        responseStatus: '500 Internal Server Error'
      }
    } as never
  )
}

/** The provider presenting through the real HTTP wallet client, answered with `body`. */
function walletRejecting(status: number, body: string) {
  const http = new WaltIdHttpWallet({
    apiUrl: 'https://wallet.test.invalid',
    fetchImpl: (async () => new Response(body, { status })) as typeof fetch
  })
  const wallet = {
    authenticate: async () => ({ token: 'session-token' }),
    isSessionValid: async () => true,
    logout: async () => undefined,
    listWallets: async () => [{ id: 'wallet-1' }],
    listKeys: async () => [],
    listDids: async () => [{ did: 'did:key:holder' }],
    sign: async () => 'jwt',
    matchCredentials: async () => [
      {
        id: 'credential-1',
        parsedDocument: { type: ['VerifiableCredential', 'VerifiableId'] }
      }
    ],
    unmatchedCredentials: async () => [],
    resolvePresentationRequest: async () => 'openid4vp://resolved',
    usePresentationRequest: http.usePresentationRequest.bind(http)
  } as WaltIdWallet

  const node = {
    nodeUri: NODE,
    async policyServerPassthrough(action: { action?: string }) {
      return action.action === PolicyServerAction.GET_PD
        ? {
            message: {
              id: 'definition',
              input_descriptors: [
                {
                  id: 'VerifiableId',
                  constraints: {
                    fields: [
                      {
                        path: ['$.vc.type'],
                        filter: { type: 'string', pattern: 'VerifiableId' }
                      }
                    ]
                  }
                }
              ]
            }
          }
        : undefined
    }
  } as unknown as OceanNodeClient

  const provider = new WaltIdCredentialProvider(node, {
    wallet,
    signer: { getAddress: async () => OWNER_ADDRESS } as never
  })

  const asset = getAssetFixture()
  asset.credentialSubject.credentials = addRequestCredentials(
    asset.credentialSubject.credentials as never,
    'allow' as never,
    [{ type: 'VerifiableId', format: 'jwt_vc_json' }]
  ) as never
  const state = `${'a'.repeat(64)}-${'b'.repeat(64)}`
  const redirectUri = `openid4vp://authorize?${new URLSearchParams({
    response_type: 'vp_token',
    state,
    response_mode: 'direct_post',
    presentation_definition_uri: `https://ps.test.invalid/pd/${state}`,
    response_uri: `https://ps.test.invalid/verify/${state}`
  })}`

  return () =>
    provider.present({
      asset,
      serviceId: SERVICE_ID,
      consumerAddress: OWNER_ADDRESS,
      node,
      sessionId: SID,
      redirectUri
    })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('default safety: off', () => {
  it('is off unless NAUTILUS_DEBUG or setDebug turns it on', () => {
    expect(getDebugLevel()).to.equal('off')
    expect(debugEnabled('sensitive', 'node')).to.equal(false)
    expect(debugEnabled('secrets', 'rpc')).to.equal(false)
  })

  it('prints nothing on stderr or the console, and reads no raw value, for every redaction site', async () => {
    const output = captureOutput()
    const log = captureLog({ level: 'trace' })
    let read = 0

    stubNode400()
    await nodeClient()
      .initialize('did:op:abc', SERVICE_ID)
      .catch(() => undefined)
    await walletRejecting(400, WALLET_400)().catch(() => undefined)
    sanitize(`failed (requestUrl="${FAKE.rpcUrl}")`, 200, 'rpc')
    redactPointer(S3_POINTER as never)
    log.events.length = 0
    debugRaw('node', 'lazy', () => {
      read++
      return 'raw'
    })
    debug('secrets', 'rpc', 'lazy', () => {
      read++
      return 'raw'
    })

    expect(read).to.equal(0)
    expect(output.join('\n')).not.to.match(/nautilus:debug|debug logging/)
    for (const line of output) expect(findSecrets(line)).to.deep.equal([])
  })
})

describe("sensitive: the raw value in the channel, never in the caller's error", () => {
  it('a wallet 400 with error?id=<sid>: the sid reaches the sink, not the error message, details or cause', async () => {
    const events = captureDebug()

    const thrown = await walletRejecting(400, WALLET_400)().catch(
      (error) => error
    )

    expect(thrown).to.be.instanceOf(CredentialPresentationError)
    expect(thrown.message).to.contain('Presentation failed')
    expect(errorText(thrown)).not.to.contain(SID)
    expect(errorText(thrown)).not.to.contain('error?id=')
    const answer = events.find((event) =>
      event.message.startsWith('answer HTTP 400')
    )
    expect(answer?.topic).to.equal('wallet')
    expect(answer?.tier).to.equal('sensitive')
    expect(JSON.stringify(answer?.data)).to.contain(`error?id=${SID}`)
  })

  it('a node 400 body reaches the sink raw, and the error is the same as with debug off', async () => {
    stubNode400()
    const off = (await nodeClient()
      .initialize('did:op:abc', SERVICE_ID)
      .catch((error) => error)) as OceanNodeError

    const events = captureDebug()
    const on = (await nodeClient()
      .initialize('did:op:abc', SERVICE_ID)
      .catch((error) => error)) as OceanNodeError

    expect(on.message).to.equal(off.message)
    expect(on.message).to.equal(
      '[ocean-node] initialize: HTTP 400 Bad Request: Invalid fileIndex'
    )
    const [answer] = events.filter((event) => event.topic === 'node')
    expect(answer.message).to.equal('answer HTTP 400 Bad Request')
    const data = answer.data as { status: number; body: string }
    expect(data.status).to.equal(400)
    expect(data.body).to.contain('only-in-the-raw-body')
    // A signature is sensitive data: shown at this tier.
    expect(data.body).to.contain(FAKE.signature)
  })

  it('an RPC URL with a token stays redacted at this tier, the rest of the RPC error shown', () => {
    const events = captureDebug()
    const logged = captureLog()

    log.emit('publish.metadata.events_unchecked', 'Could not read the block', {
      nftAddress: NFT_ADDRESS,
      blockNumber: 1,
      error: rpcError()
    })
    sanitize(`failed (requestUrl="${FAKE.rpcUrl}")`, 200, 'rpc')

    expect(events.length).to.equal(2)
    for (const event of events) {
      expect(event.topic).to.equal('rpc')
      expect(event.tier).to.equal('sensitive')
      const text = JSON.stringify(event.data)
      expect(text).not.to.contain(FAKE.rpcPathToken)
      expect(text).not.to.contain(FAKE.rpcQueryToken)
      expect(text).to.contain('https://rpc.example.org/v3/<redacted>')
    }
    expect(JSON.stringify(events[0].data)).to.contain('backend down')
    expect(JSON.stringify(logged.events)).not.to.contain('/v3/')
  })

  it('a raw signed transaction: redacted in errors and logs, shown in the channel', () => {
    const message = `nonce has already been used (transaction="${RAW_TX}", code=NONCE_EXPIRED)`
    expect(sanitize(message, 2_000, null)).not.to.contain(RAW_TX)

    const events = captureDebug()
    const logged = captureLog()
    log.emit('publish.preflight.pending_unreadable', 'Could not send', {
      nftAddress: NFT_ADDRESS,
      error: makeError('nonce has already been used', 'NONCE_EXPIRED', {
        transaction: RAW_TX
      } as never)
    })

    expect(JSON.stringify(logged.events)).not.to.contain(RAW_TX)
    const [event] = events
    expect(event.topic).to.equal('nonce')
    expect(JSON.stringify(event.data)).to.contain(RAW_TX)
  })

  it('a log event: the raw fields only when it is printed, under its topic', () => {
    const events = captureDebug()
    captureLog()

    log.emit('access.order.lookup_failed', 'filtered out', {
      did: 'did:op:abc',
      error: rpcError()
    })
    log.emit('compute.job.started', 'info is not printed at warn', {
      did: 'did:op:abc',
      jobIds: ['job-1']
    })
    expect(events.map((event) => event.message)).to.deep.equal([
      'log event access.order.lookup_failed before redaction'
    ])
    expect(events[0].topic).to.equal('order')
  })

  it("the verifier's per-policy results, named, from checkSessionId", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              httpStatus: 400,
              message: {
                verificationResult: false,
                tokenResponse: { vp_token: FAKE.jwt },
                policyResults: {
                  results: [
                    {
                      credential: 'VerifiablePresentation',
                      policyResults: [
                        {
                          policy: 'holder-binding',
                          is_success: false,
                          error:
                            'java.lang.NullPointerException\n\tat HolderBindingPolicy.kt:42'
                        },
                        { policy: 'signature', is_success: true }
                      ]
                    }
                  ]
                }
              }
            }),
            { status: 400 }
          )
      )
    )
    const events = captureDebug('sensitive', ['policy'])

    const check = await nodeClient().checkPolicySession(SID)

    expect(check.verified).to.equal(false)
    expect(JSON.stringify(check)).not.to.contain(FAKE.jwt)
    const [summary, record] = events
    expect(summary.message).to.equal(
      'verifier per-policy results (checkSessionId)'
    )
    expect((summary.data as { policies: string[] }).policies).to.deep.equal([
      'VerifiablePresentation holder-binding: failed (java.lang.NullPointerException\n\tat HolderBindingPolicy.kt:42)',
      'VerifiablePresentation signature: ok'
    ])
    expect(formatDebugLine(summary)).to.contain(
      'holder-binding: failed (java.lang.NullPointerException\\n\\tat HolderBindingPolicy.kt:42)'
    )
    // The presented VP is sensitive data: shown at this tier.
    expect(JSON.stringify(record.data)).to.contain(FAKE.jwt)
  })

  it('after a failed presentation, reads the verifier record only with the policy topic on, and throws the same error', async () => {
    const failure = new Error('Presentation failed')
    const run = async () => {
      const checked: string[] = []
      const node = {
        nodeUri: NODE,
        policySessionAddress: (address: string) => address,
        hasPolicyServer: async () => true,
        initializePolicyVerification: async () => ({
          success: true,
          httpStatus: 200,
          message: { sessionId: SID, redirectUri: 'openid4vp://authorize' }
        }),
        checkPolicySession: async (sessionId: string) => {
          checked.push(sessionId)
          return { verified: false, policyResults: [] }
        }
      } as unknown as OceanNodeClient
      const credentials: CredentialProvider = {
        present: async () => {
          throw failure
        }
      }
      const asset = getAssetFixture()
      asset.credentialSubject.credentials = addRequestCredentials(
        asset.credentialSubject.credentials as never,
        'allow' as never,
        [{ type: 'VerifiableId', format: 'jwt_vc_json' }]
      ) as never
      const thrown = await new PolicySessionResolver({ credentials })
        .resolve({
          node,
          asset,
          serviceId: SERVICE_ID,
          consumerAddress: OWNER_ADDRESS
        })
        .catch((error) => error)
      return { thrown, checked }
    }

    const off = await run()
    expect(off.thrown).to.equal(failure)
    expect(off.checked).to.deep.equal([])

    const events = captureDebug('sensitive', ['policy'])
    const on = await run()
    expect(on.thrown).to.equal(failure)
    expect(on.checked).to.deep.equal([SID])
    expect(events.map((event) => event.message)).to.include.members([
      'policy-server session opened (initiate)',
      'presentation failed'
    ])
  })
})

describe('secrets: long-lived credentials too, and still in no error', () => {
  it('shows the RPC URL token, marked SECRETS, and the thrown error still has the origin only', async () => {
    const events = captureDebug('secrets')
    captureLog()

    log.emit('publish.metadata.events_unchecked', 'Could not read', {
      nftAddress: NFT_ADDRESS,
      blockNumber: 1,
      error: rpcError()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(`upstream ${FAKE.rpcUrl} failed`, { status: 502 })
      )
    )
    const thrown = await nodeClient()
      .initialize('did:op:abc', SERVICE_ID)
      .catch((error) => error)

    const [logged] = events
    expect(logged.tier).to.equal('secrets')
    expect(formatDebugLine(logged)).to.match(
      /^\[nautilus:debug:SECRETS\] \[rpc\] /
    )
    expect(JSON.stringify(logged.data)).to.contain(FAKE.rpcPathToken)
    expect(JSON.stringify(logged.data)).to.contain(FAKE.rpcQueryToken)
    expect(errorText(thrown)).not.to.contain(FAKE.rpcPathToken)
    expect(errorText(thrown)).not.to.contain(FAKE.rpcQueryToken)
    expect(errorText(thrown)).to.contain('https://rpc.example.org')
  })

  it('shows an S3 secret key only at secrets; the returned pointer stays redacted at every tier', () => {
    const sensitive = captureDebug('sensitive')
    const atSensitive = redactPointer(S3_POINTER as never)
    expect(JSON.stringify(sensitive)).not.to.contain(FAKE.s3Secret)
    expect(JSON.stringify(sensitive)).to.contain('ddo/abc.json')

    const secrets = captureDebug('secrets')
    const atSecrets = redactPointer(S3_POINTER as never)
    expect(secrets[0].tier).to.equal('secrets')
    expect(JSON.stringify(secrets[0].data)).to.contain(FAKE.s3Secret)

    for (const pointer of [atSensitive, atSecrets])
      expect(JSON.stringify(pointer)).not.to.contain(FAKE.s3Secret)
  })

  it('shows an IPFS JWT echoed by the store only at secrets; the error stays scrubbed', async () => {
    const pinataJwt = `${FAKE.jwt}-pinata`
    const store = () =>
      new IpfsRemoteStore({
        uploadUrl: 'https://ipfs.test.invalid/add',
        headers: { Authorization: `Bearer ${pinataJwt}` },
        fetchImpl: (async () =>
          new Response(`invalid key ${pinataJwt}`, {
            status: 401
          })) as typeof fetch
      })

    const sensitive = captureDebug('sensitive', ['store'])
    const first = await store()
      .put('{}', { did: 'did:ope:1' })
      .catch((error) => error)
    expect(JSON.stringify(sensitive)).to.contain('invalid key')
    expect(JSON.stringify(sensitive)).not.to.contain(pinataJwt)

    const secrets = captureDebug('secrets', ['store'])
    const second = await store()
      .put('{}', { did: 'did:ope:1' })
      .catch((error) => error)
    expect(secrets[0].tier).to.equal('secrets')
    expect(JSON.stringify(secrets[0].data)).to.contain(pinataJwt)

    for (const error of [first, second])
      expect(errorText(error)).not.to.contain(pinataJwt)
  })

  it('never shows a private key or mnemonic, at any tier', () => {
    const events = captureDebug('secrets')
    debug('secrets', 'store', 'keys', {
      privateKey: `0x${'11'.repeat(32)}`,
      wallet: { mnemonic: 'test test test junk' }
    })
    debugRaw('store', 'keys', { private_key: 'abc-key', apiKey: 'shown-key' })

    const text = JSON.stringify(events)
    expect(text).not.to.contain('11'.repeat(32))
    expect(text).not.to.contain('test test test junk')
    expect(text).not.to.contain('abc-key')
    expect(text).to.contain('shown-key')
  })
})

describe('controls', () => {
  it('prints the banner exactly once per tier, on stderr, whatever the log level and the sink', () => {
    const output = captureOutput()
    Nautilus.configureLogging({ level: 'silent' })

    setDebug({ level: 'sensitive', sink: () => undefined })
    setDebug({ level: 'sensitive', sink: () => undefined })
    setDebug({ level: 'off' })
    setDebug({ level: 'sensitive' })

    const banners = output.filter((line) =>
      line.includes('debug logging is ON')
    )
    expect(banners).to.deep.equal([`${debugBanner('sensitive', false)}\n`])

    setDebug({ level: 'secrets', sink: () => undefined })
    setDebug({ level: 'secrets', sink: () => undefined })
    const all = output.filter((line) => line.includes('debug logging is ON'))
    expect(all.length).to.equal(2)
    expect(all[1]).to.contain('SECRETS tier')
    expect(all[1]).to.contain('rotate every credential')
  })

  it('warns harder when NODE_ENV is production', () => {
    const output = captureOutput()

    resetDebug({ NAUTILUS_DEBUG: 'sensitive', NODE_ENV: 'production' })

    expect(output).to.deep.equal([`${debugBanner('sensitive', true)}\n`])
    expect(output[0]).to.match(
      /^\[nautilus\] WARNING: NODE_ENV is production and sensitive debug logging is ON/
    )
    expect(output[0]).to.contain("setDebug({ level: 'off' })")
  })

  it('reads NAUTILUS_DEBUG and NAUTILUS_DEBUG_TOPICS; secrets only by its name', () => {
    expect(
      readDebugEnv({ NAUTILUS_DEBUG: ' Sensitive ' }).settings
    ).to.deep.equal({
      level: 'sensitive'
    })
    expect(
      readDebugEnv({
        NAUTILUS_DEBUG: 'SECRETS',
        NAUTILUS_DEBUG_TOPICS: 'rpc, store'
      }).settings
    ).to.deep.equal({ level: 'secrets', topics: ['rpc', 'store'] })

    for (const value of ['1', 'true', 'all', 'on', 'debug']) {
      const { settings, problems } = readDebugEnv({ NAUTILUS_DEBUG: value })
      expect(settings, value).to.deep.equal({})
      expect(problems[0].variable).to.equal('NAUTILUS_DEBUG')
    }

    // Topics alone turn nothing on.
    captureOutput()
    resetDebug({ NAUTILUS_DEBUG_TOPICS: 'node,rpc' })
    expect(getDebugLevel()).to.equal('off')
    expect(debugEnabled('sensitive', 'node')).to.equal(false)
  })

  it('ignores an invalid value with a warning (config.env.invalid)', () => {
    const output = captureOutput()
    const env = {
      NAUTILUS_DEBUG: 'everything',
      NAUTILUS_DEBUG_TOPICS: 'node,keys'
    }

    // The logger reports the environment's problems when it reads it.
    resetLogging(env)
    resetDebug(env)

    expect(getDebugLevel()).to.equal('off')
    const text = output.join('')
    expect(text).to.contain('config.env.invalid')
    expect(text).to.contain("NAUTILUS_DEBUG='everything' is not understood")
    expect(text).to.contain("NAUTILUS_DEBUG_TOPICS='keys' is not understood")
  })

  it('filters by topic, from the environment and from setDebug', () => {
    captureOutput()
    resetDebug({ NAUTILUS_DEBUG: 'sensitive', NAUTILUS_DEBUG_TOPICS: 'wallet' })
    expect(debugEnabled('sensitive', 'wallet')).to.equal(true)
    expect(debugEnabled('sensitive', 'node')).to.equal(false)

    const events = captureDebug('sensitive', ['node'])
    debug('sensitive', 'wallet', 'not shown', 1)
    debug('sensitive', 'node', 'shown', 2)
    expect(events.map((event) => event.message)).to.deep.equal(['shown'])
  })

  it('setDebug overrides the environment, and replaces the whole setting', () => {
    captureOutput()
    resetDebug({ NAUTILUS_DEBUG: 'secrets', NAUTILUS_DEBUG_TOPICS: 'rpc' })
    expect(debugEnabled('secrets', 'rpc')).to.equal(true)

    Nautilus.setDebug({ level: 'sensitive' })
    expect(debugEnabled('secrets', 'rpc')).to.equal(false)
    expect(debugEnabled('sensitive', 'node')).to.equal(true)

    Nautilus.setDebug({ level: 'off' })
    expect(debugEnabled('sensitive', 'rpc')).to.equal(false)
  })

  it('refuses an unknown level or topic', () => {
    expect(() => setDebug({ level: 'all' as never })).to.throw(
      /unknown level 'all'/
    )
    expect(() =>
      setDebug({ level: 'sensitive', topics: ['keys' as never] })
    ).to.throw(/unknown topic\(s\) keys/)
    expect(getDebugLevel()).to.equal('off')
  })

  it('writes one line per event on stderr, prefixed with the tier and the topic', () => {
    const output = captureOutput()
    setDebug({ level: 'secrets' })
    output.length = 0

    debug('sensitive', 'node', 'multi\nline', {
      body: 'first\nsecond\r\n\u001b[31mred\u2028sep\u202eevil'
    })
    debug('secrets', 'rpc', 'url', FAKE.rpcUrl)

    expect(output.length).to.equal(2)
    for (const line of output) {
      expect(line.endsWith('\n')).to.equal(true)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: none may be left
      expect(line.slice(0, -1)).not.to.match(/[\n\r\u001b\u2028\u2029\u202e]/)
    }
    expect(output[0]).to.match(
      /^\[nautilus:debug:sensitive\] \[node\] \d{4}-\d\d-\d\dT[^ ]+Z multi\\nline \{/
    )
    expect(output[0]).to.contain('\\u001b[31mred\\u2028sep\\u202eevil')
    expect(output[1]).to.match(/^\[nautilus:debug:SECRETS\] \[rpc\] /)
  })

  it('a failing sink or an unreadable value never fails the operation', () => {
    captureOutput()
    setDebug({
      level: 'sensitive',
      sink: () => {
        throw new Error('sink down')
      }
    })
    const hostile = {
      get body(): string {
        throw new Error('getter')
      }
    }
    expect(() => debugRaw('node', 'x', hostile)).not.to.throw()
    expect(() =>
      debugRaw('node', 'x', () => {
        throw new Error('lazy')
      })
    ).not.to.throw()
    expect(sanitize(`x ${FAKE.rpcUrl}`, 200, 'rpc')).to.equal(
      'x https://rpc.example.org'
    )
  })

  it('works without process (a browser bundle): no crash, the console instead of stderr', () => {
    const warnings: unknown[][] = []
    const lines: unknown[][] = []
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args)
    })
    vi.spyOn(console, 'debug').mockImplementation((...args) => {
      lines.push(args)
    })
    const saved = globalThis.process
    let env: ReturnType<typeof readDebugEnv> | undefined
    try {
      // Synchronous, so nothing else runs without `process`.
      ;(globalThis as { process?: unknown }).process = undefined
      env = readDebugEnv(processEnv())
      setDebug({ level: 'sensitive' })
      debug('sensitive', 'node', 'in a browser', { a: 1 })
      setDebug({ level: 'off' })
    } finally {
      globalThis.process = saved
    }

    expect(env).to.deep.equal({ settings: {}, problems: [] })
    expect(String(warnings[0][0])).to.contain('debug logging is ON')
    expect(String(lines[0][0])).to.match(
      /^\[nautilus:debug:sensitive\] \[node\] .* in a browser \{"a":1\}$/
    )
  })
})

describe('what the sensitive tier still hides', () => {
  it('masks RPC keys, user info and credential parameters, and keeps the rest of a URL', () => {
    expect(maskUrl(FAKE.rpcUrl)).to.equal(
      'https://rpc.example.org/v3/<redacted>?apikey=<redacted>'
    )
    expect(maskUrl('https://user:pass@host.test/a')).to.equal(
      'https://<redacted>@host.test/a'
    )
    const download = `${NODE}/api/services/download?nonce=1&signature=${FAKE.signature}&policyServer=${SID}`
    expect(maskUrl(download)).to.equal(download)
    expect(maskUrl(`http://verifier.test/error?id=${SID}`)).to.equal(
      `http://verifier.test/error?id=${SID}`
    )
    expect(
      maskUrl('https://b.s3.test/k?X-Amz-Credential=AKIA&X-Amz-Signature=abc')
    ).to.equal(
      'https://b.s3.test/k?X-Amz-Credential=<redacted>&X-Amz-Signature=<redacted>'
    )
    for (const kept of [
      '/openid4vc/session/3f9d2c1b-7a4e-4b8f-9c2d-1e0f5a6b7c8d',
      '/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      `/tx/0x${'ab'.repeat(32)}`
    ])
      expect(maskUrl(`https://host.test${kept}`)).to.equal(
        `https://host.test${kept}`
      )
  })

  it('masks auth headers and credential fields in text, and keeps JWTs, signatures and session ids', () => {
    const text = `Authorization: Bearer ${FAKE.jwt}; {"secretAccessKey":"${FAKE.s3Secret}","vp_token":"${FAKE.jwt}","sessionId":"${SID}","signature":"${FAKE.signature}"} password=hunter2`
    const masked = maskText(text)
    expect(masked).not.to.contain(FAKE.s3Secret)
    expect(masked).not.to.contain('hunter2')
    expect(masked).not.to.contain(`Bearer ${FAKE.jwt}`)
    expect(masked).to.contain(`"vp_token":"${FAKE.jwt}"`)
    expect(masked).to.contain(SID)
    expect(masked).to.contain(FAKE.signature)
  })
})
