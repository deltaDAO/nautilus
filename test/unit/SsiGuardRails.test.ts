import { describe, expect, it } from 'vitest'
import type { AssetV5 } from '../../src/ddo/index.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  addRequestCredentials,
  setVpPolicies
} from '../../src/identity/policy.js'
import { SsiPolicyError } from '../../src/identity/policyLint.js'
import { CredentialRejectedLocallyError } from '../../src/identity/preflight.js'
import {
  WaltIdCredentialProvider,
  type WaltIdCredentialProviderOptions
} from '../../src/identity/WaltIdProvider.js'
import type {
  WaltIdCredential,
  WaltIdWallet
} from '../../src/identity/waltid/client.js'
import * as nautilus from '../../src/index.js'
import type { LogEvent } from '../../src/log/index.js'
import { configureLogging } from '../../src/log/logger.js'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import {
  type OceanNodeClient,
  PolicyServerAction
} from '../../src/node/OceanNodeClient.js'
import {
  getAssetFixture,
  OWNER_ADDRESS,
  SERVICE_ID
} from '../fixtures/Asset.js'

const ALLOW = CredentialListTypes.ALLOW
const HOLDER = 'did:key:z6MkholderFixture'
const SERVER_SESSION = `${'a'.repeat(64)}-${'b'.repeat(64)}`
const TRUSTED = 'did:web:issuer.test.invalid'

/** Every event built while `run` runs, printed or not. */
function events(run: () => void): LogEvent[] {
  const seen: LogEvent[] = []
  configureLogging({ level: 'trace', sink: (event) => seen.push(event) })
  run()
  return seen
}

const names = (seen: LogEvent[]) => seen.map((event) => event.event)

