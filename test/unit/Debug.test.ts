/**
 * The sensitive debug channel (`src/log/debug.ts`): off by default; when on, the raw values
 * nautilus redacts reach it at the right tier, and errors, return values and log events
 * stay exactly as redacted as without it.
 *
 * `test/setup.ts` turns it off before each test, and fails the suite on debug output while
 * it is off, on a debug event that is not one line, and on a `sensitive` event holding a
 * long-lived fixture credential.
 */
import { ProviderInstance } from '@oceanprotocol/lib'
import { FetchRequest, makeError } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import {
  maskCredentials,
  maskNeverShown,
  maskText,
  maskUrl
} from '../../src/log/credentials.js'
import {
  debug,
  debugBanner,
  debugEnabled,
  debugRaw,
  formatDebugLine,
  getDebugLevel,
  resetDebug,
  setDebug,
  toPlain
} from '../../src/log/debug.js'
import { processEnv, readDebugEnv } from '../../src/log/env.js'
import type { DebugEvent, DebugTopic } from '../../src/log/index.js'
import { log, resetLogging } from '../../src/log/logger.js'
import { redactFields } from '../../src/log/redact.js'
import { Nautilus } from '../../src/Nautilus/index.js'
import { redactSecrets, sanitize } from '../../src/node/messages.js'
import {
  OceanNodeClient,
  OceanNodeError,
  PolicyServerAction
} from '../../src/node/OceanNodeClient.js'
import { IpfsRemoteStore } from '../../src/remote/IpfsRemoteStore.js'
import { redactPointer } from '../../src/remote/redact.js'
import { S3RemoteStore } from '../../src/remote/S3RemoteStore.js'
import {
  CHAIN_ID,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { captureLog, INVISIBLE_CODES } from '../helpers.js'
import {
  allowMadeUpFields,
  CREDENTIAL_SHAPES,
  FAKE,
  findCredentials,
  findSecrets
} from '../secretScan.js'

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

// These tests set the channel themselves: off, also under NAUTILUS_TEST_DEBUG.
beforeEach(() => {
  resetDebug({})
})

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
    const off = await walletRejecting(400, WALLET_400)().catch((error) => error)
    const events = captureDebug()

    const thrown = await walletRejecting(400, WALLET_400)().catch(
      (error) => error
    )

    // The same error, all of it, with the channel on or off.
    expect(toPlain(thrown)).to.deep.equal(toPlain(off))
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

    // The same error, all of it (own properties and causes), with the channel on or off.
    expect(toPlain(on)).to.deep.equal(toPlain(off))
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
      'VerifiablePresentation holder-binding: failed (java.lang.NullPointerException)',
      'VerifiablePresentation signature: ok'
    ])
    expect(formatDebugLine(summary)).to.contain(
      'holder-binding: failed (java.lang.NullPointerException)'
    )
    expect(formatDebugLine(record)).to.contain(
      'java.lang.NullPointerException\\n\\tat HolderBindingPolicy.kt:42'
    )
    // The presented VP is sensitive data: shown at this tier.
    expect(JSON.stringify(record.data)).to.contain(FAKE.jwt)
  })

  it("checkSessionId: an answer that is not the policy server's envelope reaches the channel", async () => {
    const body =
      'upstream policy-server unreachable: connect ECONNREFUSED 10.0.0.7:8080'
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'Content-Type': 'text/plain' }
          })
      )
    )
    const events = captureDebug('sensitive', ['policy', 'node'])

    const error = await nodeClient()
      .checkPolicySession(SID)
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      )

    expect(error).to.be.instanceOf(OceanNodeError)
    expect((error as Error).message).not.to.contain('ECONNREFUSED')
    const answer = events.find((event) =>
      String(JSON.stringify(event.data)).includes(body)
    )
    expect(answer?.topic).to.equal('policy')
    expect(answer?.data).to.deep.include({ status: 502, body })
  })

  it('checkSessionId over P2P: an error without an envelope reaches the channel', async () => {
    const cause = new Error(
      'P2P command error: upstream policy-server unreachable: ECONNREFUSED'
    )
    vi.spyOn(ProviderInstance, 'PolicyServerPassthrough').mockRejectedValue(
      cause
    )
    const events = captureDebug('sensitive', ['policy'])

    const error = await new OceanNodeClient({
      nodeUri: '16Uiu2HAmPeerIdOnly',
      chainId: CHAIN_ID,
      auth: { consumerAddress: NFT_ADDRESS, nonce: '1', signature: '0xsigned' },
      consumerAddress: NFT_ADDRESS
    })
      .checkPolicySession(SID)
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      )

    expect(error).to.be.instanceOf(OceanNodeError)
    const answer = events.find((event) =>
      String(JSON.stringify(event.data)).includes('ECONNREFUSED')
    )
    expect(answer?.topic).to.equal('policy')
  })

  it('after a failed presentation, reads the verifier record either way, shows it only with the policy topic on, and throws the same error', async () => {
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
    expect(off.checked).to.deep.equal([SID])

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
    vi.spyOn(console, 'info').mockImplementation((...args) => {
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

  it('masks user info a quote or a space ended before its `@` (security regression)', () => {
    // The URL ends at the quote, so no `@` is left in it and `user:secret` read as the host.
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    for (const end of ["'", '"', ' ']) {
      const text = `at https://user:${secret}${end}x@rpc.example.org/path`
      expect(maskText(text), text).not.to.contain(secret)
    }
    expect(maskUrl(`https://user:${secret}`)).to.equal('https://<redacted>')
    for (const url of [
      'https://host.test',
      'https://host.test:8545/a',
      'http://[::1]:8545/a',
      'http://127.0.0.1:/a'
    ])
      expect(maskUrl(url)).to.equal(url)
  })

  it('masks user info a quote stands in, after a numeric prefix too (security regression)', () => {
    // `user:12345` before the quote read as a host and port: the whole URL was kept.
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    for (const quote of ["'", '"', '\\"', '<', '>'])
      for (const prefix of ['user:12345', '12345', 'user:'])
        for (const url of [
          `https://${prefix}${quote}${secret}@rpc.example.org/p`,
          `https:\\/\\/${prefix}${quote}${secret}@rpc.example.org\\/p`
        ])
          for (const text of [url, `at ${url}`, `{"error":"${url}"}`]) {
            const masked = maskText(text)
            expect(masked, text).not.to.contain(secret)
            expect(masked, text).not.to.contain('12345')
            expect(masked, text).to.contain('<redacted>@rpc.example.org')
          }
    const prose = `connect "https://host.example:8545" failed, mail ops@example.org`
    expect(maskText(prose)).to.equal(prose)
  })

  it('masks user info a JSON-escaped or percent-encoded quote stands in (security regression)', () => {
    // `\u0027` ended the authority at its backslash: `user:12345` read as a host and port,
    // and a quote in a URL decoded from a query parameter ended that URL.
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    const url = (quote: string) =>
      `https://user:12345${quote}${secret}@rpc.example.org/p`
    for (const quote of ['\\u0027', '\\u0022', '\\u003c', '\\\\u0027', '\\"'])
      for (const text of [
        url(quote),
        `at ${url(quote)}`,
        `{"error":"${url(quote)}"}`,
        `https://h.example/cb?redirect=${url(quote)}`
      ]) {
        expect(maskText(text), text).not.to.contain(secret)
        expect(maskText(text), text).not.to.contain('12345')
        expect(maskText(text), text).to.contain('<redacted>@rpc.example.org')
        expect(maskUrl(text), text).not.to.contain('12345')
      }
    for (const quote of ["'", '"', '<', '\\u0027', '\\"', '%27', '%22'])
      for (const text of [
        `https://h.example/cb?redirect=${encodeURIComponent(url(quote))}`,
        `https://h.example/cb?redirect=${url(quote).replace(/'/g, '%27')}`
      ]) {
        expect(maskText(text), text).not.to.contain(secret)
        expect(maskText(text), text).not.to.contain('12345')
        expect(maskText(text), text).to.equal(
          'https://h.example/cb?redirect=https://<redacted>@rpc.example.org/p'
        )
      }
    expect(maskUrl(url('\\u0027'))).to.equal(
      'https://<redacted>@rpc.example.org/p'
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

describe('the same error, the same result, with the channel on or off', () => {
  /** A resolver whose presentation passes and whose verifier record has a failed policy. */
  function deniedByVerifier() {
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
                          error: 'java.lang.NullPointerException'
                        }
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
    const real = nodeClient()
    const node = {
      nodeUri: NODE,
      policySessionAddress: (address: string) => address,
      hasPolicyServer: async () => true,
      initializePolicyVerification: async () => ({
        success: true,
        httpStatus: 200,
        message: { sessionId: SID, redirectUri: 'openid4vp://authorize' }
      }),
      checkPolicySession: (sessionId: string) =>
        real.checkPolicySession(sessionId)
    } as unknown as OceanNodeClient
    const asset = getAssetFixture()
    asset.credentialSubject.credentials = addRequestCredentials(
      asset.credentialSubject.credentials as never,
      'allow' as never,
      [{ type: 'VerifiableId', format: 'jwt_vc_json' }]
    ) as never
    return new PolicySessionResolver({
      credentials: { present: async () => undefined }
    })
      .resolve({
        node,
        asset,
        serviceId: SERVICE_ID,
        consumerAddress: OWNER_ADDRESS
      })
      .catch((error) => error)
  }

  it('PolicyDeniedError: deep-equal on and off, the record in the channel only', async () => {
    const off = await deniedByVerifier()
    const events = captureDebug('sensitive', ['policy'])
    const on = await deniedByVerifier()

    expect(on.name).to.equal('PolicyDeniedError')
    expect(toPlain(on)).to.deep.equal(toPlain(off))
    expect(JSON.stringify(toPlain(on))).not.to.contain(FAKE.jwt)
    expect(JSON.stringify(events)).to.contain(FAKE.jwt)
  })

  it('a redacted storage pointer (PublishResponse.stored): deep-equal on and off', () => {
    const pointer = {
      type: 'url',
      url: `https://files.test.invalid/a?token=${FAKE.rpcQueryToken}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${FAKE.jwt}` }
    }
    const off = redactPointer(pointer as never)
    captureDebug('secrets')
    expect(redactPointer(pointer as never)).to.deep.equal(off)
    expect(redactPointer(S3_POINTER as never)).to.deep.equal(
      (() => {
        resetDebug({})
        return redactPointer(S3_POINTER as never)
      })()
    )
  })
})

describe('what the sensitive tier still hides: by name and shape', () => {
  it('hides every credential fixture shape, in text, objects, sanitised text and log events', () => {
    const events = captureDebug('sensitive')
    captureLog({ level: 'trace' })

    debugRaw('store', 'shapes as text', CREDENTIAL_SHAPES)
    debugRaw('node', 'shapes as fields', {
      pinataGatewayToken: FAKE.pinataGatewayToken,
      apiToken: FAKE.nestedApiToken,
      dkey: FAKE.drpcKey,
      auth: FAKE.cookie,
      credentials: FAKE.envSecretKey,
      githubToken: FAKE.pinataJwt,
      body: CREDENTIAL_SHAPES
    })
    sanitize(CREDENTIAL_SHAPES, 5000, 'rpc')
    log.emit('publish.metadata.events_unchecked', 'Could not read', {
      nftAddress: NFT_ADDRESS,
      blockNumber: 1,
      error: new Error(CREDENTIAL_SHAPES)
    })

    expect(events.length).to.be.greaterThan(3)
    for (const event of events) {
      expect(event.tier).to.equal('sensitive')
      expect(
        findCredentials(JSON.stringify(event)),
        event.message
      ).to.deep.equal([])
    }
  })

  it('shows them at secrets', () => {
    const events = captureDebug('secrets')
    debugRaw('store', 'shapes', CREDENTIAL_SHAPES)
    expect(events[0].tier).to.equal('secrets')
    expect(findCredentials(JSON.stringify(events[0]))).to.include.members([
      'drpc key',
      'Pinata gateway token',
      'Pinata JWT',
      'session cookie'
    ])
  })

  it('keeps session-scoped and public values: vp_token, state, sessionId, nonce, signature, id, a token address', () => {
    const shown = {
      vp_token: FAKE.jwt,
      state: 'state-value-1234',
      sessionId: SID,
      nonce: FAKE.nonce,
      signature: FAKE.signature,
      id: 'definition-id',
      presentation_submission: { id: 'submission-id' },
      paymentToken: NFT_ADDRESS,
      publicKey: 'public-key-value',
      key: 'ddo/abc.json',
      code: 'SERVER_ERROR'
    }
    expect(maskCredentials(shown)).to.deep.equal(shown)
    const text = `vp_token=${FAKE.jwt}&state=s1 "sessionId": "${SID}", nonce: ${FAKE.nonce}`
    expect(maskText(text)).to.equal(text)
    // A URL signature that is `0x` hex is a session signature, shown; any other is masked.
    expect(maskUrl(`https://n.test/d?signature=${FAKE.signature}`)).to.contain(
      FAKE.signature
    )
    expect(
      maskUrl('https://cdn.test/k?Signature=abc~def&key=AIzaKey')
    ).to.equal('https://cdn.test/k?Signature=<redacted>&key=<redacted>')
  })

  it('masks a credential that straddles the 32,768-character cut, before cutting', () => {
    const events = captureDebug('sensitive')
    const token = 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm'
    // The token starts 10 characters before the cut; the URL is glued to the text before it.
    const text = `${'a'.repeat(32_731)}https://rpc.example.org/v3/${token} ${'b'.repeat(100)}`
    expect(text.indexOf(token)).to.equal(32_758)
    debugRaw('rpc', 'long', text)

    const data = events[0].data as string
    expect(data).not.to.contain(token.slice(0, 6))
    expect(data).to.match(/ …\(cut: 32768 of \d+ characters shown\)$/)
  })

  it('bounds one event to about 256 KB, with a marker', () => {
    const events = captureDebug('sensitive')
    const big = Object.fromEntries(
      Array.from({ length: 200 }, (_, row) => [
        `row${row}`,
        Object.fromEntries(
          Array.from({ length: 200 }, (_, column) => [
            `c${column}`,
            'x'.repeat(1000)
          ])
        )
      ])
    )
    debugRaw('node', 'big', big)

    const line = formatDebugLine(events[0])
    expect(line.length).to.be.lessThan(300_000)
    expect(line).to.contain('event cut at 262144 characters')
  })

  it('replaces a known credential also percent-encoded and in base64, and the URL secrets of an IPFS store', async () => {
    const secret = 'known/secret+value=1'
    const events = captureDebug('sensitive', ['store'])
    debugRaw(
      'store',
      'encoded',
      `a ${encodeURIComponent(secret)} b ${btoa(secret)} c ${secret}`,
      [secret]
    )
    expect(JSON.stringify(events[0].data)).not.to.match(
      /known|a25vd25|known%2Fsecret/
    )

    const gatewayToken = 'gw-tok-7Hq2Lm9Xp4Vr'
    const store = new IpfsRemoteStore({
      uploadUrl: 'https://ipfs.test.invalid/add',
      gatewayUrl: `https://gw.test.invalid/?pinataGatewayToken=${gatewayToken}`,
      fetchImpl: (async () =>
        new Response(`bad gateway token ${gatewayToken}`, {
          status: 401
        })) as typeof fetch
    })
    const thrown = await store
      .put('{}', { did: 'did:ope:1' })
      .catch((error) => error)
    expect(errorText(thrown)).not.to.contain(gatewayToken)
    expect(JSON.stringify(events)).to.contain('bad gateway token')
    expect(JSON.stringify(events)).not.to.contain(gatewayToken)
  })

  it('hides the S3 secret keys an S3 error answer echoes, also percent-encoded', async () => {
    const write = 'S3writeSecret/Key+1234'
    const events = captureDebug('sensitive', ['store'])
    const store = new S3RemoteStore({
      endpoint: 'https://s3.test.invalid',
      bucket: 'ddos',
      prefix: 'ddo/',
      forcePathStyle: true,
      writeCredentials: { accessKeyId: 'WRITEKEY', secretAccessKey: write },
      readCredentials: {
        accessKeyId: 'READKEY',
        secretAccessKey: 'read-secret'
      },
      fetchImpl: (async () =>
        new Response(
          `<Error><Code>AccessDenied</Code><Message>${encodeURIComponent(write)} ${write}</Message></Error>`,
          { status: 403 }
        )) as typeof fetch
    })
    await store.put('{}', { did: 'did:ope:1' }).catch(() => undefined)

    const text = JSON.stringify(events)
    expect(text).to.contain('AccessDenied')
    expect(text).not.to.contain(write)
    expect(text).not.to.contain(encodeURIComponent(write))
  })

  it('a url pointer: credential header values hidden, plain ones (Content-Type) shown', () => {
    const events = captureDebug('sensitive', ['store'])
    redactPointer({
      type: 'url',
      url: 'https://files.test.invalid/a',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Auth': 'custom-credential-value'
      }
    } as never)
    const text = JSON.stringify(events[0].data)
    expect(text).to.contain('application/json')
    expect(text).not.to.contain('custom-credential-value')
  })

  it('keeps a __proto__ key (from JSON.parse) as a key, masked by its name like any other', () => {
    const parsed = JSON.parse(
      '{"__proto__":{"apiToken":"proto-token-1234"},"a":1}'
    )
    const masked = maskCredentials(parsed) as Record<string, unknown>
    expect(Object.getPrototypeOf(masked)).to.equal(Object.prototype)
    expect(JSON.stringify(masked)).to.equal(
      '{"__proto__":{"apiToken":"<redacted>"},"a":1}'
    )
  })

  it('at secrets still hides a private key or mnemonic given in text', () => {
    const masked = JSON.stringify(
      maskNeverShown(
        `privateKey=0x${'22'.repeat(32)} mnemonic: test test test junk\n{"private_key":"abc-key"}`
      )
    )
    expect(masked).not.to.contain('22'.repeat(32))
    expect(masked).not.to.contain('test test')
    expect(masked).not.to.contain('abc-key')
  })
})

describe('fix-round controls', () => {
  it('NAUTILUS_DEBUG_TOPICS with no known topic turns on no topic, never all', () => {
    const output = captureOutput()
    const env = { NAUTILUS_DEBUG: 'sensitive', NAUTILUS_DEBUG_TOPICS: 'bogus' }
    expect(readDebugEnv(env).settings).to.deep.equal({
      level: 'sensitive',
      topics: []
    })
    resetLogging(env)
    resetDebug(env)
    for (const topic of ['node', 'wallet', 'policy', 'rpc'] as const)
      expect(debugEnabled('sensitive', topic), topic).to.equal(false)
    expect(output.join('')).to.contain("NAUTILUS_DEBUG_TOPICS='bogus'")
  })

  it('hands a log event over only when the redaction changed it', () => {
    allowMadeUpFields()
    const events = captureDebug('sensitive', ['order'])
    captureLog({ level: 'trace' })
    log.emit('access.order.lookup_failed', 'plain', {
      did: 'did:op:abc',
      list: [null, 1, 'two']
    } as never)
    expect(events).to.deep.equal([])

    log.emit('access.order.lookup_failed', 'nested secret', {
      did: 'did:op:abc',
      detail: { inner: { accessToken: 'tok-123456' } }
    } as never)
    expect(events.map((event) => event.message)).to.deep.equal([
      'log event access.order.lookup_failed before redaction'
    ])
  })

  it('cuts the verifier read after a failed presentation, whatever the transport', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
      AbortSignal.abort(new Error('timed out'))
    )
    const failure = new Error('Presentation failed')
    const signals: unknown[] = []
    const node = {
      nodeUri: NODE,
      policySessionAddress: (address: string) => address,
      hasPolicyServer: async () => true,
      initializePolicyVerification: async () => ({
        success: true,
        httpStatus: 200,
        message: { sessionId: SID, redirectUri: 'openid4vp://authorize' }
      }),
      // A P2P read that never answers and ignores its signal.
      checkPolicySession: (_sessionId: string, signal: unknown) => {
        signals.push(signal)
        return new Promise(() => undefined)
      }
    } as unknown as OceanNodeClient
    const asset = getAssetFixture()
    asset.credentialSubject.credentials = addRequestCredentials(
      asset.credentialSubject.credentials as never,
      'allow' as never,
      [{ type: 'VerifiableId', format: 'jwt_vc_json' }]
    ) as never
    const events = captureDebug('sensitive', ['policy'])

    const thrown = await new PolicySessionResolver({
      credentials: {
        present: async () => {
          throw failure
        }
      }
    })
      .resolve({
        node,
        asset,
        serviceId: SERVICE_ID,
        consumerAddress: OWNER_ADDRESS
      })
      .catch((error) => error)

    expect(thrown).to.equal(failure)
    expect(signals[0]).to.be.instanceOf(AbortSignal)
    expect(events.map((event) => event.message)).to.include(
      'checkSessionId after the failed presentation failed'
    )
  })
})

describe('round-2 fixes', () => {
  /** Key names built from prefixes and credential (and readable) endings. */
  const NAMES = [
    '',
    'api',
    'access',
    'x-',
    'client',
    'master',
    'db_',
    'aws_',
    'Account',
    'storage',
    'pinata_',
    'session',
    'auth',
    'vp_',
    'public',
    'object',
    'status',
    'exit',
    'otp',
    'encryption',
    'signing',
    'X-Amz-',
    'd',
    'write'
  ].flatMap((prefix) =>
    [
      'key',
      'Key',
      'auth',
      'Auth',
      'token',
      'secret',
      'password',
      'code',
      'sig',
      'signature',
      'credential',
      'credentials',
      'cookie',
      'jwt',
      'id',
      'sessionId',
      'privateKey',
      'Security-Token',
      'nonce'
    ].map((ending) => `${prefix}${ending}`)
  )

  it('logs and errors hide every key the sensitive tier hides (dkey, sig, encryptionKey, AccountKey, apiAuth, x-auth, …)', () => {
    const value = 'FAKEsupersetQ7m2Lx9pVt4'
    const narrower: string[] = []
    for (const key of [...NAMES, 'x-auth', 'hmacKey', 'signingKey']) {
      for (const text of [
        `${key}=${value}`,
        `${key}: ${value}`,
        `"${key}": "${value}"`,
        `{\\"${key}\\":\\"${value}\\"}`,
        `'${key}': '${value}'`
      ])
        if (
          !maskText(text).includes(value) &&
          (sanitize(text, 5000, null).includes(value) ||
            redactSecrets(text).includes(value))
        )
          narrower.push(text)
      for (const entry of [value, { inner: value }])
        if (
          JSON.stringify(maskCredentials({ [key]: entry })) !==
            JSON.stringify({ [key]: entry }) &&
          JSON.stringify(redactFields({ [key]: entry })).includes(value)
        )
          narrower.push(`field ${key}`)
    }
    expect(narrower).to.deep.equal([])

    // The names the round-2 reviews found printing in logs and errors.
    for (const key of [
      'dkey',
      'sig',
      'accessKey',
      'encryptionKey',
      'signingKey',
      'AccountKey',
      'apiAuth',
      'x-auth'
    ]) {
      expect(redactSecrets(`${key}=${value}`), key).to.equal(
        `${key}=<redacted>`
      )
      expect(redactFields({ [key]: value }), key).to.deep.equal({
        [key]: '<redacted>'
      })
    }
    // Public keys and an object key stay readable.
    expect(
      redactFields({ key: 'ddo/a.json', publicKey: '0x02ab', objectKey: 'k' })
    ).to.deep.equal({ key: 'ddo/a.json', publicKey: '0x02ab', objectKey: 'k' })
  })

  /** The data of a cut string, its marker's numbers, and the text before the marker. */
  function cutMarker(data: string): {
    shown: number
    total: number
    text: string
  } {
    const match = / …\(cut: (\d+) of (\d+) characters shown\)$/.exec(data)
    expect(match, data.slice(-80)).not.to.equal(null)
    const text = data.slice(0, match?.index)
    return { shown: Number(match?.[1]), total: Number(match?.[2]), text }
  }

  it('shows no part of a credential the raw read cuts, after masking shrank the text (code N1)', () => {
    const events = captureDebug('sensitive')
    const token = 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm'
    const url = 'https://rpc.example.org/v3/'
    for (const keep of [3, 8, 19]) {
      // 40,000 characters of a masked value shrink the read 65,536 to about 25,000, so
      // the raw cut, `keep` characters into the token, is in what is printed.
      const big = `apiToken=${'Z9'.repeat(20_000)}`
      const pad = 65_536 - big.length - 1 - url.length - keep
      for (const filler of ['y'.repeat(pad), 'y '.repeat(pad / 2)]) {
        const text = `${big} ${filler.slice(0, pad)}${url}${token} tail`
        events.length = 0
        debugRaw('rpc', 'shrunk', text)

        const data = events[0].data as string
        expect(data, `${keep}`).not.to.contain(token.slice(0, 3))
        // The marker tells the truth: what is shown, of the length given.
        const marker = cutMarker(data)
        expect(marker.text.length).to.equal(marker.shown)
        expect(marker.total).to.equal(text.length)
      }
    }
  })

  it('shows no user info of a URL the raw read cuts after a quote or a comma (security regression)', () => {
    // Cut before the `@`, the word dropped back to the quote left `https://user:12345`,
    // which reads as a host and port.
    const events = captureDebug('sensitive')
    const secret = 'userinfo-secret-7Hq2Lm9Z'
    for (const mark of ["'", '"', ',', '\\u0027'])
      for (const pad of ['x', `x${mark}`]) {
        events.length = 0
        debugRaw(
          'rpc',
          'cut',
          `at https://user:12345${mark}${secret}${pad.repeat(70_000)}@h/p`
        )
        const data = events[0].data as string
        // Booleans: a diff of 64 KB strings takes minutes.
        expect(data.includes('12345'), `${mark}${pad}`).to.equal(false)
        expect(data.includes(secret), `${mark}${pad}`).to.equal(false)
        expect(cutMarker(data).text).to.equal('at ')
      }
  })

  it('shows no part of a credential the event budget cuts, and sets the marker off (security N-m1)', () => {
    const events = captureDebug('sensitive')
    const token = 'FAKELLstr9Q7wZ3kP2mN8vB4cR6tY1uAbCd'
    const prefix = 'https://rpc.example/v2/'
    // The token straddles the end of the read: at 512 KB (before this fix) and at 256 KB
    // (now). At 35 the cut falls right after the token, which the marker used to stick to.
    for (const [rows, read] of [
      [190, 524_288],
      [90, 262_144]
    ])
      for (const back of [5, 19, 25, 35]) {
        const many = Array.from({ length: rows }, () => ({
          apiKey: 'x'.repeat(2700)
        }))
        const left = read - (4 + rows * (6 + 2700) + 4)
        const last = `${'b'.repeat(left - prefix.length - back)}${prefix}${token} end`
        events.length = 0
        debugRaw('rpc', 'budget', { many, last })

        expect(JSON.stringify(events[0].data), `${back}`).not.to.contain(
          token.slice(0, 4)
        )
        const data = (events[0].data as { last?: string }).last
        if (read === 262_144)
          expect(cutMarker(data ?? '').total).to.equal(last.length)
      }
  })

  it('keeps 0x hex and bytes read in part, marked with their whole length', () => {
    const events = captureDebug('sensitive')
    debugRaw('rpc', 'hex', { data: `0x${'ab'.repeat(40_000)}` })
    debugRaw('rpc', 'bytes', new Uint8Array(40_000))
    for (const event of events) {
      const data =
        typeof event.data === 'string'
          ? event.data
          : (event.data as { data: string }).data
      const marker = cutMarker(data)
      expect(marker).to.include({ shown: 32_768, total: 80_002 })
      expect(marker.text).to.match(/^0x[0-9a-f]{32766}$/)
    }
  })

  it('hides a private key under any name holding one, at every tier, and pass/pwd keys in logs (N7)', () => {
    const value = 'FAKEn7Q7m2Lx9pVt4'
    const has = (out: unknown) => JSON.stringify(out).includes(value)
    const text = (key: string) => `${key}=${value} "${key}": "${value}"`
    for (const key of [
      'privateKeyHex',
      'private_key_hex',
      'PRIVATE_KEY_HEX',
      'privKeyBytes',
      'signerPrivateKey'
    ]) {
      expect(has(redactFields({ [key]: value })), key).to.equal(false)
      expect(sanitize(text(key), 500, null), key).not.to.contain(value)
      expect(
        has(maskCredentials({ [key]: value, text: text(key) })),
        key
      ).to.equal(false)
      expect(
        has(maskNeverShown({ [key]: value, text: text(key) })),
        key
      ).to.equal(false)
    }
    for (const key of [
      'pass',
      'PASS',
      'pwd',
      'passwd',
      'passphrase',
      'DB_PASS',
      'dbPass',
      'smtp-pass',
      'dbPassword'
    ]) {
      expect(has(redactFields({ [key]: value })), key).to.equal(false)
      expect(sanitize(text(key), 500, null), key).not.to.contain(value)
      expect(
        has(maskCredentials({ [key]: value, text: text(key) })),
        key
      ).to.equal(false)
    }
    // Words that only end in the letters `pass`, and other readable keys, stay readable.
    const readable = {
      passed: 3,
      passive: true,
      bypass: 'yes',
      compass: 'n',
      surpass: 'x',
      BYPASS: 'y',
      pkg: 'nautilus'
    }
    expect(redactFields(readable)).to.deep.equal(readable)
    expect(sanitize('passed=3 bypass: yes pkg=nautilus', 500, null)).to.equal(
      'passed=3 bypass: yes pkg=nautilus'
    )
  })
})

describe('D28: invisible characters and URLs without a scheme', () => {
  const token = FAKE.rpcPathToken
  const [head, tail] = [token.slice(0, 15), token.slice(15)]

  it('the sensitive tier shows no part of a URL token split by an invisible character', () => {
    const failures: string[] = []
    for (const code of INVISIBLE_CODES) {
      const c = String.fromCharCode(code)
      for (const text of [
        `see https://${c}rpc.example.org/v3/${token} now`,
        `see https:/${c}/rpc.example.org/v3/${token} now`,
        `see https://rpc.example.org/v3/${c}${token} now`,
        `see https://rpc.example.org/v3/${head}${c}${tail} now`
      ]) {
        const shown = maskText(text)
        if ([token, head, tail].some((part) => shown.includes(part)))
          failures.push(`U+${code.toString(16)}: ${JSON.stringify(shown)}`)
      }
    }
    expect(failures).to.deep.equal([])
    // Without one, the text keeps its invisible characters: only what hides more changes.
    expect(maskText('a\u200bb https://rpc.example.org/v3/x')).to.equal(
      'a\u200bb https://rpc.example.org/v3/x'
    )
  })

  it('the sensitive tier masks the token of a URL without a scheme on an IP address, localhost or [IPv6]', () => {
    for (const [text, expected] of [
      [
        `rpc 127.0.0.1:8545/v3/${token} down`,
        'rpc 127.0.0.1:8545/v3/<redacted> down'
      ],
      [`rpc localhost:8545/${token}.`, 'rpc localhost:8545/<redacted>.'],
      [`rpc [::1]:8545/${token}`, 'rpc [::1]:8545/<redacted>'],
      [`rpc 10.0.0.7/x?apikey=${token}`, 'rpc 10.0.0.7/x?apikey=<redacted>']
    ])
      expect(maskText(text), text).to.equal(expected)

    for (const prose of [
      'ratio a:b/c is fine',
      'version 4.2.2:8080/x',
      'node.example.org:8000/api'
    ])
      expect(maskText(prose), prose).to.equal(prose)
  })
})
