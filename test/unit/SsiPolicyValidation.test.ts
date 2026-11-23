import { describe, expect, it } from 'vitest'
import type { DdoCredentials, SsiPolicyV2Value } from '../../src/ddo/types.js'
import {
  addSsiPolicyV2,
  validateSsiPolicyCombination,
  validateSsiPolicyV2Value
} from '../../src/identity/ssi.js'

describe('SSIpolicyV2 entry validation', () => {
  it('rejects SSI deny entries on the asset or service', () => {
    const valid: DdoCredentials = {
      deny: [{ type: 'address', values: ['0x1'] }]
    }
    expect(() => validateSsiPolicyCombination(valid, valid)).not.toThrow()
    for (const type of ['SSIpolicyV2', 'SSIpolicy'] as const) {
      const invalid = { deny: [{ type, values: [] }] }
      expect(() => validateSsiPolicyCombination(invalid, valid)).toThrow(
        /credentials\.deny/
      )
      expect(() => validateSsiPolicyCombination(valid, invalid)).toThrow(
        /credentials\.deny/
      )
    }
  })

  it('limits raw SSI values across entries separately for each block', () => {
    const value: SsiPolicyV2Value = {
      version: '2',
      dcql: { credentials: [] },
      gaiax: { requireCompliance: true }
    }
    const block = {
      allow: [
        { type: 'SSIpolicyV2', values: Array(10).fill(value) },
        {
          type: 'SSIpolicy',
          values: Array(10).fill({
            request_credentials: [{ type: 'pid', format: 'vc+sd-jwt' }]
          })
        }
      ]
    } satisfies DdoCredentials
    expect(() => validateSsiPolicyCombination(block, block)).not.toThrow()
    expect(() => addSsiPolicyV2(block, value)).not.toThrow()
    expect(() => addSsiPolicyV2(block, { ...value, rego: [] })).toThrow(
      /too many SSI policies/
    )
    const overLimit: DdoCredentials = {
      allow: [...block.allow, { type: 'SSIpolicyV2', values: [value] }]
    }
    for (const blocks of [
      [block, overLimit],
      [overLimit, block]
    ])
      expect(() => validateSsiPolicyCombination(...blocks)).toThrow(
        /too many SSI policies/
      )
  })

  it('measures nesting from the assembled SSI entry in builders and preflight', () => {
    const metaAtEntryDepth = (depth: number) => {
      // entry.values[0].dcql.credentials[0].meta is already six levels deep.
      let meta = {}
      for (let i = 6; i < depth; i++) meta = { nested: meta }
      return meta
    }
    const policyAtEntryDepth = (depth: number): SsiPolicyV2Value => ({
      version: '2',
      dcql: {
        credentials: [
          { id: 'pid', format: 'dc+sd-jwt', meta: metaAtEntryDepth(depth) }
        ]
      }
    })
    const boundary = addSsiPolicyV2({}, policyAtEntryDepth(32))
    expect(() => validateSsiPolicyCombination(boundary)).not.toThrow()

    const overLimit = policyAtEntryDepth(33)
    expect(() => addSsiPolicyV2({}, overLimit)).toThrow(/nested too deeply/)
    expect(() =>
      validateSsiPolicyCombination({
        allow: [{ type: 'SSIpolicyV2', values: [overLimit] }]
      })
    ).toThrow(/nested too deeply/)
    const legacyValue = {
      request_credentials: [{ type: 'pid', format: 'vc+sd-jwt' }],
      extra: metaAtEntryDepth(40)
    }
    expect(() =>
      validateSsiPolicyCombination({
        allow: [{ type: 'SSIpolicy', values: [legacyValue] }]
      })
    ).toThrow(/nested too deeply/)
  })

  it('limits serialized inline schemas and status arguments in builders and preflight', () => {
    const limit = 16 * 1024 - JSON.stringify({ text: '' }).length
    for (const length of [limit, limit + 1]) {
      const argument = { text: 'é'.repeat(length) }
      const policies = [
        { policy: 'json_schema', schema: argument },
        { policy: 'status', argument }
      ] as const
      for (const policy of policies) {
        for (const list of [
          { vcPolicies: [policy] },
          { specificVcPolicies: { pid: [policy] } }
        ]) {
          const value: SsiPolicyV2Value = {
            version: '2',
            dcql: { credentials: [{ id: 'pid', format: 'dc+sd-jwt' }] },
            ...list
          }
          const stored: DdoCredentials = {
            allow: [{ type: 'SSIpolicyV2', values: [value] }]
          }
          for (const validate of [
            () => addSsiPolicyV2({}, value),
            () => validateSsiPolicyCombination(stored)
          ]) {
            if (length === limit) expect(validate).not.toThrow()
            else expect(validate).toThrow(/16 KiB/)
          }
        }
      }
    }
  })

  it('checks the size of the whole entry after deduplicating values', () => {
    const largeValue = (id: string): SsiPolicyV2Value => ({
      version: '2',
      dcql: { credentials: [{ id, format: 'dc+sd-jwt' }] },
      vcPolicies: Array.from({ length: 10 }, () => ({
        policy: 'json_schema',
        schema: { description: 'x'.repeat(14 * 1024) }
      }))
    })
    const value = largeValue('first')
    const credentials = addSsiPolicyV2({}, value)
    expect(addSsiPolicyV2(credentials, value)).toEqual(credentials)
    expect(() => addSsiPolicyV2(credentials, largeValue('second'))).toThrow(
      /entry is larger than 256 KiB/
    )
  })

  it('requires a nonempty values array on each stored V2 entry', () => {
    for (const values of [[], undefined, {}]) {
      const stored = {
        allow: [{ type: 'SSIpolicyV2', values }]
      } as DdoCredentials
      expect(() => validateSsiPolicyCombination(stored, {})).toThrow(
        /at least one value/
      )
      expect(() => validateSsiPolicyCombination({}, stored)).toThrow(
        /at least one value/
      )
    }
  })
})

