import { describe, expect, it } from 'vitest'
import type {
  DdoCredentials,
  SsiPolicyCredential
} from '../../src/ddo/types.js'
import { CredentialListTypes } from '../../src/ddo/types.js'
import {
  addCredentialAccessList,
  addCredentialAddresses,
  addRequestCredentials,
  DEFAULT_VC_POLICIES,
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
      'holder-binding',
      { policy: 'minimum-credentials', args: '1' }
    ])

    expect(ssiEntry(credentials)?.values[0].vp_policies).to.deep.equal([
      'holder-binding',
      { policy: 'minimum-credentials', args: '1' }
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
    let credentials = addCredentialAddresses({}, ALLOW, ['0xAbCdEf'])
    credentials = removeCredentialAddresses(credentials, ALLOW, ['0xabcdef'])

    expect(credentials.allow).to.have.length(0)
  })

  it('drops the whole entry when its last address is removed', () => {
    let credentials = addCredentialAddresses({}, ALLOW, ['0x1', '0x2'])
    credentials = removeCredentialAddresses(credentials, ALLOW, ['0x1'])

    expect(credentials.allow?.[0]).to.deep.equal({
      type: 'address',
      values: [{ address: '0x2' }]
    })

    credentials = removeCredentialAddresses(credentials, ALLOW, ['0x2'])

    expect(credentials.allow).to.have.length(0)
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
