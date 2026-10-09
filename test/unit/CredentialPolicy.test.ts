import { describe, expect, it } from 'vitest'
import type {
  DdoCredentials,
  SsiPolicyCredential,
  VpPolicy
} from '../../src/ddo/types.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  addCredentialAccessList,
  addCredentialAddresses,
  addRequestCredentials,
  DEFAULT_VC_POLICIES,
  normalizeStoredCredentials,
  removeCredentialAddresses,
  requiresPresentation,
  setVcPolicies,
  setVpPolicies
} from '../../src/identity/policy.js'

const ALLOW = CredentialListTypes.ALLOW
const DENY = CredentialListTypes.DENY

function ssiEntry(
  credentials: DdoCredentials
): SsiPolicyCredential | undefined {
  return credentials.allow?.find((entry) => entry.type === 'SSIpolicy') as
    | SsiPolicyCredential
    | undefined
}

describe('SSI credential block', () => {
  it("uses type 'SSIpolicy', which is what the policy server parses", () => {
    // The ddo-js types declare `type: 'verifiableCredential'` with `requestCredentials`.
    // Nothing in the running stack reads that shape, so nautilus emits the one that works.
    const credentials = addRequestCredentials({}, ALLOW, [
      { type: 'UniversityDegree', format: 'jwt_vc_json' }
    ])

    const entry = ssiEntry(credentials)

    expect(entry?.type).to.equal('SSIpolicy')
    expect(entry?.values?.[0]?.request_credentials).to.deep.equal([
      { type: 'UniversityDegree', format: 'jwt_vc_json' }
    ])
  })

  it('merges into one SSIpolicy entry rather than appending a second', () => {
    let credentials = addRequestCredentials({}, ALLOW, [
      { type: 'VerifiableId' }
    ])
    credentials = addRequestCredentials(credentials, ALLOW, [
      { type: 'ProofOfResidence' }
    ])

    const ssiEntries = credentials.allow?.filter(
      (entry) => entry.type === 'SSIpolicy'
    )

    expect(ssiEntries).to.have.length(1)
    expect(ssiEntry(credentials)?.values[0].request_credentials).to.have.length(
      2
    )
  })

  it('deduplicates identical request credentials', () => {
    let credentials = addRequestCredentials({}, ALLOW, [
      { type: 'VerifiableId', format: 'jwt_vc_json' }
    ])
    credentials = addRequestCredentials(credentials, ALLOW, [
      { type: 'VerifiableId', format: 'jwt_vc_json' }
    ])

    expect(ssiEntry(credentials)?.values[0].request_credentials).to.have.length(
      1
    )
  })

  it('always writes vc_policies as an array', () => {
    // The policy server's non-array fallback reads a typo'd `v_cpolicies`, so a scalar
    // value is silently dropped and the policies simply never run.
    const credentials = setVcPolicies({}, ALLOW, DEFAULT_VC_POLICIES)

    expect(ssiEntry(credentials)?.values[0].vc_policies).to.be.an('array')
    expect(ssiEntry(credentials)?.values[0].vc_policies).to.deep.equal([
      'signature',
      'not-before',
      'revoked-status-list'
    ])
  })

  it('always writes vp_policies as an array, keeping parameterised entries', () => {
    const credentials = setVpPolicies({}, ALLOW, [
      { policy: 'holder-binding' },
      { policy: 'minimum-credentials', args: '1' }
    ])

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.deep.equal([
      { policy: 'holder-binding' },
      { policy: 'minimum-credentials', args: '1' }
    ])
  })

  it('replaces the vc policies instead of merging into them', () => {
    // These are `set`, not `add`. Routing them through addRequestCredentials merged, so on
    // an edited asset the policies the caller left out stayed in the document and the
    // checks they meant to remove went on running.
    let credentials = setVcPolicies({}, ALLOW, DEFAULT_VC_POLICIES)
    credentials = setVcPolicies(credentials, ALLOW, ['signature'])

    expect(ssiEntry(credentials)?.values[0].vc_policies).to.deep.equal([
      'signature'
    ])
  })

  it('keeps the request credentials it is not asked about', () => {
    let credentials = addRequestCredentials({}, ALLOW, [
      { type: 'UniversityDegree', format: 'jwt_vc_json' }
    ])
    credentials = setVcPolicies(credentials, ALLOW, ['signature'])

    expect(ssiEntry(credentials)?.values[0].request_credentials).to.deep.equal([
      { type: 'UniversityDegree', format: 'jwt_vc_json' }
    ])
  })

  it('clears the policies when given an empty list', () => {
    let credentials = setVcPolicies({}, ALLOW, DEFAULT_VC_POLICIES)
    credentials = setVcPolicies(credentials, ALLOW, [])

    expect(ssiEntry(credentials)?.values[0].vc_policies).to.deep.equal([])
  })

  it('replaces the vp policies too', () => {
    let credentials = setVpPolicies({}, ALLOW, [
      { policy: 'holder-binding' },
      { policy: 'minimum-credentials', args: '1' }
    ])
    credentials = setVpPolicies(credentials, ALLOW, [
      { policy: 'holder-binding' }
    ])

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.deep.equal([
      { policy: 'holder-binding' }
    ])
  })

  it('still merges policies passed through addRequestCredentials', () => {
    // The additive path keeps its behaviour: this is how asset- and service-level
    // policies accumulate as the builders are called.
    let credentials = addRequestCredentials({}, ALLOW, [], {
      vcPolicies: ['signature']
    })
    credentials = addRequestCredentials(credentials, ALLOW, [], {
      vcPolicies: ['not-before']
    })

    expect(ssiEntry(credentials)?.values[0].vc_policies).to.deep.equal([
      'signature',
      'not-before'
    ])
  })

  it('deduplicates vp policies by value, not by reference', () => {
    let credentials = setVpPolicies({}, ALLOW, [
      { policy: 'minimum-credentials', args: '1' }
    ])
    credentials = setVpPolicies(credentials, ALLOW, [
      { policy: 'minimum-credentials', args: '1' }
    ])

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.have.length(1)
  })
})

