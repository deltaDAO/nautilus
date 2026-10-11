/**
 * Checks an asset's `SSIpolicy` blocks for setups that cannot work, or that check much less
 * than they seem to, before anything is published. `AssetBuilder.build()` runs it.
 *
 * What the stack does with the policies, and so what is checked (walt.id 90e568f, policy
 * server ea776b7):
 *
 * - The policy server keeps only the **name** of an asset- or service-level VC policy
 *   (`waltIdPolicyHandler.ts:857-868`). A VC policy that needs arguments (`allowed-issuer`,
 *   `schema`, `webhook`, `dynamic`, `credential-status`) then fails in walt.id for every
 *   presentation, and any other VC policy with arguments silently runs without them. Both
 *   throw here, whatever the lint mode: such an asset cannot work as written.
 * - walt.id reads `minimum-credentials`, `maximum-credentials` and `vp_required_credentials`
 *   arguments without a null check, so a bare one fails every presentation. That throws too.
 * - `holder-binding` reads the JWT `sub` of every credential, and fails on credentials
 *   without one (VCDM 2.0 `vc+jwt`, Gaia-X): a warning.
 * - `presentation-definition` filters on `$.vc.type` for `jwt_vc_json` and `jwt_vc`
 *   requests, which VCDM 2.0 credentials do not have: a warning.
 * - A requested credential without a per-credential `allowed-issuer` accepts a credential
 *   of that type from any issuer, a self-issued one included: a warning.
 *
 * No warning for a missing `presentation-definition`: it would push publishers into the
 * failure above. And nothing here closes the type bypass (a hand-built presentation with a
 * credential of another type), which needs the policy server; see the identity guide.
 */
import type {
  DdoCredentials,
  SsiPolicyValue,
  StoredRequestCredential
} from '../ddo/types.js'
import type { LogEventName } from '../log/events.js'
import { type Logger, log } from '../log/logger.js'
import { sanitize } from '../node/messages.js'
import { isSsiPolicyCredential } from './policy.js'

/**
 * What `AssetBuilder.build()` does with the SSI policy warnings: log them (`'warn'`, the
 * default), throw an `SsiPolicyError` (`'error'`), or skip them (`'off'`). Setups that cannot
 * work throw in every mode.
 */
export type SsiPolicyLintMode = 'warn' | 'error' | 'off'

/** One problem the lint found. */
export interface SsiPolicyFinding {
  /**
   * - `vc-policy-arguments`: a VC policy at asset or service level that needs or carries
   *   arguments, which the policy server drops;
   * - `vp-policy-arguments`: a VP policy that needs arguments and has none;
   * - `holder-binding`: `holder-binding` among the VP policies;
   * - `presentation-definition-vc-jwt`: `presentation-definition` with a `jwt_vc_json` or
   *   `jwt_vc` request credential;
   * - `no-issuer-trust`: a request credential without a per-credential `allowed-issuer`.
   */
  code:
    | 'vc-policy-arguments'
    | 'vp-policy-arguments'
    | 'holder-binding'
    | 'presentation-definition-vc-jwt'
    | 'no-issuer-trust'
  /** `true` for setups that cannot work: these throw whatever the lint mode. */
  fatal: boolean
  /** Where it was found: `'asset'`, or `'service <id or name>'`. */
  where: string
  /** The policy concerned. */
  policy: string
  /** The requested credential type, for findings about one. */
  credentialType?: string
  message: string
}

/** Raised by `AssetBuilder.build()` for SSI policies that cannot work, or for any finding under `ssiPolicyLint: 'error'`. */
export class SsiPolicyError extends Error {
  readonly findings: SsiPolicyFinding[]

  constructor(findings: SsiPolicyFinding[]) {
    super(
      findings.length === 1
        ? findings[0].message
        : `The asset's SSI policies have ${findings.length} problems:\n${findings.map((finding) => `- ${finding.message}`).join('\n')}`
    )
    this.name = 'SsiPolicyError'
    this.findings = findings
  }
}

/** One place an `SSIpolicy` block can sit. */
export interface SsiPolicyScope {
  /** `'asset'`, or `'service <id or name>'`. */
  where: string
  credentials: DdoCredentials | undefined
}

