/**
 * Checks an asset's `SSIpolicy` blocks for setups that cannot work, or that check much less
 * than they seem to, before anything is published. `AssetBuilder.build()` runs it.
 *
 * What the stack does with the policies, and so what is checked (walt.id 90e568f, policy
 * server ea776b7):
 *
 * - The policy server merges the asset's `allow` list with the accessed service's
 *   (`waltIdPolicyHandler.ts:698-889`). A service whose merged view holds an `SSIpolicy`
 *   entry but requests no credential is refused for every consumer ("SSIpolicy was found,
 *   but failed to fetch request credentials"). That throws here, whatever the lint mode.
 * - The policy server keeps only the **name** of an asset- or service-level VC policy
 *   (`waltIdPolicyHandler.ts:857-868`). A VC policy that needs arguments (`allowed-issuer`,
 *   `schema`, `webhook`, `dynamic`, `credential-status`) then fails in walt.id for every
 *   presentation, and any other VC policy with arguments silently runs without them. Both
 *   throw: such an asset cannot work as written.
 * - walt.id reads the arguments of `minimum-credentials` and `maximum-credentials` as an
 *   integer and those of `vp_required_credentials` as `{ required: [...] }`, without a
 *   check, so a bare or misshapen one fails every presentation. That throws too, as does a
 *   per-credential `allowed-issuer` that admits no issuer (none, `[]`, `'*'`).
 * - Weaker than PR 1's safe set (D4): no VC `signature` (a credential naming the trusted
 *   issuer but signed by anyone passes), no VP `signature`, no `minimum-credentials` of at
 *   least 1 (a presentation holding no credential passes): warnings.
 * - `'*'` in the address allow list of a credential-gated service: a warning, as a
 *   hand-built presentation passes the credential check (the type bypass), leaving no gate.
 * - `holder-binding` reads the JWT `sub` of every credential, and fails on credentials
 *   without one (VCDM 2.0 `vc+jwt`, Gaia-X): a warning.
 * - `presentation-definition` filters on `$.vc.type` for `jwt_vc_json` and `jwt_vc`
 *   requests, which VCDM 2.0 credentials do not have: a warning.
 * - walt.id keeps one per-credential policy list per requested type, the last non-empty one
 *   (`VerifierService.kt:104-108`), after the policy server drops repeats of an identical
 *   request, keeping the first one's position (`waltIdPolicyHandler.ts:873-890`). A policy
 *   of a list it drops never runs, so the gate is weaker than written: that throws. A
 *   requested type whose effective list has no `allowed-issuer` accepts a credential of that
 *   type from any issuer, a self-issued one included: a warning.
 * - walt.id files a presented credential under the last entry of its `type`, so policies
 *   requested for `VerifiableCredential` never run on a credential with a more specific
 *   type, which a wallet still presents: that throws.
 * - walt.id refuses a session whose request credentials lack a format, mix formats, or use
 *   one it does not request (`VerifierService.getPresentationFormat`): that throws.
 * - A per-credential `schema` whose arguments are not a JSON Schema object throws. A
 *   hand-written schema that
 *   checks less than it seems (keys walt.id ignores, no constraint, optional attributes, an
 *   unsupported `$schema`) and an `allowed-issuer` entry that is not a DID: warnings.
 * - A policy name walt.id does not know: a warning (a deployment may have more).
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
import {
  credentialPolicyProblem,
  GENERIC_CREDENTIAL_TYPES,
  isDid,
  KNOWN_SSI_POLICIES,
  REQUEST_FORMATS,
  schemaWeaknesses
} from './attributes.js'
import { isSsiPolicyCredential } from './policy.js'

/**
 * What `AssetBuilder.build()` does with the SSI policy warnings: log them (`'warn'`, the
 * default), throw an `SsiPolicyError` (`'error'`), or skip them (`'off'`). Setups that cannot
 * work throw in every mode.
 */
export type SsiPolicyLintMode = 'warn' | 'error' | 'off'

/** Codes of findings that throw in every lint mode (see `SsiPolicyFinding.code`). */
export type SsiPolicyFatalCode =
  | 'no-request-credentials'
  | 'vc-policy-arguments'
  | 'vp-policy-arguments'
  | 'credential-policy-arguments'
  | 'credential-policies-replaced'
  | 'generic-request-type'
  | 'request-format'

/** Codes of findings that are warnings, each logged as its own event (see `SsiPolicyFinding.code`). */
export type SsiPolicyWarningCode =
  | 'no-vc-signature'
  | 'no-vp-signature'
  | 'no-minimum-credentials'
  | 'wildcard-allow'
  | 'holder-binding'
  | 'presentation-definition-vc-jwt'
  | 'no-issuer-trust'
  | 'issuer-not-did'
  | 'weak-schema'
  | 'unknown-policy-name'
  | 'format-ignores-type'

