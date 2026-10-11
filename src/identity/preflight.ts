/**
 * Checks, before anything is presented, the policies whose outcome nautilus can decide from
 * what it holds: `holder-binding`, and a per-credential `schema` (attribute requirements).
 *
 * `holder-binding`: walt.id's rule (`HolderBindingPolicy.kt:42`, 90e568f)
 * is that the top-level `sub` of every credential JWT in the presentation, up to a `#`, is
 * the presenter's DID; a credential without `sub` makes it throw. A consumer whose credential
 * cannot pass is told so here, with nothing presented, ordered or paid, instead of a
 * verifier's "Presentation failed".
 *
 * `schema`: walt.id validates a credential of a requested type against the per-credential
 * JSON Schema of that type (the last non-empty policy list requested for it). nautilus
 * evaluates the same schema on the same object (the `vc` claim, else the payload) with a
 * subset of JSON Schema (`type`, `required`, `properties`, `const`, `enum`); a schema using
 * anything else is not judged. The credential's values are never quoted, only its path.
 *
 * Credentials nautilus cannot decode (SD-JWT, JSON-LD, mdoc, anything but a compact JWS) are
 * not judged: they are presented, and the verifier decides.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import {
  getCredentials,
  getService,
  getServiceCredentials
} from '../ddo/read.js'
import type { DdoCredentials } from '../ddo/types.js'
import { debugEnabled, debugRaw } from '../log/debug.js'
import { type Logger, log } from '../log/logger.js'
import { sanitize } from '../node/messages.js'
import {
  type AttributeSchemaVerdict,
  evaluateAttributeSchema,
  isPlainObject,
  shownPath
} from './attributes.js'
import { isSsiPolicyCredential } from './policy.js'
import type { WaltIdCredential } from './waltid/client.js'

/**
 * Why a credential was rejected locally, as `CredentialRejectedLocallyError.reason`:
 *
 * - `no-sub`: the service requires `holder-binding`, and the credential JWT has no `sub`;
 * - `sub-mismatch`: the service requires `holder-binding`, and the credential's `sub` (up to
 *   a `#`) is not the presenter's DID: another DID, empty, or not a string;
 * - `attribute-mismatch`: the service requires attributes of the credential (a per-credential
 *   `schema` policy), and an attribute is missing or has another value. `path` names it.
 */
export type CredentialRejectedLocallyReason =
  | 'no-sub'
  | 'sub-mismatch'
  | 'attribute-mismatch'

/**
 * Raised by `WaltIdCredentialProvider` before it presents anything, when a selected credential
 * cannot pass one of the service's policies (`holder-binding`, or the attribute requirements
 * of a per-credential `schema`). Nothing was presented, ordered or paid. Turn the check off
 * with the provider's `preflight: false`.
 */
export class CredentialRejectedLocallyError extends Error {
  /** The policy the credential would fail, e.g. `'holder-binding'`. */
  readonly policy: string
  readonly reason: CredentialRejectedLocallyReason
  /** The credential's type, among the types the service requests. */
  readonly credentialType?: string
  /** The service whose policies were checked. */
  readonly serviceId: string
  /**
   * For `attribute-mismatch`: the attribute that failed, from the root of the checked
   * credential, e.g. `['credentialSubject', 'gx:legalAddress', 'gx:countryCode']`. Its value
   * is never included; it goes to the debug channel only.
   */
  readonly path?: string[]

  constructor(
    message: string,
    details: {
      policy: string
      reason: CredentialRejectedLocallyReason
      credentialType?: string
      serviceId: string
      path?: string[]
    }
  ) {
    super(message)
    this.name = 'CredentialRejectedLocallyError'
    this.policy = details.policy
    this.reason = details.reason
    this.credentialType = details.credentialType
    this.serviceId = details.serviceId
    if (details.path) this.path = details.path
  }
}

/** Credential formats whose `document` is a plain compact JWS walt.id decodes as it is. */
const JWT_FORMATS = new Set(['jwt_vc_json', 'jwt_vc', 'jwt_vc_json-ld'])

/** Longer documents are not decoded. */
const MAX_DOCUMENT_LENGTH = 256 * 1024

/**
 * The names of the VP policies of the service's effective `SSIpolicy`: the asset's `allow`
 * list merged with the service's, as the policy server merges them.
 */
