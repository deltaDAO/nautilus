/**
 * The native SSI module of the node (pontusx-node, ocean-node with verifier-api2): what the
 * node announces, what its SSI commands answer, and the `SSIpolicyV2` credential entries
 * it gates on.
 *
 * The node replaced the policy server with three signed commands:
 *
 *   - `ssiInitiate` (`POST /api/services/ssi/initiate`) checks the consumer's address and
 *     opens a verifier-api2 session for one (asset, service, consumer): `{ required: false }`
 *     when the asset asks for no credentials, else `{ sessionId, requestUri, expiresAt, dcql }`,
 *     where `requestUri` is the OpenID4VP 1.0 request (`openid4vp://…`) a wallet answers;
 *   - `ssiStatus` (`POST /api/services/ssi/status`) reports `pending`, `verified`, `failed` or
 *     `expired`, with every policy result (`vc`, `vp`, `gaiax`, `rego`, `binding`);
 *   - `validateRego` (`POST /api/services/ssi/validateRego`) compiles a publisher's rego.
 *
 * The verified session goes into the `policyServer` field of `initialize`, the download,
 * `initializeCompute` and the compute start, as `{ sessionId }` (or, for a compute job,
 * `{ sessionId, sessionIds: { <did>: <sessionId> } }`). The node consumes it on the
 * download (for one order) or the compute start (for one job).
 *
 * Each command signs `consumerAddress + nonce + command` (the ocean.js convention), with the
 * node's stored nonce + 1. The node's `status` answer carries the capability block `ssi`
 * in place of the policy server's `isPSConfigured`.
 */
import type {
  DcqlQuery,
  DdoCredential,
  DdoCredentials,
  GaiaXLabelLevel,
  SsiPolicyV2Credential,
  SsiPolicyV2Value,
  SsiVcPolicy
} from '../ddo/types.js'
import { CredentialListTypes } from '../ddo/types.js'

// #region node vocabulary

/** The `type` of the native SSI module's credential entry. */
export const SSI_POLICY_V2_TYPE = 'SSIpolicyV2'
/** The deprecated policy-server entry, still read by nodes with `legacyFormat`. */
export const SSI_POLICY_LEGACY_TYPE = 'SSIpolicy'

/** The SSI commands, as signed (`consumerAddress + nonce + command`). */
export const SSI_COMMANDS = {
  INITIATE: 'ssiInitiate',
  STATUS: 'ssiStatus',
  VALIDATE_REGO: 'validateRego'
} as const

export type SsiCommand = (typeof SSI_COMMANDS)[keyof typeof SSI_COMMANDS]

/** DCQL formats the node accepts. */
export const SSI_FORMATS = ['jwt_vc_json', 'dc+sd-jwt', 'vc+sd-jwt'] as const

/** VC policy names the node accepts in `vcPolicies` and `specificVcPolicies`. */
export const SSI_VC_POLICIES = [
  'signature',
  'expiration',
  'not_before',
  'revocation',
  'status',
  'allowed_issuer',
  'json_schema',
  'vct_integrity'
] as const

/** Gaia-X label levels, lowest first. */
export const GAIAX_LABEL_LEVELS: readonly GaiaXLabelLevel[] = [
  'SC',
  'L1',
  'L2',
  'L3'
]

/** DCQL query ids the node reserves for the Gaia-X queries it adds. */
export const GAIAX_RESERVED_QUERY_IDS: readonly string[] = [
  'gx_compliance',
  'gx_legal_person',
  'gx_service_offering'
]

/**
 * The `transaction_data` type the node adds to sessions with `dc+sd-jwt` queries, which
 * binds the presentation to the consumer, the asset and the service.
 */
export const ASSET_ACCESS_TRANSACTION_DATA_TYPE =
  'org.oceanenterprise.transaction-data.asset-access'

const W3C_FORMATS = ['jwt_vc_json', 'jwt_vc_json-ld', 'jwt_vc', 'ldp_vc']
const QUERY_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_CREDENTIAL_QUERIES = 20
const MAX_REGO_POLICIES = 10
const MAX_POLICIES_PER_LIST = 20
const MAX_VC_POLICY_ARGUMENT_LENGTH = 16 * 1024
const MAX_REGO_BYTES = 64 * 1024
const MAX_ENTRY_BYTES = 256 * 1024
const MAX_SETS = 20
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// #endregion

// #region capabilities