describe('an SSIpolicy entry with several values', () => {
  // The policy server merges every value of every SSIpolicy entry. Edits used to rewrite
  // only `values[0]`, dropping the request credentials of the others.
  function twoValues(): DdoCredentials {
    return {
      allow: [
        {
          type: 'SSIpolicy',
          values: [
            {
              request_credentials: [{ type: 'VerifiableId' }],
              vc_policies: ['signature']
            },
            {
              request_credentials: [{ type: 'ProofOfResidence' }],
              vc_policies: ['not-before'],
              vp_policies: [{ policy: 'holder-binding' }]
            }
          ]
        }
      ]
    }
  }

  it("keeps every value's request credentials, merged into one value", () => {
    const credentials = addRequestCredentials(twoValues(), ALLOW, [
      { type: 'LegalPerson' }
    ])

    expect(ssiEntry(credentials)?.values).to.deep.equal([
      {
        request_credentials: [
          { type: 'VerifiableId' },
          { type: 'ProofOfResidence' },
          { type: 'LegalPerson' }
        ],
        vc_policies: ['signature', 'not-before'],
        vp_policies: [{ policy: 'holder-binding' }]
      }
    ])
  })

  it('replaces policies across every value', () => {
    const credentials = setVcPolicies(twoValues(), ALLOW, [
      'revoked-status-list'
    ])

    expect(ssiEntry(credentials)?.values).to.have.length(1)
    expect(ssiEntry(credentials)?.values[0].vc_policies).to.deep.equal([
      'revoked-status-list'
    ])
    expect(ssiEntry(credentials)?.values[0].request_credentials).to.have.length(
      2
    )
  })

  it('merges a second SSIpolicy entry in the same list into the first', () => {
    const credentials = twoValues()
    credentials.allow?.push(
      { type: 'address', values: [{ address: '*' }] },
      {
        type: 'SSIpolicy',
        values: [{ request_credentials: [{ type: 'LegalPerson' }] }]
      }
    )

    const result = setVpPolicies(credentials, ALLOW, [])

    expect(result.allow?.map((entry) => entry.type)).to.deep.equal([
      'SSIpolicy',
      'address'
    ])
    expect(
      ssiEntry(result)?.values[0].request_credentials.map((c) => c.type)
    ).to.deep.equal(['VerifiableId', 'ProofOfResidence', 'LegalPerson'])
    expect(ssiEntry(result)?.values[0].vp_policies).to.deep.equal([])
  })
})

