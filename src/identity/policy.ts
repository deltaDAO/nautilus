/**
 * Building and reading the on-chain `SSIpolicy` credential block.
 *
 * The shape here follows the running stack, not the `@oceanprotocol/ddo-js` types. See
 * `../ddo/types` for why, and `policy-server/src/handlers/waltIdPolicyHandler.ts`
 * (`parseRequestCredentials`, `hasSSIPolicyToBeChecked`) for the parser this must satisfy.
 */
import {
  type AddressCredential,
  CredentialListTypes,
  type CredentialPolicy,
  type DdoCredential,
  type DdoCredentials,
  type RequestCredential,
  type SsiPolicyCredential,
  type SsiPolicyValue,
  type StoredRequestCredential,
  type VcPolicy,
  type VpPolicy
} from '../ddo/types.js'
import { log } from '../log/logger.js'
import { sanitize } from '../node/messages.js'
import {
  type CredentialAttributeRequirement,
  type CredentialRequirementOptions,
  credentialAttributeSchema,
  credentialPolicyProblem,
  DEFAULT_REQUEST_FORMAT,
  genericTypeProblem,
  isDid,
  isPlainObject,
  mergeAttributeSchemas,
  shownValue
} from './attributes.js'

/**
 * nautilus's own default VC policies, mirroring the policy server's
 * `default-verification-policies` file. That file is not what a deployment runs: the policy
 * server adds the `DEFAULT_VC_POLICIES` and `DEFAULT_VP_POLICIES` of its environment to every
 * session (its `.env.example` lists `expired,signature,revoked-status-list,not-before` for
 * both), which its operator sets and nautilus cannot read.
 */
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
 * and the checks they meant to remove went on running. Passing `[]` clears them; an entry
 * left with no request credential and no VC or VP policy is removed.
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
 * credentials. Passing `[]` clears them; an entry left with no request credential and no
 * VC or VP policy is removed.
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
 * Replaces the request credentials on the given list's `SSIpolicy` entry, keeping its VC and
 * VP policies. Unlike `addRequestCredentials`, this can remove a request credential or a
 * per-credential policy, e.g. on an edit.
 *
 * An empty list removes the list's `SSIpolicy` entry, and with it the credential gate: the
 * policy server refuses every consumer of an entry that requests no credential. Address and
 * access-list entries are kept. The removal logs `identity.policy.gate_removed`. On the
 * `allow` list it throws a `TypeError` when that would leave no gate at all: when the list's
 * addresses admit `'*'`, and, for an asset's list (`scope.level`, the default), when no
 * address or access-list entry remains, since the node lets every address in through an
 * empty allow list. A service's list is checked together with the asset's
 * (`scope.assetCredentials`) when that is known; otherwise the event says to check it.
 */