/** What a node announces about its SSI module (`status.ssi`). */
export interface SsiCapabilities {
  /** The node checks SSI requirements: it has a verifier. */
  enabled: boolean
  formats: string[]
  vcPolicies: string[]
  /** The node can run rego policies (and `validateRego`). */
  rego: boolean
  /**
   * The Gaia-X label levels the node checks; empty without usable trust anchors. A node
   * announcing `gaiax: true` checks `SC` only.
   */
  gaiaxLevels: GaiaXLabelLevel[]
  /** The node still reads the deprecated `SSIpolicy` entries. */
  legacyFormat: boolean
  /**
   * The host of the node's public verifier URL: an `openid4vp://` request whose
   * `request_uri` points elsewhere was not created by this node's verifier. `undefined`
   * when the node does not say.
   */
  verifierPublicHost?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown, max = 50): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (entry): entry is string =>
            typeof entry === 'string' && entry.length <= 100
        )
        .slice(0, max)
    : []
}

/**
 * The SSI capabilities in a node's `status` answer, or `undefined` when it has no `ssi`
 * block: the node predates the native SSI module (it may have a policy server instead).
 */
export function readSsiCapabilities(
  status: unknown
): SsiCapabilities | undefined {
  const ssi = isRecord(status) ? status.ssi : undefined
  if (!isRecord(ssi)) return undefined

  const gaiax = ssi.gaiax
  const gaiaxLevels = isRecord(gaiax)
    ? stringList(gaiax.levels).filter((level): level is GaiaXLabelLevel =>
        (GAIAX_LABEL_LEVELS as readonly string[]).includes(level)
      )
    : gaiax === true
      ? (['SC'] as GaiaXLabelLevel[])
      : []
  const host = ssi.verifierPublicHost

  return {
    enabled: ssi.enabled === true,
    formats: stringList(ssi.formats),
    vcPolicies: stringList(ssi.vcPolicies),
    rego: ssi.rego === true,
    gaiaxLevels,
    legacyFormat: ssi.legacyFormat === true,
    verifierPublicHost:
      typeof host === 'string' && host.length > 0 && host.length <= 253
        ? host.toLowerCase()
        : undefined
  }
}

// #endregion

// #region command answers

/** What `ssiInitiate` answers. */
export type SsiInitiateResult =
  | { required: false }
  | {
      required: true
      sessionId: string
      /** The OpenID4VP request (`openid4vp://…`) the wallet answers. */
      requestUri: string
      /** When the presentation window closes (ISO 8601), when the node says. */
      expiresAt?: string
      /** The DCQL query the verifier asks for, as the node built it. */
      dcql?: DcqlQuery
      /** The asset uses the deprecated `SSIpolicy` format (`Deprecation: true`). */
      deprecated?: boolean
    }

export type SsiSessionStatus = 'pending' | 'verified' | 'failed' | 'expired'

/** One check the verifier or the node ran on a presentation. */
export interface SsiResult {
  /** `vc`, `vp`, `gaiax`, `rego` or `binding`; another string from a newer node. */
  scope: string
  /** The DCQL query the credential was presented for, when the check is per credential. */
  credentialId?: string
  name: string
  success: boolean
  error?: string
}

/** What `ssiStatus` answers. */
export interface SsiStatusResult {
  status: SsiSessionStatus
  results: SsiResult[]
}