/** One problem the lint found. */
export interface SsiPolicyFinding {
  /**
   * Fatal (throw in every mode):
   * - `no-request-credentials`: a service whose merged view holds an `SSIpolicy` entry but
   *   requests no credential, which the policy server refuses for every consumer;
   * - `vc-policy-arguments`: a VC policy at asset or service level that needs or carries
   *   arguments, which the policy server drops;
   * - `vp-policy-arguments`: a VP policy whose arguments walt.id cannot read (missing or of
   *   the wrong shape);
   * - `credential-policy-arguments`: a per-credential `allowed-issuer` that admits no issuer,
   *   or a `schema` whose arguments are not a JSON Schema object;
   * - `credential-policies-replaced`: per-credential policies of a type requested more than
   *   once that never run, because walt.id keeps only the last non-empty list per type;
   * - `generic-request-type`: per-credential policies on `VerifiableCredential` or
   *   `VerifiablePresentation`, which walt.id never runs on a credential with a more
   *   specific type;
   * - `request-format`: request credentials without a format, with different formats, or
   *   with one walt.id does not request, which makes it refuse every session.
   *
   * Warnings:
   * - `no-vc-signature`, `no-vp-signature`, `no-minimum-credentials`: a gate weaker than the
   *   safe set (no VC `signature`, no VP `signature`, no `minimum-credentials` of at least 1);
   * - `wildcard-allow`: `'*'` in the address allow list of a credential-gated service;
   * - `holder-binding`: `holder-binding` among the VP policies;
   * - `presentation-definition-vc-jwt`: `presentation-definition` with a `jwt_vc_json` or
   *   `jwt_vc` request credential;
   * - `no-issuer-trust`: a requested type whose effective per-credential policies have no
   *   `allowed-issuer`;
   * - `issuer-not-did`: an `allowed-issuer` entry that is not a DID (walt.id compares the
   *   credential's `iss` with it as written);
   * - `weak-schema`: a per-credential `schema` that checks less than it seems;
   * - `unknown-policy-name`: a policy name walt.id does not know;
   * - `format-ignores-type`: per-credential policies on a `vc+sd-jwt` or `mso_mdoc` request,
   *   whose presentation definition walt.id does not tie to the requested type.
   */
  code: SsiPolicyFatalCode | SsiPolicyWarningCode
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

/** At most this many findings are spelled out in an `SsiPolicyError` message. */
const MAX_LISTED_FINDINGS = 20

/** Raised by `AssetBuilder.build()` for SSI policies that cannot work, or for any finding under `ssiPolicyLint: 'error'`. */
export class SsiPolicyError extends Error {
  /** Every finding, the fatal ones first (under `'off'`, the fatal ones only). */
  readonly findings: SsiPolicyFinding[]