describe('DCQL claims validation', () => {
  const validate = (query: Record<string, unknown>) =>
    validateSsiPolicyV2Value({
      version: '2',
      dcql: { credentials: [{ id: 'pid', format: 'dc+sd-jwt', ...query }] }
    })
  it('bounds the serialized query metadata', () => {
    const length = 8192 - JSON.stringify({ vct: '' }).length
    expect(() => validate({ meta: { vct: 'é'.repeat(length) } })).not.toThrow()
    expect(() => validate({ meta: { vct: 'x'.repeat(length + 1) } })).toThrow(
      /meta/
    )
  })

  it('checks the shape and limits of trusted authorities', () => {
    const authority = { type: 'aki', values: Array(50).fill('x') }
    expect(() =>
      validate({ trusted_authorities: Array(10).fill(authority) })
    ).not.toThrow()
    for (const trusted_authorities of [
      {},
      Array(11).fill(authority),
      [null],
      [{ values: ['x'] }],
      [{ ...authority, values: [] }],
      [{ ...authority, values: Array(51).fill('x') }],
      [{ ...authority, values: [1] }],
      [{ ...authority, values: ['x'.repeat(2049)] }]
    ])
      expect(() => validate({ trusted_authorities })).toThrow(
        /trusted_authorities/
      )
  })

  const claim = {
    id: 'age',
    path: ['person', null, 0],
    values: [42, true, 'unknown']
  }

  it('requires each claim-set reference to name a claim in the query', () => {
    expect(() =>
      validate({ claims: [claim], claim_sets: [['age']] })
    ).not.toThrow()
    for (const claim_sets of [[['typo']], [[]], Array(21).fill(['age'])])
      expect(() => validate({ claims: [claim], claim_sets })).toThrow(
        /claim_sets/
      )
    expect(() => validate({ claim_sets: [['age']] })).toThrow(/claim_sets/)
  })

  it('checks the claim id, path segments and accepted scalar values', () => {
    for (const override of [
      { id: 'has spaces' },
      { path: [''] },
      { path: ['x'.repeat(257)] },
      { values: [] },
      { values: Array(51).fill(1) },
      { values: [Infinity] },
      { values: [null] },
      { values: ['x'.repeat(1025)] }
    ])
      expect(() => validate({ claims: [{ ...claim, ...override }] })).toThrow(
        /claims\./
      )
  })
})

