/**
 * Auth-mode normalization for ocean-node requests.
 *
 * ocean-node accepts three credentials interchangeably, expressed by ocean.js as
 * `SignerOrAuthTokenOrSignature`:
 *
 *   1. a `Signer` — nautilus fetches a nonce and signs `address + (nonce+1) + command`
 *      on every call;
 *   2. a JWT auth token string — sent as an `Authorization` header, no per-call signature;
 *   3. a `CompleteSignature` — a pre-computed `{consumerAddress, nonce, signature}`, for
 *      delegated or agent flows.
 *
 * Mode 1 costs an extra round-trip per request. For anything chatty (a compute poll loop,
 * a batch publish) prefer minting a token once with `createAuthToken()`.
 */
import {
  type CompleteSignature,
  ProviderInstance,
  type SignerOrAuthTokenOrSignature
} from '@oceanprotocol/lib'
import { isAddress, type Signer } from 'ethers'

export type NodeAuth = SignerOrAuthTokenOrSignature

export function isAuthToken(auth: NodeAuth): auth is string {
  return typeof auth === 'string'
}

export function isCompleteSignature(auth: NodeAuth): auth is CompleteSignature {
  return (
    typeof auth === 'object' &&
    auth !== null &&
    'consumerAddress' in auth &&
    'signature' in auth
  )
}

export function isSigner(auth: NodeAuth): auth is Signer {
  return !isAuthToken(auth) && !isCompleteSignature(auth)
}

/**
 * The address the node will attribute the request to.
 *
 * For a JWT it is `fallback` when given, else the token's `address` claim (see
 * `addressFromAuthToken`).
 */
export async function resolveConsumerAddress(
  auth: NodeAuth,
  fallback?: string
): Promise<string> {
  if (isCompleteSignature(auth)) return auth.consumerAddress
  if (isSigner(auth)) return auth.getAddress()

  const address = fallback || addressFromAuthToken(auth)
  if (address) return address

  throw new Error(
    'Cannot determine the consumer address from an auth token: it has no address claim. Pass consumerAddress explicitly, or authenticate with a Signer.'
  )
}

/**
 * The `address` claim of a node auth token, read the way ocean.js reads it
 * (`decodeJwt(token).address`): the payload is decoded, not verified, which is all it takes
 * to name the address the node checks the token against. `undefined` for a token that is
 * not a JWT or whose claim is not an address.
 */
export function addressFromAuthToken(token: string): string | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(binary, (char) => char.charCodeAt(0))
      )
    )
    const address =
      claims && typeof claims === 'object'
        ? (claims as { address?: unknown }).address
        : undefined

    return typeof address === 'string' && isAddress(address)
      ? address
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Mints a node session token so subsequent calls skip the nonce-and-sign round trip.
 * Invalidate it with `revokeAuthToken` when you are done.
 */
export async function createAuthToken(
  signer: Signer,
  nodeUri: string,
  signal?: AbortSignal
): Promise<string> {
  return ProviderInstance.generateAuthToken(signer, nodeUri, signal)
}

export async function revokeAuthToken(
  signer: Signer,
  token: string,
  nodeUri: string,
  signal?: AbortSignal
): Promise<boolean> {
  const result = await ProviderInstance.invalidateAuthToken(
    signer,
    token,
    nodeUri,
    signal
  )

  return result?.success === true
}