/** VC policies walt.id cannot run without arguments. */
const VC_POLICIES_NEEDING_ARGS = new Set([
  'allowed-issuer',
  'schema',
  'webhook',
  'dynamic',
  'credential-status'
])

/** VP policies walt.id reads arguments of without a null check. */
const VP_POLICIES_NEEDING_ARGS = new Set([
  'minimum-credentials',
  'maximum-credentials',
  'vp_required_credentials'
])

/** Request formats whose generated presentation definition filters on `$.vc.type`. */
const VC_TYPE_FILTER_FORMATS = new Set(['jwt_vc_json', 'jwt_vc'])

const WARNING_EVENTS: Record<string, LogEventName> = {
  'holder-binding': 'identity.policy.holder_binding',
  'presentation-definition-vc-jwt':
    'identity.policy.presentation_definition_vc_jwt',
  'no-issuer-trust': 'identity.policy.no_issuer_trust'
}

/**
 * Every finding for an asset-level block and its services' blocks. The policy server merges
 * the asset's `allow` list with the accessed service's, so a block counts only when the
 * merged view requests a credential, and `presentation-definition` is checked against the
 * merged request credentials. Each finding is reported once, where its policy sits.
 */
export function lintSsiPolicies(
  asset: SsiPolicyScope,
  services: SsiPolicyScope[]
): SsiPolicyFinding[] {
  const findings = new Map<string, SsiPolicyFinding>()
  const add = (finding: SsiPolicyFinding) => {
    const key = JSON.stringify([
      finding.code,
      finding.where,
      finding.policy,
      finding.credentialType ?? null
    ])
    if (!findings.has(key)) findings.set(key, finding)
  }

  const assetValues = ssiValues(asset.credentials)
  const scopes = services.length ? services : [{ where: '', credentials: {} }]

  for (const service of scopes) {
    const serviceValues = ssiValues(service.credentials)
    const merged = [...assetValues, ...serviceValues]
    if (!merged.some((value) => requestCredentials(value).length)) continue

    lintValues(asset.where, assetValues, add)
    if (service.where) lintValues(service.where, serviceValues, add)

    const pdWhere = assetValues.some((value) =>
      vpPolicyNames(value).includes('presentation-definition')
    )
      ? asset.where
      : service.where
    if (
      merged.some((value) =>
        vpPolicyNames(value).includes('presentation-definition')
      )
    )
      for (const credential of merged.flatMap(requestCredentials))
        if (
          typeof credential.format === 'string' &&
          VC_TYPE_FILTER_FORMATS.has(credential.format)
        )
          add({
            code: 'presentation-definition-vc-jwt',
            fatal: false,
            where: pdWhere,
            policy: 'presentation-definition',
            credentialType: credential.type,
            message: `The ${pdWhere} VP policy 'presentation-definition' will refuse VCDM 2.0 '${shown(credential.type)}' credentials (${credential.format}): walt.id's generated definition looks for the type at $.vc.type, which vc+jwt credentials such as Gaia-X ones do not have, so every such consumer is refused. Leave it out unless every accepted credential is VCDM 1.1.`
          })
  }

  return [...findings.values()]
}

/**
 * Throws an `SsiPolicyError` for the fatal findings in every mode, and for all of them under
 * `'error'`; logs the others under `'warn'`.
 */
export function applySsiPolicyLint(
  findings: SsiPolicyFinding[],
  mode: SsiPolicyLintMode = 'warn',
  logger: Logger = log
): void {
  const fatal = findings.filter((finding) => finding.fatal)
  if (fatal.length) throw new SsiPolicyError(fatal)

  if (mode === 'off' || !findings.length) return
  if (mode === 'error') throw new SsiPolicyError(findings)

  for (const finding of findings)
    logger.emit(WARNING_EVENTS[finding.code], finding.message, {
      where: finding.where,
      ...(finding.credentialType !== undefined
        ? { credentialType: finding.credentialType }
        : {})
    })
}