/** What `validateRego` answers. */
export interface RegoValidationResult {
  valid: boolean
  errors: string[]
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/
const STATUSES: SsiSessionStatus[] = [
  'pending',
  'verified',
  'failed',
  'expired'
]
const MAX_RESULTS = 200
const MAX_RESULT_TEXT = 300

/**
 * Reads an `ssiInitiate` answer. `undefined` when it is not one: a session id the node's
 * own pattern would refuse, or a request that is not `openid4vp://`.
 */
export function readSsiInitiate(data: unknown): SsiInitiateResult | undefined {
  if (!isRecord(data)) return undefined
  if (data.required === false) return { required: false }

  const { sessionId, requestUri, expiresAt, dcql } = data
  if (
    typeof sessionId !== 'string' ||
    !SESSION_ID.test(sessionId) ||
    typeof requestUri !== 'string' ||
    requestUri.length > 4096 ||
    !requestUri.startsWith('openid4vp://')
  )
    return undefined

  return {
    required: true,
    sessionId,
    requestUri,
    ...(typeof expiresAt === 'string' && expiresAt.length <= 64
      ? { expiresAt }
      : {}),
    ...(isRecord(dcql) && Array.isArray(dcql.credentials)
      ? { dcql: dcql as unknown as DcqlQuery }
      : {})
  }
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
  return clean.length > MAX_RESULT_TEXT
    ? `${clean.slice(0, MAX_RESULT_TEXT)}…`
    : clean || undefined
}

/** Reads an `ssiStatus` answer. `undefined` when it is not one. */
export function readSsiStatus(data: unknown): SsiStatusResult | undefined {
  if (!isRecord(data) || !STATUSES.includes(data.status as SsiSessionStatus))
    return undefined

  const results = Array.isArray(data.results)
    ? data.results
        .slice(0, MAX_RESULTS)
        .filter(isRecord)
        .map((entry): SsiResult => {
          const credentialId = boundedText(entry.credentialId)
          const error = boundedText(entry.error)
          return {
            scope: boundedText(entry.scope) ?? 'vc',
            ...(credentialId ? { credentialId } : {}),
            name: boundedText(entry.name) ?? 'unknown',
            // Anything but an explicit `true` counts as failed.
            success: entry.success === true,
            ...(error ? { error } : {})
          }
        })
    : []

  return { status: data.status as SsiSessionStatus, results }
}

/** Reads a `validateRego` answer. `undefined` when it is not one. */
export function readRegoValidation(
  data: unknown
): RegoValidationResult | undefined {
  if (!isRecord(data) || typeof data.valid !== 'boolean') return undefined
  return {
    valid: data.valid,
    errors: (Array.isArray(data.errors) ? data.errors : [])
      .map(boundedText)
      .filter((error): error is string => !!error)
      .slice(0, 50)
  }
}

/**
 * The host the wallet fetches an OpenID4VP request from (`request_uri` of an
 * `openid4vp://` URL), lower-cased; `undefined` when there is none or it is not a URL.
 */
export function requestUriHost(requestUri: string): string | undefined {
  try {
    const target = new URL(requestUri).searchParams.get('request_uri')
    return target ? new URL(target).host.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

// #endregion

// #region credential entries

export function isSsiPolicyV2Credential(
  credential: DdoCredential
): credential is SsiPolicyV2Credential {
  return (
    typeof credential?.type === 'string' &&
    credential.type.toLowerCase() === SSI_POLICY_V2_TYPE.toLowerCase()
  )
}

/**
 * Whether an entry is any SSI entry, as the node tells them apart: `SSIpolicyV2` or the
 * deprecated `SSIpolicy`, in any case.
 */
export function isSsiEntry(credential: unknown): boolean {
  const type = (credential as { type?: unknown } | null)?.type
  if (typeof type !== 'string') return false
  const lower = type.toLowerCase()
  return (
    lower === SSI_POLICY_V2_TYPE.toLowerCase() ||
    lower === SSI_POLICY_LEGACY_TYPE.toLowerCase()
  )
}

/** Whether the `allow` list of a credentials block has an SSI entry. */
export function hasSsiEntries(
  credentials: DdoCredentials | undefined
): boolean {
  return Array.isArray(credentials?.allow) && credentials.allow.some(isSsiEntry)
}

/** Whether the `allow` list has a deprecated `SSIpolicy` entry. */
export function hasLegacySsiEntries(
  credentials: DdoCredentials | undefined
): boolean {
  return (
    Array.isArray(credentials?.allow) &&
    credentials.allow.some(
      (entry) =>
        isSsiEntry(entry) && !isSsiPolicyV2Credential(entry as DdoCredential)
    )
  )
}

/**
 * The highest Gaia-X label level any `SSIpolicyV2` value of the blocks requires, or
 * `undefined` when none does.
 */
export function requiredGaiaXLevel(
  ...blocks: (DdoCredentials | undefined)[]
): GaiaXLabelLevel | undefined {
  let highest = -1
  for (const block of blocks)
    for (const entry of block?.allow ?? [])
      if (isSsiPolicyV2Credential(entry))
        for (const value of Array.isArray(entry.values) ? entry.values : []) {
          const gaiax = (value as SsiPolicyV2Value | undefined)?.gaiax
          if (!gaiax) continue
          const level =
            gaiax.minLabelLevel ??
            (gaiax.requireCompliance === true ? 'SC' : undefined)
          if (level)
            highest = Math.max(highest, GAIAX_LABEL_LEVELS.indexOf(level))
        }
  return highest >= 0 ? GAIAX_LABEL_LEVELS[highest] : undefined
}

// The node compares parsed policies. Omitted defaults and fields ignored by its
// parser must not turn equivalent DDO and service requirements into two sessions' worth.
function sessionPolicyKey(value: SsiPolicyV2Value): string {
  const vcPolicyKey = (policy: SsiVcPolicy) => {
    if (typeof policy === 'string') return policy
    switch (policy.policy) {
      case 'allowed_issuer':
        return {
          policy: policy.policy,
          issuers: [policy.allowed_issuer].flat()
        }
      case 'json_schema':
        return { policy: policy.policy, schema: policy.schema }
      case 'status':
        return { policy: policy.policy, argument: policy.argument }
      default:
        // The node also accepts a simple policy name in object form.
        return (policy as { policy: string }).policy
    }
  }
  return canonicalJson({
    credentials: (value.dcql?.credentials ?? []).map((query) => ({
      id: query.id,
      format: query.format,
      meta: query.meta,
      claims: query.claims?.map(({ id, path, values }) => ({
        id,
        path,
        values
      })),
      claim_sets: query.claim_sets,
      multiple: query.multiple,
      require_cryptographic_holder_binding:
        query.require_cryptographic_holder_binding,
      trusted_authorities: query.trusted_authorities?.map(
        ({ type, values }) => ({ type, values })
      )
    })),
    credential_sets: value.dcql?.credential_sets?.map(
      ({ options, required }) => ({ options, required })
    ),
    vcPolicies: (value.vcPolicies ?? []).map(vcPolicyKey),
    specificVcPolicies: Object.fromEntries(
      Object.entries(value.specificVcPolicies ?? {}).map(([id, policies]) => [
        id,
        policies.map(vcPolicyKey)
      ])
    ),
    gaiax:
      value.gaiax?.minLabelLevel ??
      (value.gaiax?.requireCompliance ? 'SC' : undefined),
    rego: (value.rego ?? []).map(({ name, code, argument, credentialId }) => ({
      name,
      code,
      argument: argument ?? {},
      credentialId
    })),
    consumerBinding: value.consumerBinding === true
  })
}

/** Check whole SSI entries and count their values before merging sessions. */
function assertSsiEntryLimits(entries: DdoCredential[]): void {
  let count = 0
  for (const entry of entries) {
    if (!isSsiEntry(entry)) continue
    assertSafeJson(entry)
    if (
      !('values' in entry) ||
      !Array.isArray(entry.values) ||
      entry.values.length === 0
    )
      fail(`an ${entry.type} entry needs at least one value`)
    count += entry.values.length
  }
  if (count > MAX_CREDENTIAL_QUERIES)
    fail('too many SSI policies in one credentials block')
}

/** Checks limits and incompatible query formats after merging a service's policies. */
export function validateSsiPolicyCombination(
  ...blocks: (DdoCredentials | undefined)[]
): void {
  const level = requiredGaiaXLevel(...blocks)
  const policies = new Map<string, SsiPolicyV2Value>()
  for (const block of blocks) {
    if (block?.deny?.some(isSsiEntry))
      fail(
        'SSI entries are only allowed in credentials.allow, not credentials.deny'
      )
    const entries = block?.allow ?? []
    assertSsiEntryLimits(entries)
    for (const entry of entries) {
      if (isSsiPolicyV2Credential(entry)) {
        for (const value of entry.values) {
          validateSsiPolicyV2Value(value)
          if (level) checkGaiaXQueries(value.dcql?.credentials ?? [])
          policies.set(sessionPolicyKey(value), value)
        }
      } else if (level && isSsiEntry(entry) && 'values' in entry) {
        // The native module translates these legacy queries into jwt_vc_json.
        for (const value of entry.values) {
          if (!isRecord(value) || !('request_credentials' in value)) continue
          const requests = value.request_credentials
          for (const request of Array.isArray(requests) ? requests : [requests])
            if (
              isRecord(request) &&
              (request.format === 'jwt_vc' || request.format === 'jwt_vc_json')
            )
              failGaiaXMixing(request.format, String(request.type))
        }
      }
    }
  }
  // Gaia-X adds compliance and legal-person queries, plus a service offering from L1.
  let queryCount = level === undefined ? 0 : level === 'SC' ? 2 : 3
  let regoCount = 0
  for (const value of policies.values()) {
    const queries = value.dcql?.credentials.length ?? 0
    queryCount += queries
    for (const rego of value.rego ?? [])
      regoCount += policies.size === 1 || rego.credentialId ? 1 : queries
  }
  if (queryCount > MAX_CREDENTIAL_QUERIES)
    fail('too many credential queries for one session')
  if (regoCount > MAX_REGO_POLICIES * 4)
    fail('too many rego policies for one session')
}

function checkGaiaXQueries(queries: { id: string; format: string }[]): void {
  const w3c = queries.find(({ format }) => W3C_FORMATS.includes(format))
  if (w3c) failGaiaXMixing(w3c.format, w3c.id)
}

function failGaiaXMixing(format: string, id: string): never {
  fail(
    `Gaia-X compliance cannot be combined with the ${format} query "${id}": the wallet signs all W3C credentials of one presentation with the organisation's did:web. Use dc+sd-jwt for the other credentials required by this service.`
  )
}

/**
 * Adds an `SSIpolicyV2` value to the `allow` list, after checking it as the node will
 * (`validateSsiPolicyV2Value`). Values are appended to the list's one `SSIpolicyV2` entry,
 * which is created when there is none; an identical value is added once.
 *
 * Only the `allow` list: the node rejects SSI entries in `deny` at indexing and denies
 * access for them.
 */
export function addSsiPolicyV2(
  credentials: DdoCredentials,
  value: SsiPolicyV2Value,
  list: CredentialListTypes = CredentialListTypes.ALLOW
): DdoCredentials {
  if (list !== CredentialListTypes.ALLOW)
    throw new SsiPolicyValidationError(
      'SSIpolicyV2 entries are only allowed in credentials.allow: the node rejects them in deny.'
    )

  validateSsiPolicyV2Value(value)

  const entries = [...(credentials.allow ?? [])]
  const index = entries.findIndex(isSsiPolicyV2Credential)
  const copy = structuredClone(value)

  const existing = entries[index] as SsiPolicyV2Credential | undefined
  const values = Array.isArray(existing?.values) ? existing.values : []
  const key = canonicalJson(copy)
  const entry: SsiPolicyV2Credential = {
    type: 'SSIpolicyV2',
    values: values.some((stored) => canonicalJson(stored) === key)
      ? values
      : [...values, copy]
  }
  entries[index === -1 ? entries.length : index] = entry
  assertSsiEntryLimits(entries)
  if (JSON.stringify(entry).length > MAX_ENTRY_BYTES)
    fail('the SSIpolicyV2 entry is larger than 256 KiB')

  return { ...credentials, allow: entries }
}

/** Removes every `SSIpolicyV2` entry from the `allow` list. */
export function removeSsiPolicyV2(credentials: DdoCredentials): DdoCredentials {
  if (!Array.isArray(credentials.allow)) return credentials
  return {
    ...credentials,
    allow: credentials.allow.filter((entry) => !isSsiPolicyV2Credential(entry))
  }
}

/** Deterministic JSON (sorted keys), for comparing values. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

// #endregion

// #region validation

/** An `SSIpolicyV2` value the node would refuse. */
export class SsiPolicyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiPolicyValidationError'
  }
}

function fail(message: string): never {
  throw new SsiPolicyValidationError(message)
}

function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > 32) fail('the SSI policy is nested too deeply')
  if (Array.isArray(value))
    for (const item of value) assertSafeJson(item, depth + 1)
  else if (isRecord(value))
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) fail(`forbidden key "${key}"`)
      assertSafeJson(value[key], depth + 1)
    }
}