describe('VP policy input at runtime', () => {
  it('writes a bare name from an untyped caller as an object', () => {
    const credentials = setVpPolicies({}, ALLOW, [
      'holder-binding'
    ] as unknown as VpPolicy[])

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.deep.equal([
      { policy: 'holder-binding' }
    ])
  })

  it('refuses an entry it cannot read', () => {
    expect(() =>
      setVpPolicies({}, ALLOW, [null] as unknown as VpPolicy[])
    ).to.throw('Cannot read the VP policy null')
  })
})

describe('VP policies are stored as objects', () => {
  // ocean-node 4.2.x did not index an asset whose `vp_policies` mixed a name with an
  // object, so every entry is written as one.

  it('drops an undefined args key rather than writing it', () => {
    const credentials = setVpPolicies({}, ALLOW, [
      { policy: 'holder-binding', args: undefined }
    ])

    expect(ssiEntry(credentials)?.values[0].vp_policies?.[0]).to.deep.equal({
      policy: 'holder-binding'
    })
    expect(
      Object.keys(ssiEntry(credentials)?.values[0].vp_policies?.[0] || {})
    ).to.deep.equal(['policy'])
  })

  it('keeps entries that differ only in args apart', () => {
    const credentials = setVpPolicies({}, ALLOW, [
      { policy: 'minimum-credentials', args: '1' },
      { policy: 'minimum-credentials', args: '2' },
      { policy: 'minimum-credentials' }
    ])

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.have.length(3)
  })

  it('merges and deduplicates through addRequestCredentials', () => {
    let credentials = addRequestCredentials(
      {},
      ALLOW,
      [{ type: 'gx:LegalPerson', format: 'jwt_vc_json' }],
      { vpPolicies: [{ policy: 'holder-binding' }] }
    )
    credentials = addRequestCredentials(credentials, ALLOW, [], {
      vpPolicies: [
        { policy: 'holder-binding' },
        { policy: 'minimum-credentials', args: '1' }
      ]
    })

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.deep.equal([
      { policy: 'holder-binding' },
      { policy: 'minimum-credentials', args: '1' }
    ])
  })
})

describe('per-credential policies are stored JSON-encoded', () => {
  // The policy server JSON-parses each string and drops one that does not parse, so a bare
  // name was never enforced. The enterprise market writes `JSON.stringify(policy)`.

  it('encodes names and objects alike', () => {
    const credentials = addRequestCredentials({}, ALLOW, [
      {
        type: 'gx:LegalPerson',
        format: 'jwt_vc_json',
        policies: ['signature', { policy: 'allowed-issuer', args: ['did:x'] }]
      }
    ])

    expect(ssiEntry(credentials)?.values[0].request_credentials).to.deep.equal([
      {
        type: 'gx:LegalPerson',
        format: 'jwt_vc_json',
        policies: [
          '"signature"',
          '{"policy":"allowed-issuer","args":["did:x"]}'
        ]
      }
    ])
  })

  it('keeps an already encoded policy as it is, rather than encoding it twice', () => {
    const stored = addRequestCredentials({}, ALLOW, [
      { type: 'gx:LegalPerson', policies: ['signature', { policy: 'expired' }] }
    ])
    const [credential] = ssiEntry(stored)?.values[0].request_credentials ?? []

    const again = addRequestCredentials({}, ALLOW, [credential])

    expect(ssiEntry(again)?.values[0].request_credentials).to.deep.equal([
      {
        type: 'gx:LegalPerson',
        policies: ['"signature"', '{"policy":"expired"}']
      }
    ])
  })

  it('deduplicates a credential added twice with the same policies', () => {
    const request = {
      type: 'gx:LegalPerson',
      policies: ['signature']
    }
    let credentials = addRequestCredentials({}, ALLOW, [request])
    credentials = addRequestCredentials(credentials, ALLOW, [request])

    expect(ssiEntry(credentials)?.values[0].request_credentials).to.have.length(
      1
    )
  })
})

