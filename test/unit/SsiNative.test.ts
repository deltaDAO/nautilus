/**
 * The node's native SSI module (pontusx-node: `ssiInitiate`, `ssiStatus`, `validateRego`,
 * `SSIpolicyV2`, OpenID4VP 1.0 / DCQL) and walt.id wallet-api2's handle-based
 * presentation: the wire shapes are taken from pontusx-node `docs/SSI.md`,
 * `core/handler/ssiHandler.ts` and `httpRoutes/ssi.ts`, and from pontusx-identity
 * `PresentationHandles.kt` / `PresentationPreviewResponse.kt`.
 */

import {
  type Config,
  type ProviderInitialize,
  ProviderInstance
} from '@oceanprotocol/lib'
import {
  hexlify,
  id,
  type Signer,
  solidityPackedKeccak256,
  toBeArray,
  toUtf8Bytes,
  verifyMessage,
  Wallet
} from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access } from '../../src/access/index.js'
import { settleOrder } from '../../src/access/settlement.js'
import { compute, freeCompute } from '../../src/compute/index.js'
import type { AssetV5 } from '../../src/ddo/index.js'
import {
  CredentialListTypes,
  type DdoCredentials,
  type SsiPolicyV2Value
} from '../../src/ddo/types.js'
import type { CredentialChallenge } from '../../src/identity/CredentialProvider.js'
import { PolicySessionResolver } from '../../src/identity/PolicySessionResolver.js'
import {
  addRequestCredentials,
  normalizeStoredCredentials
} from '../../src/identity/policy.js'
import {
  addSsiPolicyV2,
  readSsiCapabilities,
  readSsiInitiate,
  readSsiStatus,
  regoProblem,
  requiredGaiaXLevel,
  type SsiCapabilities,
  type SsiInitiateResult,
  SsiPolicyValidationError,
  type SsiStatusResult,
  validateSsiPolicyV2Value
} from '../../src/identity/ssi.js'
import { WalletApi2CredentialProvider } from '../../src/identity/WalletApi2Provider.js'
import {
  CredentialPresentationError,
  WaltIdCredentialProvider
} from '../../src/identity/WaltIdProvider.js'
import { WaltIdWalletError } from '../../src/identity/waltid/client.js'
import {
  type WalletApi2,
  WalletApi2HttpClient,
  type WalletApi2Preview
} from '../../src/identity/waltid/wallet2.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import {
  OceanNodeClient,
  OceanNodeError,
  PolicyDeniedError,
  type SsiInitiateRequest,
  type SsiStatusRequest
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
import { captureLog } from '../helpers.js'

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
const VERIFIER_HOST = 'verifier.test.invalid'
const CONSUMER = '0x0DB823218e337a6817e6D7740eb17635DEAdafAF'
const SESSION = 'a1b2c3d4e5f6a7b8c9d0'
const REQUEST_URI = `openid4vp://authorize?client_id=x509_san_dns%3A${VERIFIER_HOST}&request_uri=${encodeURIComponent(`https://${VERIFIER_HOST}/verification-session/${SESSION}/request`)}`

const signer = { getAddress: async () => CONSUMER } as unknown as Signer
const chainConfig = { chainId: CHAIN_ID } as unknown as Config

const LEGAL_PERSON: SsiPolicyV2Value = {
  version: '2',
  dcql: {
    credentials: [
      {
        id: 'legal_person',
        format: 'jwt_vc_json',
        meta: { type_values: [['gx:LegalPerson']] },
        claims: [{ path: ['credentialSubject', 'gx:legalName'] }]
      }
    ],
    credential_sets: [{ options: [['legal_person']], required: true }]
  },
  vcPolicies: ['signature', 'expiration', 'not_before', 'revocation'],
  specificVcPolicies: {
    legal_person: [
      { policy: 'allowed_issuer', allowed_issuer: ['did:web:issuer.test'] }
    ]
  }
}

const CAPABILITIES: SsiCapabilities = {
  enabled: true,
  formats: ['jwt_vc_json', 'dc+sd-jwt', 'vc+sd-jwt'],
  vcPolicies: ['signature'],
  rego: true,
  gaiaxLevels: ['SC', 'L1'],
  legacyFormat: true,
  verifierPublicHost: VERIFIER_HOST
}