export function setRequestCredentials(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  requestCredentials: RequestCredential[],
  scope: RequestCredentialsScope = {}
): DdoCredentials {
  if (!Array.isArray(requestCredentials))
    throw new TypeError(
      'setRequestCredentials takes a list of request credentials.'
    )

  const encoded = requestCredentials.map(encodeRequestCredential)

  if (!encoded.length) {
    const entries = credentials[list] ?? []
    if (!entries.some(isSsiPolicyCredential)) return credentials

    const kept = entries.filter((entry) => !isSsiPolicyCredential(entry))
    const removed = `setRequestCredentials(${list}, []) removed the ${list} list's SSIpolicy entry, with its VC and VP policies: the credential gate is gone`
    if (list !== CredentialListTypes.ALLOW) {
      log.emit(
        'identity.policy.gate_removed',
        `${removed}, and only the address and access-list entries remain.`,
        { list }
      )
      return { ...credentials, [list]: kept }
    }

    if (addressList(kept).includes('*'))
      throw new TypeError(
        "setRequestCredentials(allow, []) would remove the credential gate of a list that lets every address in ('*'), leaving no gate at all. Replace '*' with explicit addresses first, or keep a request credential."
      )

    const service = scope.level === 'service'
    const addressGate = kept.some(
      (entry) => isAddressCredential(entry) || entry?.type === 'accessList'
    )
    if (!addressGate && !service)
      throw new TypeError(
        "setRequestCredentials(allow, []) would leave the asset's allow list without an address or access-list entry, and the node lets every address in through an empty allow list: no gate would remain. Add the addresses to admit first (addCredentialAddresses), or keep a request credential."
      )
    if (
      !addressGate &&
      scope.assetCredentials &&
      admitsEveryAddress(scope.assetCredentials)
    )
      throw new TypeError(
        "setRequestCredentials(allow, []) would leave this service's allow list without an address or access-list entry while the asset's allow list admits every address: no gate would remain. Add the addresses to admit first (addCredentialAddresses), or keep a request credential."
      )

    log.emit(
      'identity.policy.gate_removed',
      addressGate
        ? `${removed}, and only the address and access-list entries remain.`
        : scope.assetCredentials
          ? `${removed}; no address entries remain on this service, so the asset's allow list alone decides who gets in.`
          : `${removed}; no address entries remain on this service; check the asset's list: if it admits every address, so does this service.`,
      { list }
    )
    return { ...credentials, [list]: kept }
  }

  return updateSsiPolicy(credentials, list, (value) => {
    value.request_credentials = dedupeRequestCredentials(encoded)
  })
}

/**
 * Requires attributes of a requested credential type, through walt.id's per-credential
 * `schema` policy on the `allow` list: e.g. `[{ path: ['gx:legalAddress', 'gx:countryCode'],
 * equals: 'DE' }]` for a `gx:LegalPerson` from Germany. Adds the request credential if it is
 * not there yet. Requirements of several calls, and an existing `schema` policy, combine
 * with AND.
 *
 * The schema is checked against the credential as walt.id reads it: the JWT payload for
 * VCDM 2.0, the `vc` claim for VCDM 1.1, both with `credentialSubject` at the root.
 *
 * Like every per-credential policy, it runs only on presented credentials whose last `type`
 * entry is `type`: a hand-built presentation, or a self-issued credential carrying `type`
 * before its last entry, is not checked (see the identity guide, "Known limitation").
 */
export function requireCredentialAttributes(
  credentials: DdoCredentials,
  type: string,
  requirements: CredentialAttributeRequirement[],
  options: CredentialRequirementOptions = {}
): DdoCredentials {
  const schema = credentialAttributeSchema(requirements)

  return updateRequestCredential(credentials, type, options, (policies) => {
    const index = policies.findIndex(
      (policy) => credentialPolicyName(policy) === 'schema'
    )
    if (index === -1) return [...policies, { policy: 'schema', args: schema }]

    const existing = (policies[index] as { args?: unknown }).args
    if (!isPlainObject(existing))
      throw new TypeError(
        `The '${shownType(type)}' request credential has a 'schema' policy whose arguments are not a JSON Schema object, so the attribute requirements cannot be added to it. Replace it with setRequestCredentials().`
      )

    const merged = [...policies]
    merged[index] = {
      policy: 'schema',
      args: mergeAttributeSchemas(existing, schema)
    }
    return merged
  })
}

/**
 * Trusts only credentials of `type` issued by one of `issuers`, through walt.id's
 * per-credential `allowed-issuer` policy on the `allow` list. Adds the request credential
 * if it is not there yet. Issuers of several calls are combined: any of them is trusted.
 *
 * Like every per-credential policy, it runs only on presented credentials whose last `type`
 * entry is `type` (see the identity guide, "Known limitation"). walt.id compares each entry,
 * as written, with the credential's raw `iss`; the builders take DIDs only.
 */