describe('normalizeStoredCredentials', () => {
  function legacy(value: Record<string, unknown>): DdoCredentials {
    return {
      allow: [{ type: 'SSIpolicy', values: [value] }]
    } as unknown as DdoCredentials
  }

  function vpPolicies(credentials: DdoCredentials) {
    return ssiEntry(credentials)?.values[0].vp_policies
  }

  it('turns a bare-string vp policy into an object', () => {
    const normalized = normalizeStoredCredentials(
      legacy({ request_credentials: [], vp_policies: ['holder-binding'] })
    )

    expect(vpPolicies(normalized)).to.deep.equal([{ policy: 'holder-binding' }])
  })

  it('keeps string args, and stringifies the rest as the policy server parses them', () => {
    const normalized = normalizeStoredCredentials(
      legacy({
        request_credentials: [],
        vp_policies: [
          { policy: 'minimum-credentials', args: '1' },
          { policy: 'maximum-credentials', args: 1 },
          { policy: 'presentation-definition', args: { a: [1, 'b'] } }
        ]
      })
    )

    expect(vpPolicies(normalized)).to.deep.equal([
      { policy: 'minimum-credentials', args: '1' },
      { policy: 'maximum-credentials', args: '1' },
      { policy: 'presentation-definition', args: '{"a":[1,"b"]}' }
    ])
  })

  it("deduplicates 'x' and { policy: 'x' } as one policy", () => {
    const normalized = normalizeStoredCredentials(
      legacy({
        request_credentials: [],
        vp_policies: ['holder-binding', { policy: 'holder-binding' }]
      })
    )

    expect(vpPolicies(normalized)).to.deep.equal([{ policy: 'holder-binding' }])
  })

  it('turns a mixed array into objects only', () => {
    const normalized = normalizeStoredCredentials(
      legacy({
        request_credentials: [],
        vp_policies: [
          'holder-binding',
          { policy: 'minimum-credentials', args: 1 }
        ]
      })
    )

    expect(vpPolicies(normalized)).to.deep.equal([
      { policy: 'holder-binding' },
      { policy: 'minimum-credentials', args: '1' }
    ])
  })

  it('refuses an unreadable vp policy rather than dropping it', () => {
    // The policy server fails on a null entry, so the asset denies everyone. Dropping it
    // would open the asset under the remaining policies after an unrelated edit.
    for (const entry of [null, 42, { args: '1' }])
      expect(() =>
        normalizeStoredCredentials(
          legacy({
            request_credentials: [],
            vp_policies: ['holder-binding', entry]
          })
        )
      ).to.throw(`Cannot read the VP policy ${JSON.stringify(entry)}`)
  })

  it('refuses an unreadable request credential or per-credential policy', () => {
    expect(() =>
      normalizeStoredCredentials(legacy({ request_credentials: [null] }))
    ).to.throw('Cannot read the request credential null')

    for (const policy of [null, 7, { args: 'x' }])
      expect(() =>
        normalizeStoredCredentials(
          legacy({
            request_credentials: [{ type: 'VerifiableId', policies: [policy] }]
          })
        )
      ).to.throw(
        `Cannot read the per-credential policy ${JSON.stringify(policy)}`
      )
  })

  it('wraps a single stored value in an array, as the policy server does', () => {
    const normalized = normalizeStoredCredentials(
      legacy({
        request_credentials: { type: 'VerifiableId', policies: 'signature' },
        vc_policies: 'signature',
        vp_policies: { policy: 'holder-binding' }
      })
    )

    expect(ssiEntry(normalized)?.values).to.deep.equal([
      {
        request_credentials: [
          { type: 'VerifiableId', policies: ['"signature"'] }
        ],
        vc_policies: ['signature'],
        vp_policies: [{ policy: 'holder-binding' }]
      }
    ])
  })

  it('skips entries and values that are not objects instead of throwing', () => {
    const input = {
      allow: [
        null,
        'address',
        { type: 'address', values: null },
        { type: 'SSIpolicy', values: [null, { request_credentials: null }] }
      ],
      deny: [null, { type: 'address', values: '0x1' }]
    } as unknown as DdoCredentials

    expect(normalizeStoredCredentials(input)).to.deep.equal({
      allow: [
        null,
        'address',
        { type: 'address', values: null },
        { type: 'SSIpolicy', values: [{ request_credentials: [] }] }
      ],
      deny: [null, { type: 'address', values: '0x1' }]
    })
  })

  it('encodes raw per-credential policies and keeps encoded ones as they are', () => {
    const normalized = normalizeStoredCredentials(
      legacy({
        request_credentials: [
          {
            type: 'gx:LegalPerson',
            policies: [
              'signature',
              '"not-before"',
              '{"policy":"allowed-issuer","args":"did:x"}',
              { policy: 'expired' }
            ]
          }
        ]
      })
    )

    expect(
      ssiEntry(normalized)?.values[0].request_credentials[0].policies
    ).to.deep.equal([
      '"signature"',
      '"not-before"',
      '{"policy":"allowed-issuer","args":"did:x"}',
      '{"policy":"expired"}'
    ])
  })

  it('returns a copy, leaving the input untouched', () => {
    const input = legacy({
      request_credentials: [],
      vp_policies: ['holder-binding']
    })
    const before = structuredClone(input)

    normalizeStoredCredentials(input)

    expect(input).to.deep.equal(before)
  })

  it('turns object vc policies into names, deduplicated', () => {
    const normalized = normalizeStoredCredentials(
      legacy({
        request_credentials: [],
        vc_policies: [
          'signature',
          { policy: 'signature' },
          { policy: 'not-before', args: 'x' },
          { args: 'x' },
          7
        ]
      })
    )

    expect(ssiEntry(normalized)?.values[0].vc_policies).to.deep.equal([
      'signature',
      'not-before'
    ])
  })

  it('leaves address entries as stored, bare strings included', () => {
    // Upstream ocean-node 4.2.0's built-in check reads only bare strings: rewriting a list
    // the edit does not touch would break its gate there.
    const input = {
      allow: [{ type: 'address', values: ['0xAbC', { address: '0x2' }, 5] }],
      deny: [{ type: 'address', values: ['0xDeF'] }]
    } as unknown as DdoCredentials

    expect(normalizeStoredCredentials(input)).to.deep.equal(input)
  })

  it('leaves non-SSI entries and match rules alone', () => {
    const input: DdoCredentials = {
      allow: [{ type: 'address', values: [{ address: '*' }] }],
      deny: [],
      match_deny: 'any'
    }

    expect(normalizeStoredCredentials(input)).to.deep.equal(input)
  })
})

