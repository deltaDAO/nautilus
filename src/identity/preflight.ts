/**
 * Checks, before anything is presented, the one policy whose outcome nautilus can decide
 * from what it holds: `holder-binding`. walt.id's rule (`HolderBindingPolicy.kt:42`, 90e568f)
 * is that the top-level `sub` of every credential JWT in the presentation, up to a `#`, is
 * the presenter's DID; a credential without `sub` makes it throw. A consumer whose credential
 * cannot pass is told so here, with nothing presented, ordered or paid, instead of a
 * verifier's "Presentation failed".
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
import { isSsiPolicyCredential } from './policy.js'
import type { WaltIdCredential } from './waltid/client.js'

/**
 * Why a credential was rejected locally, as `CredentialRejectedLocallyError.reason`:
 *
 * - `no-sub`: the service requires `holder-binding`, and the credential JWT has no `sub`;
 * - `sub-mismatch`: the service requires `holder-binding`, and the credential's `sub` (up to
 *   a `#`) is not the presenter's DID: another DID, empty, or not a string.
 */
export type CredentialRejectedLocallyReason = 'no-sub' | 'sub-mismatch'

/**
 * Raised by `WaltIdCredentialProvider` before it presents anything, when a selected credential
 * cannot pass one of the service's policies (today `holder-binding`). Nothing was presented,
 * ordered or paid. Turn the check off with the provider's `preflight: false`.
 */
export class CredentialRejectedLocallyError extends Error {
  /** The policy the credential would fail, e.g. `'holder-binding'`. */
  readonly policy: string
  readonly reason: CredentialRejectedLocallyReason
  /** The credential's type, among the types the service requests. */
  readonly credentialType?: string
  /** The service whose policies were checked. */
  readonly serviceId: string

  constructor(
    message: string,
    details: {
      policy: string
      reason: CredentialRejectedLocallyReason
      credentialType?: string
      serviceId: string
    }
  ) {
    super(message)
    this.name = 'CredentialRejectedLocallyError'
    this.policy = details.policy
    this.reason = details.reason
    this.credentialType = details.credentialType
    this.serviceId = details.serviceId
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
