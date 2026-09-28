/**
 * Signing the DDO as a JWT Verifiable Credential.
 *
 * Nautilus does not write the DDO itself on chain — it writes a `{remote}` pointer to a
 * signed VC held off chain. Signing is what makes the off-chain document tamper-evident and
 * gives the asset a real `issuer` DID.
 *
 * Two backends:
 *
 *   - `WaltIdVcSigner` — signs with a wallet-held key, so `issuer` is a proper DID. This is
 *     the intended path and matches what the enterprise-market does.
 *   - `Eip191VcSigner` — signs with the Ethereum key using a non-standard
 *     `alg: 'ETH-EIP191'` header, so publishing works with no SSI wallet configured. The
 *     `issuer` is then just the signer's address. Verifiers that only understand JOSE
 *     algorithms will not validate these.
 */
import type { Signer } from 'ethers'
import type { WaltIdWallet } from '../identity/waltid/client.js'

export interface SignedCredential {
  /** The compact JWT. */
  jwt: string
  /** The `issuer` written into the credential. */
  issuer: string
}

export interface DdoSigner {
  /**
   * The identity this signer issues as — the DID or address written into `issuer`.
   *
   * Exposed separately from `sign()` so the publish flow can stamp the effective issuer
   * onto the document *before* it is validated and returned, rather than discovering it
   * only in the signed claims.
   */
  getIssuer(): Promise<string>

  /**
   * Signs a DDO as a VC.
   * @param ddo the DDO to sign, already stripped of indexer-derived fields
   */
  sign(ddo: Record<string, unknown>): Promise<SignedCredential>
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

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/**
 * Builds the credential envelope. `type` is forced to `['VerifiableCredential']` and the
 * JWT registered claims mirror the DDO identity, as the market does.
 */
function toCredential(
  ddo: Record<string, unknown>,
  issuer: string
): Record<string, unknown> {
  // A declared issuer is an assertion about who signs, not a free-text field: the spread
  // below would silently overwrite it, so `setIssuer()` would appear to work while the
  // signed claims said something else entirely. Fail loudly instead.
  const declared = ddo.issuer

  if (
    typeof declared === 'string' &&
    declared &&
    !isSameIssuer(declared, issuer)
  )
    throw new Error(
      `The DDO declares issuer "${declared}" but it is being signed by "${issuer}". Either remove setIssuer(), or sign with the identity you declared.`
    )

  return {
    ...ddo,
    type: ['VerifiableCredential'],
    issuer,
    iss: issuer,
    sub: ddo.id,
    jti: ddo.id
  }
}

/** Signs with a walt.id wallet key. The issuer is the holder DID. */
export class WaltIdVcSigner implements DdoSigner {
  private readonly wallet: WaltIdWallet
  private readonly walletId: string
  private readonly keyId: string
  private readonly did: string
  private readonly token: string

  constructor(options: {
    wallet: WaltIdWallet
    walletId: string
    keyId: string
    did: string
    token: string
  }) {
    this.wallet = options.wallet
    this.walletId = options.walletId
    this.keyId = options.keyId
    this.did = options.did
    this.token = options.token
  }

  async getIssuer(): Promise<string> {
    return this.did
  }

  async sign(ddo: Record<string, unknown>): Promise<SignedCredential> {
    const credential = toCredential(ddo, this.did)

    const jwt = await this.wallet.sign(
      this.walletId,
      this.keyId,
      credential,
      this.token
    )

    if (!jwt)
      throw new Error('walt.id returned no signature for the DDO credential.')

    return { jwt, issuer: this.did }
  }
}

/**
 * Signs with the Ethereum key using `alg: 'ETH-EIP191'`.
 *
 * This is not a JOSE-registered algorithm — the signature is a plain `personal_sign` over
 * `${headerB64}.${payloadB64}`. It exists so publishing does not hard-require an SSI
 * wallet; use `WaltIdVcSigner` where DID-issued credentials matter.
 */
export class Eip191VcSigner implements DdoSigner {
  private readonly signer: Signer

  constructor(signer: Signer) {
    this.signer = signer
  }

  async getIssuer(): Promise<string> {
    return this.signer.getAddress()
  }

  async sign(ddo: Record<string, unknown>): Promise<SignedCredential> {
    const issuer = await this.getIssuer()

    const header = base64url(JSON.stringify({ alg: 'ETH-EIP191', typ: 'JWT' }))
    const payload = base64url(JSON.stringify(toCredential(ddo, issuer)))

    const signature = await this.signer.signMessage(`${header}.${payload}`)

    return {
      jwt: `${header}.${payload}.${Buffer.from(signature, 'utf8').toString('base64url')}`,
      issuer
    }
  }
}

/** Decodes a signed DDO credential back into its DDO, without verifying the signature. */
export function decodeCredential(jwt: string): Record<string, unknown> {
  // Count the segments rather than just reaching for the payload: `header.payload` decodes
  // perfectly well but carries no signature at all, and accepting it would let an unsigned
  // document pass for a signed one.
  const parts = jwt.split('.')

  if (parts.length !== 3 || parts.some((part) => !part))
    throw new Error('Not a compact JWT: expected three dot-separated parts.')

  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}