function queryId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !QUERY_ID.test(value))
    fail(`${field} must match ${QUERY_ID}`)
  return value
}

function checkPolicyList(input: unknown, field: string): void {
  if (input === undefined) return
  if (!Array.isArray(input) || input.length > MAX_POLICIES_PER_LIST)
    fail(
      `${field} must be an array of at most ${MAX_POLICIES_PER_LIST} policies`
    )
  for (const policy of input) checkVcPolicy(policy, field)
}

function checkVcPolicy(input: unknown, field: string): void {
  const name =
    typeof input === 'string'
      ? input
      : isRecord(input) && typeof input.policy === 'string'
        ? input.policy
        : fail(`${field}: a policy must be a name or { policy, … }`)

  if (!(SSI_VC_POLICIES as readonly string[]).includes(name))
    fail(
      `${field}: the node does not allow the policy "${name.slice(0, 64)}" (allowed: ${SSI_VC_POLICIES.join(', ')})`
    )

  const args = isRecord(input) ? input : {}
  switch (name) {
    case 'allowed_issuer': {
      const issuers = Array.isArray(args.allowed_issuer)
        ? args.allowed_issuer
        : [args.allowed_issuer]
      if (
        !issuers.length ||
        issuers.length > 100 ||
        !issuers.every(
          (issuer) =>
            typeof issuer === 'string' && issuer && issuer.length <= 2048
        )
      )
        fail(`${field}: allowed_issuer needs 1 to 100 issuers`)
      return
    }
    case 'json_schema':
      if (!isRecord(args.schema))
        fail(
          `${field}: json_schema needs an inline "schema" object (no schemaUrl)`
        )
      if (JSON.stringify(args.schema).length > MAX_VC_POLICY_ARGUMENT_LENGTH)
        fail(`${field}: json_schema.schema exceeds the 16 KiB serialized limit`)
      return
    case 'status':
      if (!isRecord(args.argument))
        fail(`${field}: status needs an "argument" object`)
      if (JSON.stringify(args.argument).length > MAX_VC_POLICY_ARGUMENT_LENGTH)
        fail(`${field}: status.argument exceeds the 16 KiB serialized limit`)
      return
    default:
      if (Object.keys(args).some((key) => key !== 'policy'))
        fail(`${field}: the policy "${name}" takes no arguments`)
  }
}