function ssiAsset(value: SsiPolicyV2Value = LEGAL_PERSON): AssetV5 {
  const asset = getAssetFixture()
  asset.credentialSubject.credentials = addSsiPolicyV2(
    asset.credentialSubject.credentials as unknown as DdoCredentials,
    value
  ) as never
  return asset
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// #region protocol helpers

describe('SSI answers', () => {
  it('reads the capability block, with gaiax levels and the verifier host', () => {
    expect(
      readSsiCapabilities({
        ssi: {
          enabled: true,
          formats: ['jwt_vc_json'],
          vcPolicies: ['signature'],
          rego: true,
          gaiax: { levels: ['SC', 'L1', 'nope'] },
          legacyFormat: true,
          verifierPublicHost: 'Verifier.Example.COM'
        }
      })
    ).to.deep.equal({
      enabled: true,
      formats: ['jwt_vc_json'],
      vcPolicies: ['signature'],
      rego: true,
      gaiaxLevels: ['SC', 'L1'],
      legacyFormat: true,
      verifierPublicHost: 'verifier.example.com'
    })
    expect(
      readSsiCapabilities({ ssi: { enabled: true, gaiax: true } })?.gaiaxLevels
    ).to.deep.equal(['SC'])
    expect(readSsiCapabilities({ isPSConfigured: true })).to.equal(undefined)
  })

  it('reads an initiate answer and refuses one that is not a session', () => {
    expect(readSsiInitiate({ required: false })).to.deep.equal({
      required: false
    })
    expect(
      readSsiInitiate({
        required: true,
        sessionId: SESSION,
        requestUri: REQUEST_URI,
        expiresAt: '2026-11-22T10:00:00Z',
        dcql: LEGAL_PERSON.dcql
      })
    ).to.deep.include({
      required: true,
      sessionId: SESSION,
      requestUri: REQUEST_URI
    })
    expect(
      readSsiInitiate({ sessionId: 'x', requestUri: REQUEST_URI })
    ).to.equal(undefined)
    expect(
      readSsiInitiate({ sessionId: SESSION, requestUri: 'https://evil.test' })
    ).to.equal(undefined)
  })

  it('reads a status answer, anything but true counting as failed', () => {
    const read = readSsiStatus({
      status: 'failed',
      results: [
        {
          scope: 'vc',
          credentialId: 'legal_person',
          name: 'signature',
          success: true,
          error: null
        },
        { scope: 'rego', name: 'min', success: 'yes', error: 'line\u0007 two' }
      ]
    }) as SsiStatusResult
    expect(read.status).to.equal('failed')
    expect(read.results[1]).to.deep.equal({
      scope: 'rego',
      name: 'min',
      success: false,
      error: 'line  two'
    })
    expect(readSsiStatus({ status: 'done' })).to.equal(undefined)
  })
})

describe('SSIpolicyV2 validation', () => {
  const bad = (value: unknown, pattern: RegExp) =>
    expect(() => validateSsiPolicyV2Value(value)).to.throw(
      SsiPolicyValidationError,
      pattern
    )

  it('accepts the documented value and a Gaia-X-only one', () => {
    validateSsiPolicyV2Value(LEGAL_PERSON)
    validateSsiPolicyV2Value({
      version: '2',
      dcql: { credentials: [] },
      gaiax: { requireCompliance: true, minLabelLevel: 'L1' }
    })
  })

  it('refuses what the node refuses', () => {
    bad({ ...LEGAL_PERSON, version: 2 }, /version "2"/)
    bad(
      { ...LEGAL_PERSON, vcPolicies: ['regex'] },
      /does not allow the policy "regex"/
    )
    bad({ ...LEGAL_PERSON, vcPolicies: [{ policy: 'webhook' }] }, /webhook/)
    bad(
      {
        ...LEGAL_PERSON,
        vcPolicies: [{ policy: 'json_schema', schemaUrl: 'https://x' }]
      },
      /inline "schema"/
    )
    bad(
      { ...LEGAL_PERSON, gaiax: { requireCompliance: true } },
      /cannot be combined with the jwt_vc_json query/
    )
    bad(
      {
        ...LEGAL_PERSON,
        gaiax: { requireCompliance: false, minLabelLevel: 'L1' }
      },
      /requireCompliance is false/
    )
    bad(
      {
        version: '2',
        dcql: { credentials: [{ id: 'gx_compliance', format: 'dc+sd-jwt' }] }
      },
      /reserved/
    )
    bad(
      { version: '2', dcql: { credentials: [{ id: 'a', format: 'ldp_vc' }] } },
      /format/
    )
    bad(
      {
        version: '2',
        dcql: {
          credentials: [
            {
              id: 'a',
              format: 'dc+sd-jwt',
              require_cryptographic_holder_binding: false
            }
          ]
        }
      },
      /cannot be disabled/
    )
    bad(
      { ...LEGAL_PERSON, specificVcPolicies: { other: ['signature'] } },
      /not a dcql credential id/
    )
    bad({ version: '2', dcql: { credentials: [] } }, /dcql.credentials needs 1/)
    bad(
      JSON.parse(
        '{"version":"2","dcql":{"credentials":[{"id":"a","format":"dc+sd-jwt","__proto__":{}}]}}'
      ),
      /forbidden key/
    )
    bad(
      {
        ...LEGAL_PERSON,
        rego: [{ name: 'r', code: 'package x\nallow if data.x' }]
      },
      /must not reference data/
    )
    bad(
      {
        ...LEGAL_PERSON,
        rego: [{ name: 'r', code: 'package x', credentialId: 'nope' }]
      },
      /credentialId "nope"/
    )
    bad(
      {
        version: '2',
        dcql: { credentials: [] },
        gaiax: { minLabelLevel: 'SC' },
        rego: [{ name: 'r', code: 'package x' }]
      },
      /never runs on the Gaia-X/
    )
  })

  it('applies the node rego static rules', () => {
    expect(
      regoProblem('package x\nimport rego.v1\nallow if input.parameter.min > 1')
    ).to.equal(undefined)
    expect(regoProblem('# c\npackage x\nallow := true')).to.equal(undefined)
    expect(regoProblem('package x\nallow := http.send({})')).to.match(
      /http.send/
    )
    expect(regoProblem('package x\nallow := http["send"]({})')).to.match(
      /http.send/
    )
    expect(regoProblem('package x\nallow if { print(input) }')).to.match(
      /print/
    )
    expect(regoProblem('package x\npackage y')).to.match(/exactly one package/)
    expect(regoProblem('allow := true\npackage x')).to.match(/first statement/)
    expect(regoProblem('package x\r\nallow := true')).to.match(
      /forbidden characters/
    )
    expect(regoProblem('package x\nimport data.y')).to.match(/data/)
    expect(
      regoProblem('package x\n# data in a comment\nallow := "data"')
    ).to.equal(undefined)
  })

  it('adds a value to allow only, once, and finds the highest Gaia-X level', () => {
    const once = addSsiPolicyV2({}, LEGAL_PERSON)
    const twice = addSsiPolicyV2(once, structuredClone(LEGAL_PERSON))
    expect(twice.allow).to.have.length(1)
    expect(
      ((twice.allow ?? [])[0] as { values: unknown[] }).values
    ).to.have.length(1)

    expect(() =>
      addSsiPolicyV2({}, LEGAL_PERSON, CredentialListTypes.DENY)
    ).to.throw(/only allowed in credentials.allow/)
    expect(() =>
      addSsiPolicyV2({}, { ...LEGAL_PERSON, vcPolicies: ['regex' as never] })
    ).to.throw(SsiPolicyValidationError)

    const gaiax = addSsiPolicyV2(once, {
      version: '2',
      dcql: { credentials: [] },
      gaiax: { minLabelLevel: 'L2' }
    })
    expect(requiredGaiaXLevel(gaiax, { allow: [] })).to.equal('L2')
    expect(requiredGaiaXLevel(once)).to.equal(undefined)
  })
})

describe('SSIpolicyV2 on the builders', () => {
  it('writes the value on the asset and the service, and an edit keeps it as stored', () => {
    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      serviceType: ServiceTypes.ACCESS
    })
      .setServiceEndpoint(NODE)
      .setPricing({ type: 'free' })
      .addSsiPolicyV2(LEGAL_PERSON)
      .build()
    const asset = new AssetBuilder()
      .setType('dataset')
      .setName('n')
      .setProvidedBy('deltaDAO AG')
      .setDescription('d')
      .addCredentialAddresses(CredentialListTypes.ALLOW, [CONSUMER])
      .addSsiPolicyV2({
        version: '2',
        dcql: { credentials: [] },
        gaiax: { minLabelLevel: 'SC' }
      })
      .addService(service)
      .build()

    expect(
      asset.ddo.credentials.allow?.map((entry) => entry.type)
    ).to.deep.equal(['address', 'SSIpolicyV2'])
    expect(service.credentials.allow).to.deep.equal([
      { type: 'SSIpolicyV2', values: [LEGAL_PERSON] }
    ])
    expect(normalizeStoredCredentials(service.credentials)).to.deep.equal(
      service.credentials
    )

    expect(() =>
      new AssetBuilder().addSsiPolicyV2({
        ...LEGAL_PERSON,
        version: '1' as never
      })
    ).to.throw(SsiPolicyValidationError)
    expect(
      new AssetBuilder().addSsiPolicyV2(LEGAL_PERSON).removeSsiPolicyV2().build
    ).to.be.a('function')
  })
})

// #endregion

// #region OceanNodeClient