describe('merged SSI session limits', () => {
  const value = (count: number, prefix = 'q'): SsiPolicyV2Value => ({
    version: '2',
    dcql: {
      credentials: Array.from({ length: count }, (_, i) => ({
        id: prefix + i,
        format: 'dc+sd-jwt'
      }))
    }
  })
  const check = (...policies: SsiPolicyV2Value[]) =>
    validateSsiPolicyCombination(
      ...policies.map((policy) => addSsiPolicyV2({}, policy))
    )

  it('validates queries from an existing DDO before counting them', () => {
    const existing = value(1)
    existing.dcql.credentials[0].trusted_authorities = [
      { type: 'aki', values: [] }
    ]
    expect(() =>
      validateSsiPolicyCombination({
        allow: [{ type: 'SSIpolicyV2', values: [existing] }]
      })
    ).toThrow(/trusted_authorities/)
  })

  it('counts distinct parsed policies across asset and service even with overlapping query ids', () => {
    const asset = value(11)
    expect(() =>
      check(asset, { ...asset, rego: [], consumerBinding: false })
    ).not.toThrow()
    expect(() => check(asset, value(9))).not.toThrow()
    expect(() => check(asset, value(10))).toThrow(/too many credential queries/)
  })

  const legacy = (policy: unknown): DdoCredentials =>
    ({ allow: [{ type: 'SSIpolicy', values: [policy] }] }) as DdoCredentials
  const request = { type: 'pid', format: 'jwt_vc' }

  it('counts translated legacy requests alongside V2 queries in either block', () => {
    const asset = legacy({ request_credentials: request })
    const atLimit = addSsiPolicyV2({}, value(19))
    const overLimit = addSsiPolicyV2({}, value(20))
    expect(() => validateSsiPolicyCombination(asset, atLimit)).not.toThrow()
    expect(() => validateSsiPolicyCombination(asset, overLimit)).toThrow(
      /too many credential queries/
    )
    expect(() => validateSsiPolicyCombination(overLimit, asset)).toThrow(
      /too many credential queries/
    )
  })

  it('deduplicates equivalent translated requirements but counts repeated queries within one', () => {
    const requests = Array(11).fill(request)
    const asset = legacy({
      request_credentials: requests,
      vc_policies: ['expired']
    })
    const equivalent = {
      request_credentials: requests.map(() =>
        JSON.stringify({ ...request, format: 'jwt_vc_json' })
      ),
      vc_policies: 'expiration',
      vp_policies: ['holder-binding']
    }
    expect(() =>
      validateSsiPolicyCombination(asset, legacy(equivalent))
    ).not.toThrow()
    expect(() =>
      validateSsiPolicyCombination(
        asset,
        legacy({ ...equivalent, vc_policies: 'signature' })
      )
    ).toThrow(/too many credential queries/)
  })

  it('includes legacy SD-JWT requests in the Gaia-X session query budget', () => {
    const asset = legacy({
      request_credentials: { ...request, format: 'vc+sd-jwt' }
    })
    const service = (count: number) =>
      addSsiPolicyV2({}, { ...value(count), gaiax: { minLabelLevel: 'L1' } })
    expect(() => validateSsiPolicyCombination(asset, service(16))).not.toThrow()
    expect(() => validateSsiPolicyCombination(asset, service(17))).toThrow(
      /too many credential queries/
    )
  })

  it('counts translated dynamic rules and expands global rules when mixing formats', () => {
    const dynamic = JSON.stringify({
      policy: 'dynamic',
      args: { rules: { rego: 'allow := true' } }
    })
    const asset = (targeted: string[]) =>
      legacy({
        request_credentials: [{ ...request, policies: targeted }, request],
        vc_policies: [dynamic]
      })
    const service = addSsiPolicyV2(
      {},
      {
        ...value(18),
        rego: [
          { name: 'rule', code: 'allow := true' },
          { name: 'other', code: 'allow := true' },
          { name: 'targeted', code: 'allow := true', credentialId: 'q0' }
        ]
      }
    )
    // 37 V2 rules, two expansions of the legacy global rule, then targeted rules.
    expect(() =>
      validateSsiPolicyCombination(asset([dynamic]), service)
    ).not.toThrow()
    expect(() =>
      validateSsiPolicyCombination(asset([dynamic, dynamic]), service)
    ).toThrow(/too many rego policies/)
  })

  it('adds the Gaia-X queries once for the highest required level', () => {
    const baseline = { ...value(18), gaiax: { requireCompliance: true } }
    expect(() =>
      check(baseline, { ...value(0), gaiax: { minLabelLevel: 'SC' } })
    ).not.toThrow()
    expect(() =>
      check(baseline, { ...value(0), gaiax: { minLabelLevel: 'L1' } })
    ).toThrow(/too many credential queries/)
  })

  it('expands untargeted rego per query only when combining distinct policies', () => {
    const rego = { name: 'rule', code: 'package example\nallow := true' }
    const asset = { ...value(8), rego: Array(5).fill(rego) }
    expect(() => check({ ...asset, rego: Array(6).fill(rego) })).not.toThrow()
    expect(() => check(asset, value(1))).not.toThrow()
    expect(() => check(asset, { ...value(1), rego: [rego] })).toThrow(
      /too many rego policies/
    )
    expect(() =>
      check(
        {
          ...asset,
          rego: [...asset.rego.slice(1), { ...rego, credentialId: 'q0' }]
        },
        { ...value(1), rego: [rego] }
      )
    ).not.toThrow()
  })
})
