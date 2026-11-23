import { describe, expect, it } from 'vitest'
import type { SsiPolicyV2Value } from '../../src/ddo/types.js'
import {
  addSsiPolicyV2,
  validateSsiPolicyV2Value
} from '../../src/identity/ssi.js'

describe('SSIpolicyV2 entry validation', () => {
  it('checks the size of the whole entry after deduplicating values', () => {
    const largeValue = (id: string): SsiPolicyV2Value => ({
      version: '2',
      dcql: { credentials: [{ id, format: 'dc+sd-jwt' }] },
      vcPolicies: [
        {
          policy: 'json_schema',
          schema: { description: 'x'.repeat(140 * 1024) }
        }
      ]
    })
    const value = largeValue('first')
    const credentials = addSsiPolicyV2({}, value)
    expect(addSsiPolicyV2(credentials, value)).toEqual(credentials)
    expect(() => addSsiPolicyV2(credentials, largeValue('second'))).toThrow(
      /entry is larger than 256 KiB/
    )
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