describe('OceanNodeClient SSI commands', () => {
  const initiateRequest: SsiInitiateRequest = {
    documentId: ASSET_DID,
    serviceId: SERVICE_ID
  }

  function answer(
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
  ) {
    const fetch = vi.fn(
      async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json', ...headers }
        })
    )
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  function client(
    auth: ConstructorParameters<typeof OceanNodeClient>[0]['auth'],
    nodeUri = NODE
  ) {
    return new OceanNodeClient({ nodeUri, chainId: CHAIN_ID, auth })
  }

  it('signs consumerAddress + (stored nonce + 1) + ssiInitiate and posts to /api/services/ssi/initiate', async () => {
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(6)
    for (const seed of ['signer 0', 'signer 278']) {
      const wallet = new Wallet(id(seed))
      const fetch = answer(200, {
        sessionId: SESSION,
        requestUri: REQUEST_URI,
        expiresAt: '2026-11-22T10:00:00Z',
        dcql: LEGAL_PERSON.dcql,
        required: true
      })

      const opened = await client(wallet).ssiInitiate(initiateRequest)

      const [url, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit
      ]
      const body = JSON.parse(String(init.body))
      const digest = solidityPackedKeccak256(
        ['bytes'],
        [hexlify(toUtf8Bytes(`${wallet.address}7ssiInitiate`))]
      )
      expect(url).to.equal(`${NODE}/api/services/ssi/initiate`)
      expect(init.redirect ?? 'manual').not.to.equal('follow')
      expect(body).to.include({
        documentId: ASSET_DID,
        serviceId: SERVICE_ID,
        consumerAddress: wallet.address,
        nonce: '7'
      })
      expect(verifyMessage(toBeArray(digest), body.signature), seed).to.equal(
        wallet.address
      )
      expect(opened).to.include({
        required: true,
        sessionId: SESSION,
        consumerAddress: wallet.address
      })
      expect(opened.required && opened.deprecated).to.equal(undefined)
    }
  })

  it('sends a JWT as Authorization with the token address, and reads Deprecation', async () => {
    const payload = Buffer.from(JSON.stringify({ address: CONSUMER })).toString(
      'base64url'
    )
    const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`
    const fetch = answer(
      200,
      { sessionId: SESSION, requestUri: REQUEST_URI, required: true },
      { Deprecation: 'true' }
    )

    const opened = (await client(token).ssiInitiate(
      initiateRequest
    )) as SsiInitiateResult & { deprecated?: boolean }

    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    const body = JSON.parse(String(init.body))
    expect((init.headers as Record<string, string>).Authorization).to.equal(
      token
    )
    expect(body.consumerAddress).to.equal(CONSUMER)
    expect(body.nonce).to.equal(undefined)
    expect(opened.deprecated).to.equal(true)
  })

  it('answers { required: false } for an asset without SSI requirement', async () => {
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(1)
    answer(200, { required: false })
    expect(
      await client(new Wallet(id('x'))).ssiInitiate(initiateRequest)
    ).to.deep.include({ required: false })
  })

  it('turns 403 and 422 into a PolicyDeniedError from the SSI module, and others into an OceanNodeError', async () => {
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(1)
    const wallet = new Wallet(id('x'))

    for (const status of [403, 422]) {
      answer(status, {
        error:
          status === 403
            ? 'Access denied'
            : 'invalid SSI policy: policy "regex" is not allowed'
      })
      const thrown = await client(wallet)
        .ssiInitiate(initiateRequest)
        .catch((e) => e)
      expect(thrown).to.be.instanceOf(PolicyDeniedError)
      expect(thrown.source).to.equal('ssi')
      expect(thrown.code).to.equal(status)
      expect(thrown.message).to.match(/^The SSI module of/)
    }

    for (const status of [404, 429, 503]) {
      answer(status, { error: 'SSI verifier is not configured' })
      const thrown = await client(wallet)
        .ssiInitiate(initiateRequest)
        .catch((e) => e)
      expect(thrown).to.be.instanceOf(OceanNodeError)
      expect(thrown.status).to.equal(status)
    }
  })

  it('retries once after a rejected nonce', async () => {
    const getNonce = vi
      .spyOn(ProviderInstance, 'getNonce')
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'nonce: 2 is not a valid nonce' }),
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ required: false }), { status: 200 })
      )
    vi.stubGlobal('fetch', fetch)

    await client(new Wallet(id('x'))).ssiInitiate(initiateRequest)

    expect(getNonce).toHaveBeenCalledTimes(2)
    expect(
      JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body))
        .nonce
    ).to.equal('3')
  })

  it('refuses P2P and a pre-computed signature before sending anything', async () => {
    const fetch = answer(200, { required: false })
    let thrown = await client(new Wallet(id('x')), '16Uiu2HAmPeer')
      .ssiInitiate(initiateRequest)
      .catch((e) => e)
    expect(thrown.message).to.match(/HTTP only/)
    thrown = await client({
      consumerAddress: CONSUMER,
      nonce: '1',
      signature: '0x00'
    })
      .ssiInitiate(initiateRequest)
      .catch((e) => e)
    expect(thrown.message).to.match(/pre-computed signature/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads ssiStatus, and a 404 as a failed binding', async () => {
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(1)
    const statusRequest: SsiStatusRequest = {
      ...initiateRequest,
      sessionId: SESSION,
      consumerAddress: CONSUMER
    }
    const fetch = answer(200, {
      status: 'verified',
      results: [{ scope: 'vc', name: 'signature', success: true }]
    })
    const wallet = new Wallet(id('x'))

    expect((await client(wallet).ssiStatus(statusRequest)).status).to.equal(
      'verified'
    )
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).to.equal(`${NODE}/api/services/ssi/status`)
    expect(JSON.parse(String(init.body))).to.include({
      sessionId: SESSION,
      documentId: ASSET_DID
    })

    answer(404, { error: 'Session not found' })
    const failed = await client(wallet).ssiStatus(statusRequest)
    expect(failed.status).to.equal('failed')
    expect(failed.results[0]).to.include({ scope: 'binding', success: false })
  })

  it('validateRego signs as publisherAddress and reads the answer', async () => {
    vi.spyOn(ProviderInstance, 'getNonce').mockResolvedValue(4)
    const wallet = new Wallet(id('publisher'))
    const fetch = answer(200, { valid: false, errors: ['rego_parse_error'] })

    const result = await client(wallet).validateRego('package x', LEGAL_PERSON)

    const body = JSON.parse(
      String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    )
    expect(body).to.include({
      code: 'package x',
      publisherAddress: wallet.address,
      nonce: '5'
    })
    expect(body.consumerAddress).to.equal(undefined)
    expect(body.policy).to.deep.equal(LEGAL_PERSON)
    expect(result).to.deep.equal({ valid: false, errors: ['rego_parse_error'] })
  })

  it('sends the session to initialize as the policyServer query parameter', async () => {
    const fetch = answer(200, { datatoken: '0x00', providerFee: {} })
    await client(new Wallet(id('x'))).initialize(ASSET_DID, SERVICE_ID, {
      consumerAddress: CONSUMER,
      policyServer: { sessionId: SESSION }
    })
    const url = new URL((fetch.mock.calls[0] as unknown as [string])[0])
    expect(url.pathname).to.equal('/api/services/initialize')
    expect(
      JSON.parse(url.searchParams.get('policyServer') as string)
    ).to.deep.equal({ sessionId: SESSION })
  })

  it('reads and keeps the capabilities from the node status', async () => {
    const status = vi
      .spyOn(ProviderInstance, 'getNodeStatus')
      .mockResolvedValue({
        ssi: { enabled: true, verifierPublicHost: VERIFIER_HOST }
      } as never)
    const node = client(new Wallet(id('x')))

    expect((await node.getSsiCapabilities())?.verifierPublicHost).to.equal(
      VERIFIER_HOST
    )
    await node.getSsiCapabilities()
    expect(status).toHaveBeenCalledOnce()

    status.mockResolvedValue({ isPSConfigured: true } as never)
    expect(await client(new Wallet(id('y'))).getSsiCapabilities()).to.equal(
      null
    )
  })
})

// #endregion

// #region resolver, access and compute

interface SsiNodeOptions {
  capabilities?: SsiCapabilities | null | undefined
  initiate?: (request: SsiInitiateRequest) => Promise<SsiInitiateResult>
  statuses?: SsiStatusResult[]
  assets?: Record<string, AssetV5>
  asset?: AssetV5
}

function ssiNode(options: SsiNodeOptions = {}) {
  const calls: string[] = []
  const statuses = [
    ...(options.statuses ?? [{ status: 'verified', results: [] }])
  ]
  const providerFee = signedProviderFee({ providerFeeAmount: '0' })

  const client = {
    nodeUri: NODE,
    forEndpoint() {
      return client
    },
    policySessionAddress(address: string) {
      return address
    },
    async getSsiCapabilities() {
      return 'capabilities' in options ? options.capabilities : CAPABILITIES
    },
    async hasPolicyServer() {
      calls.push('hasPolicyServer')
      return undefined
    },
    async initializePolicyVerification() {
      calls.push('initializePolicyVerification')
      return null
    },
    async ssiInitiate(request: SsiInitiateRequest) {
      calls.push(`ssiInitiate:${request.documentId}`)
      const result = options.initiate
        ? await options.initiate(request)
        : ({
            required: true,
            sessionId: `${SESSION}-${request.documentId.length}`,
            requestUri: REQUEST_URI,
            dcql: LEGAL_PERSON.dcql
          } as SsiInitiateResult)
      return { ...result, consumerAddress: request.consumerAddress ?? CONSUMER }
    },
    async ssiStatus(request: SsiStatusRequest) {
      calls.push(`ssiStatus:${request.sessionId}`)
      return statuses.length > 1 ? statuses.shift() : statuses[0]
    },
    async resolve(did: string) {
      return options.assets?.[did] ?? options.asset ?? ssiAsset()
    },
    async initialize(
      _did: string,
      _serviceId: string,
      params: { policyServer?: unknown }
    ) {
      calls.push(`initialize:${JSON.stringify(params.policyServer ?? null)}`)
      return {
        datatoken: '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8',
        providerFee
      } as unknown as ProviderInitialize
    },
    getDownloadUrl: vi.fn(async () => {
      calls.push('getDownloadUrl')
      return `${NODE}/download`
    }),
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
    initializeCompute: vi.fn(async () => {
      calls.push('initializeCompute')
      return {
        datasets: [
          {
            datatoken: '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8',
            providerFee
          }
        ],
        algorithm: {
          datatoken: '0x1111111111111111111111111111111111111111',
          providerFee
        }
      }
    }),
    computeStart: vi.fn(async () => {
      calls.push('computeStart')
      return [{ jobId: 'job-1' }]
    }),
    freeComputeStart: vi.fn(async () => [{ jobId: 'job-1' }])
  } as unknown as OceanNodeClient

  return { client, calls }
}

function recordingProvider(fail?: unknown) {
  const challenges: CredentialChallenge[] = []
  return {
    challenges,
    provider: {
      async present(challenge: CredentialChallenge) {
        challenges.push(challenge)
        if (fail) throw fail
      }
    }
  }
}

function resolver(provider?: {
  present(c: CredentialChallenge): Promise<void>
}) {
  return new PolicySessionResolver({
    credentials: provider,
    ssiStatusPolling: { attempts: 3, intervalMs: 0 }
  })
}

const request = (node: OceanNodeClient, asset: AssetV5 = ssiAsset()) => ({
  node,
  asset,
  serviceId: SERVICE_ID,
  consumerAddress: CONSUMER
})

describe('PolicySessionResolver on a node with the native SSI module', () => {
  it('opens no session for an asset without SSI entries: the node checks addresses itself', async () => {
    const { client, calls } = ssiNode()
    expect(
      await resolver().resolveSession(request(client, getAssetFixture()))
    ).to.equal(null)
    expect(calls).to.deep.equal([])
  })

  it('refuses an SSI asset without a provider before ssiInitiate', async () => {
    const { client, calls } = ssiNode()
    const thrown = await resolver()
      .resolve(request(client))
      .catch((e) => e)
    expect(thrown.message).to.match(/WalletApi2CredentialProvider/)
    expect(calls).to.deep.equal([])
  })

  it('refuses on a node whose SSI module has no verifier, before ssiInitiate', async () => {
    const { client, calls } = ssiNode({
      capabilities: { ...CAPABILITIES, enabled: false }
    })
    const thrown = await resolver(recordingProvider().provider)
      .resolve(request(client))
      .catch((e) => e)
    expect(thrown).to.be.instanceOf(OceanNodeError)
    expect(thrown.message).to.match(/no SSI verifier/)
    expect(calls).to.deep.equal([])
  })

  it('presents the OpenID4VP request, polls ssiStatus past pending, and hands back { sessionId }', async () => {
    const { client, calls } = ssiNode({
      statuses: [
        { status: 'pending', results: [] },
        {
          status: 'verified',
          results: [{ scope: 'vc', name: 'signature', success: true }]
        }
      ]
    })
    const { provider, challenges } = recordingProvider()

    const session = await resolver(provider).resolveSession(request(client))

    expect(session?.protocol).to.equal('ssi')
    expect(session?.payload).to.deep.equal({ sessionId: session?.sessionId })
    expect(challenges[0]).to.include({
      protocol: 'oid4vp',
      redirectUri: REQUEST_URI,
      verifierHost: VERIFIER_HOST,
      consumerAddress: CONSUMER,
      serviceId: SERVICE_ID
    })
    expect(challenges[0].dcql).to.deep.equal(LEGAL_PERSON.dcql)
    expect(calls.filter((call) => call.startsWith('ssiStatus'))).to.have.length(
      2
    )
    expect(calls).not.to.include('initializePolicyVerification')
  })

  it('opens a fresh session every time: the node consumes them', async () => {
    const { client, calls } = ssiNode()
    const sessions = resolver(recordingProvider().provider)
    await sessions.resolve(request(client))
    await sessions.resolve(request(client))
    expect(
      calls.filter((call) => call.startsWith('ssiInitiate'))
    ).to.have.length(2)
  })

  it('asks the provider to prepare before ssiInitiate, and opens no session when it cannot', async () => {
    const { client, calls } = ssiNode()
    const failure = new CredentialPresentationError(
      'no wallet for this address',
      undefined,
      'wallet-setup'
    )
    const prepared: string[] = []
    const provider = {
      async prepare(context: { consumerAddress: string }) {
        prepared.push(context.consumerAddress)
        throw failure
      },
      async present() {}
    }
    expect(
      await resolver(provider)
        .resolve(request(client))
        .catch((e) => e)
    ).to.equal(failure)
    expect(prepared).to.deep.equal([CONSUMER])
    expect(calls).to.deep.equal([])
  })

  it('needs no presentation when the node answers required: false', async () => {
    const { client } = ssiNode({ initiate: async () => ({ required: false }) })
    const { provider, challenges } = recordingProvider()
    expect(await resolver(provider).resolve(request(client))).to.equal(null)
    expect(challenges).to.have.length(0)
  })

  it('refuses a request that does not point at the announced verifier, before presenting', async () => {
    const { client } = ssiNode({
      initiate: async () => ({
        required: true,
        sessionId: SESSION,
        requestUri: `openid4vp://authorize?request_uri=${encodeURIComponent('https://evil.test/r')}`
      })
    })
    const { provider, challenges } = recordingProvider()
    const thrown = await resolver(provider)
      .resolve(request(client))
      .catch((e) => e)
    expect(thrown).to.be.instanceOf(CredentialPresentationError)
    expect(thrown.reason).to.equal('request-invalid')
    expect(challenges).to.have.length(0)
  })

  it('warns once when the node does not announce its verifier', async () => {
    const { client } = ssiNode({
      capabilities: { ...CAPABILITIES, verifierPublicHost: undefined }
    })
    const log = captureLog()
    await resolver(recordingProvider().provider).resolve(request(client))
    expect(log.events.map((event) => event.event)).to.include(
      'identity.ssi.verifier_unannounced'
    )
  })

  it('throws a PolicyDeniedError naming the failed results when the session fails', async () => {
    const { client } = ssiNode({
      initiate: async () => ({
        required: true,
        sessionId: SESSION,
        requestUri: REQUEST_URI
      }),
      statuses: [
        {
          status: 'failed',
          results: [
            {
              scope: 'vc',
              credentialId: 'legal_person',
              name: 'allowed-issuer',
              success: false,
              error: `issuer not allowed for ${SESSION}`
            },
            {
              scope: 'vc',
              credentialId: 'legal_person',
              name: 'signature',
              success: true
            }
          ]
        }
      ]
    })

    const thrown = await resolver(recordingProvider().provider)
      .resolve(request(client))
      .catch((e) => e)

    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.source).to.equal('ssi')
    expect(thrown.policyResults[0]).to.include({
      scope: 'vc',
      credential: 'legal_person',
      policy: 'allowed-issuer',
      success: false
    })
    expect(thrown.policyResults[0].error).not.to.include(SESSION)
    expect(thrown.reason).to.match(/vc\/allowed-issuer \(legal_person\)/)
  })

  it('throws when the session is still pending after the last attempt, or expired', async () => {
    for (const status of ['pending', 'expired'] as const) {
      const { client } = ssiNode({ statuses: [{ status, results: [] }] })
      const thrown = await resolver(recordingProvider().provider)
        .resolve(request(client))
        .catch((e) => e)
      expect(thrown).to.be.instanceOf(PolicyDeniedError)
      expect(thrown.reason).to.match(
        status === 'pending'
          ? /still reports the SSI session pending/
          : /expired/
      )
    }
  })

  it('reads the status after a verifier rejection, and throws the results with the wallet error as cause', async () => {
    const rejection = new CredentialPresentationError(
      'The verifier rejected the presentation.',
      undefined,
      'verifier-rejected'
    )
    const { client } = ssiNode({
      statuses: [
        {
          status: 'failed',
          results: [{ scope: 'binding', name: 'consumer', success: false }]
        }
      ]
    })
    const thrown = await resolver(recordingProvider(rejection).provider)
      .resolve(request(client))
      .catch((e) => e)
    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(thrown.cause).to.equal(rejection)
  })

  it('throws a wallet-side failure as it is, without reading the status', async () => {
    const failure = new CredentialPresentationError(
      'no wallet',
      undefined,
      'wallet-setup'
    )
    const { client, calls } = ssiNode()
    const thrown = await resolver(recordingProvider(failure).provider)
      .resolve(request(client))
      .catch((e) => e)
    expect(thrown).to.equal(failure)
    expect(calls.some((call) => call.startsWith('ssiStatus'))).to.equal(false)
  })

  it('takes the SSI path for an SSIpolicyV2 asset when the status is unreadable, the policy-server path otherwise', async () => {
    const unreadable = ssiNode({ capabilities: undefined })
    expect(
      (
        await resolver(recordingProvider().provider).resolveSession(
          request(unreadable.client)
        )
      )?.protocol
    ).to.equal('ssi')

    const legacy = getAssetFixture()
    legacy.credentialSubject.credentials = addRequestCredentials(
      legacy.credentialSubject.credentials as never,
      CredentialListTypes.ALLOW,
      [{ type: 'VerifiableId' }]
    ) as never
    const old = ssiNode({ capabilities: undefined })
    await resolver(recordingProvider().provider).resolveSession(
      request(old.client, legacy)
    )
    expect(old.calls).to.include('initializePolicyVerification')
    expect(old.calls.some((call) => call.startsWith('ssiInitiate'))).to.equal(
      false
    )
  })

  it('warns about a legacy SSIpolicy asset the node translated', async () => {
    const { client } = ssiNode({
      initiate: async () => ({
        required: true,
        sessionId: SESSION,
        requestUri: REQUEST_URI,
        deprecated: true
      })
    })
    const log = captureLog()
    await resolver(recordingProvider().provider).resolve(request(client))
    expect(log.events.map((event) => event.event)).to.include(
      'identity.ssi.legacy_policy'
    )
  })

  it('validates its polling options', () => {
    expect(
      () => new PolicySessionResolver({ ssiStatusPolling: { attempts: 0 } })
    ).to.throw(/attempts/)
    expect(
      () => new PolicySessionResolver({ ssiStatusPolling: { intervalMs: -1 } })
    ).to.throw(/intervalMs/)
  })
})