// #region consumer: the holder-binding preflight

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** An unsigned compact JWS: the preflight reads only the payload. */
function jwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: 'EdDSA', typ: 'vc+jwt' })}.${b64(payload)}.c2lnbmF0dXJl`
}

/** A VCDM 2.0 gx:LegalPerson as delta-dao issues it: URL subject, `sub` only if given. */
function legalPerson(sub?: string, extra: Partial<WaltIdCredential> = {}) {
  return {
    id: 'credential-1',
    document: jwt({
      iss: TRUSTED,
      ...(sub === undefined ? {} : { sub }),
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'gx:LegalPerson'],
      credentialSubject: { id: 'https://example.org/legal-person.json#cs' }
    }),
    parsedDocument: { type: ['VerifiableCredential', 'gx:LegalPerson'] },
    ...extra
  } as WaltIdCredential
}

const DEFINITION = {
  id: 'definition',
  input_descriptors: [
    {
      id: 'gx:LegalPerson',
      constraints: {
        fields: [{ path: ['$.vc.type'], filter: { pattern: 'gx:LegalPerson' } }]
      }
    }
  ]
}

function nodeStub(): OceanNodeClient {
  return {
    nodeUri: 'https://node.test.invalid',
    async policyServerPassthrough(action: { action?: string }) {
      return action.action === PolicyServerAction.GET_PD
        ? { message: DEFINITION }
        : undefined
    },
    requireSigner() {
      return { getAddress: async () => OWNER_ADDRESS }
    }
  } as unknown as OceanNodeClient
}

interface WalletCalls {
  resolved: number
  presented: number
}

function walletWith(
  credentials: WaltIdCredential[],
  calls: WalletCalls
): WaltIdWallet {
  return {
    authenticate: async () => ({ token: 'wallet-token' }),
    isSessionValid: async () => true,
    logout: async () => {},
    listWallets: async () => [{ id: 'wallet-1' }],
    listKeys: async () => [],
    listDids: async () => [{ did: HOLDER }],
    sign: async () => 'jwt',
    matchCredentials: async () => credentials,
    unmatchedCredentials: async () => [],
    async resolvePresentationRequest() {
      calls.resolved++
      return 'resolved'
    },
    async usePresentationRequest() {
      calls.presented++
      return { redirectUri: 'https://verifier.test.invalid/success' }
    }
  } as unknown as WaltIdWallet
}

/** An asset whose access service asks for a gx:LegalPerson, with `vpPolicies` where asked. */
function gatedAsset(
  vpPolicies: string[],
  level: 'asset' | 'service' = 'asset'
): AssetV5 {
  const asset = getAssetFixture()
  const credentials = setVpPolicies(
    addRequestCredentials({}, ALLOW, [
      { type: 'gx:LegalPerson', format: 'jwt_vc_json' }
    ]),
    ALLOW,
    vpPolicies.map((policy) => ({ policy }))
  )

  if (level === 'asset')
    asset.credentialSubject.credentials = credentials as never
  else
    for (const service of asset.credentialSubject.services)
      if (service.id === SERVICE_ID) service.credentials = credentials as never

  return asset
}

function openid4vpRequest(): string {
  return `openid4vp://authorize?${new URLSearchParams({
    response_type: 'vp_token',
    state: SERVER_SESSION,
    presentation_definition_uri: `https://ps.test.invalid/pd/${SERVER_SESSION}`,
    response_uri: `https://ps.test.invalid/verify/${SERVER_SESSION}`
  })}`
}

async function present(
  asset: AssetV5,
  credentials: WaltIdCredential[],
  options: Partial<WaltIdCredentialProviderOptions> = {}
): Promise<{ calls: WalletCalls; error?: unknown }> {
  const calls = { resolved: 0, presented: 0 }
  const node = nodeStub()
  const provider = new WaltIdCredentialProvider(node, {
    wallet: walletWith(credentials, calls),
    signer: { getAddress: async () => OWNER_ADDRESS } as never,
    ...options
  })

  try {
    await provider.present({
      asset,
      serviceId: SERVICE_ID,
      consumerAddress: OWNER_ADDRESS,
      node,
      sessionId: SERVER_SESSION,
      redirectUri: openid4vpRequest()
    })
    return { calls }
  } catch (error) {
    return { calls, error }
  }
}

describe('holder-binding preflight in WaltIdCredentialProvider', () => {
  it('refuses a credential without sub before anything is presented', async () => {
    const { calls, error } = await present(gatedAsset(['holder-binding']), [
      legalPerson()
    ])

    expect(error).to.be.instanceOf(CredentialRejectedLocallyError)
    const rejected = error as CredentialRejectedLocallyError
    expect(rejected.name).to.equal('CredentialRejectedLocallyError')
    expect(rejected.policy).to.equal('holder-binding')
    expect(rejected.reason).to.equal('no-sub')
    expect(rejected.credentialType).to.equal('gx:LegalPerson')
    expect(rejected.serviceId).to.equal(SERVICE_ID)
    expect(rejected.message).to.contain(
      `Service ${SERVICE_ID} of ${getAssetFixture().id} requires \`holder-binding\``
    )
    expect(rejected.message).to.contain(`must be your DID (${HOLDER})`)
    expect(rejected.message).to.contain(
      'Your `gx:LegalPerson` credential has no `sub` (its subject is a URL)'
    )
    expect(rejected.message).to.contain('Nothing was ordered or paid.')
    expect(calls).to.deep.equal({ resolved: 0, presented: 0 })
  })

  it('refuses a credential whose sub is another DID, without quoting it', async () => {
    const { calls, error } = await present(gatedAsset(['holder-binding']), [
      legalPerson('did:key:z6MkSomeoneElse')
    ])

    expect((error as CredentialRejectedLocallyError).reason).to.equal(
      'sub-mismatch'
    )
    expect((error as Error).message).not.to.contain('SomeoneElse')
    expect(calls.presented).to.equal(0)
  })

  it('refuses when any of several credentials fails, as walt.id does', async () => {
    const { calls, error } = await present(gatedAsset(['holder-binding']), [
      legalPerson(HOLDER),
      legalPerson(undefined, { id: 'credential-2' })
    ])

    expect((error as CredentialRejectedLocallyError).reason).to.equal('no-sub')
    expect(calls.presented).to.equal(0)
  })

  it('presents a credential whose sub is the holder DID, with or without a fragment', async () => {
    for (const sub of [HOLDER, `${HOLDER}#key-1`]) {
      const { calls, error } = await present(gatedAsset(['holder-binding']), [
        legalPerson(sub)
      ])

      expect(error).to.equal(undefined)
      expect(calls.presented).to.equal(1)
    }
  })

  it('reads sub from a VCDM 1.1 credential too', async () => {
    const credential = {
      id: 'credential-1',
      document: jwt({
        iss: TRUSTED,
        sub: HOLDER,
        vc: { type: ['VerifiableCredential', 'gx:LegalPerson'] }
      }),
      parsedDocument: {
        vc: { type: ['VerifiableCredential', 'gx:LegalPerson'] }
      }
    }

    const { error } = await present(gatedAsset(['holder-binding']), [
      credential
    ])
    expect(error).to.equal(undefined)
  })

  it('checks holder-binding set on the service only', async () => {
    const { error } = await present(gatedAsset(['holder-binding'], 'service'), [
      legalPerson()
    ])

    expect((error as CredentialRejectedLocallyError).reason).to.equal('no-sub')
  })

  it('does not check when the service asks for no holder-binding', async () => {
    const { calls, error } = await present(
      gatedAsset(['signature', 'minimum-credentials']),
      [legalPerson()]
    )

    expect(error).to.equal(undefined)
    expect(calls.presented).to.equal(1)
  })

  it('presents anyway with preflight: false', async () => {
    const { calls, error } = await present(
      gatedAsset(['holder-binding']),
      [legalPerson()],
      { preflight: false }
    )

    expect(error).to.equal(undefined)
    expect(calls.presented).to.equal(1)
  })

  it('never judges a credential it cannot decode, and says so at debug', async () => {
    const undecodable: WaltIdCredential[] = [
      legalPerson(undefined, {
        format: 'vc+sd-jwt',
        disclosures: 'WyJzYWx0IiwibmFtZSIsIngiXQ'
      } as never),
      { ...legalPerson(), document: { proof: {} }, format: 'ldp_vc' } as never,
      { ...legalPerson(), document: 'not-a-jwt' },
      { ...legalPerson(), document: undefined }
    ]

    for (const credential of undecodable) {
      const seen: LogEvent[] = []
      configureLogging({ level: 'debug', sink: (event) => seen.push(event) })
      const result = await present(gatedAsset(['holder-binding']), [credential])

      expect(result.error).to.equal(undefined)
      expect(result.calls.presented).to.equal(1)
      expect(names(seen)).to.include('identity.preflight.skipped')
      const skipped = seen.find(
        (event) => event.event === 'identity.preflight.skipped'
      )
      expect(JSON.stringify(skipped)).not.to.contain('eyJ')
    }
  })

  it('quotes no control characters from the asset or the wallet', async () => {
    const { error } = await present(
      gatedAsset(['holder-binding']),
      [legalPerson()],
      {
        did: `${HOLDER}\u001b[31m`
      }
    )

    expect((error as Error).message).not.to.contain('\u001b')
  })

  it('is exported from the package, with its reason type', () => {
    expect(nautilus.CredentialRejectedLocallyError).to.equal(
      CredentialRejectedLocallyError
    )
    expect(nautilus.SsiPolicyError).to.equal(SsiPolicyError)
  })
})

