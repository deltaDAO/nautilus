/**
 * DDO v5 vocabulary that `@oceanprotocol/ddo-js` does not expose, plus the credential
 * shapes the running stack actually accepts.
 *
 * Two reasons this file exists:
 *
 * 1. `@oceanprotocol/ddo-js` re-exports its DDO5 credential and metadata modules with
 *    *named* exports only, so `CredentialPolicyBased`, `RequestCredential`, `Policy`, the
 *    v5 `Credentials` wrapper and `License` are unreachable from the package root.
 *    Unqualified `Credential`/`Credentials` resolve to the **v4** shapes.
 * 2. The declared v5 credential type (`type: 'verifiableCredential'` with
 *    `requestCredentials`) is not what the policy server parses. It only understands
 *    `type: 'SSIpolicy'` with `values: [{ request_credentials, vc_policies, vp_policies }]`
 *    — see `policy-server/src/handlers/waltIdPolicyHandler.ts#parseRequestCredentials`,
 *    and the reference DDOs in `ocean-cli/metadata/simpleDownloadDatasetV5.json`.
 *
 * The types below follow the running stack. Where ddo-js and the stack disagree, the
 * stack wins.
 *
 * Anything ddo-js *does* expose is taken from there rather than re-declared here — see
 * `./ddo-js.ts`.
 */
import type { RemoteObject } from '@oceanprotocol/ddo-js'

// #region policies

/** A VC verification policy, by name. */
export type VcPolicy = string

/**
 * A VP verification policy. Always an object, as the enterprise market writes it: ocean-node
 * 4.2.x did not index an asset whose `vp_policies` mixed a name with an object.
 *
 * `args` is a string, as the enterprise market writes it. The policy server JSON-parses it
 * when it can (`'1'` reaches walt.id as `1`), so pass structured arguments through
 * `JSON.stringify`.
 */
export interface VpPolicy {
  policy: string
  args?: string
}

/**
 * A per-credential policy attached to a single `request_credentials` entry: a walt.id
 * policy name, or a name with arguments.
 */
export type CredentialPolicy = string | { policy: string; args?: unknown }

/**
 * One credential the verifier should ask the holder to present.
 * `format` is a walt.id credential format such as `jwt_vc_json`.
 */
export interface RequestCredential {
  type: string
  format?: string
  policies?: CredentialPolicy[]
}

/**
 * A `request_credentials` entry as stored in the DDO: each policy JSON-encoded, which is
 * what the policy server parses (it drops a string that is not JSON) and what the
 * enterprise market writes. It also keeps the array a single type for the node's index.
 */
export interface StoredRequestCredential {
  type: string
  format?: string
  policies?: string[]
}

// #endregion

// #region credential entries

/**
 * Address allow/deny list. nautilus writes `{ address }` objects, as the enterprise market
 * does; assets from other producers can hold bare strings, which the policy server and
 * OceanProtocolEnterprise ocean-node read too.
 */
export interface AddressCredential {
  type: 'address'
  values: ({ address: string } | string)[]
}

/** On-chain access-list gating. */
export interface AccessListCredential {
  type: 'accessList'
  chainId: number
  accessList: string
}

/**
 * SSI gating. Note the snake_case keys — this is the on-chain wire format the policy
 * server reads, not a TypeScript-idiomatic shape.
 */
export interface SsiPolicyCredential {
  type: 'SSIpolicy'
  values: SsiPolicyValue[]
}

export interface SsiPolicyValue {
  request_credentials: StoredRequestCredential[]
  vc_policies?: VcPolicy[]
  vp_policies?: VpPolicy[]
}

/**
 * SSI gating for nodes with the native SSI module (pontusx-node / ocean-node with
 * verifier-api2, OpenID4VP 1.0 and DCQL), which replaced the policy server. The node asks
 * the consumer for the presentation described by `dcql`, and the verifier and the node
 * check the policies. Every entry of the asset and of the requested service must be
 * satisfied (AND).
 *
 * Only valid in `credentials.allow`: the node rejects SSI entries in `deny`.
 */
