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
  // Null-safe: a stored list can hold entries that are not objects.
  return credential?.type === 'SSIpolicy'
}

export function isAddressCredential(
  credential: DdoCredential
): credential is AddressCredential {
  return credential?.type === 'address'
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
 * One entry with one value per list. The policy server merges every value of every
 * `SSIpolicy` entry (asset and service level), so existing entries and values are merged
 * into one first: changing only the first value dropped the request credentials of the
 * others, and a replacement such as `setVcPolicies` left their policies running.
 */
function updateSsiPolicy(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  mutate: (value: SsiPolicyValue) => void
): DdoCredentials {
  const entries = credentials[list] || []
  const ssiEntries = entries.filter(isSsiPolicyCredential)
  const [existing, ...others] = ssiEntries

  const value = mergeSsiValues(
    ssiEntries.flatMap((entry) => toArray(entry.values))
  )

  mutate(value)

  if (existing) existing.values = [value]
  else entries.push({ type: 'SSIpolicy', values: [value] })

  return {
    ...credentials,
    [list]: others.length
      ? entries.filter(
          (entry) => !isSsiPolicyCredential(entry) || entry === existing
        )
      : entries
  }
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
 * Whether the configured provider should be consulted for this call.
 *
 * `skipCredentials` skips the *presentation*, not the provider: one that simply replays a
 * session the caller already holds (`StaticCredentialProvider`) has no flow to skip, and
 * bypassing it threw away the very session the flag exists to reuse.
 */
export function shouldResolveCredentials(
  credentials: { interactive?: boolean } | undefined,
  skip?: boolean
): boolean {
  if (!credentials) return false

  return !(skip && credentials.interactive !== false)
}

/**
 * Refuses to go on when a gated service has no verifier session behind it.
 *
 * This is what makes "credentials before spend" true rather than aspirational. Without it
 * a missing session surfaced only when the download URL was requested — after the order
 * had been placed and paid for — because an unresolved policy is indistinguishable from
 * "no gating applies" at the point where it is resolved.
 *
 * `skipped` is the deliberate escape hatch: ocean-node fails open when it has no
 * `POLICY_SERVER_URL`, so a DDO can declare policies that the deployment never enforces.
 * A caller who knows that is the case passes `skipCredentials` and takes the risk.
 */
export function assertPolicySatisfied(params: {
  did: string
  serviceId: string
  assetCredentials: DdoCredentials | undefined
  serviceCredentials: DdoCredentials | undefined
  resolved: unknown
  skipped?: boolean
}): void {
  if (params.resolved || params.skipped) return

  if (!requiresPresentation(params.assetCredentials, params.serviceCredentials))
    return

  throw new Error(
    `Service ${params.serviceId} of ${params.did} requires a verifiable presentation, but no verifier session could be resolved. Pass a CredentialProvider to Nautilus.create() — a WaltIdCredentialProvider to run the presentation, or a StaticCredentialProvider if you already hold a session id. Set skipCredentials to continue anyway (the node will refuse the request unless its policy server is disabled).`
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
 * read every entry. A single policy or request credential stored without its array is
 * wrapped in one, as the policy server does for `vp_policies`.
 *
 * Unusable addresses and VC policies are dropped, as the policy server skips them; an
 * allow entry left without addresses stays `values: []` and keeps denying everyone. An
 * unreadable VP policy, request credential or per-credential policy throws instead:
 * dropping it would leave the asset open under the remaining policies, where the policy
 * server today refuses or fails on it.
 */
export function normalizeStoredCredentials(
  credentials: DdoCredentials
): DdoCredentials {
  const copy = structuredClone(credentials)

  for (const list of [copy.allow, copy.deny]) {
    if (!Array.isArray(list)) continue

    // The guards skip entries that are not objects, which the stack cannot match either.
    for (const entry of list) {
      if (isAddressCredential(entry))
        // A non-array list holds no address the stack can match.
        entry.values = Array.isArray(entry.values)
          ? (entry.values as unknown[]).flatMap(readAddress)
          : []
      else if (isSsiPolicyCredential(entry))
        entry.values = toArray(entry.values)
          .filter(isObject)
          .map(normalizeSsiValue)
    }
  }

  return copy
}

/** Normalises one stored `SSIpolicy` value in place (see `normalizeStoredCredentials`). */
function normalizeSsiValue(raw: Record<string, unknown>): SsiPolicyValue {
  const value = raw as unknown as SsiPolicyValue

  if (raw.request_credentials !== undefined)
    value.request_credentials = toArray(raw.request_credentials).map(
      readRequestCredential
    )

  if (raw.vc_policies !== undefined)
    value.vc_policies = dedupe(toArray(raw.vc_policies).flatMap(readVcPolicy))

  if (raw.vp_policies !== undefined)
    value.vp_policies = dedupeVpPolicies(toArray(raw.vp_policies))

  return value
}

/**
 * Merges `SSIpolicy` values into one, as the policy server reads them: request
 * credentials and both policy lists are combined and deduplicated.
 */
function mergeSsiValues(values: unknown[]): SsiPolicyValue {
  const parts = values.filter(isObject).map(normalizeSsiValue)

  const merged: SsiPolicyValue = Object.assign({}, ...parts, {
    request_credentials: dedupeRequestCredentials(
      parts.flatMap((part) => part.request_credentials ?? [])
    )
  })

  if (parts.some((part) => part.vc_policies))
    merged.vc_policies = dedupe(parts.flatMap((part) => part.vc_policies ?? []))

  if (parts.some((part) => part.vp_policies))
    merged.vp_policies = dedupeVpPolicies(
      parts.flatMap((part) => part.vp_policies ?? [])
    )

  return merged
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

/** A VP policy in any form the stack has written, as a `VpPolicy`. Throws if unreadable. */
function readVpPolicy(raw: unknown): VpPolicy {
  if (typeof raw === 'string') return { policy: raw }

  if (isObject(raw) && typeof raw.policy === 'string') {
    const { policy, args } = raw
    if (args === undefined) return { policy }

    return {
      policy,
      args: typeof args === 'string' ? args : JSON.stringify(args)
    }
  }

  throw unreadable('VP policy', raw, 'a name or { policy, args? }')
}

/** A stored request credential, its per-credential policies JSON-encoded. */
function readRequestCredential(raw: unknown): StoredRequestCredential {
  if (!isObject(raw))
    throw unreadable('request credential', raw, '{ type, format?, policies? }')

  const credential = raw as unknown as StoredRequestCredential
  if (raw.policies === undefined) return credential

  return {
    ...credential,
    policies: toArray(raw.policies).map(readCredentialPolicy)
  }
}

/**
 * A per-credential policy, JSON-encoded. A string that already parses to a name or an
 * object is kept; any other string is a raw name and is encoded, as is a
 * `{ policy, args? }` object. The single encoder for builder input and stored policies, so
 * a stored policy passed back in is not encoded twice. Throws if unreadable.
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

    return JSON.stringify(raw)
  }

  if (isObject(raw) && typeof raw.policy === 'string')
    return JSON.stringify(raw)

  throw unreadable('per-credential policy', raw, 'a name or { policy, args? }')
}

function encodeRequestCredential(
  credential: RequestCredential
): StoredRequestCredential {
  return {
    type: credential.type,
    ...(credential.format !== undefined && { format: credential.format }),
    ...(credential.policies && {
      policies: credential.policies.map(readCredentialPolicy)
    })
  }
}

/**
 * Reads each VP policy (see `readVpPolicy`) and deduplicates by value, writing each as a
 * plain `{ policy, args? }` object. Takes `unknown[]` because callers outside TypeScript,
 * and stored DDOs, can hand it bare names or worse.
 */
function dedupeVpPolicies(policies: readonly unknown[]): VpPolicy[] {
  const byKey = new Map<string, VpPolicy>()

  for (const policy of policies.map(readVpPolicy)) {
    const key = JSON.stringify([policy.policy, policy.args ?? null])
    if (!byKey.has(key)) byKey.set(key, policy)
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

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

/** A stored value that may be one item rather than an array, as an array. */
function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  return raw === undefined || raw === null ? [] : [raw]
}

function unreadable(kind: string, raw: unknown, expected: string): Error {
  let shown: string
  try {
    shown = JSON.stringify(raw) ?? String(raw)
  } catch {
    shown = String(raw)
  }

  return new Error(
    `Cannot read the ${kind} ${shown}: expected ${expected}. Nautilus does not drop it, which would leave the asset open under the remaining policies; fix or remove it.`
  )
}
