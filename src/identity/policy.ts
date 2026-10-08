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
  StoredRequestCredential,
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
 * entry rather than appending a second one.
 *
 * Additive throughout: everything already on the entry is kept. Use `setVcPolicies` /
 * `setVpPolicies` to replace a policy list outright.
 *
 * Each per-credential policy is stored JSON-encoded (see `StoredRequestCredential`).
 */
export function addRequestCredentials(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  requestCredentials: RequestCredential[],
  policies: { vcPolicies?: VcPolicy[]; vpPolicies?: VpPolicy[] } = {}
): DdoCredentials {
  return updateSsiPolicy(credentials, list, (value) => {
    value.request_credentials = dedupeRequestCredentials([
      ...(value.request_credentials || []),
      ...requestCredentials.map(encodeRequestCredential)
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
  })
}

/**
 * Replaces the VC policies on the given list's `SSIpolicy` entry, keeping its request
 * credentials.
 *
 * A genuine replacement, which routing this through `addRequestCredentials` was not: that
 * merges, so on an edited asset the policies the caller left out stayed in the document
 * and the checks they meant to remove went on running. Passing `[]` clears them.
 */
export function setVcPolicies(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  vcPolicies: VcPolicy[]
): DdoCredentials {
  return updateSsiPolicy(credentials, list, (value) => {
    value.vc_policies = dedupe(vcPolicies)
  })
}

/**
 * Replaces the VP policies on the given list's `SSIpolicy` entry, keeping its request
 * credentials. Passing `[]` clears them.
 */
export function setVpPolicies(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  vpPolicies: VpPolicy[]
): DdoCredentials {
  return updateSsiPolicy(credentials, list, (value) => {
    value.vp_policies = dedupeVpPolicies(vpPolicies)
  })
}

/**
 * Applies a change to one list's single `SSIpolicy` entry, creating it if needed.
 *
 * One entry per list: the policy server merges asset- and service-level entries, but two
 * entries in the same list is needless ambiguity.
 */
function updateSsiPolicy(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  mutate: (value: SsiPolicyValue) => void
): DdoCredentials {
  const entries = credentials[list] || []
  const existing = entries.find(isSsiPolicyCredential)

  const value: SsiPolicyValue = existing?.values?.[0] || {
    request_credentials: []
  }

  mutate(value)

  if (existing) existing.values = [value]
  else entries.push({ type: 'SSIpolicy', values: [value] })

  return { ...credentials, [list]: entries }
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

/**
 * Refuses to open a policy session that cannot be completed: the service asks for a
 * verifiable presentation (`requiresPresentation`) and no `CredentialProvider` is set to
 * make one.
 *
 * `PolicySessionResolver` calls this once it knows the node has a policy server, before
 * `initiate`, so nothing is signed, ordered or paid. A service gated by addresses only
 * needs no provider: the session `initiate` opens is all the node checks.
 */
export function assertPolicySatisfied(params: {
  did: string
  serviceId: string
  assetCredentials: DdoCredentials | undefined
  serviceCredentials: DdoCredentials | undefined
  /** Whether a `CredentialProvider` is set. */
  canPresent: boolean
}): void {
  if (params.canPresent) return

  if (!requiresPresentation(params.assetCredentials, params.serviceCredentials))
    return

  throw new Error(
    `Service ${params.serviceId} of ${params.did} requires a verifiable presentation, and no credential provider is set to make one. Pass a WaltIdCredentialProvider as \`credentials\` to Nautilus.create(), or call setCredentialProvider(). Nothing was ordered or paid.`
  )
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

/**
 * Normalises a credentials block read from a published DDO, so that writing it back
 * produces the form nautilus writes itself. Returns a deep copy.
 *
 * Assets published before VP policies were stored as objects can carry bare-string
 * `vp_policies` and raw (not JSON-encoded) per-credential policies. Left as they are, an
 * edit that adds an object policy would write a mixed array, which the node does not
 * index. Raw per-credential names were also dropped by the policy server, so encoding them
 * makes them take effect.
 *
 * Other producers can also write `{ policy }` objects into `vc_policies` (the policy
 * server reads only the name) and bare-string address `values`. Both are rewritten to the
 * single form nautilus writes, so every array stays one type and the address helpers can
 * read every entry.
 */
export function normalizeStoredCredentials(
  credentials: DdoCredentials
): DdoCredentials {
  const copy = structuredClone(credentials)

  for (const entry of [...(copy.allow || []), ...(copy.deny || [])]) {
    if (isAddressCredential(entry)) {
      if (Array.isArray(entry.values))
        entry.values = (entry.values as unknown[]).flatMap(readAddress)
      continue
    }

    if (!isSsiPolicyCredential(entry)) continue

    for (const value of entry.values || []) {
      if (value.vc_policies)
        value.vc_policies = dedupe(
          (value.vc_policies as unknown[]).flatMap(readVcPolicy)
        )

      if (value.vp_policies)
        value.vp_policies = dedupeVpPolicies(
          (value.vp_policies as unknown[]).flatMap(readVpPolicy)
        )

      if (value.request_credentials)
        value.request_credentials = value.request_credentials.map(
          (credential) =>
            credential.policies
              ? {
                  ...credential,
                  policies: (credential.policies as unknown[]).map(
                    readCredentialPolicy
                  )
                }
              : credential
        )
    }
  }

  return copy
}

/**
 * A stored address value as `{ address }`. The case is kept, as `addCredentialAddresses`
 * keeps it; removal compares case-insensitively.
 */
function readAddress(raw: unknown): { address: string }[] {
  if (typeof raw === 'string') return [{ address: raw }]

  const address = (raw as { address?: unknown } | null)?.address
  if (typeof address === 'string') return [{ address }]

  // Unusable: the policy server cannot match it either.
  return []
}

/** A stored VC policy as its name: the policy server reads only `policy` from an object. */
function readVcPolicy(raw: unknown): VcPolicy[] {
  if (typeof raw === 'string') return [raw]

  const policy = (raw as { policy?: unknown } | null)?.policy
  return typeof policy === 'string' ? [policy] : []
}

/** A stored VP policy in any form the stack has written, as a `VpPolicy`. */
function readVpPolicy(raw: unknown): VpPolicy[] {
  if (typeof raw === 'string') return [{ policy: raw }]

  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as { policy?: unknown }).policy === 'string'
  ) {
    const { policy, args } = raw as { policy: string; args?: unknown }
    if (args === undefined) return [{ policy }]

    return [
      { policy, args: typeof args === 'string' ? args : JSON.stringify(args) }
    ]
  }

  // Unusable: the policy server skips it too.
  return []
}

/**
 * A stored per-credential policy, JSON-encoded. A string that already parses to a name or
 * an object is kept; anything else is a raw name or object and is encoded.
 */
function readCredentialPolicy(raw: unknown): string {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'string' || (parsed && typeof parsed === 'object'))
        return raw
    } catch {
      // A raw policy name.
    }
  }

  return JSON.stringify(raw)
}

function encodeRequestCredential(
  credential: RequestCredential
): StoredRequestCredential {
  return {
    type: credential.type,
    ...(credential.format !== undefined && { format: credential.format }),
    ...(credential.policies && {
      policies: credential.policies.map((policy) => JSON.stringify(policy))
    })
  }
}

/** Deduplicates by value, writing each policy as a plain `{ policy, args? }` object. */
function dedupeVpPolicies(policies: VpPolicy[]): VpPolicy[] {
  const byKey = new Map<string, VpPolicy>()

  for (const { policy, args } of policies) {
    const key = JSON.stringify([policy, args ?? null])
    if (!byKey.has(key))
      byKey.set(key, args === undefined ? { policy } : { policy, args })
  }

  return [...byKey.values()]
}

function dedupeRequestCredentials(
  requestCredentials: StoredRequestCredential[]
): StoredRequestCredential[] {
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