describe('access() on a node with the native SSI module', () => {
  it('verifies before the fee request and the order, and downloads with { sessionId }', async () => {
    const { client, calls } = ssiNode()

    await access(
      { assetDid: ASSET_DID },
      {
        node: client,
        signer,
        chainConfig,
        policySessions: resolver(recordingProvider().provider)
      }
    )

    const verified = calls.findIndex((call) => call.startsWith('ssiStatus'))
    expect(verified).to.be.greaterThan(-1)
    const quoted = calls.findIndex((call) => call.startsWith('initialize'))
    expect(verified).to.be.lessThan(quoted)
    // The node's initialize checks the session too, so it gets it.
    expect(calls[quoted]).to.equal(
      `initialize:${JSON.stringify({ sessionId: `${SESSION}-${ASSET_DID.length}` })}`
    )
    const downloadOptions = vi.mocked(client.getDownloadUrl).mock
      .calls[0] as unknown as [
      string,
      string,
      string,
      { policyServer?: unknown }
    ]
    expect(downloadOptions[3].policyServer).to.deep.equal({
      sessionId: `${SESSION}-${ASSET_DID.length}`
    })
  })

  it('orders nothing when the session fails', async () => {
    const { client, calls } = ssiNode({
      statuses: [{ status: 'failed', results: [] }]
    })
    const thrown = await access(
      { assetDid: ASSET_DID },
      {
        node: client,
        signer,
        chainConfig,
        policySessions: resolver(recordingProvider().provider)
      }
    ).catch((e) => e)
    expect(thrown).to.be.instanceOf(PolicyDeniedError)
    expect(calls.some((call) => call.startsWith('initialize'))).to.equal(false)
    expect(vi.mocked(settleOrder)).not.toHaveBeenCalled()
  })
})

