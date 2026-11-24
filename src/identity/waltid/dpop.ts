/**
 * DPoP proofs (RFC 9449) for wallet-api2 address tokens, with an ephemeral P-256 key.
 *
 * The key pair is generated with WebCrypto, in memory, with a non-extractable private key:
 * it is never exported, persisted or logged, and it dies with the process. wallet-api2 binds
 * the address token to the key's SHA-256 JWK thumbprint (RFC 7638), so a token leaked from a
 * log, a proxy or the gateway is useless without the key.
 *
 * A proof is a compact JWS as wallet-api2's `DpopVerifier` checks it: header
 * `{ typ: 'dpop+jwt', alg: 'ES256', jwk }` (the public key only), claims `htm` (the method),
 * `htu` (the gateway URL of the request, without query or fragment), `iat` (seconds, within
 * ±60 s of the server's clock), a fresh `jti` (at most 64 characters: a UUID) and, once a
 * token exists, `ath` (base64url SHA-256 of the token). Kept out of the package's exports.
 */

/** The public half of the key, as it goes into the proof header. */
export interface DpopPublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

const encoder = new TextEncoder()

/** Unpadded base64url of bytes. */
export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlText(text: string): string {
  return base64url(encoder.encode(text))
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(text))
  )
}

/** `ath`: base64url SHA-256 of the access token (ASCII), as RFC 9449 §4.2 defines it. */
export async function accessTokenHash(token: string): Promise<string> {
  return base64url(await sha256(token))
}

/** The RFC 7638 SHA-256 thumbprint of a P-256 public JWK: members in lexicographic order. */
export async function jwkThumbprint(jwk: DpopPublicJwk): Promise<string> {
  const { crv, kty, x, y } = jwk
  return base64url(await sha256(JSON.stringify({ crv, kty, x, y })))
}

/** `url` without its query and fragment, as `htu` carries it. */
export function htuOf(url: string): string {
  return url.replace(/[?#].*$/, '')
}

/** An ephemeral DPoP key: one per sign-in. */
export class DpopKey {
  /** A true private field: not an own property, so no debug walk or `JSON.stringify` sees it. */
  readonly #privateKey: CryptoKey

  private constructor(
    privateKey: CryptoKey,
    readonly jwk: DpopPublicJwk,
    /** The key's SHA-256 JWK thumbprint (`jkt`), 43 base64url characters. */
    readonly thumbprint: string
  ) {
    this.#privateKey = privateKey
  }

  /** A new key pair; the private key cannot be exported. */
  static async create(): Promise<DpopKey> {
    const pair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    )) as CryptoKeyPair
    const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
    if (
      exported.kty !== 'EC' ||
      exported.crv !== 'P-256' ||
      !exported.x ||
      !exported.y
    )
      throw new Error('WebCrypto returned no P-256 public key.')
    const jwk: DpopPublicJwk = {
      kty: 'EC',
      crv: 'P-256',
      x: exported.x,
      y: exported.y
    }
    return new DpopKey(pair.privateKey, jwk, await jwkThumbprint(jwk))
  }

  /**
   * A proof for one request: `method` and `url` (its query and fragment are left out of
   * `htu`), bound to `accessToken` (`ath`) when given. Every proof has a new `jti`.
   */
  async proof(
    method: string,
    url: string,
    accessToken?: string
  ): Promise<string> {
    const header = base64urlText(
      JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: this.jwk })
    )
    const claims: Record<string, unknown> = {
      htm: method.toUpperCase(),
      htu: htuOf(url),
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID()
    }
    if (accessToken !== undefined)
      claims.ath = await accessTokenHash(accessToken)
    const input = `${header}.${base64urlText(JSON.stringify(claims))}`
    // WebCrypto's ECDSA signature is r || s (64 bytes), which is what JWS ES256 wants.
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.#privateKey,
      encoder.encode(input)
    )
    return `${input}.${base64url(new Uint8Array(signature))}`
  }

  /** Never prints the key: a key object in a log line or an error shows only its thumbprint. */
  toJSON(): { thumbprint: string } {
    return { thumbprint: this.thumbprint }
  }
}
