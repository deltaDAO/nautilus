/**
 * DDO v5 vocabulary that `@oceanprotocol/ddo-js` does not expose, plus the credential
 * shapes the running stack actually accepts.
 *
 * Two reasons this file exists:
 *
 * 1. `@oceanprotocol/ddo-js` re-exports its DDO5 credential module with *named* exports
 *    only, so `CredentialPolicyBased`, `RequestCredential`, `Policy`, the v5 `Credentials`
 *    wrapper, `License` and friends are unreachable from the package. Unqualified
 *    `Credential`/`Credentials` resolve to the **v4** shapes.
 * 2. The declared v5 credential type (`type: 'verifiableCredential'` with
 *    `requestCredentials`) is not what the policy server parses. It only understands
 *    `type: 'SSIpolicy'` with `values: [{ request_credentials, vc_policies, vp_policies }]`
 *    — see `policy-server/src/handlers/waltIdPolicyHandler.ts#parseRequestCredentials`,
 *    and the reference DDOs in `ocean-cli/metadata/simpleDownloadDatasetV5.json`.
 *
 * The types below follow the running stack. Where ddo-js and the stack disagree, the
 * stack wins.
 */

// #region policies

/** A VC verification policy: a bare name, or a name with an argument. */
export type VcPolicy = string

/** A VP verification policy. `args` is passed through to walt.id verbatim. */
export type VpPolicy = string | { policy: string; args?: unknown }

/** A per-credential policy attached to a single `request_credentials` entry. */
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

// #endregion

// #region credential entries

/** Address allow/deny list. The stack accepts bare strings too, but writes objects. */
export interface AddressCredential {
  type: 'address'
  values: { address: string }[]
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
  request_credentials: RequestCredential[]
  vc_policies?: VcPolicy[]
  vp_policies?: VpPolicy[]
}

export type DdoCredential =
  | AddressCredential
  | AccessListCredential
  | SsiPolicyCredential

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

// #region metadata pieces ddo-js does not export

/** A language-tagged string. v5 uses these wherever v4 used a plain `string`. */
export interface LanguageValue {
  '@value': string
  '@language': string
  '@direction': string
}

/** One retrievable location for a `RemoteObject`. */
export interface RemoteSource {
  type: string
  url?: string
  method?: string
  headers?: string | Record<string, string | number | boolean>
  ipfsCid?: string
}

/** A referenced document — license text, attachment, or a data/input/output schema. */
export interface RemoteObject {
  name: string
  displayName?: LanguageValue
  description?: LanguageValue
  fileType: string
  sha256: string
  mirrors: RemoteSource[]
  additionalInformation?: Record<string, string | number | boolean>
}

/** v5 replaced the plain `license: string` with a structured object. */
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

// #endregion