describe('compute() on a node with the native SSI module', () => {
  const ALGO_DID = 'did:ope:algorithm-ssi'

  function assets(): Record<string, AssetV5> {
    const dataset = getComputeAssetFixture()
    dataset.credentialSubject.credentials = addSsiPolicyV2(
      dataset.credentialSubject.credentials as unknown as DdoCredentials,
      LEGAL_PERSON
    ) as never
    const algorithm = getAlgorithmAssetFixture()
    algorithm.id = ALGO_DID
    algorithm.credentialSubject.id = ALGO_DID
    algorithm.credentialSubject.services[0].datatokenAddress =
      '0x1111111111111111111111111111111111111111'
    algorithm.credentialSubject.credentials = addSsiPolicyV2(
      algorithm.credentialSubject.credentials as unknown as DdoCredentials,
      LEGAL_PERSON
    ) as never
    return { [ASSET_DID]: dataset, [ALGO_DID]: algorithm }
  }

  const job = { dataset: { did: ASSET_DID }, algorithm: { did: ALGO_DID } }
  const context = (node: OceanNodeClient) => ({
    node,
    signer,
    chainConfig,
    escrow: '0x00000000000000000000000000000000000e5c40',
    policySessions: resolver(recordingProvider().provider)
  })

  it('sends { sessionId, sessionIds } keyed by DID to initializeCompute and computeStart', async () => {
    const { client } = ssiNode({ assets: assets() })

    await compute(job, context(client))

    const sent = (
      vi.mocked(client.initializeCompute).mock.calls[0] as unknown as [
        { policyServer: unknown }
      ]
    )[0].policyServer
    expect(sent).to.deep.equal({
      sessionId: `${SESSION}-${ASSET_DID.length}`,
      sessionIds: {
        [ASSET_DID]: `${SESSION}-${ASSET_DID.length}`,
        [ALGO_DID]: `${SESSION}-${ALGO_DID.length}`
      }
    })
    expect(
      (
        vi.mocked(client.computeStart).mock.calls[0] as unknown as [
          { policyServer: unknown }
        ]
      )[0].policyServer
    ).to.equal(sent)
  })

  it('sends them to freeComputeStart too', async () => {
    const { client } = ssiNode({ assets: assets() })
    await freeCompute(job, context(client))
    const sent = (
      vi.mocked(client.freeComputeStart).mock.calls[0] as unknown as [
        { policyServer: { sessionIds: object } }
      ]
    )[0].policyServer
    expect(Object.keys(sent.sessionIds)).to.have.members([ASSET_DID, ALGO_DID])
  })
})