function checkClaim(claim: unknown, credentialId: string): string | undefined {
  if (
    !isRecord(claim) ||
    !Array.isArray(claim.path) ||
    !claim.path.length ||
    claim.path.length > 16 ||
    !claim.path.every(
      (segment) =>
        segment === null ||
        (typeof segment === 'string' &&
          segment.length > 0 &&
          segment.length <= 256) ||
        (typeof segment === 'number' &&
          Number.isInteger(segment) &&
          segment >= 0)
    )
  )
    fail(`the dcql query "${credentialId}" has an invalid claims.path`)

  if (
    claim.values !== undefined &&
    (!Array.isArray(claim.values) ||
      !claim.values.length ||
      claim.values.length > 50 ||
      !claim.values.every(
        (value) =>
          (typeof value === 'string' && value.length <= 1024) ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          typeof value === 'boolean'
      ))
  )
    fail(`the dcql query "${credentialId}" has invalid claims.values`)

  return claim.id === undefined ? undefined : queryId(claim.id, 'claims.id')
}

function checkCredentialQuery(input: unknown): {
  id: string
  format: string
} {
  if (!isRecord(input)) fail('a dcql credential query must be an object')
  const id = queryId(input.id, 'a dcql credential id')
  if (
    typeof input.format !== 'string' ||
    !(SSI_FORMATS as readonly string[]).includes(input.format)
  )
    fail(
      `the dcql query "${id}" has a format the node does not accept (${SSI_FORMATS.join(', ')})`
    )
  if (
    input.meta !== undefined &&
    (!isRecord(input.meta) || JSON.stringify(input.meta).length > 8 * 1024)
  )
    fail(`the dcql query "${id}" has an invalid meta`)
  if (
    input.trusted_authorities !== undefined &&
    (!Array.isArray(input.trusted_authorities) ||
      input.trusted_authorities.length > 10 ||
      !input.trusted_authorities.every(
        (authority) =>
          isRecord(authority) &&
          typeof authority.type === 'string' &&
          Array.isArray(authority.values) &&
          authority.values.length > 0 &&
          authority.values.length <= 50 &&
          authority.values.every(
            (value: unknown) =>
              typeof value === 'string' && value.length <= 2048
          )
      ))
  )
    fail(`the dcql query "${id}" has invalid trusted_authorities`)
  const claimIds = new Set<string>()
  if (input.claims !== undefined) {
    if (
      !Array.isArray(input.claims) ||
      !input.claims.length ||
      input.claims.length > 50
    )
      fail(`the dcql query "${id}" has invalid claims`)
    for (const claim of input.claims) {
      const claimId = checkClaim(claim, id)
      if (claimId !== undefined) claimIds.add(claimId)
    }
  }
  if (
    input.claim_sets !== undefined &&
    (!Array.isArray(input.claim_sets) ||
      input.claim_sets.length > MAX_SETS ||
      !input.claim_sets.every(
        (set) =>
          Array.isArray(set) &&
          set.length > 0 &&
          set.every(
            (claimId) => typeof claimId === 'string' && claimIds.has(claimId)
          )
      ))
  )
    fail(
      `the dcql query "${id}" has invalid claim_sets: each set must name claims of this query`
    )
  if (input.multiple !== undefined && typeof input.multiple !== 'boolean')
    fail(`the dcql query "${id}" has an invalid multiple`)
  if (
    input.require_cryptographic_holder_binding !== undefined &&
    input.require_cryptographic_holder_binding !== true
  )
    fail(
      `the dcql query "${id}": require_cryptographic_holder_binding cannot be disabled`
    )
  return { id, format: input.format }
}

