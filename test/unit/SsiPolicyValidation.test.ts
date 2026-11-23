import { describe, expect, it } from 'vitest'
import type { SsiPolicyV2Value } from '../../src/ddo/types.js'
import { addSsiPolicyV2 } from '../../src/identity/ssi.js'

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