  constructor(findings: SsiPolicyFinding[]) {
    const listed = findings
      .slice(0, MAX_LISTED_FINDINGS)
      .map((finding) => `- ${finding.message}`)
    const more = findings.length - listed.length

    super(
      findings.length === 1
        ? findings[0].message
        : `The asset's SSI policies have ${findings.length} problems:\n${listed.join('\n')}${more ? `\n… and ${more} more (see SsiPolicyError.findings).` : ''}`
    )
    this.name = 'SsiPolicyError'
    this.findings = findings
  }
}

/** One place an `SSIpolicy` block can sit. */
export interface SsiPolicyScope {
  /** `'asset'`, or `'service <id or name>'`, already safe to quote. */
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

/** VP policies walt.id reads an integer argument of, without a check. */
const VP_INTEGER_POLICIES = new Set([
  'minimum-credentials',
  'maximum-credentials'
])

/**
 * Request formats whose presentation definition walt.id does not tie to the requested type:
 * `vc+sd-jwt` asks for any `$.vct` (the policy server forwards no `vct`), `mso_mdoc` for
 * fixed mDL fields. Verified on the dev stack's verifier.
 */
const TYPE_UNFILTERED_FORMATS = new Set(['vc+sd-jwt', 'mso_mdoc'])

/** Request formats whose generated presentation definition filters on `$.vc.type`. */
const VC_TYPE_FILTER_FORMATS = new Set(['jwt_vc_json', 'jwt_vc'])

/** The event each warning is logged as: a new warning code fails to compile without one. */
const WARNING_EVENTS: Record<SsiPolicyWarningCode, LogEventName> = {
  'no-vc-signature': 'identity.policy.no_vc_signature',
  'no-vp-signature': 'identity.policy.no_vp_signature',
  'no-minimum-credentials': 'identity.policy.no_minimum_credentials',
  'wildcard-allow': 'identity.policy.wildcard_allow',
  'holder-binding': 'identity.policy.holder_binding',
  'presentation-definition-vc-jwt':
    'identity.policy.presentation_definition_vc_jwt',
  'no-issuer-trust': 'identity.policy.no_issuer_trust',
  'issuer-not-did': 'identity.policy.issuer_not_did',
  'weak-schema': 'identity.policy.weak_schema',
  'unknown-policy-name': 'identity.policy.unknown_name',
  'format-ignores-type': 'identity.policy.format_ignores_type'
}

/** The policy server's environment may add policies nautilus cannot see (D4). */
const OPERATOR_NOTE =
  "The policy server may add it from its operator's DEFAULT_VC_POLICIES / DEFAULT_VP_POLICIES, which nautilus cannot read; set it on the asset so the check holds whatever the operator set."

/**
 * A request credential as the policy server forwards it to walt.id, with the block it came
 * from: `'asset'` or `'service <id or name>'`.
 */
export interface ForwardedRequest {
  where: string
  credential: StoredRequestCredential
  /** Its per-credential policies as the policy server parses them (`parsePolicies`). */
  policies: unknown[]
}

/** walt.id's per-credential policies for one requested type. */
export interface RequestedTypePolicies {
  /** The list walt.id runs: the last non-empty one for the type, if any. */
  effective?: ForwardedRequest
  /** Non-empty lists for the type that walt.id drops, with other policies than `effective`. */
  replaced: ForwardedRequest[]
  /** Every forwarded request of the type, in the policy server's order. */
  requests: ForwardedRequest[]
}

/**
 * Every finding for an asset-level block and its services' blocks. The policy server merges
 * the asset's `allow` list with the accessed service's, so most checks run on each service's
 * merged view; a block counts as a gate only when that view requests a credential. Each
 * finding is reported once, where its policy sits (or, for a missing one, where the
 * service's policies sit).
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
  const refused: { where: string; services: string[] }[] = []

  for (const service of scopes) {
    const serviceValues = ssiValues(service.credentials)
    const merged = [...assetValues, ...serviceValues]
    const serviceHasPolicy = ssiEntries(service.credentials).length > 0
    const policyWhere = serviceHasPolicy ? service.where : asset.where

    if (!policyServerGates(asset.credentials, service.credentials)) {
      if (
        service.where &&
        (ssiEntries(asset.credentials).length || serviceHasPolicy)
      ) {
        if (ssiEntries(asset.credentials).length)
          addRefused(refused, asset.where, service.where)
        if (serviceHasPolicy) addRefused(refused, service.where, service.where)
      }
      continue
    }

    lintValues(asset.where, assetValues, add)
    if (service.where) lintValues(service.where, serviceValues, add)

    lintPresentationDefinition(asset, service, assetValues, merged, add)
    lintRequestedTypes(
      asset.where,
      assetValues,
      service.where,
      serviceValues,
      add
    )
    lintSafeSet(policyWhere, merged, add)
    lintWildcard(asset, service, add)
  }

  for (const { where, services: names } of refused)
    add({
      code: 'no-request-credentials',
      fatal: true,
      where,
      policy: 'SSIpolicy',
      message: `The ${where} has an SSIpolicy entry, but ${names.length === 1 ? `${names[0]} requests` : `${names.join(', ')} request`} no credential: the policy server merges the asset's SSIpolicy entries with the accessed service's and refuses every consumer of a service that holds one without a request credential ("SSIpolicy was found, but failed to fetch request credentials"). Put the VC and VP policies on the gated service only (ServiceBuilder.setVcPolicies / setVpPolicies, next to its addRequestCredentials), or add request credentials.${where === asset.where ? " On an edit, clear the asset's lists with AssetBuilder.setVcPolicies(list, []) and setVpPolicies(list, []), which removes its emptied SSIpolicy entry, then set them on the gated service." : ''}`
    })

  return [...findings.values()]
}

/**
 * Throws an `SsiPolicyError` when a finding is fatal (every mode), or for any finding under
 * `'error'`; otherwise logs each finding under `'warn'`.
 */
export function applySsiPolicyLint(
  findings: SsiPolicyFinding[],
  mode: SsiPolicyLintMode = 'warn',
  logger: Logger = log
): void {
  const fatal = findings.filter((finding) => finding.fatal)
  const warnings = findings.filter((finding) => !finding.fatal)

  if (fatal.length || (mode === 'error' && warnings.length))
    throw new SsiPolicyError(mode === 'off' ? fatal : [...fatal, ...warnings])

  if (mode === 'off') return

  for (const finding of warnings) {
    const event = Object.hasOwn(WARNING_EVENTS, finding.code)
      ? WARNING_EVENTS[finding.code as SsiPolicyWarningCode]
      : undefined
    if (event)
      logger.emit(event, finding.message, {
        where: finding.where,
        ...(finding.code === 'unknown-policy-name'
          ? { policy: shown(finding.policy) }
          : {}),
        ...(finding.credentialType !== undefined
          ? { credentialType: finding.credentialType }
          : {})
      })
  }
}

function addRefused(
  refused: { where: string; services: string[] }[],
  where: string,
  service: string
): void {
  const entry = refused.find((candidate) => candidate.where === where)
  if (entry) entry.services.push(service)
  else refused.push({ where, services: [service] })
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
      if (name && !KNOWN_SSI_POLICIES.has(name))
        add(unknownName(where, 'VC', name))
      if (!name || !(hasArgs || VC_POLICIES_NEEDING_ARGS.has(name))) continue

      const perCredential = VC_POLICIES_NEEDING_ARGS.has(name)
      add({
        code: 'vc-policy-arguments',
        fatal: true,
        where,
        policy: name,
        message: perCredential
          ? `The ${where} VC policy '${shown(name)}' ${hasArgs ? 'has arguments' : 'needs arguments'}, and the policy server keeps only the name of an asset- or service-level VC policy: walt.id would fail it for every presentation, refusing every consumer. Put it on the credential instead: addRequestCredentials(list, [{ type, format, policies: [{ policy: '${shown(name)}', args }] }]).`
          : `The ${where} VC policy '${shown(name)}' has arguments, and the policy server keeps only the name of an asset- or service-level VC policy: walt.id would run it without them, a different check from the one written. Drop the arguments and keep '${shown(name)}' in the VC policies, where it runs on every presented credential.`
      })
    }

