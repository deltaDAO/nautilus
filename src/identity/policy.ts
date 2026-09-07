/**
 * Building and reading the on-chain `SSIpolicy` credential block.
 *
 * The shape here follows the running stack, not the `@oceanprotocol/ddo-js` types. See
 * `../ddo/types` for why, and `policy-server/src/handlers/waltIdPolicyHandler.ts`
 * (`parseRequestCredentials`, `hasSSIPolicyToBeChecked`) for the parser this must satisfy.
 */
import type {
  AddressCredential,
  CredentialListTypes,
  DdoCredential,
  DdoCredentials,
  RequestCredential,
  SsiPolicyCredential,
  SsiPolicyValue,
  VcPolicy,
  VpPolicy
} from '../ddo/types.js'

/** The policy server's own defaults, from `policy-server/default-verification-policies`. */
export const DEFAULT_VC_POLICIES: VcPolicy[] = [
  'signature',
  'not-before',
  'revoked-status-list'
]

export function isSsiPolicyCredential(
  credential: DdoCredential
): credential is SsiPolicyCredential {
  return credential.type === 'SSIpolicy'
}

export function isAddressCredential(
  credential: DdoCredential
): credential is AddressCredential {
  return credential.type === 'address'
}

/**
 * Adds request credentials and policies to one list, merging into an existing `SSIpolicy`
 * entry rather than appending a second one — the policy server merges asset- and
 * service-level entries, but two entries in the same list is needless ambiguity.
 */
export function addRequestCredentials(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  requestCredentials: RequestCredential[],
  policies: { vcPolicies?: VcPolicy[]; vpPolicies?: VpPolicy[] } = {}
): DdoCredentials {
  const entries = credentials[list] || []
  const existing = entries.find(isSsiPolicyCredential)

  const value: SsiPolicyValue = existing?.values?.[0] || {
    request_credentials: []
  }

  value.request_credentials = dedupeRequestCredentials([
    ...(value.request_credentials || []),
    ...requestCredentials
  ])

  // Always arrays: the policy server's scalar fallback reads a typo'd `v_cpolicies`, so a
  // bare string is silently dropped.
  if (policies.vcPolicies)
    value.vc_policies = dedupe([
      ...(value.vc_policies || []),
      ...policies.vcPolicies
    ])

  if (policies.vpPolicies)
    value.vp_policies = dedupeVpPolicies([
      ...(value.vp_policies || []),
      ...policies.vpPolicies
    ])

  if (existing) existing.values = [value]
  else entries.push({ type: 'SSIpolicy', values: [value] })

  return { ...credentials, [list]: entries }
}

/** Replaces the VC policies on the given list's `SSIpolicy` entry. */
export function setVcPolicies(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  vcPolicies: VcPolicy[]
): DdoCredentials {
  return addRequestCredentials(credentials, list, [], { vcPolicies })
}

/** Replaces the VP policies on the given list's `SSIpolicy` entry. */
export function setVpPolicies(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  vpPolicies: VpPolicy[]
): DdoCredentials {
  return addRequestCredentials(credentials, list, [], { vpPolicies })
}

/**
 * Adds addresses to the `type: 'address'` entry of one list.
 *
 * Written as `{ address }` objects: the policy server's `extractAddressList` accepts bare
 * strings too, but every producer in the stack writes objects, so nautilus matches them.
 */
export function addCredentialAddresses(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  addresses: string[]
): DdoCredentials {
  const entries = credentials[list] || []
  const existing = entries.find(isAddressCredential)

  const merged = dedupe([
    ...(existing?.values || []).map((value) => value.address),
    ...addresses
  ])

  if (existing) existing.values = merged.map((address) => ({ address }))
  else
    entries.push({
      type: 'address',
      values: merged.map((address) => ({ address }))
    })

  return { ...credentials, [list]: entries }
}

/** Removes addresses, dropping the whole entry when its list becomes empty. */
export function removeCredentialAddresses(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  addresses: string[]
): DdoCredentials {
  const entries = credentials[list] || []
  const index = entries.findIndex(isAddressCredential)

  if (index === -1) return credentials

  const removed = new Set(addresses.map((address) => address.toLowerCase()))
  const remaining = (entries[index] as AddressCredential).values.filter(
    (value) => !removed.has(value.address.toLowerCase())
  )

  if (remaining.length) (entries[index] as AddressCredential).values = remaining
  else entries.splice(index, 1)

  return { ...credentials, [list]: entries }
}

/** Adds an on-chain access-list credential. */
export function addCredentialAccessList(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  accessList: { chainId: number; accessList: string }
): DdoCredentials {
  const entries = credentials[list] || []

  entries.push({ type: 'accessList', ...accessList })

  return { ...credentials, [list]: entries }
}

/**
 * Whether a presentation is actually required.
 *
 * Mirrors the policy server's `hasSSIPolicyToBeChecked`: asset- and service-level entries
 * are merged, and gating applies only if some entry carries a non-empty
 * `request_credentials`. An `SSIpolicy` entry with no credentials is a configuration error
 * on the publisher's side (the server answers `CREDENTIAL_FETCH_FAILED`).
 */
export function requiresPresentation(
  assetCredentials: DdoCredentials | undefined,
  serviceCredentials?: DdoCredentials
): boolean {
  const entries = [
    ...(assetCredentials?.allow || []),
    ...(serviceCredentials?.allow || [])
  ].filter(isSsiPolicyCredential)

  return entries.some((entry) =>
    (entry.values || []).some(
      (value) => (value.request_credentials || []).length > 0
    )
  )
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function dedupeVpPolicies(policies: VpPolicy[]): VpPolicy[] {
  const seen = new Set<string>()

  return policies.filter((policy) => {
    const key = JSON.stringify(policy)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dedupeRequestCredentials(
  requestCredentials: RequestCredential[]
): RequestCredential[] {
  const seen = new Set<string>()

  return requestCredentials.filter((credential) => {
    const key = JSON.stringify({
      type: credential.type,
      format: credential.format,
      policies: credential.policies
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