describe('address credentials', () => {
  it('writes addresses as objects, matching every other producer in the stack', () => {
    const credentials = addCredentialAddresses({}, ALLOW, ['0xAbC'])

    expect(credentials.allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0xAbC' }]
    })
  })

  it('merges into the existing address entry and deduplicates', () => {
    let credentials = addCredentialAddresses({}, ALLOW, ['0x1'])
    credentials = addCredentialAddresses(credentials, ALLOW, ['0x2', '0x1'])

    expect(credentials.allow).to.have.length(1)
    expect(credentials.allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0x1' }, { address: '0x2' }]
    })
  })

  it('keeps allow and deny lists independent', () => {
    let credentials = addCredentialAddresses({}, ALLOW, ['0x1'])
    credentials = addCredentialAddresses(credentials, DENY, ['0x2'])

    expect(credentials.allow).to.have.length(1)
    expect(credentials.deny).to.have.length(1)
  })

  it('removes addresses case-insensitively', () => {
    let credentials = addCredentialAddresses({}, ALLOW, ['0xAbCdEf', '0x2'])
    credentials = removeCredentialAddresses(credentials, ALLOW, ['0xabcdef'])

    expect(credentials.allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0x2' }]
    })
  })

  it('keeps an emptied allow entry, which denies everyone', () => {
    // The node and the policy server read an empty address allow list as deny-all.
    // Dropping the entry instead lifted the address gate.
    let credentials = addCredentialAddresses({}, ALLOW, ['0x1', '0x2'])
    credentials = removeCredentialAddresses(credentials, ALLOW, ['0x1', '0x2'])

    expect(credentials.allow).to.deep.equal([{ type: 'address', values: [] }])
  })

  it('drops an emptied deny entry, which denies no one', () => {
    let credentials = addCredentialAddresses({}, DENY, ['0x1'])
    credentials = removeCredentialAddresses(credentials, DENY, ['0x1'])

    expect(credentials.deny).to.deep.equal([])
  })

  it('keeps an entry stored as bare strings in that form', () => {
    // Before, `addCredentialAddresses` wrote `{ address: undefined }` for each string and
    // `removeCredentialAddresses` threw on `.toLowerCase()`. Upstream ocean-node 4.2.0
    // without a policy server reads only bare strings.
    const stored = () =>
      ({
        allow: [{ type: 'address', values: ['0xAbC', '0x2'] }]
      }) as unknown as DdoCredentials

    expect(
      addCredentialAddresses(stored(), ALLOW, ['0x3']).allow
    ).to.deep.equal([{ type: 'address', values: ['0xAbC', '0x2', '0x3'] }])
    expect(
      removeCredentialAddresses(stored(), ALLOW, ['0xabc']).allow
    ).to.deep.equal([{ type: 'address', values: ['0x2'] }])
    expect(
      removeCredentialAddresses(stored(), ALLOW, ['0xabc', '0x2']).allow
    ).to.deep.equal([{ type: 'address', values: [] }])
  })

  it('writes objects to an entry stored empty or without an array', () => {
    for (const values of [[], null]) {
      const stored = {
        allow: [{ type: 'address', values }]
      } as unknown as DdoCredentials

      expect(
        addCredentialAddresses(stored, ALLOW, ['0x1']).allow
      ).to.deep.equal([{ type: 'address', values: [{ address: '0x1' }] }])
    }
  })

  it('reads a mixed entry in both forms, writing it back as objects', () => {
    const stored = () =>
      ({
        allow: [{ type: 'address', values: ['0xAbC', { address: '0x2' }, 5] }],
        deny: [{ type: 'address', values: ['0xDeF', { address: '0x4' }] }]
      }) as unknown as DdoCredentials

    expect(
      addCredentialAddresses(stored(), ALLOW, ['0x2', '0x3']).allow
    ).to.deep.equal([
      {
        type: 'address',
        values: [{ address: '0xAbC' }, { address: '0x2' }, { address: '0x3' }]
      }
    ])

    // Every other deny address is kept: none is lost to the change of form.
    expect(
      removeCredentialAddresses(stored(), DENY, ['0xdef']).deny
    ).to.deep.equal([{ type: 'address', values: [{ address: '0x4' }] }])
    expect(
      removeCredentialAddresses(stored(), ALLOW, ['0x2']).allow
    ).to.deep.equal([{ type: 'address', values: [{ address: '0xAbC' }] }])
  })

  it('leaves a stored entry without the address as it is', () => {
    const stored = {
      allow: [{ type: 'address', values: null }],
      deny: [{ type: 'address', values: ['0x2', 5] }]
    } as unknown as DdoCredentials

    expect(
      removeCredentialAddresses(stored, ALLOW, ['0x1']).allow
    ).to.deep.equal([{ type: 'address', values: null }])
    expect(removeCredentialAddresses(stored, DENY, ['0x1']).deny).to.deep.equal(
      [{ type: 'address', values: ['0x2', 5] }]
    )
  })

  it('removes an address from every address entry of the list', () => {
    // The policy server reads them as one list: left in a second entry, the address would
    // stay allowed.
    const stored = () =>
      ({
        allow: [
          { type: 'address', values: [{ address: '0xA' }, { address: '0xB' }] },
          { type: 'address', values: ['0xb', '0xC'] }
        ],
        deny: [
          { type: 'address', values: ['0xD'] },
          { type: 'address', values: ['0xd', '0xE'] }
        ]
      }) as unknown as DdoCredentials

    expect(
      removeCredentialAddresses(stored(), ALLOW, ['0xB']).allow
    ).to.deep.equal([
      { type: 'address', values: [{ address: '0xA' }] },
      { type: 'address', values: ['0xC'] }
    ])
    // An emptied deny entry is dropped, the other keeps what it still denies.
    expect(
      removeCredentialAddresses(stored(), DENY, ['0xD']).deny
    ).to.deep.equal([{ type: 'address', values: ['0xE'] }])
  })

  it('is a no-op when removing from a list with no address entry', () => {
    const credentials = removeCredentialAddresses({}, ALLOW, ['0x1'])

    expect(credentials).to.deep.equal({})
  })

  it('keeps an SSIpolicy entry alongside an address entry', () => {
    let credentials = addRequestCredentials({}, ALLOW, [
      { type: 'VerifiableId' }
    ])
    credentials = addCredentialAddresses(credentials, ALLOW, ['*'])

    expect(credentials.allow?.map((entry) => entry.type)).to.deep.equal([
      'SSIpolicy',
      'address'
    ])
  })
})