export function effectiveVpPolicies(
  asset: AssetV5,
  serviceId: string
): Set<string> {
  const service = getService(asset, serviceId)
  const names = new Set<string>()

  for (const credentials of [
    getCredentials(asset),
    service ? getServiceCredentials(service) : undefined
  ] as (DdoCredentials | undefined)[])
    for (const entry of toArray(credentials?.allow))
      if (isSsiPolicyCredential(entry as never))
        for (const value of toArray((entry as { values?: unknown }).values))
          for (const policy of toArray(
            (value as { vp_policies?: unknown } | null)?.vp_policies
          )) {
            const name =
              typeof policy === 'string'
                ? policy
                : (policy as { policy?: unknown } | null)?.policy
            if (typeof name === 'string') names.add(name)
          }

  return names
}

/**
 * Throws a `CredentialRejectedLocallyError` when the service requires `holder-binding` and a
 * selected credential's `sub` is missing or is not `holderDid` (walt.id's rule). Credentials
 * it cannot decode are skipped, with a `debug` event and their raw form on the debug channel.
 */
export function assertHolderBinding(params: {
  asset: AssetV5
  serviceId: string
  holderDid: string
  credentials: WaltIdCredential[]
  /** The credential's type to name in the message: one the service requests. */
  typeOf: (credential: WaltIdCredential) => string | undefined
  logger?: Logger
}): void {
  const { asset, serviceId, holderDid, credentials } = params
  if (!effectiveVpPolicies(asset, serviceId).has('holder-binding')) return

  for (const credential of credentials) {
    const payload = decodeJwtPayload(credential)

    if (!payload) {
      const format = (credential as { format?: unknown }).format
      ;(params.logger ?? log).emit(
        'identity.preflight.skipped',
        'A selected credential is not a plain JWT nautilus can read, so the holder-binding check before presenting skipped it; the verifier decides.',
        {
          serviceId,
          credentialId: credential.id,
          policy: 'holder-binding',
          ...(typeof format === 'string' ? { format } : {})
        }
      )
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', 'holder-binding preflight skipped a credential', {
          id: credential.id,
          format,
          document: credential.document
        })
      continue
    }

    // walt.id reads `sub` as JSON text, so a number or null is present but never a DID.
    const sub = payload.sub
    const subject = typeof sub === 'string' ? sub.split('#')[0] : undefined
    if (subject === holderDid) continue

    const reason = sub === undefined ? 'no-sub' : 'sub-mismatch'
    const credentialType = params.typeOf(credential)

    if (debugEnabled('sensitive', 'wallet'))
      debugRaw('wallet', 'holder-binding preflight refused a credential', {
        id: credential.id,
        sub,
        holderDid
      })

    throw new CredentialRejectedLocallyError(
      holderBindingMessage({
        assetDid: asset.id,
        serviceId,
        holderDid,
        credentialType,
        reason,
        sub,
        urlSubject: hasUrlSubject(payload)
      }),
      { policy: 'holder-binding', reason, credentialType, serviceId }
    )
  }
}

/**
 * The per-credential policies walt.id runs on a presented credential of each type: the
 * service's effective request credentials (asset `allow` list, then the service's, as the
 * policy server merges them), keyed by type, the last non-empty policy list winning
 * (`VerifierService.kt:104-108`).
 */
export function effectiveCredentialPolicies(
  asset: AssetV5,
  serviceId: string
): Map<string, unknown[]> {
  const service = getService(asset, serviceId)
  const byType = new Map<string, unknown[]>()

  for (const credentials of [
    getCredentials(asset),
    service ? getServiceCredentials(service) : undefined
  ] as (DdoCredentials | undefined)[])
    for (const entry of toArray(credentials?.allow))
      if (isSsiPolicyCredential(entry as never))
        for (const value of toArray((entry as { values?: unknown }).values))
          for (const request of toArray(
            (value as { request_credentials?: unknown } | null)
              ?.request_credentials
          )) {
            const { type, policies } = (request ?? {}) as {
              type?: unknown
              policies?: unknown
            }
            const parsed = toArray(policies).flatMap(parseCredentialPolicy)
            if (typeof type === 'string' && parsed.length)
              byType.set(type, parsed)
          }

  return byType
}

