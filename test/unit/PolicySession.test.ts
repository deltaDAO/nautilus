/**
 * The policy-server session: how nautilus opens it, when it needs a wallet, and that every
 * flow has it before it spends anything.
 *
 * The node and the policy server are played back: the real `OceanNodeClient` against a
 * stubbed `fetch` and ocean.js, and `PolicySessionResolver`, `access()` and `compute()`
 * against plain node stubs that answer the way ocean-node 4.2 and policy server 1.3 do.
 */

import {
  type Config,
  type ProviderInitialize,
  ProviderInstance
} from '@oceanprotocol/lib'
import {
  getAddress,
  getBytes,
  hexlify,
  type Signer,
  solidityPackedKeccak256,
  toUtf8Bytes,
  verifyMessage,
  Wallet
} from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access } from '../../src/access/index.js'
import { settleOrder } from '../../src/access/settlement.js'
import { compute, freeCompute } from '../../src/compute/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import type { PolicyServerPayload } from '../../src/ddo/types.js'
import type { CredentialChallenge } from '../../src/identity/CredentialProvider.js'
import {
  DEFAULT_SESSION_TTL_MS,
  PolicySessionResolver
} from '../../src/identity/PolicySessionResolver.js'
import { addRequestCredentials } from '../../src/identity/policy.js'
import {
  MemorySessionStore,
  type SessionEntry,
  type SessionKey
} from '../../src/identity/session.js'
import {
  OceanNodeClient,
  OceanNodeError,
  PolicyDeniedError,
  type PolicyServerReply,
  type PolicySessionCheck,
  type PolicyVerificationRequest
} from '../../src/node/OceanNodeClient.js'
import {
  ASSET_DID,
  CHAIN_ID,
  getAlgorithmAssetFixture,
  getAssetFixture,
  getComputeAssetFixture,
  SERVICE_ID
} from '../fixtures/Asset.js'
import { signedProviderFee } from '../fixtures/ProviderFee.js'
import { expectThrowsAsync } from '../helpers.js'

// Orders run against the chain. Stubbed, so a test can see whether one was placed at all.
vi.mock('../../src/access/settlement.js', () => ({
  settleOrder: vi.fn(async () => ({ transferTxId: '0xorder', reused: false })),
  planSettlement: vi.fn(
    async ({ datatokenAddress }: { datatokenAddress: string }) => ({
      datatokenAddress
    })
  ),
  sendSettlement: vi.fn(
    async ({ datatokenAddress }: { datatokenAddress: string }) => ({
      transferTxId: `tx-${datatokenAddress}`
    })
  )
}))

const NODE = 'https://node.test.invalid'
/** Checksummed on purpose: the policy server hashes the address as it is sent. */
const CONSUMER = '0x0DB823218e337a6817e6D7740eb17635DEAdafAF'
const OTHER_CONSUMER = '0x1111111111111111111111111111111111111111'
const SESSION = `${'a'.repeat(64)}-${'b'.repeat(64)}`

const signer = { getAddress: async () => CONSUMER } as unknown as Signer
const chainConfig = { chainId: CHAIN_ID } as unknown as Config

/** The policy server's `initiate` answer for an asset with no presentation to make. */
function initiated(
  sessionId: string | null = SESSION,
  redirectUri = `https://market.test.invalid/success?sessionId=${SESSION}`
): PolicyServerReply {
  return {
    success: true,
    httpStatus: 200,
    message: { ...(sessionId ? { sessionId } : {}), redirectUri }
  }
}

/** The policy server's answer for an asset whose `SSIpolicy` asks for credentials. */
function initiatedWithPresentation(): PolicyServerReply {
  return initiated(SESSION, `openid4vp://authorize?state=${SESSION}`)
}

/** An asset whose `SSIpolicy` asks for a `VerifiableId`. */
function ssiAsset(): AssetV5 {
  const asset = getAssetFixture()
  asset.credentialSubject.credentials = addRequestCredentials(
    asset.credentialSubject.credentials as never,
    'allow' as never,
    [{ type: 'VerifiableId', format: 'jwt_vc_json' }]
  ) as never

  return asset
}

interface PolicyNodeStub {
  client: OceanNodeClient
  calls: string[]
  initiateRequests: PolicyVerificationRequest[]
  checkedSessions: string[]
}

/**
 * A node with a policy server. Every call is logged in order into `calls`, so a test can
 * see what came before the fee request and the order.
 */
