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

// #endregion