/**
 * Throws a `CredentialRejectedLocallyError` when a selected credential of a type the service
 * requires attributes of (a per-credential `schema`) does not have them. Credentials it cannot
 * decode, and schemas outside the evaluated subset, are skipped with a `debug` event.
 */
export function assertCredentialAttributes(params: {
  asset: AssetV5
  serviceId: string
  credentials: WaltIdCredential[]
  logger?: Logger
}): void {
  const { asset, serviceId, credentials } = params
  const logger = params.logger ?? log

  const schemas = new Map<string, Record<string, unknown>[]>()
  for (const [type, policies] of effectiveCredentialPolicies(
    asset,
    serviceId
  )) {
    const found = policies.flatMap((policy) =>
      isPlainObject(policy) &&
      policy.policy === 'schema' &&
      isPlainObject(policy.args)
        ? [policy.args]
        : []
    )
    if (found.length) schemas.set(type, found)
  }
  if (!schemas.size) return

  for (const credential of credentials) {
    const payload = decodeJwtPayload(credential)

    if (!payload) {
      const format = (credential as { format?: unknown }).format
      logger.emit(
        'identity.preflight.skipped',
        'A selected credential is not a plain JWT nautilus can read, so the attribute check before presenting skipped it; the verifier decides.',
        {
          serviceId,
          credentialId: credential.id,
          policy: 'schema',
          ...(typeof format === 'string' ? { format } : {})
        }
      )
      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', 'attribute preflight skipped a credential', {
          id: credential.id,
          format,
          document: credential.document
        })
      continue
    }

    // walt.id's type: the last entry of `type` (or `vc.type`), and the object it validates:
    // the `vc` claim, else the payload.
    const credentialType = waltIdType(payload)
    const credentialSchemas =
      credentialType === undefined ? undefined : schemas.get(credentialType)
    if (!credentialSchemas) continue

    const data = payload.vc !== undefined ? payload.vc : payload
    if (!isPlainObject(data)) continue

    for (const schema of credentialSchemas) {
      const verdict = evaluateAttributeSchema(schema, data)

      if (verdict.outcome === 'pass') continue
      if (verdict.outcome === 'unsupported') {
        logger.emit(
          'identity.preflight.schema_skipped',
          "The service's attribute schema uses a keyword nautilus does not evaluate, so the attribute check before presenting skipped it; the verifier decides.",
          {
            serviceId,
            credentialType: shown(credentialType as string, 'node'),
            keyword: shown(verdict.keyword, 'node')
          }
        )
        continue
      }

      if (debugEnabled('sensitive', 'wallet'))
        debugRaw('wallet', 'attribute preflight refused a credential', {
          id: credential.id,
          path: verdict.path,
          value: valueAt(data, verdict.path)
        })

      throw new CredentialRejectedLocallyError(
        attributeMessage({
          assetDid: asset.id,
          serviceId,
          credentialType: credentialType as string,
          verdict
        }),
        {
          policy: 'schema',
          reason: 'attribute-mismatch',
          credentialType,
          serviceId,
          // The keys come from the asset's schema, which the publisher wrote: no control
          // characters reach a terminal that prints them.
          path: verdict.path.map((key) => sanitize(key, 200, null))
        }
      )
    }
  }
}

function attributeMessage(params: {
  assetDid: string
  serviceId: string
  credentialType: string
  verdict: Extract<AttributeSchemaVerdict, { outcome: 'fail' }>
}): string {
  const { verdict } = params
  const attribute = verdict.path.length
    ? shownPath(verdict.path)
    : 'the credential'
  const expected = (verdict.expected ?? []).map((value) =>
    sanitize(JSON.stringify(value) ?? String(value), 100, null)
  )

  const requirement =
    verdict.kind === 'missing'
      ? 'to be present'
      : verdict.kind === 'type'
        ? `to be of type ${expected.join(' or ')}`
        : expected.length === 1
          ? `to be ${expected[0]}`
          : expected.length
            ? `to be one of ${expected.join(', ')}`
            : 'to match its schema'
  const problem =
    verdict.kind === 'missing'
      ? `has no \`${attribute}\``
      : verdict.kind === 'type'
        ? `has a \`${attribute}\` of another type`
        : `has another \`${attribute}\``

  return `Service ${shown(params.serviceId, 'node')} of ${shown(params.assetDid, 'node')} requires \`${attribute}\` of your \`${shown(params.credentialType, 'node')}\` credential ${requirement} (\`schema\` policy). Your credential ${problem}, so the verifier would reject it. Nothing was ordered or paid. Present a credential with the required attributes, or ask the publisher about the requirement.`
}