// #endregion

// #region wallet-api2

const PREVIEW: WalletApi2Preview = {
  valid: true,
  keyId: 'key-1',
  clientId: `x509_san_dns:${VERIFIER_HOST}`,
  responseUri: `https://${VERIFIER_HOST}/verification-session/${SESSION}/response`,
  transactionData: [],
  credentialOptions: [
    {
      queryId: 'legal_person',
      credentialId: 'cred-1',
      format: 'jwt_vc_json',
      credentialData: { secret: 'claims' }
    },
    { queryId: 'legal_person', credentialId: 'cred-2', format: 'jwt_vc_json' }
  ],
  credentialRequirements: [{ options: [['legal_person']] }],
  holder: { did: 'did:web:org.test', keyId: 'org-key' }
}

function fakeWallet(
  preview: Partial<WalletApi2Preview> = {},
  submit: { transmissionSuccess?: boolean } = { transmissionSuccess: true }
) {
  const calls: { name: string; args: unknown[] }[] = []
  const wallet: WalletApi2 = {
    async listWallets() {
      calls.push({ name: 'listWallets', args: [] })
      return [
        {
          walletId: 'w-other',
          address: '0x1111111111111111111111111111111111111111'
        },
        { walletId: 'w-own', address: CONSUMER.toLowerCase() }
      ]
    },
    async previewPresentation(...args) {
      calls.push({ name: 'preview', args })
      return {
        handle: 'handle-0123456789abcdef',
        preview: { ...PREVIEW, ...preview }
      }
    },
    async submitPresentation(...args) {
      calls.push({ name: 'submit', args })
      return submit
    },
    async rejectPresentation(...args) {
      calls.push({ name: 'reject', args })
    }
  }
  return { wallet, calls }
}

function challenge(
  overrides: Partial<CredentialChallenge> = {}
): CredentialChallenge {
  return {
    protocol: 'oid4vp',
    asset: ssiAsset(),
    serviceId: SERVICE_ID,
    consumerAddress: CONSUMER,
    node: { nodeUri: NODE } as OceanNodeClient,
    sessionId: SESSION,
    redirectUri: REQUEST_URI,
    dcql: LEGAL_PERSON.dcql,
    verifierHost: VERIFIER_HOST,
    ...overrides
  }
}