export function trustIssuers(
  credentials: DdoCredentials,
  type: string,
  issuers: string[],
  options: CredentialRequirementOptions = {}
): DdoCredentials {
  if (!Array.isArray(issuers) || !issuers.length)
    throw new TypeError(
      `trustIssuers('${shownType(type)}') needs a non-empty list of issuer DIDs: an empty one trusts no issuer and refuses every consumer.`
    )
  const bad = issuers.find((issuer) => !isDid(issuer))
  if (bad !== undefined)
    throw new TypeError(
      `trustIssuers('${shownType(type)}'): ${shownValue(bad, 'node')} is not a DID (did:<method>:<id>, e.g. did:web:example.com).`
    )

  return updateRequestCredential(credentials, type, options, (policies) => {
    const index = policies.findIndex(
      (policy) => credentialPolicyName(policy) === 'allowed-issuer'
    )
    if (index === -1)
      return [{ policy: 'allowed-issuer', args: dedupe(issuers) }, ...policies]

    const existing = (policies[index] as { args?: unknown }).args
    if (credentialPolicyProblem('allowed-issuer', existing))
      throw new TypeError(
        `The '${shownType(type)}' request credential has an 'allowed-issuer' policy whose arguments are not a list of DIDs, so issuers cannot be added to it. Replace it with setRequestCredentials().`
      )

    const merged = [...policies]
    merged[index] = {
      policy: 'allowed-issuer',
      args: dedupe([
        ...(Array.isArray(existing) ? existing : [existing]),
        ...issuers
      ])
    }
    return merged
  })
}

/**
 * Changes the per-credential policies of the request credentials of `type` on the `allow`
 * list, creating one if there is none (format `options.format`, else `jwt_vc_json`). walt.id
 * keeps a single policy list per type, so every request of the type gets the change. The
 * policies are then ordered issuer trust first, then attribute checks, then the rest, so the
 * stored form does not depend on the order of the calls.
 *
 * Throws a `TypeError` for a generic type (`VerifiableCredential`), and for a `format` that
 * would add a second request of the type or a second format to the list: walt.id refuses a
 * session whose request credentials do not share one format.
 */
function updateRequestCredential(
  credentials: DdoCredentials,
  type: string,
  options: CredentialRequirementOptions,
  change: (policies: CredentialPolicy[]) => CredentialPolicy[]
): DdoCredentials {
  if (typeof type !== 'string' || !type)
    throw new TypeError('The credential type must be a non-empty string.')
  const generic = genericTypeProblem(type)
  if (generic) throw new TypeError(generic)
  if (
    options.format !== undefined &&
    (typeof options.format !== 'string' || !options.format)
  )
    throw new TypeError('The credential format must be a non-empty string.')

  return updateSsiPolicy(credentials, CredentialListTypes.ALLOW, (value) => {
    const requests = [...(value.request_credentials ?? [])]
    const ofType = requests.filter((credential) => credential.type === type)
    const { format } = options

    if (format !== undefined) {
      const other = (ofType.length ? ofType : requests).find(
        (credential) => credential.format !== format
      )
      if (other)
        throw new TypeError(
          ofType.length
            ? `'${shownType(type)}' is already requested with format ${shownValue(other.format ?? null, 'node')}, and walt.id keeps one policy list per type and refuses a session whose requests have different formats. Leave out the format option, or change the request with setRequestCredentials().`
            : `The allow list already requests ${shownValue(other.type, 'node')} with format ${shownValue(other.format ?? null, 'node')}, and walt.id refuses a session whose requests have different formats. Use that format, or leave out the format option.`
        )
    }

    // A new request takes the list's format, so the session keeps a single one.
    const listFormat = requests.find(
      (credential) => typeof credential.format === 'string'
    )?.format
    const targets: StoredRequestCredential[] = ofType.length
      ? ofType
      : [{ type, format: format ?? listFormat ?? DEFAULT_REQUEST_FORMAT }]
    if (!ofType.length) requests.push(targets[0])

    const updated = new Map(
      targets.map((target) => [
        target,
        {
          ...target,
          policies: orderCredentialPolicies(
            change((target.policies ?? []).map(decodeCredentialPolicy))
          ).map(encodeCredentialPolicy)
        }
      ])
    )

    value.request_credentials = dedupeRequestCredentials(
      requests.map((credential) => updated.get(credential) ?? credential)
    )
  })
}

