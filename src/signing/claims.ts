/**
 * The claims nautilus's own signers put in a DDO credential, and the rule for who may sign
 * a DDO that declares an issuer. Kept out of the package's exports: the publish flow uses
 * them to size the JWS and to check the issuer before the first transaction, and to check
 * what a signer returned.
 */
import { sanitize } from '../node/messages.js'

/**
 * The JWT registered claims (RFC 7519 §4.1). A signer may add them to the payload: the
 * built-in signers set `iss`, `sub` and `jti`, and a custom one may set the others.
 */
export const REGISTERED_CLAIMS: readonly string[] = [
  'iss',
  'sub',
  'aud',
  'exp',
  'nbf',
  'iat',
  'jti'
]

/** `type` as `Eip191VcSigner` and `WaltIdVcSigner` write it, whatever the DDO declared. */
export const CREDENTIAL_TYPE = ['VerifiableCredential']

/**
 * The credential payload for `ddo` issued by `issuer`: the DDO with `type` forced to
 * `CREDENTIAL_TYPE`, `issuer` set, and the JWT registered claims `iss`, `sub` and `jti`
 * mirroring the DDO's identity, as the enterprise market does.
 */
export function credentialClaims(
  ddo: Record<string, unknown>,
  issuer: string
): Record<string, unknown> {
  return {
    ...ddo,
    type: [...CREDENTIAL_TYPE],
    issuer,
    iss: issuer,
    sub: ddo.id,
    jti: ddo.id
  }
}

/**
 * Throws when the DDO declares an issuer (`declared`) other than the signing identity
 * (`issuer`). The publish flows run it before their first transaction, with `suffix`
 * " Nothing was sent.", and the built-in signers again before signing. On an edit the
 * declared issuer is node-served, so the message shows it sanitised and bounded; the raw
 * value goes to the debug channel.
 */
export function assertSameIssuer(
  declared: unknown,
  issuer: string,
  suffix = ''
): void {
  if (typeof declared !== 'string' || !declared) return
  if (isSameIssuer(declared, issuer)) return

  throw new Error(
    `The DDO declares issuer "${sanitize(declared, 200, 'node')}" but it is being signed by "${issuer}". Sign with the identity it declares, or call setIssuer() with the signing identity (on an edit, the declared issuer is the published one).${suffix}`
  )
}

/**
 * Whether a DDO-declared issuer names the same identity as the signer.
 *
 * Ethereum addresses are compared case-insensitively — `getAddress()` returns the
 * checksummed form, and failing a publish because the caller typed it lowercase would be
 * pedantry. Everything else (DIDs) is compared exactly, since their method-specific ids
 * are case-sensitive.
 */
function isSameIssuer(declared: string, actual: string): boolean {
  if (declared === actual) return true

  const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value)

  return (
    isAddress(declared) &&
    isAddress(actual) &&
    declared.toLowerCase() === actual.toLowerCase()
  )
}