describe('access list credentials', () => {
  it('adds an on-chain access list entry', () => {
    const credentials = addCredentialAccessList({}, ALLOW, {
      chainId: 32456,
      accessList: '0xList'
    })

    expect(credentials.allow?.[0]).to.deep.equal({
      type: 'accessList',
      chainId: 32456,
      accessList: '0xList'
    })
  })
})

describe('requiresPresentation', () => {
  it('is false with no credentials at all', () => {
    expect(requiresPresentation(undefined)).to.equal(false)
  })

  it('is false when only addresses gate the asset', () => {
    expect(
      requiresPresentation(addCredentialAddresses({}, ALLOW, ['0x1']))
    ).to.equal(false)
  })

  it('is true when request credentials are demanded', () => {
    const credentials = addRequestCredentials({}, ALLOW, [
      { type: 'VerifiableId' }
    ])

    expect(requiresPresentation(credentials)).to.equal(true)
  })

  it('is true when only the service demands credentials', () => {
    // Gating is per service as well as per asset, and the policy server merges both.
    const serviceCredentials = addRequestCredentials({}, ALLOW, [
      { type: 'VerifiableId' }
    ])

    expect(requiresPresentation({}, serviceCredentials)).to.equal(true)
  })

  it('is false for an SSIpolicy entry that demands nothing', () => {
    // The policy server treats this as a publisher misconfiguration and answers
    // CREDENTIAL_FETCH_FAILED, so nautilus must not report it as "gated".
    const credentials: DdoCredentials = {
      allow: [{ type: 'SSIpolicy', values: [{ request_credentials: [] }] }]
    }

    expect(requiresPresentation(credentials)).to.equal(false)
  })
})