function policyNode(
  options: {
    nodeUri?: string
    policyServer?: boolean | undefined
    initiate?: () => Promise<PolicyServerReply | null>
    check?: PolicySessionCheck
    asset?: AssetV5
    assets?: Record<string, AssetV5>
  } = {}
): PolicyNodeStub {
  const calls: string[] = []
  const initiateRequests: PolicyVerificationRequest[] = []
  const checkedSessions: string[] = []
  const nodeUri = options.nodeUri ?? NODE

  const client = {
    nodeUri,
    forEndpoint() {
      return client
    },
    async hasPolicyServer() {
      calls.push('hasPolicyServer')
      return 'policyServer' in options ? options.policyServer : true
    },
    async initializePolicyVerification(request: PolicyVerificationRequest) {
      calls.push('initiate')
      initiateRequests.push(request)
      return options.initiate ? options.initiate() : initiated()
    },
    async checkPolicySession(sessionId: string) {
      calls.push('checkSessionId')
      checkedSessions.push(sessionId)
      return options.check ?? { verified: true, result: {} }
    },
    async resolve(did: string) {
      calls.push('resolve')
      const asset = options.assets?.[did] ?? options.asset ?? getAssetFixture()
      return asset
    },
    async initialize(
      _did: string,
      _serviceId: string,
      params: { consumerAddress?: string }
    ) {
      calls.push(`initialize:${params.consumerAddress}`)
      return {
        datatoken: '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8',
        validOrder: '0xexisting',
        providerFee: { providerFeeAmount: '0' }
      } as unknown as ProviderInitialize
    },
    getDownloadUrl: vi.fn(
      async (
        _did: string,
        _serviceId: string,
        _tx: string,
        _options: { policyServer?: PolicyServerPayload | null }
      ) => {
        calls.push('getDownloadUrl')
        return `${nodeUri}/download`
      }
    )
  } as unknown as OceanNodeClient

  return { client, calls, initiateRequests, checkedSessions }
}