function checkDcql(
  input: unknown,
  allowEmpty: boolean
): { id: string; format: string }[] {
  if (!isRecord(input)) fail('dcql must be an object')
  const min = allowEmpty ? 0 : 1
  if (
    !Array.isArray(input.credentials) ||
    input.credentials.length < min ||
    input.credentials.length > MAX_CREDENTIAL_QUERIES
  )
    fail(`dcql.credentials needs ${min} to ${MAX_CREDENTIAL_QUERIES} queries`)

  const queries = input.credentials.map(checkCredentialQuery)
  const ids = new Set<string>()
  for (const { id } of queries) {
    if (ids.has(id)) fail(`the dcql credential id "${id}" is used twice`)
    ids.add(id)
  }

  if (input.credential_sets !== undefined) {
    const sets = input.credential_sets
    if (!Array.isArray(sets) || !sets.length || sets.length > MAX_SETS)
      fail('dcql.credential_sets is invalid')
    for (const set of sets) {
      if (
        !isRecord(set) ||
        !Array.isArray(set.options) ||
        !set.options.length ||
        set.options.length > MAX_SETS ||
        !set.options.every(
          (option) =>
            Array.isArray(option) &&
            option.length > 0 &&
            option.every((id) => typeof id === 'string' && ids.has(id))
        )
      )
        fail('dcql.credential_sets options must name dcql credential ids')
      if (set.required !== undefined && typeof set.required !== 'boolean')
        fail('dcql.credential_sets required must be a boolean')
    }
  }

  return queries
}