/** For `setRequestCredentials`: where the list sits, which decides what an empty one means. */
export interface RequestCredentialsScope {
  /** `'asset'` (the default) or `'service'`: the node checks a service's list and the asset's. */
  level?: 'asset' | 'service'
  /** For a service's list: the asset's credentials, when known (e.g. on an edit). */
  assetCredentials?: DdoCredentials
}

/**
 * Whether an allow list lets every address through the node: empty, or only address entries
 * admitting `'*'`, or `'*'` under `match_allow: 'any'`.
 */
function admitsEveryAddress(credentials: DdoCredentials): boolean {
  const allow = (credentials.allow ?? []) as DdoCredential[]
  if (credentials.match_allow === 'any' && addressList(allow).includes('*'))
    return true
  return allow.every(
    (entry) => isAddressCredential(entry) && addressList([entry]).includes('*')
  )
}

/** The addresses of a list's `address` entries, as the policy server reads them. */
function addressList(entries: DdoCredential[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.type !== 'address' || !Array.isArray(entry.values)) return []
    return (entry.values as unknown[]).flatMap((value) => {
      const address =
        typeof value === 'string'
          ? value
          : (value as { address?: unknown } | null)?.address
      return typeof address === 'string' ? [address] : []
    })
  })
}

function shownType(type: unknown): string {
  return sanitize(String(type), 100, 'node')
}

/** Issuer trust first, then attribute checks, then the rest, each group in its order. */
function orderCredentialPolicies(
  policies: CredentialPolicy[]
): CredentialPolicy[] {
  const rank = (policy: CredentialPolicy) => {
    const name = credentialPolicyName(policy)
    return name === 'allowed-issuer' ? 0 : name === 'schema' ? 1 : 2
  }
  return policies
    .map((policy, index) => ({ policy, index }))
    .sort((a, b) => rank(a.policy) - rank(b.policy) || a.index - b.index)
    .map(({ policy }) => policy)
}

function credentialPolicyName(policy: CredentialPolicy): string {
  return typeof policy === 'string' ? policy : policy.policy
}

/** A stored (JSON-encoded) per-credential policy as a name or `{ policy, args? }`. */
function decodeCredentialPolicy(stored: string): CredentialPolicy {
  const policy: unknown = JSON.parse(readCredentialPolicy(stored))
  if (typeof policy === 'string') return policy
  if (isPlainObject(policy) && typeof policy.policy === 'string')
    return policy as { policy: string; args?: unknown }
  throw unreadable(
    'per-credential policy',
    stored,
    'a name or { policy, args? }'
  )
}

/** A per-credential policy as stored: JSON-encoded, `{ policy, args? }` in that key order. */
function encodeCredentialPolicy(policy: CredentialPolicy): string {
  if (typeof policy === 'string') return JSON.stringify(policy)
  const {
    policy: name,
    args,
    ...rest
  } = policy as {
    policy: string
    args?: unknown
  }
  return JSON.stringify({
    policy: name,
    ...(args !== undefined ? { args } : {}),
    ...rest
  })
}

/**
 * Applies a change to one list's single `SSIpolicy` entry, creating it if needed, and
 * removing it when the change leaves it empty.
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

  // An emptied entry goes: the policy server refuses every consumer of a service whose merged
  // view holds an SSIpolicy entry without request credentials, so clearing an asset's VC and
  // VP lists is how an edit moves them onto the gated service.
  if (isEmptySsiValue(value))
    return {
      ...credentials,
      [list]: entries.filter((entry) => !isSsiPolicyCredential(entry))
    }

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

/** An `SSIpolicy` value with no request credential, no VC or VP policy and nothing else. */
function isEmptySsiValue(value: SsiPolicyValue): boolean {
  return Object.entries(value).every(
    ([key, field]) =>
      (key === 'request_credentials' ||
        key === 'vc_policies' ||
        key === 'vp_policies') &&
      (field === undefined || (Array.isArray(field) && field.length === 0))
  )
}

