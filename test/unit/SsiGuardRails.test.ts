import { describe, expect, it, vi } from 'vitest'
import type { AssetV5 } from '../../src/ddo/index.js'
import {
  CredentialListTypes,
  type RequestCredential,
  type SsiPolicyValue
} from '../../src/ddo/types.js'
import {
  addRequestCredentials,
  requiresPresentation,
  setVpPolicies
} from '../../src/identity/policy.js'
import {
  policyServerRequests,
  requestedTypes,
  SsiPolicyError
} from '../../src/identity/policyLint.js'
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
import { setDebug } from '../../src/log/debug.js'
import type { DebugEvent, LogEvent } from '../../src/log/index.js'
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
import { captureLog } from '../helpers.js'

const ALLOW = CredentialListTypes.ALLOW
const HOLDER = 'did:key:z6MkholderFixture'
const SERVER_SESSION = `${'a'.repeat(64)}-${'b'.repeat(64)}`
const TRUSTED = 'did:web:issuer.test.invalid'

/** Every event built while `run` runs, printed or not. */
function events(run: () => void): LogEvent[] {
  const log = captureLog({ level: 'trace' })
  run()
  return log.events
}

/** The debug channel's events from now on (`sensitive`, every topic). */
function captureDebug(): DebugEvent[] {
  const seen: DebugEvent[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  setDebug({ level: 'sensitive', sink: (event) => seen.push(event) })
  return seen
}

const names = (seen: LogEvent[]) => seen.map((event) => event.event)

/** Whether `text` holds a C0 control character, the multi-finding message's own newline-dash separators aside. */
const hasControlCharacters = (text: string) =>
  [...text.replace(/\n- /g, '')].some((char) => char.charCodeAt(0) < 0x20)

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

  it('names an empty, numeric or null sub for what it is', async () => {
    const cases: [unknown, string][] = [
      ['', 'has an empty `sub` (its subject is a URL)'],
      [123, 'has a `sub` that is not a DID'],
      [null, 'has a `sub` that is not a DID']
    ]

    for (const [sub, text] of cases) {
      const { calls, error } = await present(gatedAsset(['holder-binding']), [
        legalPerson(sub as string)
      ])

      expect((error as CredentialRejectedLocallyError).reason).to.equal(
        'sub-mismatch'
      )
      expect((error as Error).message).to.contain(
        `Your \`gx:LegalPerson\` credential ${text}`
      )
      expect(calls.presented).to.equal(0)
    }
  })

  it('asks to drop holder-binding as a whole, which applies to every credential', async () => {
    const { error } = await present(gatedAsset(['holder-binding']), [
      legalPerson()
    ])

    expect((error as Error).message).to.contain(
      'Ask the publisher to drop `holder-binding` (it applies to every credential in the presentation)'
    )
    expect((error as Error).message).not.to.contain('for this credential type')
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
      const seen = captureLog({ level: 'debug' }).events
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

  it('quotes no control characters from the asset DID, and sends the raw values to the debug channel', async () => {
    const debug = captureDebug()
    const asset = gatedAsset(['holder-binding'])
    asset.id = `${asset.id}\u001b[2J\nFORGED LINE`

    const { error } = await present(asset, [legalPerson()], {
      did: `${HOLDER}\u001b[31m`
    })
    const { message } = error as Error

    expect(hasControlCharacters(message)).to.equal(false)
    expect(message).to.contain('FORGED LINE')
    const raw = (topic: string) =>
      debug.filter(
        (event) =>
          event.topic === topic &&
          JSON.stringify(event.data ?? '').includes('\\u001b')
      )
    expect(raw('node')).not.to.have.length(0)
    expect(raw('wallet')).not.to.have.length(0)
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

const SAFE_VC = ['signature', 'not-before', 'revoked-status-list']
const SAFE_VP = [
  { policy: 'signature' },
  { policy: 'minimum-credentials', args: '1' }
]
const TRUST = [
  {
    type: 'gx:LegalPerson',
    format: 'jwt_vc_json',
    policies: [{ policy: 'allowed-issuer', args: [TRUSTED] }]
  }
]

function serviceBuilder(name = 'Access Service') {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setName(name)
    .setPricing({ type: 'free' })
}

function accessService() {
  return serviceBuilder().build()
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
    .addRequestCredentials(ALLOW, TRUST)
    .setVcPolicies(ALLOW, SAFE_VC)
    .setVpPolicies(ALLOW, SAFE_VP)
}

/** The finding codes of the `SsiPolicyError` `run` throws. */
function thrownCodes(run: () => unknown): string[] {
  try {
    run()
  } catch (error) {
    expect(error).to.be.instanceOf(SsiPolicyError)
    return (error as SsiPolicyError).findings.map((finding) => finding.code)
  }
  throw new Error('expected an SsiPolicyError')
}

/** The guide's per-service gating: an open preview and a gated full service. */
function partialGate(policies: 'asset' | 'service') {
  let full = serviceBuilder('full').addRequestCredentials(ALLOW, [
    { type: 'VerifiableId', format: 'jwt_vc_json', policies: TRUST[0].policies }
  ])
  if (policies === 'service')
    full = full.setVcPolicies(ALLOW, SAFE_VC).setVpPolicies(ALLOW, SAFE_VP)

  const builder = new AssetBuilder()
    .setType('dataset')
    .setName('Partial')
    .setProvidedBy('deltaDAO AG')
    .addService(serviceBuilder('preview').build())
    .addService(full.build())
    .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])

  return policies === 'asset'
    ? builder.setVcPolicies(ALLOW, SAFE_VC).setVpPolicies(ALLOW, SAFE_VP)
    : builder
}

describe('SSI policy lint in AssetBuilder.build()', () => {
  it('accepts the safe set without a warning', () => {
    expect(names(events(() => safeSet().build()))).to.deep.equal([])
  })

  it('warns about holder-binding, once, naming where it is', () => {
    const seen = events(() =>
      safeSet()
        .setVpPolicies(ALLOW, [...SAFE_VP, { policy: 'holder-binding' }])
        .build()
    )

    expect(names(seen)).to.deep.equal(['identity.policy.holder_binding'])
    expect(seen[0].level).to.equal('warn')
    expect(seen[0].fields).to.deep.equal({ where: 'asset' })
    expect(seen[0].msg).to.contain("JWT 'sub'")
  })

  it('warns about presentation-definition with jwt_vc_json or jwt_vc, not with another format', () => {
    const withPd = (format: string) =>
      events(() =>
        safeSet(
          newAsset().addRequestCredentials(ALLOW, [
            { ...TRUST[0], type: 'VerifiableId', format }
          ])
        )
          .setVpPolicies(ALLOW, [
            ...SAFE_VP,
            { policy: 'presentation-definition' }
          ])
          .build()
      )

    const seen = withPd('jwt_vc_json')
    expect(names(seen)).to.deep.equal([
      'identity.policy.presentation_definition_vc_jwt',
      'identity.policy.presentation_definition_vc_jwt'
    ])
    expect(seen.map((event) => event.fields)).to.deep.include({
      where: 'asset',
      credentialType: 'VerifiableId'
    })
    expect(
      withPd('jwt_vc').map((event) => event.fields?.credentialType)
    ).to.include('VerifiableId')
    // The safe set's own gx:LegalPerson is jwt_vc_json: only it warns.
    expect(
      withPd('ldp_vc').map((event) => event.fields?.credentialType)
    ).to.deep.equal(['gx:LegalPerson'])
  })

  it('warns about presentation-definition at asset level with a service-level jwt_vc_json request', () => {
    const service = serviceBuilder('Gated service')
      .addRequestCredentials(ALLOW, TRUST)
      .setVcPolicies(ALLOW, SAFE_VC)
      .setVpPolicies(ALLOW, SAFE_VP)
      .build()

    const seen = events(() =>
      new AssetBuilder()
        .setType('dataset')
        .setName('Gated')
        .setProvidedBy('deltaDAO AG')
        .addService(service)
        .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
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
      safeSet().setVpPolicies(ALLOW, [...SAFE_VP, { policy: 'holder-binding' }])

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

  it('throws on a bare minimum-credentials, maximum-credentials or vp_required_credentials, in every mode', () => {
    for (const policy of [
      'minimum-credentials',
      'maximum-credentials',
      'vp_required_credentials'
    ])
      for (const mode of ['warn', 'error', 'off'] as const)
        expect(() =>
          safeSet()
            .setVpPolicies(ALLOW, [...SAFE_VP, { policy }])
            .setSsiPolicyLint(mode)
            .build()
        ).to.throw(SsiPolicyError, new RegExp(`'${policy}' needs its argument`))
  })

  it('throws on VP arguments walt.id cannot read, with a hint of the right shape', () => {
    const vp = (policy: { policy: string; args?: string }) => () =>
      safeSet()
        .setVpPolicies(ALLOW, [...SAFE_VP, policy])
        .setSsiPolicyLint('off')
        .build()

    expect(vp({ policy: 'minimum-credentials', args: 'abc' })).to.throw(
      SsiPolicyError,
      /'minimum-credentials' needs an integer argument.*args: '1'/
    )
    expect(vp({ policy: 'maximum-credentials', args: '[2]' })).to.throw(
      SsiPolicyError,
      /'maximum-credentials' needs an integer argument/
    )
    expect(vp({ policy: 'maximum-credentials', args: '1.5' })).to.throw(
      SsiPolicyError,
      /needs an integer argument/
    )
    for (const args of ['1', '{"required":[{}]}', '{"required":"x"}'])
      expect(vp({ policy: 'vp_required_credentials', args })).to.throw(
        SsiPolicyError,
        /'vp_required_credentials' needs .*args: JSON\.stringify\(\{ required: \[\{ credential_type: '<type>' \}\] \}\)/
      )

    // Readable shapes build.
    for (const policy of [
      { policy: 'maximum-credentials', args: '3' },
      { policy: 'minimum-credentials', args: '"2"' },
      {
        policy: 'vp_required_credentials',
        args: JSON.stringify({
          required: [
            { credential_type: 'gx:LegalPerson' },
            { any_of: ['VerifiableId', 'gx:LegalPerson'] }
          ]
        })
      }
    ])
      expect(names(events(vp(policy)))).to.deep.equal([])
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

  it('throws on any VC policy object with arguments, advising per-credential placement only where it belongs', () => {
    expect(() =>
      safeSet()
        .setVcPolicies(ALLOW, [
          'signature',
          { policy: 'allowed-issuer', args: [TRUSTED] } as never
        ])
        .build()
    ).to.throw(
      SsiPolicyError,
      /'allowed-issuer' has arguments.*Put it on the credential instead/
    )

    let message = ''
    try {
      safeSet()
        .setVcPolicies(ALLOW, [{ policy: 'signature', args: 'x' } as never])
        .build()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.contain('a different check')
    expect(message).to.contain(
      "Drop the arguments and keep 'signature' in the VC policies"
    )
    expect(message).not.to.contain('addRequestCredentials')
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
    const holderBinding = seen.filter(
      (event) => event.event === 'identity.policy.holder_binding'
    )
    expect(holderBinding).to.have.length(1)
    expect(holderBinding[0].fields?.where).to.equal(`service ${SERVICE_ID}`)

    // A removed service is not checked.
    const removed = events(() =>
      new AssetBuilder(published)
        .removeService(SERVICE_ID)
        .addService(accessService())
        .build()
    )
    expect(names(removed)).to.deep.equal([])
  })

  it('checks a kept service in the form the edit writes', () => {
    // Stored with an argument the policy server drops; the edit writes the name only, which
    // works, so the edit must not be refused for it.
    const published = getAssetFixture()
    published.credentialSubject.credentials = {
      allow: [{ type: 'address', values: [{ address: OWNER_ADDRESS }] }]
    } as never
    for (const service of published.credentialSubject.services)
      service.credentials = {
        allow: [
          {
            type: 'SSIpolicy',
            values: [
              {
                request_credentials: [
                  {
                    type: 'VerifiableId',
                    format: 'jwt_vc_json',
                    policies: TRUST[0].policies
                  }
                ],
                vc_policies: [{ policy: 'signature', args: 'legacy' }],
                vp_policies: SAFE_VP
              }
            ]
          }
        ]
      } as never

    expect(
      names(
        events(() => new AssetBuilder(published).setName('Renamed').build())
      )
    ).to.deep.equal([])
  })

  it('quotes no control characters from a service id the node returned, and sends the raw id to the debug channel', () => {
    const debug = captureDebug()
    const published = getAssetFixture()
    const evil = `${SERVICE_ID}\u001b[31mEVIL\nFORGED LINE`
    published.credentialSubject.services[0].id = evil
    published.credentialSubject.services[0].credentials = {
      allow: [
        {
          type: 'SSIpolicy',
          values: [
            {
              request_credentials: [
                { type: 'VerifiableId', format: 'jwt_vc_json' }
              ],
              vp_policies: [{ policy: 'minimum-credentials' }]
            }
          ]
        }
      ]
    } as never

    let error: SsiPolicyError | undefined
    try {
      new AssetBuilder(published).setName('Renamed').build()
    } catch (caught) {
      error = caught as SsiPolicyError
    }

    expect(error).to.be.instanceOf(SsiPolicyError)
    expect(hasControlCharacters(error?.message ?? '')).to.equal(false)
    expect(hasControlCharacters(error?.findings[0].where ?? '')).to.equal(false)
    expect(error?.findings[0].where).to.contain('FORGED LINE')
    expect(
      debug.some((event) => event.topic === 'node' && event.data === evil)
    ).to.equal(true)
  })

  it('lists every finding, and caps the message', () => {
    // A fatal finding in 'warn' mode keeps the warnings in `findings`.
    const both = thrownCodes(() =>
      safeSet()
        .setVpPolicies(ALLOW, [
          ...SAFE_VP,
          { policy: 'holder-binding' },
          { policy: 'maximum-credentials' }
        ])
        .build()
    )
    expect(both).to.deep.equal(['vp-policy-arguments', 'holder-binding'])

    // 'off' reports the fatal ones only.
    expect(
      thrownCodes(() =>
        safeSet()
          .setVpPolicies(ALLOW, [
            ...SAFE_VP,
            { policy: 'holder-binding' },
            { policy: 'maximum-credentials' }
          ])
          .setSsiPolicyLint('off')
          .build()
      )
    ).to.deep.equal(['vp-policy-arguments'])

    let builder = new AssetBuilder()
      .setType('dataset')
      .setName('Many')
      .setProvidedBy('deltaDAO AG')
      .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
    for (let index = 0; index < 30; index++)
      builder = builder.addService(
        serviceBuilder(`s${index}`)
          .addRequestCredentials(ALLOW, TRUST)
          .setVcPolicies(ALLOW, SAFE_VC)
          .setVpPolicies(ALLOW, [...SAFE_VP, { policy: 'holder-binding' }])
          .build()
      )

    let error: SsiPolicyError | undefined
    try {
      builder.setSsiPolicyLint('error').build()
    } catch (caught) {
      error = caught as SsiPolicyError
    }
    expect(error?.findings).to.have.length(30)
    expect(error?.message.split('\n- ')).to.have.length(21)
    expect(error?.message).to.contain(
      '… and 10 more (see SsiPolicyError.findings).'
    )
  })
})

describe('SSI policy lint: per-service gating (D27)', () => {
  it('throws, in every mode, for an SSIpolicy that applies to a service requesting no credential', () => {
    for (const mode of ['warn', 'error', 'off'] as const) {
      expect(
        thrownCodes(() =>
          newAsset()
            .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
            .setVpPolicies(ALLOW, SAFE_VP)
            .setSsiPolicyLint(mode)
            .build()
        )
      ).to.deep.equal(['no-request-credentials'])
    }

    expect(() => newAsset().setVpPolicies(ALLOW, SAFE_VP).build()).to.throw(
      SsiPolicyError,
      /failed to fetch request credentials/
    )
  })

  it('throws for asset-level policies next to an ungated sibling service, naming it', () => {
    let error: SsiPolicyError | undefined
    try {
      partialGate('asset').setSsiPolicyLint('off').build()
    } catch (caught) {
      error = caught as SsiPolicyError
    }

    expect(error).to.be.instanceOf(SsiPolicyError)
    expect(error?.findings).to.have.length(1)
    expect(error?.findings[0]).to.include({
      code: 'no-request-credentials',
      fatal: true,
      where: 'asset'
    })
    expect(error?.message).to.contain('service preview requests no credential')
    expect(error?.message).to.contain(
      'ServiceBuilder.setVcPolicies / setVpPolicies'
    )
  })

  it('throws for a service-level SSIpolicy without request credentials', () => {
    const service = serviceBuilder('lonely')
      .setVpPolicies(ALLOW, SAFE_VP)
      .build()

    let error: SsiPolicyError | undefined
    try {
      new AssetBuilder()
        .setType('dataset')
        .setName('Lonely')
        .setProvidedBy('deltaDAO AG')
        .addService(service)
        .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
        .build()
    } catch (caught) {
      error = caught as SsiPolicyError
    }
    expect(error?.findings[0]).to.include({
      code: 'no-request-credentials',
      where: 'service lonely'
    })
  })

  it('builds the safe set on the gated service only, leaving the sibling open', () => {
    let built: ReturnType<AssetBuilder['build']> | undefined
    const seen = events(() => {
      built = partialGate('service').setSsiPolicyLint('error').build()
    })
    expect(names(seen)).to.deep.equal([])

    const [preview, full] = built?.ddo.services ?? []
    expect(
      built?.ddo.credentials.allow?.some((entry) => entry.type === 'SSIpolicy')
    ).to.equal(false)
    expect(
      requiresPresentation(built?.ddo.credentials, preview.credentials)
    ).to.equal(false)
    expect(
      requiresPresentation(built?.ddo.credentials, full.credentials)
    ).to.equal(true)

    // Stored as the policy server reads it: one SSIpolicy entry, one value.
    expect(full.credentials.allow).to.deep.equal([
      {
        type: 'SSIpolicy',
        values: [
          {
            request_credentials: [
              {
                type: 'VerifiableId',
                format: 'jwt_vc_json',
                policies: [JSON.stringify(TRUST[0].policies[0])]
              }
            ],
            vc_policies: SAFE_VC,
            vp_policies: SAFE_VP
          }
        ]
      }
    ])
  })

  it('replaces a service policy list with the setters, and clears it with []', () => {
    const service = serviceBuilder()
      .addRequestCredentials(ALLOW, TRUST)
      .setVpPolicies(ALLOW, [{ policy: 'holder-binding' }])
      .setVpPolicies(ALLOW, SAFE_VP)
      .setVcPolicies(ALLOW, ['expired'])
      .setVcPolicies(ALLOW, [])
      .build()

    const [entry] = service.credentials.allow ?? []
    const value = (entry as { values: SsiPolicyValue[] }).values[0]
    expect(value.vp_policies).to.deep.equal(SAFE_VP)
    expect(value.vc_policies).to.deep.equal([])
    expect(value.request_credentials).to.have.length(1)
  })
})

describe('SSI policy lint: weaker than the safe set (D4)', () => {
  const variant = (vc: string[], vp: { policy: string; args?: string }[]) =>
    safeSet().setVcPolicies(ALLOW, vc).setVpPolicies(ALLOW, vp)

  it('warns once for each missing safe-set policy, and throws them under error', () => {
    const cases: [ReturnType<typeof variant>, string][] = [
      [
        variant(['not-before', 'revoked-status-list'], SAFE_VP),
        'identity.policy.no_vc_signature'
      ],
      [variant(SAFE_VC, [SAFE_VP[1]]), 'identity.policy.no_vp_signature'],
      [
        variant(SAFE_VC, [SAFE_VP[0]]),
        'identity.policy.no_minimum_credentials'
      ],
      [
        variant(SAFE_VC, [
          SAFE_VP[0],
          { policy: 'minimum-credentials', args: '0' }
        ]),
        'identity.policy.no_minimum_credentials'
      ]
    ]

    for (const [builder, event] of cases) {
      const seen = events(() => builder.build())
      expect(names(seen)).to.deep.equal([event])
      expect(seen[0].fields).to.deep.equal({ where: 'asset' })
      expect(() => builder.setSsiPolicyLint('error').build()).to.throw(
        SsiPolicyError
      )
    }

    expect(
      names(events(() => variant(SAFE_VC, [SAFE_VP[0]]).build()))[0]
    ).to.equal('identity.policy.no_minimum_credentials')
  })

  it('says the policy server may add signature, which nautilus cannot see', () => {
    const seen = events(() => variant(SAFE_VC, [SAFE_VP[1]]).build())
    expect(seen[0].msg).to.contain('DEFAULT_VP_POLICIES')
  })

  it('accepts a minimum of 1 next to a lower one, and checks the merged view', () => {
    expect(
      names(
        events(() =>
          variant(SAFE_VC, [
            ...SAFE_VP,
            { policy: 'minimum-credentials', args: '0' }
          ]).build()
        )
      )
    ).to.deep.equal([])

    // Safe set split between asset and service: complete when merged.
    const service = serviceBuilder()
      .addRequestCredentials(ALLOW, TRUST)
      .setVpPolicies(ALLOW, SAFE_VP)
      .build()
    expect(
      names(
        events(() =>
          new AssetBuilder()
            .setType('dataset')
            .setName('Split')
            .setProvidedBy('deltaDAO AG')
            .addService(service)
            .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
            .setVcPolicies(ALLOW, SAFE_VC)
            .build()
        )
      )
    ).to.deep.equal([])
  })
})

describe("SSI policy lint: '*' with a credential gate (D6)", () => {
  it('warns when the policy server lets every address into a gated service, and throws under error', () => {
    const wildcard = () => safeSet().addCredentialAddresses(ALLOW, ['*'])

    const seen = events(() => wildcard().build())
    expect(names(seen)).to.deep.equal(['identity.policy.wildcard_allow'])
    expect(seen[0].fields).to.deep.equal({ where: 'asset' })
    expect(seen[0].msg).to.contain('type bypass')
    expect(() => wildcard().setSsiPolicyLint('error').build()).to.throw(
      SsiPolicyError,
      /'\*'/
    )
  })

  it("follows the policy server's address rule", () => {
    const withService = (addresses: string[]) => {
      const service = serviceBuilder()
        .addRequestCredentials(ALLOW, TRUST)
        .setVcPolicies(ALLOW, SAFE_VC)
        .setVpPolicies(ALLOW, SAFE_VP)
        .addCredentialAddresses(ALLOW, addresses)
        .build()
      return events(() =>
        new AssetBuilder()
          .setType('dataset')
          .setName('Rule')
          .setProvidedBy('deltaDAO AG')
          .addService(service)
          .addCredentialAddresses(ALLOW, ['*'])
          .build()
      )
    }

    // The service's own list narrows it.
    expect(names(withService([OWNER_ADDRESS]))).to.deep.equal([])
    // '*' at both levels: everyone.
    const both = withService(['*'])
    expect(names(both)).to.deep.equal(['identity.policy.wildcard_allow'])
    expect(both[0].fields?.where).to.equal('service Access Service')

    // No credential gate: '*' is a plain open asset.
    expect(
      names(
        events(() => newAsset().addCredentialAddresses(ALLOW, ['*']).build())
      )
    ).to.deep.equal([])
  })
})

describe('SSI policy lint: per-credential policies as walt.id resolves them', () => {
  const twice = (
    assetPolicies: RequestCredential['policies'],
    servicePolicies: RequestCredential['policies']
  ) => {
    const service = serviceBuilder()
      .addRequestCredentials(ALLOW, [
        {
          type: 'gx:LegalPerson',
          format: 'jwt_vc_json',
          policies: servicePolicies
        }
      ])
      .build()
    return events(() =>
      new AssetBuilder()
        .setType('dataset')
        .setName('Twice')
        .setProvidedBy('deltaDAO AG')
        .addService(service)
        .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
        .addRequestCredentials(ALLOW, [
          {
            type: 'gx:LegalPerson',
            format: 'jwt_vc_json',
            policies: assetPolicies
          }
        ])
        .setVcPolicies(ALLOW, SAFE_VC)
        .setVpPolicies(ALLOW, SAFE_VP)
        .build()
    )
  }

  it('keeps issuer trust when a later request of the type has no policies', () => {
    expect(names(twice(TRUST[0].policies, []))).to.deep.equal([])
  })

  it('warns when a later non-empty list replaces the one with issuer trust', () => {
    const seen = twice(TRUST[0].policies, [{ policy: 'schema', args: {} }])
    expect(
      seen.map((event) => [event.event, event.fields?.where])
    ).to.deep.equal([
      ['identity.policy.credential_policies_replaced', 'asset'],
      ['identity.policy.no_issuer_trust', 'service Access Service']
    ])
  })

  it('warns that an earlier list never runs, and no issuer warning when the last has trust', () => {
    const seen = twice([{ policy: 'schema', args: {} }], TRUST[0].policies)
    expect(names(seen)).to.deep.equal([
      'identity.policy.credential_policies_replaced'
    ])
    expect(seen[0].fields).to.deep.equal({
      where: 'asset',
      credentialType: 'gx:LegalPerson'
    })
    expect(seen[0].msg).to.contain('(schema) that never run')
  })

  it('drops a repeated identical request at its first position, as the policy server does', () => {
    // G4 (PR 12 round 2): the service repeats the asset's issuer-trust request after another
    // list. The policy server keeps the asset's copy where it is, so walt.id runs the
    // service's not-before list for the type, and another issuer's credential passes.
    const notBefore = [{ policy: 'not-before' }]
    const service = serviceBuilder()
      .addRequestCredentials(ALLOW, [
        { type: 'gx:LegalPerson', format: 'jwt_vc_json', policies: notBefore },
        TRUST[0]
      ])
      .build()
    const seen = events(() =>
      new AssetBuilder()
        .setType('dataset')
        .setName('Repeated')
        .setProvidedBy('deltaDAO AG')
        .addService(service)
        .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
        .addRequestCredentials(ALLOW, TRUST)
        .setVcPolicies(ALLOW, SAFE_VC)
        .setVpPolicies(ALLOW, SAFE_VP)
        .build()
    )

    expect(
      seen.map((event) => [event.event, event.fields?.where])
    ).to.deep.equal([
      ['identity.policy.credential_policies_replaced', 'asset'],
      ['identity.policy.no_issuer_trust', 'service Access Service']
    ])
    expect(seen[0].msg).to.contain('(allowed-issuer) that never run')
  })

  it('reads the policies the policy server forwards for a type', () => {
    const asset = {
      request_credentials: [
        { type: 'T', format: 'jwt_vc_json', policies: [TRUST[0].policies[0]] },
        { type: 'U', policies: ['not json', 7] }
      ]
    } as unknown as SsiPolicyValue
    const service = {
      request_credentials: [
        { type: 'T', format: 'jwt_vc_json', policies: ['"expired"'] },
        {
          type: 'T',
          format: 'jwt_vc_json',
          policies: [JSON.stringify(TRUST[0].policies[0])]
        },
        { type: 'U', policies: 'allowed-issuer' }
      ]
    } as unknown as SsiPolicyValue

    const forwarded = policyServerRequests([
      { where: 'asset', values: [asset] },
      { where: 'service s', values: [service] }
    ])
    expect(
      forwarded.map(({ where, credential, policies }) => [
        where,
        credential.type,
        policies
      ])
    ).to.deep.equal([
      ['asset', 'T', [TRUST[0].policies[0]]],
      // Unparseable strings and non-lists give no policies, so the service's U repeats it.
      ['asset', 'U', []],
      ['service s', 'T', ['expired']]
      // The service's issuer-trust T repeats the asset's, which keeps its position.
    ])

    const t = requestedTypes(forwarded).get('T')
    expect(t?.effective?.policies).to.deep.equal(['expired'])
    expect(t?.replaced.map(({ where }) => where)).to.deep.equal(['asset'])
    expect(requestedTypes(forwarded).get('U')?.effective).to.equal(undefined)
  })

  it('throws for an allowed-issuer that names no issuer, in every mode', () => {
    for (const policy of [
      'allowed-issuer',
      { policy: 'allowed-issuer', args: [] },
      { policy: 'allowed-issuer', args: '*' },
      { policy: 'allowed-issuer', args: ['*', ''] }
    ])
      for (const mode of ['warn', 'off'] as const)
        expect(
          thrownCodes(() =>
            safeSet(
              newAsset().addRequestCredentials(ALLOW, [
                {
                  type: 'VerifiableId',
                  format: 'jwt_vc_json',
                  policies: [policy]
                }
              ])
            )
              .setSsiPolicyLint(mode)
              .build()
          )
        ).to.deep.equal(['credential-policy-arguments'])

    // One usable issuer next to '*' works.
    expect(
      names(
        events(() =>
          safeSet(
            newAsset().addRequestCredentials(ALLOW, [
              {
                type: 'VerifiableId',
                format: 'jwt_vc_json',
                policies: [{ policy: 'allowed-issuer', args: ['*', TRUSTED] }]
              }
            ])
          ).build()
        )
      )
    ).to.deep.equal([])
  })
})

// #endregion