export interface SsiPolicyV2Credential {
  type: 'SSIpolicyV2'
  values: SsiPolicyV2Value[]
}

/** A DCQL credential format the node accepts. */
export type SsiCredentialFormat = 'jwt_vc_json' | 'dc+sd-jwt' | 'vc+sd-jwt'

/** One DCQL claims query: a path into the credential and, optionally, accepted values. */
export interface DcqlClaimsQuery {
  id?: string
  path: (string | number | null)[]
  values?: (string | number | boolean)[]
}

/**
 * One DCQL credential query (OpenID4VP 1.0 §6.1). `id` matches `[A-Za-z0-9_-]{1,64}`; the
 * ids `gx_compliance`, `gx_legal_person` and `gx_service_offering` are reserved for the
 * node's Gaia-X queries.
 */
export interface DcqlCredentialQuery {
  id: string
  format: SsiCredentialFormat
  /**
   * Format-specific filters: `{ type_values: [["gx:LegalPerson"]] }` for `jwt_vc_json`,
   * `{ vct_values: ["…"] }` for SD-JWT VCs.
   */
  meta?: Record<string, unknown>
  claims?: DcqlClaimsQuery[]
  claim_sets?: string[][]
  multiple?: boolean
  trusted_authorities?: { type: string; values: string[] }[]
  /** Holder binding is mandatory: the node refuses `false`. */
  require_cryptographic_holder_binding?: true
}

/** Alternatives of credential query ids, one of which must be presented. */
export interface DcqlCredentialSet {
  options: string[][]
  required?: boolean
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[]
  credential_sets?: DcqlCredentialSet[]
}

/**
 * A VC policy of an `SSIpolicyV2` value, by the node's contract name. The node maps each
 * to verifier-api2's wire name and refuses anything else (`regex` and `webhook` included).
 */
export type SsiVcPolicy =
  | 'signature'
  | 'expiration'
  | 'not_before'
  | 'revocation'
  | 'vct_integrity'
  | { policy: 'allowed_issuer'; allowed_issuer: string | string[] }
  | { policy: 'json_schema'; schema: Record<string, unknown> }
  | { policy: 'status'; argument: Record<string, unknown> }

/** A Gaia-X label level the node can check, lowest first. */
export type GaiaXLabelLevel = 'SC' | 'L1' | 'L2' | 'L3'

/** One inline rego policy, evaluated by the verifier's OPA for each presented credential. */
export interface SsiRegoPolicy {
  name: string
  /** Inline rego source, at most 64 KiB, exactly one leading `package` statement. */
  code: string
  /** Passed to the policy as `input.parameter`. */
  argument?: Record<string, unknown>
  /** Evaluate only against the credentials presented for this DCQL query id. */
  credentialId?: string
}

/** One value of an `SSIpolicyV2` entry. */
export interface SsiPolicyV2Value {
  version: '2'
  /**
   * What the consumer must present. May be empty (`{ credentials: [] }`) for a Gaia-X-only
   * value: the node adds the Gaia-X queries itself.
   */
  dcql: DcqlQuery
  /** Policies run on every credential of this value; `signature` is always added. */
  vcPolicies?: SsiVcPolicy[]
  /** Policies run on the credentials of one DCQL query id. */
  specificVcPolicies?: Record<string, SsiVcPolicy[]>
  /**
   * Gaia-X compliance of the presenting organisation. A level alone implies the
   * requirement; `requireCompliance: true` without one means `SC`. Cannot be combined with
   * `jwt_vc_json` queries applying to the same service (use `dc+sd-jwt` for other credentials).
   */
  gaiax?: { requireCompliance?: boolean; minLabelLevel?: GaiaXLabelLevel }
  rego?: SsiRegoPolicy[]
  /**
   * Require every presented credential to be bound to the consumer's EVM address: a
   * `jwt_vc_json` holder must be `did:pkh`/`did:ethr` of the consumer, a `dc+sd-jwt` is bound
   * by the node's transaction data (sent for `dc+sd-jwt` either way), a `vc+sd-jwt` cannot be
   * bound and fails. Default `false`.
   */
  consumerBinding?: boolean
}