/** A provider that records what it was asked to present. */
function recordingProvider() {
  const challenges: CredentialChallenge[] = []

  return {
    challenges,
    provider: {
      async present(challenge: CredentialChallenge) {
        challenges.push(challenge)
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OceanNodeClient policy server', () => {
  function client(
    auth: ConstructorParameters<typeof OceanNodeClient>[0]['auth']
  ) {
    return new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth,
      consumerAddress: CONSUMER
    })
  }

  const request: PolicyVerificationRequest = {
    documentId: ASSET_DID,
    serviceId: SERVICE_ID,
    consumerAddress: CONSUMER,
    policyServer: {
      sessionId: '',
      successRedirectUri: '',
      errorRedirectUri: '',
      responseRedirectUri: '',
      presentationDefinitionUri: ''
    }
  }

  /** The node's status, with or without a policy server. */
  function status(isPSConfigured?: boolean) {
    return vi
      .spyOn(ProviderInstance, 'getNodeStatus')
      .mockResolvedValue(
        (isPSConfigured === undefined ? null : { isPSConfigured }) as never
      )
  }

  /** Answers `initializePSVerification` with `body` and `httpStatus`. */
  function answer(httpStatus: number, body: unknown) {
    const fetch = vi.fn(
      async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: httpStatus
        })
    )
    vi.stubGlobal('fetch', fetch)

    return fetch
  }

  it('returns null without asking when the node status says it has no policy server', async () => {
    status(false)
    const fetch = answer(200, initiated())

    expect(
      await client('a-session-token').initializePolicyVerification(request)
    ).to.equal(null)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the node status once per client', async () => {
    const getNodeStatus = status(true)
    const node = client('a-session-token')

    expect(await node.hasPolicyServer()).to.equal(true)
    expect(await node.hasPolicyServer()).to.equal(true)
    expect(getNodeStatus).toHaveBeenCalledOnce()
  })

  it('returns null on a 404 with no body, how a node with no policy server answers', async () => {
    status(undefined)
    answer(404, '')

    expect(
      await client('a-session-token').initializePolicyVerification(request)
    ).to.equal(null)
  })

  it("returns the policy server's answer", async () => {
    status(true)
    answer(200, initiated())

    expect(
      await client('a-session-token').initializePolicyVerification(request)
    ).to.deep.equal(initiated())
  })

  it('throws a PolicyDeniedError with the reason on a 403, never null', async () => {
    status(true)
    answer(403, {
      success: false,
      httpStatus: 403,
      message: {
        redirectUri: '',
        error: 'Access denied: Address not allowed at asset level.'
      }
    })

    const thrown = await client('a-session-token')
      .initializePolicyVerification(request)
      .catch((caught) => caught)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown).not.to.be.instanceOf(OceanNodeError)
    expect(thrown).to.include({
      did: ASSET_DID,
      serviceId: SERVICE_ID,
      consumerAddress: CONSUMER,
      code: 403,
      reason: 'Access denied: Address not allowed at asset level.'
    })
    expect(thrown.message).to.match(/Nothing was ordered or paid/)
  })

  it('throws a PolicyDeniedError on a 401 from the node, even when the status is unknown', async () => {
    status(undefined)
    answer(401, 'Invalid nonce or signature')

    const thrown = await client('a-session-token')
      .initializePolicyVerification(request)
      .catch((caught) => caught)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.code).to.equal(401)
    expect(thrown.reason).to.equal('Invalid nonce or signature')
  })

  it('names the address the request was sent with, which a Signer chooses', async () => {
    status(true)
    const wallet = Wallet.createRandom()
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(1)
    const fetch = answer(403, {
      success: false,
      httpStatus: 403,
      message: { error: 'Access denied: Address not allowed at asset level.' }
    })

    // The request names another address; ocean-node and ocean.js send the signer's.
    const thrown = await client(wallet)
      .initializePolicyVerification({ ...request, consumerAddress: CONSUMER })
      .catch((caught) => caught)

    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body)).consumerAddress).to.equal(
      wallet.address
    )
    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.consumerAddress).to.equal(wallet.address)
    expect(thrown.message).to.contain(`for ${wallet.address}`)
    expect(thrown.message).not.to.contain(CONSUMER)
  })

  it('names the address ocean.js sent over P2P', async () => {
    status(true)
    const wallet = Wallet.createRandom()
    vi.spyOn(ProviderInstance, 'initializePSVerification').mockRejectedValue(
      new Error(
        JSON.stringify({
          success: false,
          httpStatus: 403,
          message: { error: 'Access denied' }
        })
      )
    )

    const thrown = await new OceanNodeClient({
      nodeUri: '16Uiu2HAmPeerIdOnly',
      chainId: CHAIN_ID,
      auth: wallet,
      consumerAddress: CONSUMER
    })
      .initializePolicyVerification({ ...request, consumerAddress: CONSUMER })
      .catch((caught) => caught)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.consumerAddress).to.equal(wallet.address)
  })

  it('throws an OceanNodeError on a 5xx, a rate limit or a network error', async () => {
    status(true)

    answer(500, 'Unknown error: boom')
    let thrown = await client('a-session-token')
      .initializePolicyVerification(request)
      .catch((caught) => caught)
    expect(thrown).to.be.instanceOf(OceanNodeError)
    expect(thrown.message).to.match(/500.*boom/)

    answer(429, 'Too many requests')
    thrown = await client('a-session-token')
      .initializePolicyVerification(request)
      .catch((caught) => caught)
    expect(thrown).to.be.instanceOf(OceanNodeError)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    thrown = await client('a-session-token')
      .initializePolicyVerification(request)
      .catch((caught) => caught)
    expect(thrown).to.be.instanceOf(OceanNodeError)
    expect(thrown.message).to.match(/fetch failed/)
  })

  it('signs consumerAddress + (stored nonce + 1) + PolicyServerInitialize, as ocean.js does', async () => {
    status(true)
    const wallet = Wallet.createRandom()
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(6)
    const fetch = answer(200, initiated())

    await client(wallet).initializePolicyVerification({
      ...request,
      consumerAddress: wallet.address
    })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    const message = `${wallet.address}7PolicyServerInitialize`
    const digest = solidityPackedKeccak256(
      ['bytes'],
      [hexlify(toUtf8Bytes(message))]
    )

    expect(url).to.equal(`${NODE}/api/services/initializePSVerification`)
    expect(body).to.include({
      documentId: ASSET_DID,
      serviceId: SERVICE_ID,
      consumerAddress: wallet.address,
      nonce: '7'
    })
    expect(verifyMessage(getBytes(digest), body.signature)).to.equal(
      wallet.address
    )
  })

  it('sends a JWT as Authorization, with no nonce or signature', async () => {
    status(true)
    const fetch = answer(200, initiated())

    await client('a-session-token').initializePolicyVerification(request)

    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    const body = JSON.parse(String(init.body))

    expect((init.headers as Record<string, string>).Authorization).to.equal(
      'a-session-token'
    )
    expect(body.nonce).to.equal(undefined)
    expect(body.signature).to.equal(undefined)
  })

  it('sends initiate and the download the same checksummed address, read from the signer', async () => {
    status(true)
    const wallet = Wallet.createRandom()
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(1)
    const fetch = answer(200, initiated())
    const node = new OceanNodeClient({
      nodeUri: NODE,
      chainId: CHAIN_ID,
      auth: wallet
    })
    const consumerAddress = await wallet.getAddress()

    const session = await new PolicySessionResolver().resolve({
      node,
      asset: getAssetFixture(),
      serviceId: SERVICE_ID,
      consumerAddress
    })
    const url = await node.getDownloadUrl(ASSET_DID, SERVICE_ID, '0xorder', {
      policyServer: session
    })

    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    const initiatedFor = JSON.parse(String(init.body)).consumerAddress

    expect(initiatedFor).to.equal(getAddress(consumerAddress))
    expect(new URL(url).searchParams.get('consumerAddress')).to.equal(
      initiatedFor
    )
  })

  it('reports a verified session', async () => {
    vi.spyOn(ProviderInstance, 'PolicyServerPassthrough').mockResolvedValue({
      success: true,
      message: { verificationResult: true }
    })

    expect(
      await client('a-session-token').checkPolicySession(SESSION)
    ).to.deep.equal({ verified: true, result: { verificationResult: true } })
  })

  it('reports an unverified session, which the policy server answers with an error status', async () => {
    // ocean.js throws the body of a failed answer as the error message.
    const record = { verificationResult: false, policyResults: {} }
    const passthrough = vi
      .spyOn(ProviderInstance, 'PolicyServerPassthrough')
      .mockRejectedValue(
        new Error(
          JSON.stringify({ success: false, httpStatus: 500, message: record })
        )
      )

    expect(
      await client('a-session-token').checkPolicySession(SESSION)
    ).to.deep.equal({ verified: false, result: record })
    expect(passthrough.mock.calls[0][1]).to.deep.equal({
      policyServerPassthrough: { action: 'checkSessionId', sessionId: SESSION }
    })
  })

  it('throws an OceanNodeError when the session cannot be checked at all', async () => {
    vi.spyOn(ProviderInstance, 'PolicyServerPassthrough').mockRejectedValue(
      new Error('PolicyServerPassthrough failed: fetch failed.')
    )

    await expectThrowsAsync(
      () => client('a-session-token').checkPolicySession(SESSION),
      /fetch failed/
    )
  })
})