// #endregion

// #region publisher: the SSI policy lint

function accessService() {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setName('Access Service')
    .setPricing({ type: 'free' })
    .build()
}

function newAsset() {
  return new AssetBuilder()
    .setType('dataset')
    .setName('Gated')
    .setProvidedBy('deltaDAO AG')
    .addService(accessService())
}

/** PR 1's safe set, with per-credential issuer trust. */
function safeSet(builder = newAsset()) {
  return builder
    .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
    .addRequestCredentials(ALLOW, [
      {
        type: 'gx:LegalPerson',
        format: 'jwt_vc_json',
        policies: [{ policy: 'allowed-issuer', args: [TRUSTED] }]
      }
    ])
    .setVcPolicies(ALLOW, ['signature', 'not-before', 'revoked-status-list'])
    .setVpPolicies(ALLOW, [
      { policy: 'signature' },
      { policy: 'minimum-credentials', args: '1' }
    ])
}

describe('SSI policy lint in AssetBuilder.build()', () => {
  it('accepts the safe set without a warning', () => {
    expect(names(events(() => safeSet().build()))).to.deep.equal([])
  })

  it('warns about holder-binding, once, naming where it is', () => {
    const seen = events(() =>
      safeSet()
        .setVpPolicies(ALLOW, [
          { policy: 'signature' },
          { policy: 'holder-binding' },
          { policy: 'minimum-credentials', args: '1' }
        ])
        .build()
    )

    expect(names(seen)).to.deep.equal(['identity.policy.holder_binding'])
    expect(seen[0].level).to.equal('warn')
    expect(seen[0].fields).to.deep.equal({ where: 'asset' })
    expect(seen[0].msg).to.contain("JWT 'sub'")
  })

  it('warns about presentation-definition with jwt_vc_json, not with another format', () => {
    const withPd = (format: string) =>
      events(() =>
        newAsset()
          .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
          .addRequestCredentials(ALLOW, [
            {
              type: 'gx:LegalPerson',
              format,
              policies: [{ policy: 'allowed-issuer', args: [TRUSTED] }]
            }
          ])
          .setVpPolicies(ALLOW, [
            { policy: 'signature' },
            { policy: 'presentation-definition' }
          ])
          .build()
      )

    const seen = withPd('jwt_vc_json')
    expect(names(seen)).to.deep.equal([
      'identity.policy.presentation_definition_vc_jwt'
    ])
    expect(seen[0].fields).to.deep.equal({
      where: 'asset',
      credentialType: 'gx:LegalPerson'
    })
    expect(names(withPd('ldp_vc'))).to.deep.equal([])
  })

  it('warns about presentation-definition at asset level with a service-level jwt_vc_json request', () => {
    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      serviceType: ServiceTypes.ACCESS
    })
      .setServiceEndpoint('https://node.test.invalid')
      .setName('Gated service')
      .setPricing({ type: 'free' })
      .addRequestCredentials(ALLOW, [
        {
          type: 'gx:LegalPerson',
          format: 'jwt_vc_json',
          policies: [{ policy: 'allowed-issuer', args: [TRUSTED] }]
        }
      ])
      .build()

    const seen = events(() =>
      new AssetBuilder()
        .setType('dataset')
        .setName('Gated')
        .setProvidedBy('deltaDAO AG')
        .addService(service)
        .setVpPolicies(ALLOW, [{ policy: 'presentation-definition' }])
        .build()
    )

    expect(names(seen)).to.deep.equal([
      'identity.policy.presentation_definition_vc_jwt'
    ])
    expect(seen[0].fields?.where).to.equal('asset')
  })

  it('warns about a request credential without per-credential issuer trust', () => {
    const seen = events(() =>
      safeSet()
        .addRequestCredentials(ALLOW, [
          {
            type: 'VerifiableId',
            format: 'jwt_vc_json',
            policies: ['signature']
          }
        ])
        .build()
    )

    expect(names(seen)).to.deep.equal(['identity.policy.no_issuer_trust'])
    expect(seen[0].fields).to.deep.equal({
      where: 'asset',
      credentialType: 'VerifiableId'
    })
  })

  it('throws instead of warning with ssiPolicyLint error, and is silent with off', () => {
    const holderBinding = () =>
      safeSet().setVpPolicies(ALLOW, [{ policy: 'holder-binding' }])

    expect(() => holderBinding().setSsiPolicyLint('error').build())
      .to.throw(SsiPolicyError, /holder-binding/)
      .with.property('findings')
      .that.has.length(1)

    expect(
      names(events(() => holderBinding().setSsiPolicyLint('off').build()))
    ).to.deep.equal([])
  })

  it('refuses an unknown lint mode', () => {
    expect(() => newAsset().setSsiPolicyLint('loud' as never)).to.throw(
      TypeError,
      /'warn', 'error' or 'off'/
    )
  })

  it('throws on a bare minimum-credentials, in every mode', () => {
    for (const mode of ['warn', 'error', 'off'] as const)
      expect(() =>
        safeSet()
          .setVpPolicies(ALLOW, [
            { policy: 'signature' },
            { policy: 'minimum-credentials' }
          ])
          .setSsiPolicyLint(mode)
          .build()
      ).to.throw(SsiPolicyError, /'minimum-credentials' needs its argument/)
  })

  it('throws on VC policies that need arguments, which the policy server drops', () => {
    for (const policy of [
      'allowed-issuer',
      'schema',
      'webhook',
      'dynamic',
      'credential-status'
    ])
      expect(() =>
        safeSet()
          .setVcPolicies(ALLOW, ['signature', policy])
          .setSsiPolicyLint('off')
          .build()
      ).to.throw(
        SsiPolicyError,
        new RegExp(
          `VC policy '${policy}' needs arguments.*addRequestCredentials\\(list, \\[\\{ type, format, policies`
        )
      )
  })

  it('throws on any VC policy object with arguments', () => {
    expect(() =>
      safeSet()
        .setVcPolicies(ALLOW, [
          'signature',
          { policy: 'allowed-issuer', args: [TRUSTED] } as never
        ])
        .build()
    ).to.throw(SsiPolicyError, /'allowed-issuer' has arguments/)

    expect(() =>
      safeSet()
        .setVcPolicies(ALLOW, [{ policy: 'expired', args: '1' } as never])
        .build()
    ).to.throw(SsiPolicyError, /a different check/)
  })

  it('throws on an edit of a published asset whose VC policies lost their arguments', () => {
    const published = getAssetFixture()
    published.credentialSubject.credentials = {
      allow: [
        { type: 'address', values: [{ address: OWNER_ADDRESS }] },
        {
          type: 'SSIpolicy',
          values: [
            {
              request_credentials: [
                { type: 'gx:LegalPerson', format: 'jwt_vc_json' }
              ],
              vc_policies: [
                'signature',
                { policy: 'allowed-issuer', args: [TRUSTED] }
              ]
            }
          ]
        }
      ]
    } as never

    expect(() =>
      new AssetBuilder(published).setName('Renamed').build()
    ).to.throw(SsiPolicyError, /'allowed-issuer'/)
  })

  it('checks the published services an edit keeps', () => {
    const published = getAssetFixture()
    for (const service of published.credentialSubject.services)
      service.credentials = {
        allow: [
          {
            type: 'SSIpolicy',
            values: [
              {
                request_credentials: [
                  { type: 'VerifiableId', format: 'jwt_vc_json' }
                ],
                vp_policies: [{ policy: 'holder-binding' }]
              }
            ]
          }
        ]
      } as never

    const seen = events(() =>
      new AssetBuilder(published).setName('Renamed').build()
    )
    expect(names(seen)).to.include('identity.policy.holder_binding')
    expect(seen[0].fields?.where).to.equal(`service ${SERVICE_ID}`)

    // A removed service is not checked.
    const removed = events(() =>
      new AssetBuilder(published)
        .removeService(SERVICE_ID)
        .addService(accessService())
        .build()
    )
    expect(names(removed)).to.deep.equal([])
  })

  it('ignores policies when nothing requests a credential', () => {
    const seen = events(() =>
      newAsset()
        .setVpPolicies(ALLOW, [{ policy: 'holder-binding' }])
        .build()
    )

    expect(names(seen)).to.deep.equal([])
  })
})

// #endregion