describe('WalletApi2CredentialProvider', () => {
  it("previews from the consumer's wallet and submits the first match of every required query", async () => {
    const { wallet, calls } = fakeWallet()

    await new WalletApi2CredentialProvider({ wallet }).present(challenge())

    expect(calls.map((call) => call.name)).to.deep.equal([
      'listWallets',
      'preview',
      'submit'
    ])
    expect(calls[1].args.slice(0, 2)).to.deep.equal([
      'w-own',
      { requestUrl: REQUEST_URI }
    ])
    expect(calls[2].args.slice(0, 2)).to.deep.equal([
      'w-own',
      {
        handle: 'handle-0123456789abcdef',
        selectedCredentialOptions: [
          { queryId: 'legal_person', credentialId: 'cred-1' }
        ],
        keyId: 'org-key',
        did: 'did:web:org.test'
      }
    ])
  })

  it('prepare() resolves the wallet once, before any session', async () => {
    const { wallet, calls } = fakeWallet()
    const provider = new WalletApi2CredentialProvider({ wallet })
    await provider.prepare({ ...challenge() })
    await provider.present(challenge())
    expect(calls.map((call) => call.name)).to.deep.equal([
      'listWallets',
      'preview',
      'submit'
    ])
    const thrown = await provider
      .prepare({
        ...challenge(),
        consumerAddress: '0x2222222222222222222222222222222222222222'
      })
      .catch((e) => e)
    expect(thrown.reason).to.equal('wallet-setup')
  })

  it('refuses a wallet account without a wallet for the consumer', async () => {
    const { wallet } = fakeWallet()
    const thrown = await new WalletApi2CredentialProvider({ wallet })
      .present(
        challenge({
          consumerAddress: '0x2222222222222222222222222222222222222222'
        })
      )
      .catch((e) => e)
    expect(thrown.reason).to.equal('wallet-setup')
  })

  it('declines (reject-handle) what it must not answer, and presents nothing', async () => {
    const cases: [Partial<WalletApi2Preview>, RegExp][] = [
      [
        { valid: false, error: { code: 'invalid_request', message: 'bad' } },
        /refused the presentation request/
      ],
      [
        { responseUri: `http://${VERIFIER_HOST}/response` },
        /response_uri must be https/
      ],
      [{ responseUri: 'https://evil.test/response' }, /posted to evil.test/],
      [
        { credentialOptions: [{ queryId: 'other', credentialId: 'c' }] },
        /"other"/
      ],
      [{ transactionData: [{ type: 'something.else' }] }, /unknown type/],
      [
        {
          transactionData: [
            {
              type: 'org.oceanenterprise.transaction-data.asset-access',
              details: {
                consumer_address: '0x2222222222222222222222222222222222222222',
                document_id: ASSET_DID,
                service_id: SERVICE_ID
              }
            }
          ]
        },
        /another account/
      ],
      [
        {
          transactionData: [
            {
              type: 'org.oceanenterprise.transaction-data.asset-access',
              details: {
                consumer_address: CONSUMER,
                document_id: 'did:op:other',
                service_id: SERVICE_ID
              }
            }
          ]
        },
        /another asset/
      ]
    ]

    for (const [preview, pattern] of cases) {
      const { wallet, calls } = fakeWallet(preview)
      const thrown = await new WalletApi2CredentialProvider({
        wallet,
        walletId: 'w-own'
      })
        .present(challenge())
        .catch((e) => e)
      expect(thrown, String(pattern)).to.be.instanceOf(
        CredentialPresentationError
      )
      expect(thrown.reason).to.equal('request-invalid')
      expect(thrown.message).to.match(pattern)
      expect(calls.map((call) => call.name)).to.deep.equal([
        'preview',
        'reject'
      ])
    }
  })

  it('accepts the transaction data the node attached for this consumer, asset and service', async () => {
    const { wallet, calls } = fakeWallet({
      transactionData: [
        {
          type: 'org.oceanenterprise.transaction-data.asset-access',
          rawJson: {
            consumer_address: CONSUMER.toLowerCase(),
            document_id: ASSET_DID,
            service_id: SERVICE_ID
          }
        }
      ]
    })
    await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w-own'
    }).present(challenge())
    expect(calls.map((call) => call.name)).to.deep.equal(['preview', 'submit'])
  })

  it('requires asset-access data covering every selected dc+sd-jwt query', async () => {
    const ids = ['pid', 'company']
    const request = challenge({
      dcql: { credentials: ids.map((id) => ({ id, format: 'dc+sd-jwt' })) }
    })
    for (const covered of [[], ['pid'], ids]) {
      const { wallet, calls } = fakeWallet({
        credentialOptions: ids.map((queryId) => ({
          queryId,
          credentialId: 'cred'
        })),
        credentialRequirements: [{ options: [ids] }],
        transactionData: covered.length
          ? [
              {
                type: 'org.oceanenterprise.transaction-data.asset-access',
                credentialQueryIds: covered,
                details: {
                  consumer_address: CONSUMER,
                  document_id: ASSET_DID,
                  service_id: SERVICE_ID
                }
              }
            ]
          : []
      })
      const result = await new WalletApi2CredentialProvider({
        wallet,
        walletId: 'w'
      })
        .present(request)
        .catch((e) => e)
      if (covered.length === ids.length) {
        expect(result).to.equal(undefined)
        expect(calls.map((call) => call.name)).to.deep.equal([
          'preview',
          'submit'
        ])
      } else {
        expect(result.reason).to.equal('request-invalid')
        expect(calls.map((call) => call.name)).to.deep.equal([
          'preview',
          'reject'
        ])
      }
    }
  })

  it('declines with no-matching-credential when a requirement cannot be met', async () => {
    const { wallet, calls } = fakeWallet({ credentialOptions: [] })
    const thrown = await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w-own'
    })
      .present(challenge())
      .catch((e) => e)
    expect(thrown.reason).to.equal('no-matching-credential')
    expect(thrown.details).to.deep.equal({ missing: [['legal_person']] })
    expect(calls.map((call) => call.name)).to.include('reject')
  })

  it('selects credentials for query IDs that name Object properties', async () => {
    const ids = ['toString', '__proto__']
    const { wallet, calls } = fakeWallet({
      credentialOptions: ids.map((queryId) => ({ queryId, credentialId: 'c' })),
      credentialRequirements: [{ options: [ids] }]
    })
    await new WalletApi2CredentialProvider({ wallet, walletId: 'w' }).present(
      challenge({
        dcql: { credentials: ids.map((id) => ({ id, format: 'jwt_vc_json' })) }
      })
    )
    expect(
      (calls[1].args[1] as { selectedCredentialOptions: unknown[] })
        .selectedCredentialOptions
    ).to.deep.equal(ids.map((queryId) => ({ queryId, credentialId: 'c' })))
  })

  it('takes an onSelectCredentials choice, and refuses one that was not offered', async () => {
    const chosen = fakeWallet()
    await new WalletApi2CredentialProvider({
      wallet: chosen.wallet,
      walletId: 'w-own',
      onSelectCredentials: async () => ({ legal_person: ['cred-2'] })
    }).present(challenge())
    expect(
      (chosen.calls[1].args[1] as { selectedCredentialOptions: unknown[] })
        .selectedCredentialOptions
    ).to.deep.equal([{ queryId: 'legal_person', credentialId: 'cred-2' }])

    const selections: Record<string, string[]>[] = [
      { legal_person: ['cred-9'] },
      { legal_person: ['cred-1', 'cred-2'] },
      { other: ['cred-1'] }
    ]
    for (const selection of selections) {
      const { wallet, calls } = fakeWallet()
      const thrown = await new WalletApi2CredentialProvider({
        wallet,
        walletId: 'w-own',
        onSelectCredentials: async () => selection
      })
        .present(challenge())
        .catch((e) => e)
      expect(thrown.reason).to.equal('none-selected')
      expect(calls.map((call) => call.name)).to.deep.equal([
        'preview',
        'reject'
      ])
    }
  })

  it('rejects the handle on selection failure and preserves the original error', async () => {
    const { wallet, calls } = fakeWallet()
    const cancelled = new Error('selection cancelled')
    const reject = vi
      .spyOn(wallet, 'rejectPresentation')
      .mockRejectedValue(new Error('handle expired'))
    const error = await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w',
      onSelectCredentials: async () => {
        throw cancelled
      }
    })
      .present(challenge())
      .catch((e) => e)
    expect(error).to.equal(cancelled)
    expect(reject.mock.calls).to.deep.equal([
      ['w', { handle: 'handle-0123456789abcdef', errorCode: 'access_denied' }]
    ])
    expect(calls.map((call) => call.name)).to.deep.equal(['preview'])
  })

  it('reports a verifier refusal as verifier-rejected', async () => {
    const { wallet } = fakeWallet({}, { transmissionSuccess: false })
    const thrown = await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w-own'
    })
      .present(challenge())
      .catch((e) => e)
    expect(thrown.reason).to.equal('verifier-rejected')
  })

  it('refuses a policy-server challenge, and the v1 provider refuses an oid4vp one', async () => {
    const { wallet } = fakeWallet()
    const thrown = await new WalletApi2CredentialProvider({ wallet })
      .present(challenge({ protocol: 'policy-server' }))
      .catch((e) => e)
    expect(thrown.reason).to.equal('request-invalid')

    const v1 = new WaltIdCredentialProvider({} as OceanNodeClient, {
      walletApi: 'https://wallet.test.invalid'
    })
    const refused = await v1.present(challenge()).catch((e) => e)
    expect(refused.reason).to.equal('request-invalid')
    expect(refused.message).to.match(/WalletApi2CredentialProvider/)
  })

  it('refuses a request URI off the verifier host before calling the wallet', async () => {
    const { wallet, calls } = fakeWallet()
    const thrown = await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w-own'
    })
      .present(
        challenge({
          redirectUri: `openid4vp://authorize?request_uri=${encodeURIComponent('https://evil.test/r')}`
        })
      )
      .catch((e) => e)
    expect(thrown.reason).to.equal('request-invalid')
    expect(calls).to.have.length(0)
  })
})

