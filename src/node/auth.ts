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
import type { Signer } from 'ethers'

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
 * For a JWT the address is embedded in the token, but ocean.js does not re-export its
 * `decodeJwt` helper, so callers using token auth must supply the address themselves.
 */
export async function resolveConsumerAddress(
  auth: NodeAuth,
  fallback?: string
): Promise<string> {
  if (isCompleteSignature(auth)) return auth.consumerAddress
  if (isSigner(auth)) return auth.getAddress()
  if (fallback) return fallback

  throw new Error(
    'Cannot determine the consumer address from an auth token. Pass consumerAddress explicitly, or authenticate with a Signer.'
  )
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