describe('PolicySessionResolver', () => {
  function resolve(
    node: OceanNodeClient,
    resolver = new PolicySessionResolver(),
    asset = getAssetFixture(),
    consumerAddress = CONSUMER
  ) {
    return resolver.resolve({
      node,
      asset,
      serviceId: SERVICE_ID,
      consumerAddress
    })
  }

  it('uses message.sessionId for an address-only asset, with no wallet', async () => {
    const { client, calls } = policyNode()
    const { provider, challenges } = recordingProvider()

    const session = await resolve(
      client,
      new PolicySessionResolver({ credentials: provider })
    )

    expect(session?.sessionId).to.equal(SESSION)
    expect(challenges).to.have.length(0)
    expect(calls).not.to.include('checkSessionId')
  })

  it('reads message.sessionId whether or not the redirect carries an id', async () => {
    for (const redirectUri of [
      'https://market.test.invalid/success',
      `https://market.test.invalid/success?id=${SESSION}`,
      'https://market.test.invalid/success?id=another-session'
    ]) {
      const { client } = policyNode({
        initiate: async () => initiated(SESSION, redirectUri)
      })

      expect((await resolve(client))?.sessionId).to.equal(SESSION)
    }
  })

  it('falls back to the redirect: sessionId=, then id=, then state=', async () => {
    for (const [redirectUri, expected] of [
      [
        'https://m.test.invalid/ok?id=from-id&sessionId=from-session',
        'from-session'
      ],
      ['https://m.test.invalid/ok?id=from-id', 'from-id'],
      ['openid4vp://authorize?state=from-state&client_id=x', 'from-state']
    ]) {
      const { client } = policyNode({
        initiate: async () => initiated(null, redirectUri)
      })

      expect((await resolve(client))?.sessionId).to.equal(expected)
    }
  })

  it('fails when the policy server opens no session', async () => {
    const { client } = policyNode({
      initiate: async () => initiated(null, 'https://m.test.invalid/ok')
    })

    await expectThrowsAsync(() => resolve(client), /opened no session/)
  })

  it('treats credentials: {} as gated, as the node does', async () => {
    const asset = getAssetFixture()
    asset.credentialSubject.credentials = {} as never
    const { client, calls } = policyNode()

    expect((await resolve(client, undefined, asset))?.sessionId).to.equal(
      SESSION
    )
    expect(calls).to.include('initiate')
  })

  it('opens no session when neither the asset nor the service has credentials', async () => {
    const asset = getAssetFixture()
    delete (asset.credentialSubject as { credentials?: unknown }).credentials
    delete (asset.credentialSubject.services[0] as { credentials?: unknown })
      .credentials
    const { client, calls } = policyNode()

    expect(await resolve(client, undefined, asset)).to.equal(null)
    expect(calls).to.deep.equal([])
  })

  it('opens no session on a node without a policy server, even for an SSI asset', async () => {
    const { client, calls } = policyNode({ policyServer: false })

    expect(await resolve(client, undefined, ssiAsset())).to.equal(null)
    expect(calls).not.to.include('initiate')
  })

  it('returns null when initiate finds no policy server (404)', async () => {
    const { client } = policyNode({
      policyServer: undefined,
      initiate: async () => null
    })

    expect(await resolve(client)).to.equal(null)
  })

  it('caches neither a refusal nor an unverified presentation', async () => {
    const denied = policyNode({
      initiate: async () => {
        throw new PolicyDeniedError({
          nodeUri: NODE,
          did: ASSET_DID,
          serviceId: SERVICE_ID,
          consumerAddress: CONSUMER,
          code: 403,
          reason: 'Access denied: Address not allowed at asset level.'
        })
      }
    })
    const resolver = new PolicySessionResolver()

    for (let i = 0; i < 2; i++)
      expect(
        await resolve(denied.client, resolver).catch((e) => e)
      ).to.be.instanceOf(PolicyDeniedError)
    expect(denied.initiateRequests).to.have.length(2)

    const unverified = policyNode({
      initiate: async () => initiatedWithPresentation(),
      check: { verified: false, result: {} }
    })
    const withProvider = new PolicySessionResolver({
      credentials: recordingProvider().provider
    })

    for (let i = 0; i < 2; i++)
      await resolve(unverified.client, withProvider, ssiAsset()).catch(() => {})
    expect(unverified.initiateRequests).to.have.length(2)
  })

  it('refuses an SSI asset without a credential provider, before initiate', async () => {
    const { client, calls } = policyNode({
      initiate: async () => initiatedWithPresentation()
    })

    await expectThrowsAsync(
      () => resolve(client, undefined, ssiAsset()),
      /requires a verifiable presentation, and no credential provider is set.*WaltIdCredentialProvider/
    )
    expect(calls).not.to.include('initiate')
  })

  it('hands the session and the openid4vp request to the provider, then checks it', async () => {
    const { client, calls, checkedSessions } = policyNode({
      initiate: async () => initiatedWithPresentation()
    })
    const { provider, challenges } = recordingProvider()

    const session = await resolve(
      client,
      new PolicySessionResolver({ credentials: provider }),
      ssiAsset()
    )

    expect(session?.sessionId).to.equal(SESSION)
    expect(challenges).to.have.length(1)
    expect(challenges[0]).to.include({
      sessionId: SESSION,
      redirectUri: `openid4vp://authorize?state=${SESSION}`,
      serviceId: SERVICE_ID,
      consumerAddress: CONSUMER,
      node: client
    })
    expect(checkedSessions).to.deep.equal([SESSION])
    expect(calls.slice(-2)).to.deep.equal(['initiate', 'checkSessionId'])
  })

  it('throws a PolicyDeniedError naming the failed policy when the presentation is not verified', async () => {
    const { client } = policyNode({
      initiate: async () => initiatedWithPresentation(),
      check: {
        verified: false,
        result: {
          verificationResult: false,
          policyResults: {
            results: [
              {
                policyResults: [
                  { is_success: true, policy: 'signature' },
                  {
                    is_success: false,
                    policy: 'revoked-status-list',
                    description: 'credential is revoked'
                  }
                ]
              }
            ]
          }
        }
      }
    })

    const thrown = await resolve(
      client,
      new PolicySessionResolver({ credentials: recordingProvider().provider }),
      ssiAsset()
    ).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.reason).to.match(
      /did not accept the presentation \(revoked-status-list: credential is revoked\)/
    )
  })

  it('caches a session per account and per node, and sends the address as it is', async () => {
    const first = policyNode()
    const second = policyNode({ nodeUri: 'https://other.test.invalid' })
    const resolver = new PolicySessionResolver()

    await resolve(first.client, resolver)
    await resolve(first.client, resolver)
    await resolve(first.client, resolver, undefined, OTHER_CONSUMER)
    await resolve(second.client, resolver)

    // Only the second call hits the cache.
    expect(first.initiateRequests.map((r) => r.consumerAddress)).to.deep.equal([
      CONSUMER,
      OTHER_CONSUMER
    ])
    expect(second.initiateRequests).to.have.length(1)
  })

  it('never hands a session opened for the checksummed address to the lower-cased one', async () => {
    let opened = 0
    const { client, initiateRequests } = policyNode({
      initiate: async () => initiated(`session-${++opened}`)
    })
    const resolver = new PolicySessionResolver()
    const lower = CONSUMER.toLowerCase()

    const checksummed = await resolve(client, resolver)
    const lowerCased = await resolve(client, resolver, undefined, lower)

    expect(checksummed?.sessionId).to.equal('session-1')
    expect(lowerCased?.sessionId).to.equal('session-2')
    expect(initiateRequests.map((r) => r.consumerAddress)).to.deep.equal([
      CONSUMER,
      lower
    ])

    // Each is still cached under its own exact string.
    expect((await resolve(client, resolver))?.sessionId).to.equal('session-1')
    expect(
      (await resolve(client, resolver, undefined, lower))?.sessionId
    ).to.equal('session-2')
    expect(initiateRequests).to.have.length(2)
  })

  describe('session lifetime', () => {
    const T0 = 1_700_000_000_000

    function at(time: number) {
      vi.spyOn(Date, 'now').mockReturnValue(time)
    }

    it('reuses a session younger than the TTL, and opens a new one once it is that old', async () => {
      let opened = 0
      const { client, initiateRequests } = policyNode({
        initiate: async () => initiated(`session-${++opened}`)
      })
      const resolver = new PolicySessionResolver()

      at(T0)
      expect((await resolve(client, resolver))?.sessionId).to.equal('session-1')

      at(T0 + DEFAULT_SESSION_TTL_MS - 1)
      expect((await resolve(client, resolver))?.sessionId).to.equal('session-1')
      expect(initiateRequests).to.have.length(1)

      at(T0 + DEFAULT_SESSION_TTL_MS)
      expect((await resolve(client, resolver))?.sessionId).to.equal('session-2')
      expect(initiateRequests).to.have.length(2)
    })

    it('defaults to 2 minutes, within the 5 minutes walt.id keeps a session', () => {
      expect(DEFAULT_SESSION_TTL_MS).to.equal(2 * 60 * 1000)
    })

    it('takes sessionTtlMs, and caches nothing with 0', async () => {
      const { client, initiateRequests } = policyNode()

      at(T0)
      const short = new PolicySessionResolver({ sessionTtlMs: 1000 })
      await resolve(client, short)
      at(T0 + 1000)
      await resolve(client, short)
      expect(initiateRequests).to.have.length(2)

      const store = new MemorySessionStore()
      const uncached = new PolicySessionResolver({
        sessionTtlMs: 0,
        sessionStore: store
      })
      await resolve(client, uncached)
      await resolve(client, uncached)
      expect(initiateRequests).to.have.length(4)
      expect(
        store.get({
          nodeUri: NODE,
          did: ASSET_DID,
          serviceId: SERVICE_ID,
          consumerAddress: CONSUMER
        })
      ).to.equal(undefined)
    })

    it('rejects a negative or non-finite sessionTtlMs', () => {
      for (const sessionTtlMs of [-1, Number.NaN, Number.POSITIVE_INFINITY])
        expect(() => new PolicySessionResolver({ sessionTtlMs })).to.throw(
          /sessionTtlMs/
        )
    })

    it('drops an expired, undated or future-dated entry from a store that outlived the policy server', async () => {
      const key: SessionKey = {
        nodeUri: NODE,
        did: ASSET_DID,
        serviceId: SERVICE_ID,
        consumerAddress: CONSUMER
      }

      for (const stale of [
        {
          sessionId: 'stale',
          createdAt: T0 - DEFAULT_SESSION_TTL_MS,
          presented: false
        },
        { sessionId: 'stale', presented: false } as unknown as SessionEntry,
        { sessionId: 'stale', createdAt: T0 + 60_000, presented: false }
      ]) {
        const store = new MemorySessionStore()
        store.set(key, stale)
        const { client, initiateRequests } = policyNode()

        at(T0)
        const session = await resolve(
          client,
          new PolicySessionResolver({ sessionStore: store })
        )

        expect(session?.sessionId).to.equal(SESSION)
        expect(initiateRequests).to.have.length(1)
        expect(store.get(key)).to.deep.equal({
          sessionId: SESSION,
          createdAt: T0,
          presented: false
        })
      }
    })

    it('reuses an address-only session without asking the policy server again', async () => {
      const { client, calls } = policyNode()
      const resolver = new PolicySessionResolver()

      await resolve(client, resolver)
      await resolve(client, resolver)

      expect(calls.filter((call) => call === 'initiate')).to.have.length(1)
      expect(calls).not.to.include('checkSessionId')
    })

    it('checks a cached presented session again before reusing it', async () => {
      const { client, calls, checkedSessions } = policyNode({
        initiate: async () => initiatedWithPresentation()
      })
      const { provider, challenges } = recordingProvider()
      const resolver = new PolicySessionResolver({ credentials: provider })

      await resolve(client, resolver, ssiAsset())
      const reused = await resolve(client, resolver, ssiAsset())

      expect(reused?.sessionId).to.equal(SESSION)
      expect(calls.filter((call) => call === 'initiate')).to.have.length(1)
      expect(challenges).to.have.length(1)
      // Once after the presentation, once before the reuse.
      expect(checkedSessions).to.deep.equal([SESSION, SESSION])
    })

    it('opens and presents again when the verifier no longer knows a cached session', async () => {
      let opened = 0
      const { client, initiateRequests } = policyNode({
        initiate: async () =>
          initiated(`session-${++opened}`, 'openid4vp://authorize?state=x')
      })
      const check = vi.spyOn(client, 'checkPolicySession')
      const { provider, challenges } = recordingProvider()
      const resolver = new PolicySessionResolver({ credentials: provider })

      await resolve(client, resolver, ssiAsset())

      // The verifier restarted: checking the cached session fails outright.
      check.mockRejectedValueOnce(
        new OceanNodeError('checkPolicySession', '500 session expired')
      )

      const session = await resolve(client, resolver, ssiAsset())

      expect(session?.sessionId).to.equal('session-2')
      expect(initiateRequests).to.have.length(2)
      expect(challenges.map((c) => c.sessionId)).to.deep.equal([
        'session-1',
        'session-2'
      ])
    })

    it('opens a new session when the check reports a cached one unverified', async () => {
      let opened = 0
      const { client, initiateRequests } = policyNode({
        initiate: async () =>
          initiated(`session-${++opened}`, 'openid4vp://authorize?state=x')
      })
      const check = vi.spyOn(client, 'checkPolicySession')
      const resolver = new PolicySessionResolver({
        credentials: recordingProvider().provider
      })

      await resolve(client, resolver, ssiAsset())

      check.mockResolvedValueOnce({ verified: false, result: {} })

      expect((await resolve(client, resolver, ssiAsset()))?.sessionId).to.equal(
        'session-2'
      )
      expect(initiateRequests).to.have.length(2)
    })
  })
})

