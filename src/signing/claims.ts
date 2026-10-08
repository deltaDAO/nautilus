/**
 * The claims nautilus's own signers put in a DDO credential. Kept out of the package's
 * exports: the publish flow uses it to size the JWS before the first transaction and to
 * check what a signer returned.
 */

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