/**
 * Adds addresses to the `type: 'address'` entry of one list.
 *
 * Written as `{ address }` objects: the policy server's `extractAddressList` accepts bare
 * strings too, but the enterprise market writes and reads objects, so nautilus matches it.
 * An entry stored as bare strings only is kept that way (see `addressValues`).
 */
export function addCredentialAddresses(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  addresses: string[]
): DdoCredentials {
  const entries = credentials[list] || []
  const existing = entries.find(isAddressCredential)

  const merged = dedupe([
    ...(existing ? storedAddresses(existing) : []),
    ...addresses
  ])

  if (existing) existing.values = addressValues(merged, existing)
  else entries.push({ type: 'address', values: addressValues(merged) })

  return { ...credentials, [list]: entries }
}

/**
 * Removes addresses, compared case-insensitively, from every address entry of the list that
 * holds one: the policy server reads them as one list, and under `match_allow: 'any'` the
 * node lets in an address any of them holds. Each changed entry keeps its stored form (see
 * `addressValues`); the others are left as stored.
 *
 * An allow entry left empty is kept as `values: []`: the node and the policy server read an
 * empty address allow list as "deny everyone", so dropping it would lift the gate. A deny
 * entry left empty denies no one and is dropped.
 */
export function removeCredentialAddresses(
  credentials: DdoCredentials,
  list: CredentialListTypes,
  addresses: string[]
): DdoCredentials {
  const entries = credentials[list] || []
  const removed = new Set(addresses.map((address) => address.toLowerCase()))

  const kept = entries.flatMap((entry): DdoCredential[] => {
    if (!isAddressCredential(entry)) return [entry]

    const stored = storedAddresses(entry)
    const remaining = stored.filter(
      (address) => !removed.has(address.toLowerCase())
    )
    if (remaining.length === stored.length) return [entry]
    if (!remaining.length && list === CredentialListTypes.DENY) return []

    entry.values = addressValues(remaining, entry)
    return [entry]
  })

  if (!entries.some(isAddressCredential)) return credentials

  return { ...credentials, [list]: kept }
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
 * The credential types a service asks for: the `type` of every `request_credentials` entry
 * in the `SSIpolicy` entries of the asset's and the service's `allow` lists, which the
 * policy server merges into the presentation request.
 */
export function requestedCredentialTypes(
  assetCredentials: DdoCredentials | undefined,
  serviceCredentials?: DdoCredentials
): Set<string> {
  const types = new Set<string>()

  for (const entry of [
    ...(assetCredentials?.allow || []),
    ...(serviceCredentials?.allow || [])
  ])
    if (isSsiPolicyCredential(entry))
      for (const value of entry.values || [])
        for (const credential of value.request_credentials || [])
          if (typeof credential?.type === 'string' && credential.type)
            types.add(credential.type)

  return types
}

/**
 * Refuses to open a policy session that cannot be completed: the service asks for a
 * verifiable presentation (`requiresPresentation`) and no `CredentialProvider` is set to
 * make one.
 *
 * `PolicySessionResolver` calls this before `initiate`, unless it knows the node has no
 * policy server, so nothing is signed, ordered or paid. A service gated by addresses only
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
 * server reads only the name); they are rewritten to names, so the array stays one type. A
 * single policy or request credential stored without its array is wrapped in one, as the
 * policy server does for `vp_policies`.
 *
 * Address entries are left as stored: bare strings and `{ address }` objects are both read
 * by the policy server and OceanProtocolEnterprise ocean-node, but upstream ocean-node
 * 4.2.0's built-in check (no policy server) reads strings only, so rewriting a list the
 * edit does not touch could break its gate there. `addCredentialAddresses` and
 * `removeCredentialAddresses` read either form.
 *
 * Unusable VC policies are dropped, as the policy server skips them. An unreadable VP
 * policy, request credential or per-credential policy throws instead: dropping it would
 * leave the asset open under the remaining policies, where the policy server today
 * refuses or fails on it.
 */
export function normalizeStoredCredentials(
  credentials: DdoCredentials
): DdoCredentials {
  const copy = structuredClone(credentials)

  for (const list of [copy.allow, copy.deny]) {
    if (!Array.isArray(list)) continue

    // The guard skips entries that are not objects, which the stack cannot match either.
    for (const entry of list)
      if (isSsiPolicyCredential(entry))
        entry.values = toArray(entry.values)
          .filter(isObject)
          .map(normalizeSsiValue)
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
 * Addresses as the values of an address entry: bare strings when `stored` holds bare
 * strings only, `{ address }` objects otherwise (a new or empty entry included).
 *
 * ocean-node and the policy server accept bare strings, and upstream ocean-node 4.2.0
 * without a policy server reads nothing else, so changing an address of such an entry must
 * not turn it into objects.
 */
function addressValues(
  addresses: string[],
  stored?: AddressCredential
): AddressCredential['values'] {
  const values: unknown = stored?.values
  const bareStrings =
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => typeof value === 'string')

  return bareStrings ? addresses : addresses.map((address) => ({ address }))
}

/**
 * The addresses an address entry holds, read from bare strings and `{ address }` objects
 * alike, with their case kept. A value that is neither, or a `values` that is not an
 * array, holds no address the stack can match, and is skipped.
 */
function storedAddresses(entry: AddressCredential): string[] {
  const values: unknown = entry.values
  if (!Array.isArray(values)) return []

  return values.flatMap((raw: unknown) => {
    if (typeof raw === 'string') return [raw]

    const address = (raw as { address?: unknown } | null)?.address
    return typeof address === 'string' ? [address] : []
  })
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
  assertRequestCredential(credential)

  return {
    type: credential.type,
    ...(credential.format !== undefined && { format: credential.format }),
    ...(credential.policies && {
      policies: credential.policies.map(readCredentialPolicy)
    })
  }
}

/**
 * Refuses, with a `TypeError` naming the credential type and the policy, a request
 * credential walt.id would fail for every presentation: a `schema` whose arguments are not a
 * JSON Schema object, an `allowed-issuer` without a list of DIDs.
 */
function assertRequestCredential(credential: RequestCredential): void {
  const { type, policies } = (credential ?? {}) as Partial<RequestCredential>
  if (typeof type !== 'string' || !type)
    throw new TypeError(
      "A request credential needs a type, e.g. { type: 'gx:LegalPerson', format: 'jwt_vc_json' }."
    )
  if (policies === undefined) return
  if (!Array.isArray(policies))
    throw new TypeError(
      `The '${shownType(type)}' request credential's policies must be a list.`
    )
  const generic = policies.length ? genericTypeProblem(type) : undefined
  if (generic) throw new TypeError(generic)

  for (const raw of policies) {
    const policy = decodeCredentialPolicy(readCredentialPolicy(raw))
    if (typeof policy === 'string') {
      const problem = credentialPolicyProblem(policy, undefined)
      if (problem) throw policyArgumentsError(type, policy, problem)
      continue
    }
    const problem = credentialPolicyProblem(policy.policy, policy.args)
    if (problem) throw policyArgumentsError(type, policy.policy, problem)
  }
}

function policyArgumentsError(
  type: string,
  policy: string,
  problem: string
): TypeError {
  return new TypeError(
    `The '${shownType(type)}' request credential's '${shownType(policy)}' policy ${problem}.${policy === 'schema' ? ' Pass the schema as an object, not JSON.stringify(schema), or use requireCredentialAttributes().' : ' Use trustIssuers(type, [did, …]).'}`
  )
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