describe('access() with a policy server', () => {
  function download(
    node: OceanNodeClient,
    policySessions?: PolicySessionResolver
  ) {
    return access(
      { assetDid: ASSET_DID },
      { node, signer, chainConfig, policySessions }
    )
  }

  it('opens a session for an address-only asset with no provider, and downloads with it', async () => {
    const { client, calls } = policyNode()

    await download(client)

    expect(calls.indexOf('initiate')).to.be.lessThan(
      calls.indexOf(`initialize:${CONSUMER}`)
    )
    const downloadOptions = vi.mocked(client.getDownloadUrl).mock.calls[0][3]
    expect(
      (downloadOptions?.policyServer as PolicyServerPayload | null)?.sessionId
    ).to.equal(SESSION)
  })

  it('sends initiate and the node calls the same address string', async () => {
    const { client, calls, initiateRequests } = policyNode()

    await download(client)

    expect(initiateRequests[0].consumerAddress).to.equal(CONSUMER)
    expect(calls).to.include(`initialize:${CONSUMER}`)
  })

  it('stops at a refusal: no fee request, no order, nothing cached', async () => {
    const { client, calls, initiateRequests } = policyNode({
      initiate: async () => {
        throw new PolicyDeniedError({
          nodeUri: NODE,
          did: ASSET_DID,
          serviceId: SERVICE_ID,
          consumerAddress: CONSUMER,
          code: 403,
          reason: 'Access denied: Address not allowed at asset level.'
        })
      }
    })
    const resolver = new PolicySessionResolver()

    for (let i = 0; i < 2; i++)
      expect(await download(client, resolver).catch((e) => e)).to.be.instanceOf(
        PolicyDeniedError
      )

    expect(calls.filter((call) => call.startsWith('initialize'))).to.deep.equal(
      []
    )
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
    expect(initiateRequests).to.have.length(2)
  })

  it('downloads with no session on a node without a policy server', async () => {
    const { client, calls } = policyNode({ policyServer: false })

    await download(client)

    expect(calls).not.to.include('initiate')
    const downloadOptions = vi.mocked(client.getDownloadUrl).mock.calls[0][3]
    expect(downloadOptions?.policyServer).to.equal(null)
  })

  it('refuses an SSI asset without a provider before initialize', async () => {
    const { client, calls } = policyNode({ asset: ssiAsset() })

    await expectThrowsAsync(
      () => download(client),
      /requires a verifiable presentation/
    )
    expect(calls.some((call) => call.startsWith('initialize'))).to.equal(false)
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
  })

  it('refuses before the order when checkSessionId does not verify the presentation', async () => {
    const { client, calls } = policyNode({
      asset: ssiAsset(),
      initiate: async () => initiatedWithPresentation(),
      check: { verified: false, result: {} }
    })

    const thrown = await download(
      client,
      new PolicySessionResolver({ credentials: recordingProvider().provider })
    ).catch((caught) => caught)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(calls.some((call) => call.startsWith('initialize'))).to.equal(false)
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
  })
})