    for (const raw of toArray(value.vp_policies)) {
      const { name, args, hasArgs } = readPolicy(raw)
      if (!name) continue
      if (!KNOWN_SSI_POLICIES.has(name)) add(unknownName(where, 'VP', name))

      const problem = vpArgumentProblem(name, parseArgs(args), hasArgs)
      if (problem)
        add({
          code: 'vp-policy-arguments',
          fatal: true,
          where,
          policy: name,
          message: `The ${where} VP policy '${shown(name)}' ${problem}: walt.id fails it for every presentation, refusing every consumer. Write it as ${vpArgumentExample(name)}.`
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
      for (const raw of toArray(credential.policies)) {
        // As the policy server parses it; the builders and an edit store each as JSON.
        const [parsed] = parseCredentialPolicy(raw)
        const { name } = readPolicy(parsed)
        if (name && !KNOWN_SSI_POLICIES.has(name))
          add(unknownName(where, 'per-credential', name, credential.type))
      }
  }
}

/** `presentation-definition` against the merged view's `jwt_vc_json` / `jwt_vc` requests. */
function lintPresentationDefinition(
  asset: SsiPolicyScope,
  service: SsiPolicyScope,
  assetValues: SsiPolicyValue[],
  merged: SsiPolicyValue[],
  add: (finding: SsiPolicyFinding) => void
): void {
  const hasPd = (values: SsiPolicyValue[]) =>
    values.some((value) =>
      vpPolicies(value).some(({ name }) => name === 'presentation-definition')
    )
  if (!hasPd(merged)) return

  const where = hasPd(assetValues) ? asset.where : service.where
  for (const credential of merged.flatMap(requestCredentials))
    if (
      typeof credential.format === 'string' &&
      VC_TYPE_FILTER_FORMATS.has(credential.format)
    )
      add({
        code: 'presentation-definition-vc-jwt',
        fatal: false,
        where,
        policy: 'presentation-definition',
        credentialType: credential.type,
        message: `The ${where} VP policy 'presentation-definition' will refuse VCDM 2.0 '${shown(credential.type)}' credentials (${shown(credential.format)}): walt.id's generated definition looks for the type at $.vc.type, which vc+jwt credentials such as Gaia-X ones do not have, so every such consumer is refused. Leave it out unless every accepted credential is VCDM 1.1.`
      })
}

/**
 * Per requested type, the per-credential policies walt.id runs (see `requestedTypes`): lists
 * it drops with a policy that then never runs, policies on a generic type, the effective
 * list's issuer trust and schema; and the formats of the session's requests.
 */
function lintRequestedTypes(
  assetWhere: string,
  assetValues: SsiPolicyValue[],
  serviceWhere: string,
  serviceValues: SsiPolicyValue[],
  add: (finding: SsiPolicyFinding) => void
): void {
  const forwarded = policyServerRequests([
    { where: assetWhere, values: assetValues },
    { where: serviceWhere, values: serviceValues }
  ])
  lintRequestFormats(forwarded, add)

  for (const [type, { effective, replaced, requests }] of requestedTypes(
    forwarded
  )) {
    const where = (effective ?? requests[requests.length - 1]).where

    for (const earlier of replaced) {
      const runs = new Set(effective?.policies.map((p) => JSON.stringify(p)))
      const lost = earlier.policies.filter((p) => !runs.has(JSON.stringify(p)))
      if (!lost.length) continue

      const names = policyNames(lost).map(shown).join(', ') || 'policies'
      add({
        code: 'credential-policies-replaced',
        fatal: true,
        where: earlier.where,
        policy: names,
        credentialType: type,
        message: `The ${earlier.where} request for '${shown(type)}' credentials carries per-credential policies (${names}) that never run, so the gate is weaker than written: walt.id keeps only the last non-empty policy list per requested type, here the one at ${effective?.where} (the policy server first drops a repeat of an identical request, keeping the first one's position). Put all of the type's policies on one request: trustIssuers() and requireCredentialAttributes() add to it, setRequestCredentials() replaces the list.`
      })
    }

    if (effective && GENERIC_CREDENTIAL_TYPES.has(type)) {
      add({
        code: 'generic-request-type',
        fatal: true,
        where: effective.where,
        policy: policyNames(effective.policies).map(shown).join(', '),
        credentialType: type,
        message: `The ${effective.where} request for '${shown(type)}' credentials carries per-credential policies that never run on a credential with a more specific type: walt.id files a presented credential under the last entry of its type (e.g. 'gx:LegalPerson' for ['VerifiableCredential', 'gx:LegalPerson']), and every wallet presents such a credential for this request. Request the credential's own type, the last entry of its type list.`
      })
      continue
    }

    const format = effective?.credential.format
    if (effective && TYPE_UNFILTERED_FORMATS.has(String(format)))
      add({
        code: 'format-ignores-type',
        fatal: false,
        where: effective.where,
        policy: policyNames(effective.policies).map(shown).join(', '),
        credentialType: type,
        message: `The ${effective.where} request for '${shown(type)}' credentials has the format '${shown(String(format))}', for which walt.id's presentation definition does not ask for the requested type (${format === 'mso_mdoc' ? 'it asks for fixed mDL fields' : "it asks for any 'vct'"}). Its per-credential policies run only on a presented credential walt.id files under '${shown(type)}', so a wallet that presents one of another type for this request skips them. Request credentials checked by per-credential policies as 'jwt_vc_json'.`
      })

    lintSchemas(where, type, effective?.policies ?? [], add)

    const issuers = (effective?.policies ?? []).filter(
      (policy) => readPolicy(policy).name === 'allowed-issuer'
    )
    if (!issuers.length) {
      add({
        code: 'no-issuer-trust',
        fatal: false,
        where,
        policy: 'allowed-issuer',
        credentialType: type,
        message: `The ${where} request for '${shown(type)}' credentials has no per-credential 'allowed-issuer' that runs, so a '${shown(type)}' credential from any issuer, a self-issued one included, is accepted. Add { policy: 'allowed-issuer', args: ['did:…'] } to its policies.`
      })
      continue
    }

    const entries = issuers.flatMap((policy) =>
      issuerEntries(readPolicy(policy).args)
    )
    if (!entries.some(isUsableIssuer)) {
      add({
        code: 'credential-policy-arguments',
        fatal: true,
        where,
        policy: 'allowed-issuer',
        credentialType: type,
        message: `The ${where} per-credential 'allowed-issuer' for '${shown(type)}' credentials names no issuer (it needs a DID or a list of DIDs; '*' is not a wildcard in walt.id), so walt.id refuses every '${shown(type)}' credential and every consumer. Write it as { policy: 'allowed-issuer', args: ['did:…'] }.`
      })
      continue
    }

    const notDids = entries.filter(
      (entry) => isUsableIssuer(entry) && !isDid(entry)
    )
    if (notDids.length)
      add({
        code: 'issuer-not-did',
        fatal: false,
        where,
        policy: 'allowed-issuer',
        credentialType: type,
        message: `The ${where} per-credential 'allowed-issuer' for '${shown(type)}' credentials lists ${notDids
          .slice(0, 5)
          .map((entry) => `'${shown(String(entry))}'`)
          .join(
            ', '
          )}, which ${notDids.length === 1 ? 'is not a DID' : 'are not DIDs'}. walt.id compares a credential's iss with each entry as written, so it trusts only an issuer whose iss is exactly that text. Use the issuer's DID (trustIssuers() takes DIDs only).`
      })
  }
}

/** The effective list's `schema` policies: arguments walt.id cannot use, or that check less than they seem. */
function lintSchemas(
  where: string,
  type: string,
  policies: unknown[],
  add: (finding: SsiPolicyFinding) => void
): void {
  for (const policy of policies) {
    const { name, args } = readPolicy(policy)
    if (name !== 'schema') continue

    const problem = credentialPolicyProblem('schema', args)
    if (problem) {
      add({
        code: 'credential-policy-arguments',
        fatal: true,
        where,
        policy: 'schema',
        credentialType: type,
        message: `The ${where} request for '${shown(type)}' credentials has a per-credential 'schema' policy that ${problem}. Pass the schema as an object (not JSON.stringify(schema)), or use requireCredentialAttributes().`
      })
      continue
    }

    const weaknesses = schemaWeaknesses(args as Record<string, unknown>)
    if (weaknesses.length)
      add({
        code: 'weak-schema',
        fatal: false,
        where,
        policy: 'schema',
        credentialType: type,
        message: `The ${where} per-credential 'schema' for '${shown(type)}' credentials ${weaknesses.join('; ')}. Write attribute requirements with requireCredentialAttributes(), which generates a schema that checks each one.`
      })
  }
}

/**
 * walt.id opens a session only when every request credential has a format, the same one, of
 * those it requests (`VerifierService.getPresentationFormat`): otherwise it refuses every
 * consumer ("Credentials formats must be distinct for a presentation request").
 */
function lintRequestFormats(
  forwarded: ForwardedRequest[],
  add: (finding: SsiPolicyFinding) => void
): void {
  if (!forwarded.length) return
  const formats = [
    ...new Set(forwarded.map(({ credential }) => credential.format))
  ]
  const known = formats.length === 1 && REQUEST_FORMATS.has(String(formats[0]))
  if (known) return

  const odd =
    forwarded.find(
      ({ credential }) =>
        typeof credential.format !== 'string' ||
        !REQUEST_FORMATS.has(credential.format)
    ) ??
    forwarded.find(({ credential }) => credential.format !== formats[0]) ??
    forwarded[0]
  const listed = formats
    .map((format) =>
      typeof format === 'string' ? `'${shown(format)}'` : 'none'
    )
    .join(', ')

  add({
    code: 'request-format',
    fatal: true,
    where: odd.where,
    policy: 'request_credentials',
    credentialType: odd.credential.type,
    message: `The request credentials of the ${odd.where} have the format${formats.length === 1 ? '' : 's'} ${listed}: walt.id opens a session only when every requested credential has the same format, one of ${[...REQUEST_FORMATS].join(', ')}, and refuses every consumer otherwise ("Credentials formats must be distinct for a presentation request"). Give every request credential of the asset and the service one format, e.g. 'jwt_vc_json'.`
  })
}

/** D4's safe set on the merged view: VC and VP `signature`, `minimum-credentials` ≥ 1. */
function lintSafeSet(
  where: string,
  merged: SsiPolicyValue[],
  add: (finding: SsiPolicyFinding) => void
): void {
  const vcNames = merged.flatMap((value) =>
    toArray(value.vc_policies).flatMap((raw) => readPolicy(raw).name ?? [])
  )
  const vp = merged.flatMap(vpPolicies)

  if (!vcNames.includes('signature'))
    add({
      code: 'no-vc-signature',
      fatal: false,
      where,
      policy: 'signature',
      message: `The ${where} VC policies have no 'signature', so nothing is sure to check the presented credentials' signatures: a credential that names a trusted issuer but is signed by anyone passes 'allowed-issuer'. ${OPERATOR_NOTE} Use setVcPolicies(list, ['signature', 'not-before', 'revoked-status-list']).`
    })

  if (!vp.some(({ name }) => name === 'signature'))
    add({
      code: 'no-vp-signature',
      fatal: false,
      where,
      policy: 'signature',
      message: `The ${where} VP policies have no 'signature', so nothing is sure to check the presentation's own signature: a presentation can name any DID. ${OPERATOR_NOTE} Add { policy: 'signature' } to setVpPolicies.`
    })

  const minimums = vp.filter(({ name }) => name === 'minimum-credentials')
  const atLeastOne = minimums.some(({ args }) => {
    const n = readInteger(parseArgs(args))
    return n !== undefined && n >= 1
  })
  // A minimum whose arguments walt.id cannot read is already fatal.
  const unreadable = minimums.some(
    ({ args, hasArgs }) =>
      !hasArgs || readInteger(parseArgs(args)) === undefined
  )
  if (!atLeastOne && !unreadable)
    add({
      code: 'no-minimum-credentials',
      fatal: false,
      where,
      policy: 'minimum-credentials',
      message: `The ${where} VP policies have no 'minimum-credentials' of at least 1, so a presentation holding no credential at all passes the credential check. Add { policy: 'minimum-credentials', args: '1' } to setVpPolicies.`
    })
}

/**
 * `'*'` in the address allow list of a credential-gated service, read as the policy server
 * reads it (`waltIdPolicyHandler.ts:985-1005`): the asset's list holds `'*'`, and the service
 * has no address entry or its list holds `'*'` too.
 */
function lintWildcard(
  asset: SsiPolicyScope,
  service: SsiPolicyScope,
  add: (finding: SsiPolicyFinding) => void
): void {
  const serviceDefines = hasAddressEntry(service.credentials)
  if (!addressList(asset.credentials).includes('*')) return
  if (serviceDefines && !addressList(service.credentials).includes('*')) return

  const where = serviceDefines ? service.where : asset.where
  add({
    code: 'wildcard-allow',
    fatal: false,
    where,
    policy: 'address',
    message: `The ${where} address allow list holds '*' on a credential-gated service, so the address check lets everyone in and the credential check is the only gate. A hand-built presentation with a self-issued credential of another type passes that check (the type bypass, see the identity guide's known limitation), so the asset is open to anyone. List the allowed addresses explicitly.`
  })
}

/** walt.id's `allowed-issuer` entries: one string, or a list. */
function issuerEntries(args: unknown): unknown[] {
  return typeof args === 'string' ? [args] : Array.isArray(args) ? args : []
}

/** Whether walt.id can match a credential's issuer against this entry. */
function isUsableIssuer(entry: unknown): boolean {
  return typeof entry === 'string' && entry.trim() !== '' && entry !== '*'
}

/** Why walt.id cannot read a VP policy's arguments, or `undefined` when it can. */
function vpArgumentProblem(
  name: string,
  args: unknown,
  hasArgs: boolean
): string | undefined {
  if (VP_INTEGER_POLICIES.has(name)) {
    if (!hasArgs) return 'needs its argument'
    if (readInteger(args) === undefined)
      return 'needs an integer argument, and walt.id cannot read this one as one'
    return undefined
  }

  if (name === 'vp_required_credentials') {
    if (!hasArgs) return 'needs its argument'
    const required = isPlainObject(args) ? args.required : undefined
    if (!Array.isArray(required))
      return 'needs an argument of the form { required: [...] }, and this one is not'
    const readable = required.every(
      (entry) =>
        isPlainObject(entry) &&
        ((typeof entry.credential_type === 'string' &&
          entry.credential_type.trim() !== '') ||
          (entry.credential_type === undefined &&
            Array.isArray(entry.any_of) &&
            entry.any_of.every((type) => typeof type === 'string')))
    )
    if (!readable)
      return "needs each entry of 'required' to be { credential_type: '<type>' } or { any_of: ['<type>', …] }, and this one has another"
  }

  return undefined
}

function vpArgumentExample(name: string): string {
  return name === 'vp_required_credentials'
    ? `{ policy: 'vp_required_credentials', args: JSON.stringify({ required: [{ credential_type: '<type>' }] }) }`
    : `{ policy: '${shown(name)}', args: '1' }`
}

/** An integer as walt.id's `JsonPrimitive.int` reads it, or `undefined`. */
function readInteger(args: unknown): number | undefined {
  const n =
    typeof args === 'number'
      ? args
      : typeof args === 'string' && /^-?\d+$/.test(args)
        ? Number(args)
        : Number.NaN
  return Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31 ? n : undefined
}

/** A VP policy's arguments as the policy server forwards them (`parseArgs`). */
function parseArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args
  try {
    return JSON.parse(args)
  } catch {
    return args
  }
}

/**
 * Whether the policy server opens a verifier session for a service (its
 * `hasSSIPolicyToBeChecked`): some `SSIpolicy` value of the asset or the service has a
 * non-empty `request_credentials` array.
 */
function policyServerGates(
  asset: DdoCredentials | undefined,
  service: DdoCredentials | undefined
): boolean {
  return [...ssiEntries(asset), ...ssiEntries(service)].some(
    (entry) =>
      Array.isArray(entry.values) &&
      entry.values.some(
        (value) =>
          Array.isArray(
            (value as SsiPolicyValue | null)?.request_credentials
          ) && (value as SsiPolicyValue).request_credentials.length > 0
      )
  )
}

/** The `SSIpolicy` entries of a block's `allow` list. */
function ssiEntries(
  credentials: DdoCredentials | undefined
): { type: 'SSIpolicy'; values: unknown }[] {
  return toArray(credentials?.allow).filter(
    (entry): entry is { type: 'SSIpolicy'; values: unknown } =>
      isSsiPolicyCredential(entry as never)
  )
}

/** The `SSIpolicy` values of a block's `allow` list. */
function ssiValues(credentials: DdoCredentials | undefined): SsiPolicyValue[] {
  return ssiEntries(credentials)
    .flatMap((entry) => toArray(entry.values))
    .filter((value): value is SsiPolicyValue => isPlainObject(value))
}

/** The block's address allow list, as the policy server extracts it. */
function addressList(credentials: DdoCredentials | undefined): string[] {
  return toArray(credentials?.allow).flatMap((entry) => {
    const { type, values } = (entry ?? {}) as {
      type?: unknown
      values?: unknown
    }
    if (type !== 'address' || !Array.isArray(values)) return []
    return values.flatMap((value: unknown) => {
      const address =
        typeof value === 'string'
          ? value
          : (value as { address?: unknown } | null)?.address
      return typeof address === 'string' ? [address.toLowerCase()] : []
    })
  })
}

function hasAddressEntry(credentials: DdoCredentials | undefined): boolean {
  return toArray(credentials?.allow).some(
    (entry) => (entry as { type?: unknown } | null)?.type === 'address'
  )
}

function requestCredentials(value: SsiPolicyValue): StoredRequestCredential[] {
  return toArray(value.request_credentials).filter(
    (credential): credential is StoredRequestCredential =>
      typeof (credential as StoredRequestCredential | null)?.type === 'string'
  )
}

/**
 * The request credentials the policy server forwards to walt.id (`parseRequestCredentials`,
 * `waltIdPolicyHandler.ts:737-899`): the blocks' requests in order (asset, then service),
 * each one's policies parsed (`parsePolicies`), and a repeat of an identical
 * `{ type, format, policies }` dropped, the first occurrence keeping its position.
 */
export function policyServerRequests(
  blocks: { where: string; values: SsiPolicyValue[] }[]
): ForwardedRequest[] {
  const forwarded = new Map<string, ForwardedRequest>()

  for (const { where, values } of blocks)
    for (const credential of values.flatMap(requestCredentials)) {
      const policies = Array.isArray(credential.policies)
        ? credential.policies.flatMap(parseCredentialPolicy)
        : []
      const key = JSON.stringify({
        type: credential.type,
        format: credential.format,
        policies
      })
      if (!forwarded.has(key))
        forwarded.set(key, { where, credential, policies })
    }

  return [...forwarded.values()]
}

/**
 * Per requested type, the per-credential policies walt.id runs: of the forwarded requests
 * (`policyServerRequests`), those with no policies are dropped, and of the others the last
 * for a type wins (`VerifierService.kt:104-108`).
 */
export function requestedTypes(
  forwarded: ForwardedRequest[]
): Map<string, RequestedTypePolicies> {
  const types = new Map<string, RequestedTypePolicies>()

  for (const type of new Set(
    forwarded.map(({ credential }) => credential.type)
  )) {
    const requests = forwarded.filter(
      ({ credential }) => credential.type === type
    )
    const withPolicies = requests.filter(({ policies }) => policies.length)
    const effective = withPolicies.at(-1)
    const replaced = withPolicies
      .slice(0, -1)
      .filter(
        ({ policies }) =>
          JSON.stringify(policies) !== JSON.stringify(effective?.policies)
      )
    types.set(type, { effective, replaced, requests })
  }

  return types
}

/**
 * Per requested type, the per-credential policies walt.id runs for one service, from the
 * stored `credentials` blocks of the asset and the service: the policy server's merge and
 * dedupe (`policyServerRequests`), then walt.id's last non-empty list (`requestedTypes`).
 */
export function effectiveRequestPolicies(
  asset: DdoCredentials | undefined,
  service: DdoCredentials | undefined
): Map<string, unknown[]> {
  const forwarded = policyServerRequests([
    { where: 'asset', values: ssiValues(asset) },
    { where: 'service', values: ssiValues(service) }
  ])
  const policies = new Map<string, unknown[]>()
  for (const [type, { effective }] of requestedTypes(forwarded))
    if (effective) policies.set(type, effective.policies)
  return policies
}

/**
 * A per-credential policy as the policy server parses it (`parsePolicies`): an object as it
 * is, a string JSON-parsed, an unparseable string or anything else dropped.
 */
function parseCredentialPolicy(raw: unknown): unknown[] {
  if (raw && typeof raw === 'object') return [raw]
  if (typeof raw !== 'string') return []
  try {
    return [JSON.parse(raw)]
  } catch {
    return []
  }
}

function policyNames(policies: unknown[]): string[] {
  return policies.flatMap((policy) => readPolicy(policy).name ?? [])
}

function vpPolicies(
  value: SsiPolicyValue
): { name: string; args?: unknown; hasArgs: boolean }[] {
  return toArray(value.vp_policies).flatMap((raw) => {
    const policy = readPolicy(raw)
    return policy.name ? [{ ...policy, name: policy.name }] : []
  })
}

/** A policy as a name or `{ policy, args? }`, the way the policy server reads it. */
function readPolicy(raw: unknown): {
  name?: string
  args?: unknown
  hasArgs: boolean
} {
  if (typeof raw === 'string') return { name: raw, hasArgs: false }

  const { policy, args } = (raw ?? {}) as { policy?: unknown; args?: unknown }
  return {
    name: typeof policy === 'string' ? policy : undefined,
    args,
    hasArgs: args !== undefined && args !== null && args !== ''
  }
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function unknownName(
  where: string,
  level: string,
  name: string,
  credentialType?: string
): SsiPolicyFinding {
  return {
    code: 'unknown-policy-name',
    fatal: false,
    where,
    policy: name,
    ...(credentialType !== undefined ? { credentialType } : {}),
    message: `The ${where} ${level} policy '${shown(name)}'${credentialType !== undefined ? ` for '${shown(credentialType)}' credentials` : ''} is not one walt.id 90e568f knows. If the verifier doesn't know it either, it fails every presentation. Check the spelling.`
  }
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  return raw === undefined || raw === null ? [] : [raw]
}

/** A publisher- or node-supplied name, made safe to quote; the raw form goes to the debug channel. */
function shown(text: string): string {
  return sanitize(String(text), 100, 'node')
}