/** Checks one block's own policies (see `lintSsiPolicies`). */
function lintValues(
  where: string,
  values: SsiPolicyValue[],
  add: (finding: SsiPolicyFinding) => void
): void {
  for (const value of values) {
    for (const raw of toArray(value.vc_policies)) {
      const { name, hasArgs } = readPolicy(raw)
      if (!name || !(hasArgs || VC_POLICIES_NEEDING_ARGS.has(name))) continue

      add({
        code: 'vc-policy-arguments',
        fatal: true,
        where,
        policy: name,
        message: `The ${where} VC policy '${shown(name)}' ${hasArgs ? 'has arguments' : 'needs arguments'}, and the policy server keeps only the name of an asset- or service-level VC policy: ${VC_POLICIES_NEEDING_ARGS.has(name) ? 'walt.id would fail it for every presentation, refusing every consumer' : 'walt.id would run it without them, a different check'}. Put it on the credential instead: addRequestCredentials(list, [{ type, format, policies: [{ policy: '${shown(name)}', args }] }]).`
      })
    }

    for (const raw of toArray(value.vp_policies)) {
      const { name, hasArgs } = readPolicy(raw)
      if (!name) continue

      if (VP_POLICIES_NEEDING_ARGS.has(name) && !hasArgs)
        add({
          code: 'vp-policy-arguments',
          fatal: true,
          where,
          policy: name,
          message: `The ${where} VP policy '${name}' needs its argument, e.g. { policy: '${name}', args: '1' }: without it walt.id fails it for every presentation, refusing every consumer.`
        })

      if (name === 'holder-binding')
        add({
          code: 'holder-binding',
          fatal: false,
          where,
          policy: name,
          message: `The ${where} VP policy 'holder-binding' requires every presented credential's JWT 'sub' to be the presenter's DID. Credentials without 'sub', such as Gaia-X and other VCDM 2.0 vc+jwt credentials with a URL subject, cannot satisfy it: walt.id refuses them all. Leave it out unless every accepted credential is issued to the holder's DID.`
        })
    }

    for (const credential of requestCredentials(value))
      if (
        !toArray(credential.policies).some(
          (policy) => readCredentialPolicyName(policy) === 'allowed-issuer'
        )
      )
        add({
          code: 'no-issuer-trust',
          fatal: false,
          where,
          policy: 'allowed-issuer',
          credentialType: credential.type,
          message: `The ${where} request for '${shown(credential.type)}' credentials has no per-credential 'allowed-issuer', so a '${shown(credential.type)}' credential from any issuer, a self-issued one included, is accepted. Add { policy: 'allowed-issuer', args: ['did:…'] } to its policies.`
        })
  }
}

/** The `SSIpolicy` values of a block's `allow` list. */
function ssiValues(credentials: DdoCredentials | undefined): SsiPolicyValue[] {
  return toArray(credentials?.allow)
    .filter((entry): entry is { type: 'SSIpolicy'; values: unknown } =>
      isSsiPolicyCredential(entry as never)
    )
    .flatMap((entry) => toArray(entry.values))
    .filter(
      (value): value is SsiPolicyValue =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
    )
}

function requestCredentials(value: SsiPolicyValue): StoredRequestCredential[] {
  return toArray(value.request_credentials).filter(
    (credential): credential is StoredRequestCredential =>
      typeof (credential as StoredRequestCredential | null)?.type === 'string'
  )
}

function vpPolicyNames(value: SsiPolicyValue): string[] {
  return toArray(value.vp_policies).flatMap((raw) => {
    const { name } = readPolicy(raw)
    return name ? [name] : []
  })
}

/** A policy as a name or `{ policy, args? }`, the way the policy server reads it. */
function readPolicy(raw: unknown): { name?: string; hasArgs: boolean } {
  if (typeof raw === 'string') return { name: raw, hasArgs: false }

  const { policy, args } = (raw ?? {}) as { policy?: unknown; args?: unknown }
  return {
    name: typeof policy === 'string' ? policy : undefined,
    hasArgs: args !== undefined && args !== null && args !== ''
  }
}

/** A per-credential policy's name: stored JSON-encoded, or as the builder takes it. */
function readCredentialPolicyName(raw: unknown): string | undefined {
  let policy = raw
  if (typeof raw === 'string')
    try {
      policy = JSON.parse(raw)
    } catch {
      return raw
    }

  return readPolicy(policy).name
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  return raw === undefined || raw === null ? [] : [raw]
}

/** A publisher-supplied name, made safe to quote. */
function shown(text: string): string {
  return sanitize(text, 100, null)
}