describe('compute() with a policy server', () => {
  const ALGO_DID = 'did:ope:algorithm'
  const ALGO_SERVICE_ID = 'algorithm-service'
  const ALGO_DATATOKEN = '0x1111111111111111111111111111111111111111'
  const DATASET_DATATOKEN = '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8'

  function algorithm(): AssetV5 {
    const asset = getAlgorithmAssetFixture()
    asset.id = ALGO_DID
    asset.credentialSubject.id = ALGO_DID
    asset.credentialSubject.services[0].id = ALGO_SERVICE_ID
    asset.credentialSubject.services[0].datatokenAddress = ALGO_DATATOKEN

    return asset
  }

  /** A compute node with a policy server that opens one session per (asset, service). */
  function computeNode(
    initiate?: (
      request: PolicyVerificationRequest
    ) => Promise<PolicyServerReply>
  ) {
    const calls: string[] = []
    const initializeCompute: { policyServer?: unknown }[] = []
    const computeStart: { policyServer?: unknown }[] = []
    const freeComputeStart: { policyServer?: unknown }[] = []
    const providerFee = signedProviderFee({ providerFeeAmount: '0' })
    const assets: Record<string, AssetV5> = {
      [ASSET_DID]: getComputeAssetFixture(),
      [ALGO_DID]: algorithm()
    }

    const client = {
      nodeUri: NODE,
      async resolve(did: string) {
        return assets[did]
      },
      async hasPolicyServer() {
        return true
      },
      async initializePolicyVerification(request: PolicyVerificationRequest) {
        calls.push(`initiate:${request.documentId}`)
        return initiate
          ? initiate(request)
          : initiated(`session-of-${request.documentId}#${request.serviceId}`)
      },
      async getComputeEnvironments() {
        return [
          {
            id: 'env-1',
            consumerAddress: '0x00000000000000000000000000000000000000c0',
            resources: [{ id: 'cpu', min: 1, max: 4 }],
            fees: {
              [String(CHAIN_ID)]: [
                { feeToken: '0xfee0000000000000000000000000000000000000' }
              ]
            },
            free: { resources: [{ id: 'cpu', min: 1, max: 1 }] },
            maxJobDuration: 3600
          }
        ]
      },
      async initializeCompute(params: { policyServer?: unknown }) {
        calls.push('initializeCompute')
        initializeCompute.push(params)
        return {
          datasets: [{ datatoken: DATASET_DATATOKEN, providerFee }],
          algorithm: { datatoken: ALGO_DATATOKEN, providerFee }
        }
      },
      async computeStart(params: { policyServer?: unknown }) {
        calls.push('computeStart')
        computeStart.push(params)
        return [{ jobId: 'job-1' }]
      },
      async freeComputeStart(params: { policyServer?: unknown }) {
        freeComputeStart.push(params)
        return [{ jobId: 'job-1' }]
      }
    } as unknown as OceanNodeClient

    return { client, calls, initializeCompute, computeStart, freeComputeStart }
  }

  const job = {
    dataset: { did: ASSET_DID },
    algorithm: { did: ALGO_DID }
  }

  const context = (node: OceanNodeClient) => ({
    node,
    signer,
    chainConfig,
    escrow: '0x00000000000000000000000000000000000e5c40'
  })

  it('opens one session per input, the algorithm included, and sends the same array to both calls', async () => {
    const node = computeNode()

    await compute(job, context(node.client))

    const expected = [
      {
        sessionId: `session-of-${ASSET_DID}#${SERVICE_ID}`,
        documentId: ASSET_DID,
        serviceId: SERVICE_ID
      },
      {
        sessionId: `session-of-${ALGO_DID}#${ALGO_SERVICE_ID}`,
        documentId: ALGO_DID,
        serviceId: ALGO_SERVICE_ID
      }
    ]

    const sent = node.initializeCompute[0].policyServer as Record<
      string,
      unknown
    >[]
    expect(sent).to.have.length(2)
    sent.forEach((entry, index) => {
      expect(entry).to.include(expected[index])
    })
    expect(node.computeStart[0].policyServer).to.equal(sent)
  })

  it('sends initiate and initializeCompute the signer address unchanged', async () => {
    const initiatedFor: string[] = []
    const node = computeNode(async (request) => {
      initiatedFor.push(request.consumerAddress)
      return initiated(`session-of-${request.documentId}`)
    })

    await compute(job, context(node.client))

    expect(initiatedFor).to.deep.equal([CONSUMER, CONSUMER])
    expect(
      (node.initializeCompute[0] as { consumerAddress?: string })
        .consumerAddress
    ).to.equal(CONSUMER)
  })

  it('opens every session before initializeCompute and any order', async () => {
    const node = computeNode()

    await compute(job, context(node.client))

    expect(node.calls.slice(0, 3)).to.deep.equal([
      `initiate:${ASSET_DID}`,
      `initiate:${ALGO_DID}`,
      'initializeCompute'
    ])
  })

  it('refuses the whole job when the algorithm is refused, before anything is asked or ordered', async () => {
    const node = computeNode(async (request) => {
      if (request.documentId === ALGO_DID)
        throw new PolicyDeniedError({
          nodeUri: NODE,
          did: ALGO_DID,
          serviceId: ALGO_SERVICE_ID,
          consumerAddress: CONSUMER,
          code: 403,
          reason: 'Access denied: Address not allowed at asset level.'
        })
      return initiated()
    })

    const thrown = await compute(job, context(node.client)).catch(
      (caught) => caught
    )

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.did).to.equal(ALGO_DID)
    expect(node.calls).not.to.include('initializeCompute')
    expect(node.calls).not.to.include('computeStart')
  })

  it('sends the sessions to freeComputeStart too', async () => {
    const node = computeNode()

    await freeCompute(job, context(node.client))

    const sent = node.freeComputeStart[0].policyServer as {
      documentId: string
    }[]
    expect(sent.map((entry) => entry.documentId)).to.deep.equal([
      ASSET_DID,
      ALGO_DID
    ])
  })
})