/** A stored per-credential policy (JSON-encoded, or as given) as a name or object. */
function parseCredentialPolicy(raw: unknown): unknown[] {
  if (typeof raw !== 'string')
    return raw === undefined || raw === null ? [] : [raw]
  try {
    return [JSON.parse(raw)]
  } catch {
    return [raw]
  }
}

/** walt.id's credential type: the last entry of `type`, `vc.type` or `vp.type`. */
function waltIdType(payload: Record<string, unknown>): string | undefined {
  const raw =
    payload.type ??
    (payload.vc as { type?: unknown } | undefined)?.type ??
    (payload.vp as { type?: unknown } | undefined)?.type
  const type = Array.isArray(raw) ? raw[raw.length - 1] : raw
  return typeof type === 'string' ? type : undefined
}

function valueAt(data: unknown, path: string[]): unknown {
  let node = data
  for (const key of path) {
    if (!isPlainObject(node) || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

function holderBindingMessage(params: {
  assetDid: string
  serviceId: string
  holderDid: string
  credentialType?: string
  reason: CredentialRejectedLocallyReason
  sub: unknown
  urlSubject: boolean
}): string {
  const credential = params.credentialType
    ? `\`${shown(params.credentialType, 'node')}\` credential`
    : 'credential'
  const url = params.urlSubject ? ' (its subject is a URL)' : ''
  const problem =
    params.reason === 'no-sub'
      ? `has no \`sub\`${url}`
      : params.sub === ''
        ? `has an empty \`sub\`${url}`
        : typeof params.sub === 'string'
          ? 'has a `sub` that is another DID'
          : 'has a `sub` that is not a DID'

  return `Service ${shown(params.serviceId, 'node')} of ${shown(params.assetDid, 'node')} requires \`holder-binding\`: each presented credential's subject (\`sub\`) must be your DID (${shown(params.holderDid, 'wallet')}). Your ${credential} ${problem}, so the verifier would reject it. Nothing was ordered or paid. Ask the publisher to drop \`holder-binding\` (it applies to every credential in the presentation), or present a credential issued to your DID.`
}

/**
 * The payload of a credential whose `document` is a compact JWS (three base64url parts, no
 * SD-JWT disclosures) of a JWT format, or `undefined` for anything else.
 */
function decodeJwtPayload(
  credential: WaltIdCredential
): Record<string, unknown> | undefined {
  const { document } = credential
  const { format, disclosures } = credential as {
    format?: unknown
    disclosures?: unknown
  }

  if (typeof document !== 'string' || document.length > MAX_DOCUMENT_LENGTH)
    return undefined
  if (typeof format === 'string' && !JWT_FORMATS.has(format)) return undefined
  if (typeof disclosures === 'string' && disclosures) return undefined

  const parts = document.trim().split('.')
  if (parts.length !== 3 || !parts.every((part) => /^[\w-]*$/.test(part)))
    return undefined

  try {
    const payload: unknown = JSON.parse(base64UrlDecode(parts[1]))
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Whether the credential's subject id (VCDM 2.0 at the top, 1.1 in `vc`) is a URL. */
function hasUrlSubject(payload: Record<string, unknown>): boolean {
  const body = (
    payload.vc && typeof payload.vc === 'object' ? payload.vc : payload
  ) as { credentialSubject?: unknown }
  const subjects = toArray(body.credentialSubject)

  return subjects.some((subject) => {
    const id = (subject as { id?: unknown } | null)?.id
    return typeof id === 'string' && /^https?:\/\//i.test(id)
  })
}

/** base64url to UTF-8 text, without `Buffer`, so it works in a browser too. */
function base64UrlDecode(text: string): string {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0))
  )
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  return raw === undefined || raw === null ? [] : [raw]
}

/** Wallet- or node-supplied text, made safe to quote; the raw form goes to the debug channel. */
function shown(text: string, topic: 'node' | 'wallet'): string {
  return sanitize(text, 200, topic)
}
