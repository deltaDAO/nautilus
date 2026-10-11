import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetV5 } from '../../src/ddo/index.js'
import {
  CredentialListTypes,
  type DdoCredentials
} from '../../src/ddo/types.js'
import {
  credentialAttributeSchema,
  evaluateAttributeSchema
} from '../../src/identity/attributes.js'
import {
  addRequestCredentials,
  requireCredentialAttributes,
  setRequestCredentials,
  trustIssuers
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
import { resetDebug, setDebug } from '../../src/log/debug.js'
import type { DebugEvent, LogEvent } from '../../src/log/index.js'
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
const TRUSTED = 'did:web:delta-dao.com'
const OTHER_ISSUER = 'did:web:issuer.test.invalid'
const LEGAL_PERSON = 'gx:LegalPerson'
const COUNTRY = ['gx:legalAddress', 'gx:countryCode']
const DE = [{ path: COUNTRY, equals: 'DE' }]

/**
 * The reviewed fixture: the nautilus test harness's `DE_SCHEMA_FIXTURE`
 * (`tests/selftest.ts`), which walt.id accepted for a DE credential and refused for FR and a
 * credential without the address on the dev stack (PR 13, R1-R3).
 */
const DE_SCHEMA_FIXTURE = {
  type: 'object',
  required: ['credentialSubject'],
  properties: {
    credentialSubject: {
      type: 'object',
      required: ['gx:legalAddress'],
      properties: {
        'gx:legalAddress': {
          type: 'object',
          required: ['gx:countryCode'],
          properties: { 'gx:countryCode': { const: 'DE' } }
        }
      }
    }
  }
}

/** The harness's `DE_GATE_FIXTURE` request credential: issuer trust, then the schema. */
const DE_GATE_REQUEST = {
  type: LEGAL_PERSON,
  format: 'jwt_vc_json',
  policies: [
    `{"policy":"allowed-issuer","args":["${TRUSTED}"]}`,
    `{"policy":"schema","args":${JSON.stringify(DE_SCHEMA_FIXTURE)}}`
  ]
}

const ssiValue = (credentials: { allow?: unknown[] }) =>
  (
    credentials.allow?.find(
      (entry) => (entry as { type?: string }).type === 'SSIpolicy'
    ) as { values: Record<string, unknown>[] } | undefined
  )?.values[0]

const requests = (credentials: { allow?: unknown[] }) =>
  ssiValue(credentials)?.request_credentials as {
    type: string
    format?: string
    policies?: string[]
  }[]

/** Every event built while `run` runs, printed or not. */
function events(run: () => void): LogEvent[] {
  const seen: LogEvent[] = []
  configureLogging({ level: 'trace', sink: (event) => seen.push(event) })
  run()
  return seen
}

const names = (seen: LogEvent[]) => seen.map((event) => event.event)

// #region the schema

describe('credentialAttributeSchema', () => {
  it('builds the reviewed DE fixture, key order included', () => {
    expect(JSON.stringify(credentialAttributeSchema(DE))).to.equal(
      JSON.stringify(DE_SCHEMA_FIXTURE)
    )
  })

  it('writes oneOf as enum, a single value as const, and exists as {}', () => {
    const schema = credentialAttributeSchema([
      { path: COUNTRY, oneOf: ['DE', 'AT'] },
      { path: ['gx:legalName'], exists: true },
      { path: ['gx:registrationNumber'] },
      { path: ['gx:vatID'], oneOf: ['X'] },
      { path: ['gx:active'], equals: true },
      { path: ['gx:employees'], equals: 10 }
    ]) as typeof DE_SCHEMA_FIXTURE
    const subject = schema.properties.credentialSubject as {
      required: string[]
      properties: Record<string, unknown>
    }

    expect(subject.required).to.deep.equal([
      'gx:legalAddress',
      'gx:legalName',
      'gx:registrationNumber',
      'gx:vatID',
      'gx:active',
      'gx:employees'
    ])
    expect(subject.properties['gx:legalAddress']).to.deep.equal({
      type: 'object',
      required: ['gx:countryCode'],
      properties: { 'gx:countryCode': { enum: ['DE', 'AT'] } }
    })
    expect(subject.properties['gx:legalName']).to.deep.equal({})
    expect(subject.properties['gx:registrationNumber']).to.deep.equal({})
    expect(subject.properties['gx:vatID']).to.deep.equal({ const: 'X' })
    expect(subject.properties['gx:active']).to.deep.equal({ const: true })
    expect(subject.properties['gx:employees']).to.deep.equal({ const: 10 })
  })

  it('combines requirements with AND: shared parents, intersected values', () => {
    const schema = credentialAttributeSchema([
      { path: COUNTRY, oneOf: ['DE', 'AT', 'CH'] },
      { path: COUNTRY, oneOf: ['CH', 'DE'] },
      { path: ['gx:legalAddress', 'gx:locality'], equals: 'Hamburg' },
      { path: COUNTRY, exists: true }
    ]) as typeof DE_SCHEMA_FIXTURE
    const address = schema.properties.credentialSubject.properties[
      'gx:legalAddress'
    ] as unknown

    expect(address).to.deep.equal({
      type: 'object',
      required: ['gx:countryCode', 'gx:locality'],
      properties: {
        'gx:countryCode': { enum: ['DE', 'CH'] },
        'gx:locality': { const: 'Hamburg' }
      }
    })
    expect(
      credentialAttributeSchema([
        { path: COUNTRY, oneOf: ['AT', 'DE'] },
        { path: COUNTRY, equals: 'DE' }
      ])
    ).to.deep.equal(DE_SCHEMA_FIXTURE)
  })

  it('throws a TypeError for contradictory or invalid requirements', () => {
    const invalid: unknown[][] = [
      [],
      [{ path: [] }],
      [{ path: ['a', ''] }],
      [{ path: 'gx:legalAddress' }],
      [{ path: ['__proto__'], equals: 'x' }],
      [{ path: COUNTRY, equals: 'DE', oneOf: ['DE'] }],
      [{ path: COUNTRY, exists: false }],
      [{ path: COUNTRY, equals: { code: 'DE' } }],
      [{ path: COUNTRY, equals: Number.NaN }],
      [{ path: COUNTRY, oneOf: [] }],
      [
        { path: COUNTRY, equals: 'DE' },
        { path: COUNTRY, equals: 'FR' }
      ],
      [{ path: COUNTRY, equals: 'DE' }, { path: [...COUNTRY, 'deeper'] }],
      [{ path: [...COUNTRY, 'deeper'] }, { path: COUNTRY, equals: 'DE' }]
    ]

    for (const requirements of invalid)
      expect(
        () => credentialAttributeSchema(requirements as never),
        JSON.stringify(requirements)
      ).to.throw(TypeError)

    expect(() =>
      credentialAttributeSchema([
        { path: COUNTRY, equals: 'DE' },
        { path: COUNTRY, equals: 'FR' }
      ])
    ).to.throw(/cannot be both "DE" and "FR"/)
  })
})

// #endregion

// #region the builder helpers

function accessService() {
  return new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint('https://node.test.invalid')
    .setName('Access Service')
    .setPricing({ type: 'free' })
}

function newAsset() {
  return new AssetBuilder()
    .setType('dataset')
    .setName('Gated')
    .setProvidedBy('deltaDAO AG')
    .addService(accessService().build())
}

/** The DE gate of the identity guide: the safe set with issuer trust and the country. */
function deGate(builder = newAsset()) {
  return builder
    .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
    .requireCredentialAttributes(LEGAL_PERSON, DE)
    .trustIssuers(LEGAL_PERSON, [TRUSTED])
    .setVcPolicies(ALLOW, ['signature', 'not-before', 'revoked-status-list'])
    .setVpPolicies(ALLOW, [
      { policy: 'signature' },
      { policy: 'minimum-credentials', args: '1' }
    ])
}

describe('requireCredentialAttributes and trustIssuers', () => {
  it('store the harness DE gate exactly, whatever the call order, and build without a finding', () => {
    let built: ReturnType<AssetBuilder['build']> | undefined
    const seen = events(() => {
      built = deGate().build()
    })
    expect(names(seen)).to.deep.equal([])

    const credentials = built?.ddo.credentials as { allow?: unknown[] }
    expect(requests(credentials)).to.deep.equal([DE_GATE_REQUEST])
    expect(ssiValue(credentials)?.vc_policies).to.deep.equal([
      'signature',
      'not-before',
      'revoked-status-list'
    ])

    const reversed = trustIssuers({}, LEGAL_PERSON, [TRUSTED])
    expect(
      requests(requireCredentialAttributes(reversed, LEGAL_PERSON, DE))
    ).to.deep.equal([DE_GATE_REQUEST])
  })

  it('add to the one request for the type, keeping its other policies after them', () => {
    const credentials = addRequestCredentials({}, ALLOW, [
      { type: LEGAL_PERSON, format: 'jwt_vc_json', policies: ['signature'] }
    ])
    const changed = trustIssuers(
      requireCredentialAttributes(credentials, LEGAL_PERSON, DE),
      LEGAL_PERSON,
      [TRUSTED]
    )

    expect(requests(changed)).to.have.length(1)
    expect(
      requests(changed)[0].policies?.map(
        (policy) => JSON.parse(policy).policy ?? JSON.parse(policy)
      )
    ).to.deep.equal(['allowed-issuer', 'schema', 'signature'])
  })

  it('use the existing request of a type without a format, and a new jwt_vc_json one otherwise', () => {
    const ldp = addRequestCredentials({}, ALLOW, [
      { type: LEGAL_PERSON, format: 'ldp_vc' }
    ])
    expect(requests(trustIssuers(ldp, LEGAL_PERSON, [TRUSTED]))).to.have.length(
      1
    )
    expect(
      requests(trustIssuers(ldp, LEGAL_PERSON, [TRUSTED]))[0].format
    ).to.equal('ldp_vc')

    const fresh = trustIssuers({}, 'VerifiableId', [TRUSTED])
    expect(requests(fresh)[0].format).to.equal('jwt_vc_json')

    const both = trustIssuers(ldp, LEGAL_PERSON, [TRUSTED], {
      format: 'jwt_vc_json'
    })
    expect(requests(both).map((request) => request.format)).to.deep.equal([
      'ldp_vc',
      'jwt_vc_json'
    ])
  })

  it('combine requirements of several calls with AND, and issuers of several calls with OR', () => {
    const credentials = trustIssuers(
      trustIssuers(
        requireCredentialAttributes(
          requireCredentialAttributes({}, LEGAL_PERSON, [
            { path: COUNTRY, oneOf: ['DE', 'AT'] }
          ]),
          LEGAL_PERSON,
          [{ path: COUNTRY, equals: 'DE' }]
        ),
        LEGAL_PERSON,
        [TRUSTED]
      ),
      LEGAL_PERSON,
      [OTHER_ISSUER, TRUSTED]
    )

    const [issuers, schema] = (requests(credentials)[0].policies ?? []).map(
      (policy) => JSON.parse(policy)
    )
    expect(issuers).to.deep.equal({
      policy: 'allowed-issuer',
      args: [TRUSTED, OTHER_ISSUER]
    })
    expect(schema).to.deep.equal({ policy: 'schema', args: DE_SCHEMA_FIXTURE })
  })

  it('merge into a hand-written schema they cannot read with allOf', () => {
    const custom = { type: 'object', required: ['issuer'] }
    const credentials = requireCredentialAttributes(
      addRequestCredentials({}, ALLOW, [
        {
          type: LEGAL_PERSON,
          format: 'jwt_vc_json',
          policies: [{ policy: 'schema', args: custom }]
        }
      ]),
      LEGAL_PERSON,
      DE
    )

    expect(
      JSON.parse(requests(credentials)[0].policies?.[0] ?? '')
    ).to.deep.equal({
      policy: 'schema',
      args: { allOf: [custom, DE_SCHEMA_FIXTURE] }
    })
  })

  it('refuse issuers that are not DIDs, and an empty list, with a TypeError', () => {
    for (const issuers of [
      [],
      ['delta-dao.com'],
      ['did:web'],
      ['did:web:'],
      [TRUSTED, 'https://delta-dao.com'],
      [42]
    ])
      expect(
        () => trustIssuers({}, LEGAL_PERSON, issuers as never),
        JSON.stringify(issuers)
      ).to.throw(TypeError, /gx:LegalPerson/)

    expect(() =>
      trustIssuers({}, LEGAL_PERSON, [
        'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        'did:web:example.com%3A8443:users:alice',
        'did:ethr:0x1:0xb9c5714089478a327f09197987f16f9e5d936e8a'
      ])
    ).not.to.throw()
  })

  it('refuse a type that is not a string', () => {
    expect(() => trustIssuers({}, '', [TRUSTED])).to.throw(TypeError)
    expect(() => requireCredentialAttributes({}, 7 as never, DE)).to.throw(
      TypeError
    )
  })

  it('exist on the service builder, for the service alone', () => {
    const service = accessService()
      .requireCredentialAttributes(LEGAL_PERSON, DE)
      .trustIssuers(LEGAL_PERSON, [TRUSTED])
      .build()

    expect(requests(service.credentials as never)).to.deep.equal([
      DE_GATE_REQUEST
    ])
  })
})

describe('per-credential policy validation in addRequestCredentials and setRequestCredentials', () => {
  const add = (policies: unknown[]) => () =>
    addRequestCredentials({}, ALLOW, [
      { type: LEGAL_PERSON, format: 'jwt_vc_json', policies: policies as never }
    ])

  it('throws a TypeError naming the type and the policy for schema args that are not an object', () => {
    for (const policies of [
      [{ policy: 'schema', args: JSON.stringify(DE_SCHEMA_FIXTURE) }],
      [{ policy: 'schema', args: [DE_SCHEMA_FIXTURE] }],
      [{ policy: 'schema' }],
      ['schema'],
      [JSON.stringify({ policy: 'schema', args: 'x' })]
    ])
      expect(add(policies), JSON.stringify(policies)).to.throw(
        TypeError,
        /'gx:LegalPerson' request credential's 'schema' policy/
      )

    expect(add([{ policy: 'schema', args: JSON.stringify({}) }])).to.throw(
      /not JSON\.stringify\(schema\)/
    )
  })

  it('throws for allowed-issuer without a DID list, and accepts one DID', () => {
    for (const policies of [
      ['allowed-issuer'],
      [{ policy: 'allowed-issuer', args: [] }],
      [{ policy: 'allowed-issuer', args: ['delta-dao.com'] }],
      [{ policy: 'allowed-issuer', args: { did: TRUSTED } }]
    ])
      expect(add(policies), JSON.stringify(policies)).to.throw(
        TypeError,
        /'allowed-issuer' policy/
      )

    // walt.id accepts one DID as well as a list (`AllowedIssuerPolicy`).
    expect(add([{ policy: 'allowed-issuer', args: TRUSTED }])).not.to.throw()
  })

  it('setRequestCredentials replaces the list, keeping the VC and VP policies', () => {
    const built = deGate()
      .setRequestCredentials(ALLOW, [
        {
          type: LEGAL_PERSON,
          format: 'jwt_vc_json',
          policies: [{ policy: 'allowed-issuer', args: [TRUSTED] }]
        }
      ])
      .build()
    const credentials = built.ddo.credentials as { allow?: unknown[] }

    expect(requests(credentials)).to.deep.equal([
      {
        type: LEGAL_PERSON,
        format: 'jwt_vc_json',
        policies: [`{"policy":"allowed-issuer","args":["${TRUSTED}"]}`]
      }
    ])
    expect(ssiValue(credentials)?.vp_policies).to.deep.equal([
      { policy: 'signature' },
      { policy: 'minimum-credentials', args: '1' }
    ])
  })

  it('setRequestCredentials with an empty list removes the credential gate, not the address list', () => {
    const credentials = deGate().setRequestCredentials(ALLOW, []).build().ddo
      .credentials as { allow?: { type: string }[] }

    expect(credentials.allow?.map((entry) => entry.type)).to.deep.equal([
      'address'
    ])
    expect(
      setRequestCredentials({}, ALLOW, []),
      'nothing to remove'
    ).to.deep.equal({})
  })

  it('setRequestCredentials validates like addRequestCredentials', () => {
    expect(() =>
      setRequestCredentials({}, ALLOW, [
        { type: LEGAL_PERSON, policies: [{ policy: 'schema', args: 'x' }] }
      ])
    ).to.throw(TypeError)
    expect(() => setRequestCredentials({}, ALLOW, 'x' as never)).to.throw(
      TypeError
    )
  })

  it('on the service builder too', () => {
    const service = accessService()
      .requireCredentialAttributes(LEGAL_PERSON, DE)
      .setRequestCredentials(ALLOW, [{ type: 'VerifiableId' }])
      .build()

    expect(requests(service.credentials as never)).to.deep.equal([
      { type: 'VerifiableId' }
    ])
  })
})

// #endregion

// #region the lint

/** A published asset whose asset-level SSIpolicy is `value`, as stored. */
function publishedWith(value: Record<string, unknown>): AssetV5 {
  const asset = getAssetFixture()
  asset.credentialSubject.credentials = {
    allow: [
      { type: 'address', values: [{ address: OWNER_ADDRESS }] },
      { type: 'SSIpolicy', values: [value] }
    ]
  } as never
  return asset
}

describe('SSI policy lint for per-credential policies', () => {
  it('throws on an edit of a stored asset whose schema args are a string', () => {
    const published = publishedWith({
      request_credentials: [
        {
          type: LEGAL_PERSON,
          format: 'jwt_vc_json',
          policies: [
            `{"policy":"allowed-issuer","args":["${TRUSTED}"]}`,
            JSON.stringify({
              policy: 'schema',
              args: JSON.stringify(DE_SCHEMA_FIXTURE)
            })
          ]
        }
      ]
    })

    let error: unknown
    try {
      new AssetBuilder(published).setName('Renamed').build()
    } catch (caught) {
      error = caught
    }

    expect(error).to.be.instanceOf(SsiPolicyError)
    const [finding] = (error as SsiPolicyError).findings
    expect(finding).to.include({
      code: 'credential-policy-arguments',
      fatal: true,
      where: 'asset',
      policy: 'schema',
      credentialType: LEGAL_PERSON
    })
    expect(finding.message).to.contain('a string, not a JSON Schema object')
  })

  it('throws when a type is requested twice with different policies: walt.id keeps only the last', () => {
    const service = accessService()
      .requireCredentialAttributes(LEGAL_PERSON, DE)
      .build()
    const builder = newAsset()
      .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
      .trustIssuers(LEGAL_PERSON, [TRUSTED])
    builder.addService(service)

    let error: unknown
    try {
      builder.build()
    } catch (caught) {
      error = caught
    }

    expect(error).to.be.instanceOf(SsiPolicyError)
    expect(
      (error as SsiPolicyError).findings.map((finding) => finding.code)
    ).to.include('duplicate-request-type')
    expect((error as Error).message).to.contain(
      "walt.id keeps only the last request's per-credential policies"
    )
  })

  it('throws for two formats of one type in one block, but not for the same request twice', () => {
    expect(() =>
      deGate()
        .trustIssuers(LEGAL_PERSON, [TRUSTED], { format: 'ldp_vc' })
        .build()
    ).to.throw(SsiPolicyError, /requested 2 times/)

    const service = accessService()
      .trustIssuers(LEGAL_PERSON, [TRUSTED])
      .build()
    const builder = newAsset()
      .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
      .trustIssuers(LEGAL_PERSON, [TRUSTED])
    builder.addService(service)
    expect(names(events(() => builder.build()))).not.to.include(
      'identity.policy.no_issuer_trust'
    )
  })

  it('warns about a policy name walt.id does not know, at every level', () => {
    const unknown = events(() =>
      deGate()
        .setVcPolicies(ALLOW, ['signature', 'expiry'])
        .setVpPolicies(ALLOW, [
          { policy: 'signature' },
          { policy: 'minimum-credentials', args: '1' },
          { policy: 'holder-bnding' }
        ])
        .build()
    )
    const warnings = unknown.filter(
      (event) => event.event === 'identity.policy.unknown_name'
    )
    expect(warnings.map((event) => event.fields?.policy)).to.deep.equal([
      'expiry',
      'holder-bnding'
    ])
    expect(warnings[0].level).to.equal('warn')
  })

  it('warns about an unknown per-credential name, naming the type', () => {
    const seen = events(() =>
      newAsset()
        .addCredentialAddresses(ALLOW, [OWNER_ADDRESS])
        .setRequestCredentials(ALLOW, [
          {
            type: LEGAL_PERSON,
            format: 'jwt_vc_json',
            policies: [
              { policy: 'allowed-issuer', args: [TRUSTED] },
              'json-schema'
            ]
          }
        ])
        .build()
    )
    const warning = seen.find(
      (event) => event.event === 'identity.policy.unknown_name'
    )
    expect(warning?.fields).to.include({
      where: 'asset',
      policy: 'json-schema',
      credentialType: LEGAL_PERSON
    })
  })
})

// #endregion

// #region consumer: the attribute preflight

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** An unsigned compact JWS: the preflight reads only the payload. */
const jwt = (payload: Record<string, unknown>) =>
  `${b64({ alg: 'EdDSA', typ: 'vc+jwt' })}.${b64(payload)}.c2lnbmF0dXJl`

const MARKER = 'ZZ-VALUE-MARKER'

/** A VCDM 2.0 gx:LegalPerson with `subject` attributes. */
function legalPerson(
  subject: Record<string, unknown>,
  extra: Partial<WaltIdCredential> = {},
  type = LEGAL_PERSON
): WaltIdCredential {
  return {
    id: 'credential-1',
    document: jwt({
      iss: TRUSTED,
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', type],
      credentialSubject: {
        id: 'https://example.org/legal-person.json#cs',
        ...subject
      }
    }),
    parsedDocument: { type: ['VerifiableCredential', type] },
    ...extra
  } as WaltIdCredential
}

/** The same attributes as a VCDM 1.1 credential, in a `vc` claim. */
function legalPersonV1(subject: Record<string, unknown>): WaltIdCredential {
  return {
    id: 'credential-1',
    document: jwt({
      iss: TRUSTED,
      vc: {
        type: ['VerifiableCredential', LEGAL_PERSON],
        credentialSubject: { id: 'did:key:z6Mkholder', ...subject }
      }
    }),
    parsedDocument: { vc: { type: ['VerifiableCredential', LEGAL_PERSON] } }
  } as WaltIdCredential
}

const address = (countryCode: unknown) => ({
  'gx:legalAddress': { 'gx:countryCode': countryCode }
})

function gatedAsset(
  credentials: DdoCredentials,
  serviceCredentials?: DdoCredentials
): AssetV5 {
  const asset = getAssetFixture()
  asset.credentialSubject.credentials = credentials as never
  if (serviceCredentials)
    for (const service of asset.credentialSubject.services)
      if (service.id === SERVICE_ID)
        service.credentials = serviceCredentials as never
  return asset
}

const deAsset = () =>
  gatedAsset(
    requireCredentialAttributes(
      trustIssuers({}, LEGAL_PERSON, [TRUSTED]),
      LEGAL_PERSON,
      DE
    )
  )

const DEFINITION = {
  id: 'definition',
  input_descriptors: [
    {
      id: LEGAL_PERSON,
      constraints: {
        fields: [{ path: ['$.vc.type'], filter: { pattern: LEGAL_PERSON } }]
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

const SERVER_SESSION = `${'a'.repeat(64)}-${'b'.repeat(64)}`

async function present(
  asset: AssetV5,
  credentials: WaltIdCredential[],
  options: Partial<WaltIdCredentialProviderOptions> = {}
): Promise<{ presented: number; error?: unknown }> {
  let presented = 0
  const wallet = {
    authenticate: async () => ({ token: 'wallet-token' }),
    isSessionValid: async () => true,
    listWallets: async () => [{ id: 'wallet-1' }],
    listDids: async () => [{ did: 'did:key:z6Mkholder' }],
    matchCredentials: async () => credentials,
    unmatchedCredentials: async () => [],
    resolvePresentationRequest: async () => 'resolved',
    async usePresentationRequest() {
      presented++
      return { redirectUri: 'https://verifier.test.invalid/success' }
    }
  } as unknown as WaltIdWallet
  const node = nodeStub()
  const provider = new WaltIdCredentialProvider(node, {
    wallet,
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
      redirectUri: `openid4vp://authorize?${new URLSearchParams({
        response_uri: `https://ps.test.invalid/verify/${SERVER_SESSION}`
      })}`
    })
    return { presented }
  } catch (error) {
    return { presented, error }
  }
}

describe('attribute preflight in WaltIdCredentialProvider', () => {
  afterEach(() => {
    resetDebug()
    vi.restoreAllMocks()
  })

  it('presents a credential that has the attributes', async () => {
    const result = await present(deAsset(), [legalPerson(address('DE'))])
    expect(result.error).to.equal(undefined)
    expect(result.presented).to.equal(1)
  })

  it('refuses another value before anything is presented, naming the path, not the value', async () => {
    const { presented, error } = await present(deAsset(), [
      legalPerson(address(MARKER))
    ])

    expect(error).to.be.instanceOf(CredentialRejectedLocallyError)
    const rejected = error as CredentialRejectedLocallyError
    expect(rejected).to.include({
      policy: 'schema',
      reason: 'attribute-mismatch',
      credentialType: LEGAL_PERSON,
      serviceId: SERVICE_ID
    })
    expect(rejected.path).to.deep.equal(['credentialSubject', ...COUNTRY])
    expect(rejected.message).to.contain(
      '`credentialSubject.gx:legalAddress.gx:countryCode` of your `gx:LegalPerson` credential to be "DE" (`schema` policy)'
    )
    expect(rejected.message).to.contain('Nothing was ordered or paid.')
    expect(rejected.message).not.to.contain(MARKER)
    expect(JSON.stringify(rejected)).not.to.contain(MARKER)
    expect(presented).to.equal(0)
  })

  it('refuses a credential without the attribute, and one without its parent', async () => {
    for (const subject of [{ 'gx:legalAddress': {} }, {}]) {
      const { presented, error } = await present(deAsset(), [
        legalPerson(subject)
      ])
      expect((error as CredentialRejectedLocallyError).reason).to.equal(
        'attribute-mismatch'
      )
      expect((error as Error).message).to.match(/to be present.*has no `/)
      expect(presented).to.equal(0)
    }
  })

  it('refuses a value of another JSON type', async () => {
    const asset = gatedAsset(
      requireCredentialAttributes({}, LEGAL_PERSON, [
        { path: ['gx:employees'], equals: 10 }
      ])
    )
    const { error } = await present(asset, [
      legalPerson({ 'gx:employees': '10' })
    ])
    expect((error as CredentialRejectedLocallyError).reason).to.equal(
      'attribute-mismatch'
    )
  })

  it('reads a VCDM 1.1 credential from its vc claim, as walt.id does', async () => {
    expect(
      (await present(deAsset(), [legalPersonV1(address('DE'))])).presented
    ).to.equal(1)
    expect(
      (
        (await present(deAsset(), [legalPersonV1(address('FR'))]))
          .error as Error
      ).name
    ).to.equal('CredentialRejectedLocallyError')
  })

  it('checks oneOf and exists', async () => {
    const asset = gatedAsset(
      requireCredentialAttributes({}, LEGAL_PERSON, [
        { path: COUNTRY, oneOf: ['AT', 'DE'] },
        { path: ['gx:legalName'], exists: true }
      ])
    )

    expect(
      (
        await present(asset, [
          legalPerson({ ...address('AT'), 'gx:legalName': 'x' })
        ])
      ).presented
    ).to.equal(1)
    const { error } = await present(asset, [legalPerson(address('AT'))])
    expect((error as CredentialRejectedLocallyError).path).to.deep.equal([
      'credentialSubject',
      'gx:legalName'
    ])
    expect((error as Error).message).not.to.contain('"AT"')
  })

  it('does not check a credential whose walt.id type (its last) is another: walt.id does not either', async () => {
    const types = ['VerifiableCredential', LEGAL_PERSON, 'gx:Other']
    const credential = {
      id: 'credential-1',
      document: jwt({
        iss: TRUSTED,
        type: types,
        credentialSubject: address('FR')
      }),
      parsedDocument: { type: types }
    } as WaltIdCredential

    const result = await present(deAsset(), [credential])
    expect(result.error).to.equal(undefined)
    expect(result.presented).to.equal(1)
  })

  it('follows walt.id when a type is requested twice: the last non-empty policy list wins', async () => {
    // Asset-level schema, service-level issuer trust: walt.id runs only the issuer trust.
    const asset = gatedAsset(
      requireCredentialAttributes({}, LEGAL_PERSON, DE),
      trustIssuers({}, LEGAL_PERSON, [TRUSTED])
    )
    expect((await present(asset, [legalPerson(address('FR'))])).error).to.equal(
      undefined
    )
  })

  it('skips a schema outside the evaluated subset, at debug', async () => {
    const asset = gatedAsset(
      addRequestCredentials({}, ALLOW, [
        {
          type: LEGAL_PERSON,
          format: 'jwt_vc_json',
          policies: [
            {
              policy: 'schema',
              args: {
                type: 'object',
                properties: {
                  credentialSubject: {
                    type: 'object',
                    properties: { 'gx:legalName': { pattern: '^Z' } }
                  }
                }
              }
            }
          ]
        }
      ])
    )
    const seen: LogEvent[] = []
    configureLogging({ level: 'debug', sink: (event) => seen.push(event) })

    const result = await present(asset, [legalPerson({ 'gx:legalName': 'A' })])

    expect(result.presented).to.equal(1)
    const skipped = seen.find(
      (event) => event.event === 'identity.preflight.schema_skipped'
    )
    expect(skipped?.level).to.equal('debug')
    expect(skipped?.fields).to.include({ keyword: 'pattern' })
  })

  it('never judges a credential it cannot decode', async () => {
    const seen: LogEvent[] = []
    configureLogging({ level: 'debug', sink: (event) => seen.push(event) })
    const result = await present(deAsset(), [
      { ...legalPerson(address('FR')), document: 'not-a-jwt' }
    ])

    expect(result.presented).to.equal(1)
    expect(
      seen.find((event) => event.event === 'identity.preflight.skipped')?.fields
        ?.policy
    ).to.equal('schema')
  })

  it('quotes no control characters from the asset, in the message or the path', async () => {
    const asset = gatedAsset(
      requireCredentialAttributes({}, LEGAL_PERSON, [
        { path: ['gx:legal\u001b[31mAddress'], equals: 'DE\u001b[0m' }
      ])
    )
    const { error } = await present(asset, [legalPerson({})])

    expect((error as Error).message).not.to.contain('\u001b')
    expect(
      JSON.stringify((error as CredentialRejectedLocallyError).path)
    ).not.to.contain('\\u001b')
  })

  it('presents anyway with preflight: false', async () => {
    const result = await present(deAsset(), [legalPerson(address('FR'))], {
      preflight: false
    })
    expect(result.presented).to.equal(1)
  })

  it('logs the value nowhere but the sensitive debug tier', async () => {
    const seen: LogEvent[] = []
    configureLogging({ level: 'trace', sink: (event) => seen.push(event) })
    resetDebug({})
    await present(deAsset(), [legalPerson(address(MARKER))])
    expect(JSON.stringify(seen)).not.to.contain(MARKER)

    const debugEvents: DebugEvent[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    setDebug({
      level: 'sensitive',
      sink: (event) => debugEvents.push(event)
    })
    await present(deAsset(), [legalPerson(address(MARKER))])
    expect(JSON.stringify(debugEvents)).to.contain(MARKER)
  })

  it('is exported from the package', () => {
    expect(nautilus.credentialAttributeSchema).to.equal(
      credentialAttributeSchema
    )
    expect(nautilus.evaluateAttributeSchema).to.equal(evaluateAttributeSchema)
    expect(nautilus.requireCredentialAttributes).to.equal(
      requireCredentialAttributes
    )
    expect(nautilus.trustIssuers).to.equal(trustIssuers)
    expect(nautilus.setRequestCredentials).to.equal(setRequestCredentials)
  })
})