/**
 * Checks an `SSIpolicyV2` value against the rules the node applies at indexing and at
 * `ssiInitiate` (`pontusx-node` `ssi/dcql.ts`, `ssi/rego.ts`), so a value the node would
 * mark invalid is refused before anything is published. The node stays authoritative:
 * rego is compiled only by `validateRego` on the node.
 *
 * Throws an `SsiPolicyValidationError` naming the first problem.
 */
export function validateSsiPolicyV2Value(value: unknown): void {
  if (!isRecord(value)) fail('an SSIpolicyV2 value must be an object')
  assertSafeJson(value)
  if (JSON.stringify(value).length > MAX_ENTRY_BYTES)
    fail('the SSIpolicyV2 value is larger than 256 KiB')
  if (value.version !== '2') fail('an SSIpolicyV2 value needs version "2"')

  const gaiax = value.gaiax
  let requireGaiaX = false
  if (gaiax !== undefined) {
    if (!isRecord(gaiax)) fail('gaiax must be an object')
    const { requireCompliance, minLabelLevel } = gaiax
    if (
      requireCompliance !== undefined &&
      typeof requireCompliance !== 'boolean'
    )
      fail('gaiax.requireCompliance must be a boolean')
    if (
      minLabelLevel !== undefined &&
      !(GAIAX_LABEL_LEVELS as readonly unknown[]).includes(minLabelLevel)
    )
      fail(
        `gaiax.minLabelLevel must be one of ${GAIAX_LABEL_LEVELS.join(', ')}`
      )
    if (minLabelLevel !== undefined && requireCompliance === false)
      fail('gaiax.minLabelLevel is set but gaiax.requireCompliance is false')
    requireGaiaX = requireCompliance === true || minLabelLevel !== undefined
  }

  const queries =
    value.dcql === undefined && requireGaiaX
      ? []
      : checkDcql(value.dcql, requireGaiaX)
  const ids = new Set(queries.map(({ id }) => id))

  const reserved = queries.find(({ id }) =>
    GAIAX_RESERVED_QUERY_IDS.includes(id)
  )
  if (reserved)
    fail(
      `the dcql credential id "${reserved.id}" is reserved for the node's Gaia-X queries`
    )

  if (requireGaiaX) checkGaiaXQueries(queries)

  checkPolicyList(value.vcPolicies, 'vcPolicies')

  if (value.specificVcPolicies !== undefined) {
    if (!isRecord(value.specificVcPolicies))
      fail('specificVcPolicies must be an object')
    for (const [id, list] of Object.entries(value.specificVcPolicies)) {
      if (!ids.has(id))
        fail(
          `specificVcPolicies names "${id}", which is not a dcql credential id`
        )
      checkPolicyList(list, `specificVcPolicies.${id}`)
    }
  }

  if (value.rego !== undefined) {
    if (!Array.isArray(value.rego) || value.rego.length > MAX_REGO_POLICIES)
      fail(`rego must be an array of at most ${MAX_REGO_POLICIES} policies`)
    if (value.rego.length && !ids.size)
      fail(
        'rego needs a dcql credential query: it never runs on the Gaia-X queries'
      )
    for (const entry of value.rego) {
      if (!isRecord(entry)) fail('a rego entry must be an object')
      if (
        typeof entry.name !== 'string' ||
        !entry.name ||
        entry.name.length > 128
      )
        fail('rego.name must be a non-empty string of at most 128 characters')
      if (typeof entry.code !== 'string' || !entry.code)
        fail(`rego "${entry.name}": code must be inline rego source`)
      if (entry.argument !== undefined && !isRecord(entry.argument))
        fail(`rego "${entry.name}": argument must be an object`)
      if (entry.credentialId !== undefined) {
        const id = queryId(entry.credentialId, 'rego.credentialId')
        if (!ids.has(id))
          fail(
            `rego "${entry.name}": credentialId "${id}" is not a dcql credential id`
          )
      }
      const problem = regoProblem(entry.code)
      if (problem) fail(`rego "${entry.name}": ${problem}`)
    }
  }

  if (
    value.consumerBinding !== undefined &&
    typeof value.consumerBinding !== 'boolean'
  )
    fail('consumerBinding must be a boolean')
}