export type DdoCredential =
  | AddressCredential
  | AccessListCredential
  | SsiPolicyCredential
  | SsiPolicyV2Credential

export type MatchRule = 'any' | 'all'

/**
 * The `credentials` block, as it appears both on the asset (`credentialSubject.credentials`)
 * and on each service. It is an object, despite `CredentialSubject.credentials` being
 * typed as an array upstream.
 */
export interface DdoCredentials {
  allow?: DdoCredential[]
  deny?: DdoCredential[]
  /** Default `'all'` — every allow rule must match. */
  match_allow?: MatchRule
  /** Default `'any'` — any deny rule blocks. */
  match_deny?: MatchRule
}

/** Which list a credential is being added to or removed from. */
export enum CredentialListTypes {
  ALLOW = 'allow',
  DENY = 'deny'
}

// #endregion

// #region metadata pieces

/**
 * Taken from ddo-js rather than re-declared: its root star-exports `DDO5/Remote.js`, so
 * unlike the credential module these three are reachable.
 *
 * `LanguageValue` — a language-tagged string, used wherever v4 used a plain `string` — is
 * ddo-js's `LanguageValueObject` under the name nautilus has always exposed.
 */
export type {
  LanguageValueObject as LanguageValue,
  RemoteObject,
  RemoteSource
} from '@oceanprotocol/ddo-js'

/**
 * v5 replaced the plain `license: string` with a structured object.
 *
 * Identical to ddo-js's `License`, but unreachable: `DDO5/Metadata.js` is exported as
 * `{ Metadata as MetadataV5 }` only, so nothing else in that module escapes the package.
 */
export interface License {
  name: string
  ODRL?: unknown
  licenseDocuments?: RemoteObject[]
}

// #endregion

// #region consumer parameters

/**
 * v5 consumer parameter. Differs from v4 in two places: `options` is an array (v4 encoded
 * it as a JSON string) and `default` keeps its type (v4 coerced everything to string).
 */
export interface ConsumerParameterV5 {
  name: string
  type: string
  label: string
  required: boolean
  description: string
  default: string | number | boolean
  options?: ConsumerParameterOption[]
}

export type ConsumerParameterOption = Record<
  string,
  string | number | boolean | Record<string, string>[]
>

// #endregion

// #region policy server payloads

/**
 * What ocean.js takes in its opaque `policyServer` slots. `sessionId` is the only field
 * that carries information; the redirect URIs are sent empty and the policy server
 * substitutes its own defaults.
 */
export interface PolicyServerPayload {
  sessionId: string
  successRedirectUri: string
  errorRedirectUri: string
  responseRedirectUri: string
  presentationDefinitionUri: string
}

/**
 * The compute variant. The policy server receives the whole array on every per-asset call
 * and selects the entry matching `documentId` + `serviceId`, so both must be set.
 */
export interface PolicyServerComputePayload extends PolicyServerPayload {
  documentId: string
  serviceId: string
}

/**
 * The `policyServer` field for a node with the native SSI module: the id of a verified SSI
 * session (`ssiInitiate`). The field keeps its name for ocean.js compatibility.
 */
export interface SsiSessionPayload {
  sessionId: string
}

/**
 * The `policyServer` field of a compute job on a node with the native SSI module: one
 * session per input with an SSI requirement, keyed by its DID. `sessionId` is the first of
 * them, for nodes that read only that.
 */
export interface SsiComputePayload {
  sessionId: string
  sessionIds: Record<string, string>
}

// #endregion