describe('evaluateAttributeSchema', () => {
  it('agrees with the fixture credentials: DE passes, FR and missing fail', () => {
    const data = (subject: Record<string, unknown>) => ({
      type: ['VerifiableCredential', LEGAL_PERSON],
      credentialSubject: subject
    })
    expect(
      evaluateAttributeSchema(DE_SCHEMA_FIXTURE, data(address('DE')))
    ).to.deep.equal({ outcome: 'pass' })
    expect(
      evaluateAttributeSchema(DE_SCHEMA_FIXTURE, data(address('FR')))
    ).to.deep.equal({
      outcome: 'fail',
      path: ['credentialSubject', ...COUNTRY],
      kind: 'mismatch',
      expected: ['DE']
    })
    expect(evaluateAttributeSchema(DE_SCHEMA_FIXTURE, data({}))).to.deep.equal({
      outcome: 'fail',
      path: ['credentialSubject', 'gx:legalAddress'],
      kind: 'missing'
    })
    expect(evaluateAttributeSchema(DE_SCHEMA_FIXTURE, {})).to.include({
      outcome: 'fail',
      kind: 'missing'
    })
  })

  it('handles types, enums of objects, boolean schemas and annotations', () => {
    expect(evaluateAttributeSchema({ type: 'integer' }, 1.5)).to.include({
      outcome: 'fail',
      kind: 'type'
    })
    expect(
      evaluateAttributeSchema({ type: ['string', 'null'] }, null)
    ).to.deep.equal({ outcome: 'pass' })
    expect(
      evaluateAttributeSchema({ enum: [{ a: 1, b: [2] }] }, { b: [2], a: 1 })
    ).to.deep.equal({ outcome: 'pass' })
    expect(evaluateAttributeSchema(false, 'x')).to.include({ outcome: 'fail' })
    expect(
      evaluateAttributeSchema(
        {
          $schema: 'http://json-schema.org/draft-07/schema#',
          title: 't',
          const: 'x'
        },
        'x'
      )
    ).to.deep.equal({ outcome: 'pass' })
    // `required` and `properties` apply to objects only, as in JSON Schema.
    expect(evaluateAttributeSchema({ required: ['a'] }, 'x')).to.deep.equal({
      outcome: 'pass'
    })
  })

  it('reports a keyword outside the subset anywhere, even on a branch the data never reaches', () => {
    for (const [schema, keyword] of [
      [{ allOf: [] }, 'allOf'],
      [{ properties: { x: { minLength: 1 } } }, 'minLength'],
      [{ $ref: '#/definitions/x' }, '$ref'],
      [{ type: 'date' }, 'type'],
      ['string', '(not a schema)']
    ] as const)
      expect(evaluateAttributeSchema(schema, {})).to.deep.equal({
        outcome: 'unsupported',
        keyword
      })
  })

  it('does not reach the prototype', () => {
    expect(evaluateAttributeSchema({ required: ['toString'] }, {})).to.include({
      outcome: 'fail',
      kind: 'missing'
    })
  })
})

// #endregion