const FORBIDDEN_CODE_POINTS = new Set([
  0x00, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029, 0xfeff
])
const PACKAGE_STATEMENT = /^[ \t]*package(?![A-Za-z0-9_])/
const FORBIDDEN_BUILTINS: [RegExp, string][] = [
  [/\bhttp\s*\.\s*send\b/, 'http.send'],
  [/\bnet\s*\.\s*lookup_ip_addr\b/, 'net.lookup_ip_addr'],
  [/\bopa\s*\.\s*runtime\b/, 'opa.runtime'],
  [/\bhttp\s*\[/, 'http.send'],
  [/\bnet\s*\[/, 'net.lookup_ip_addr'],
  [/\bopa\s*\[/, 'opa.runtime'],
  [/(?<![A-Za-z0-9_.\]])print\s*\(/, 'print'],
  [/(?<![A-Za-z0-9_.\]])trace\s*\(/, 'trace']
]

/** Rego without its strings and comments, as the node strips it before its checks. */
function stripRego(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '#') while (i < code.length && code[i] !== '\n') i++
    else if (ch === '"') {
      i++
      while (i < code.length && code[i] !== '"' && code[i] !== '\n')
        i += code[i] === '\\' ? 2 : 1
      i++
      out += '""'
    } else if (ch === '`') {
      i++
      while (i < code.length && code[i] !== '`') i++
      i++
      out += '""'
    } else {
      out += ch
      i++
    }
  }
  return out
}

/**
 * Why the node's static rego checks would refuse `code`, or `undefined`: at most 64 KiB,
 * only `\n` line endings, at most one `package` statement and only as the first statement,
 * no reference to `data`, only `rego.v1`, `future.keywords` and `input` imports, and none
 * of `http.send`, `net.lookup_ip_addr`, `opa.runtime`, `print` or `trace`.
 */
export function regoProblem(code: string): string | undefined {
  if (new TextEncoder().encode(code).length > MAX_REGO_BYTES)
    return 'the code is larger than 64 KiB'
  for (let i = 0; i < code.length; i++)
    if (FORBIDDEN_CODE_POINTS.has(code.charCodeAt(i)))
      return 'the code contains forbidden characters (only \\n line endings are allowed)'

  const stripped = stripRego(code)
  const forbidden = new Set<string>()
  for (const [pattern, name] of FORBIDDEN_BUILTINS)
    if (pattern.test(stripped)) forbidden.add(name)
  if (forbidden.size)
    return `the code uses forbidden builtins: ${[...forbidden].sort().join(', ')}`

  const lines = code.split('\n')
  const packages = lines.filter((line) => PACKAGE_STATEMENT.test(line))
  if (packages.length > 1)
    return 'the code must contain exactly one package statement'
  let body = lines
  if (packages.length === 1) {
    const first = lines.findIndex((line) => {
      const rest = line.replace(/^[ \t]+/, '')
      return rest !== '' && !rest.startsWith('#')
    })
    if (first === -1 || !PACKAGE_STATEMENT.test(lines[first]))
      return 'the package statement must be the first statement'
    body = lines.slice(first + 1)
  }

  const rest = stripRego(body.join('\n'))
  if (/\bdata\b/.test(rest))
    return 'the code must not reference data (only input and its own rules)'
  for (const statement of rest.match(/\bimport\s+[^\s]+/g) ?? []) {
    const target = statement.replace(/^import\s+/, '')
    const parts = target.split('.')
    const allowed =
      parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) &&
      (target === 'rego.v1' ||
        (parts[0] === 'future' &&
          parts[1] === 'keywords' &&
          parts.length <= 3) ||
        parts[0] === 'input')
    if (!allowed) return `the import "${target.slice(0, 64)}" is not allowed`
  }

  return undefined
}

// #endregion