describe('WalletApi2HttpClient', () => {
  function stub(status: number, body: unknown) {
    return vi.fn(
      async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status
        })
    )
  }

  it('sends the bearer token, previews and reads the answer', async () => {
    const fetchImpl = stub(200, {
      handle: 'handle-0123456789abcdef',
      expiresAt: '2026-11-22T10:05:00Z',
      preview: {
        ...PREVIEW,
        credentialOptions: [
          { queryId: 'q', credentialId: 'c', multiple: 'yes' },
          { bad: true }
        ]
      }
    })
    const client = new WalletApi2HttpClient({
      apiUrl: 'https://wallet-api.test.invalid/',
      token: async () => 'hanko-jwt',
      fetchImpl
    })

    const opened = await client.previewPresentation('w 1', {
      requestUrl: REQUEST_URI
    })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit
    ]
    expect(url).to.equal(
      'https://wallet-api.test.invalid/wallet/w%201/credentials/present/preview-handle'
    )
    expect((init.headers as Record<string, string>).Authorization).to.equal(
      'Bearer hanko-jwt'
    )
    expect(JSON.parse(String(init.body))).to.deep.equal({
      requestUrl: REQUEST_URI
    })
    expect(opened.preview.credentialOptions).to.deep.equal([
      { queryId: 'q', credentialId: 'c', multiple: false }
    ])
  })

  it('rejects handles with oversized or malformed transaction data', async () => {
    const item = {
      type: 'org.oceanenterprise.transaction-data.asset-access',
      details: {
        consumer_address: CONSUMER,
        document_id: ASSET_DID,
        service_id: SERVICE_ID
      }
    }
    for (const transactionData of [Array(51).fill(item), [null], {}]) {
      const fetchImpl = stub(200, {
        handle: 'handle-0123456789abcdef',
        preview: { ...PREVIEW, transactionData }
      })
      const wallet = new WalletApi2HttpClient({
        apiUrl: 'https://wallet-api.test.invalid',
        token: 't',
        fetchImpl
      })
      const error = await new WalletApi2CredentialProvider({
        wallet,
        walletId: 'w'
      })
        .present(challenge())
        .catch((e) => e)
      expect(error.reason).to.equal('request-invalid')
      expect(
        (fetchImpl.mock.calls as unknown as [string][]).map(([url]) =>
          url.split('/').pop()
        )
      ).to.deep.equal(['preview-handle', 'reject-handle'])
    }
  })

  it('declines an unreadable response URI without an announced verifier', async () => {
    const fetchImpl = stub(200, {
      handle: 'handle-0123456789abcdef',
      preview: {
        ...PREVIEW,
        responseUri: `http://wallet.test/${'x'.repeat(2048)}`
      }
    })
    const wallet = new WalletApi2HttpClient({
      apiUrl: 'https://wallet-api.test.invalid',
      token: 't',
      fetchImpl
    })
    const error = await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w'
    })
      .present(challenge({ verifierHost: undefined }))
      .catch((e) => e)
    expect(error.reason).to.equal('request-invalid')
    expect(
      (fetchImpl.mock.calls as unknown as [string][]).map(([url]) =>
        url.split('/').pop()
      )
    ).to.deep.equal(['preview-handle', 'reject-handle'])
  })

  it('reads the snake_case submit answer and the org wallets', async () => {
    const submit = new WalletApi2HttpClient({
      apiUrl: 'https://wallet-api.test.invalid',
      token: 't',
      fetchImpl: stub(200, {
        transmission_success: false,
        redirect_to: 'https://x.test'
      })
    })
    expect(
      await submit.submitPresentation('w', {
        handle: 'h',
        selectedCredentialOptions: []
      })
    ).to.deep.equal({
      transmissionSuccess: false,
      redirectTo: 'https://x.test'
    })

    const list = new WalletApi2HttpClient({
      apiUrl: 'https://wallet-api.test.invalid',
      token: 't',
      fetchImpl: stub(200, [
        { walletId: 'w1', address: CONSUMER, walletName: 'Main' },
        { nope: 1 }
      ])
    })
    expect(await list.listWallets()).to.deep.equal([
      { walletId: 'w1', address: CONSUMER, walletName: 'Main' }
    ])
  })

  it('throws a WaltIdWalletError with the status, and refuses plain http and non-URLs', async () => {
    const client = new WalletApi2HttpClient({
      apiUrl: 'https://wallet-api.test.invalid',
      token: 't',
      fetchImpl: stub(404, { error: 'Unknown or expired presentation' })
    })
    const thrown = await client
      .rejectPresentation('w', { handle: 'h' })
      .catch((e) => e)
    expect(thrown).to.be.instanceOf(WaltIdWalletError)
    expect(thrown.status).to.equal(404)
    expect(thrown.message).to.match(/Unknown or expired presentation/)

    expect(
      () =>
        new WalletApi2HttpClient({
          apiUrl: 'http://wallet.example.com',
          token: 't'
        })
    ).to.throw(WaltIdWalletError)
    expect(
      () => new WalletApi2HttpClient({ apiUrl: '16Uiu2HAmPeer', token: 't' })
    ).to.throw(/http\(s\) URL/)
    expect(
      () =>
        new WalletApi2HttpClient({
          apiUrl: 'http://127.0.0.1:7006',
          token: 't'
        })
    ).not.to.throw()
  })

  it('maps a 401 from wallet-api2 to wallet-setup in the provider', async () => {
    const wallet = new WalletApi2HttpClient({
      apiUrl: 'https://wallet-api.test.invalid',
      token: 't',
      fetchImpl: stub(401, { error: 'Please log in.' })
    })
    const thrown = await new WalletApi2CredentialProvider({
      wallet,
      walletId: 'w'
    })
      .present(challenge())
      .catch((e) => e)
    expect(thrown.reason).to.equal('wallet-setup')
  })
})

// #endregion
