/**
 * The seam between nautilus and an identity wallet.
 *
 * Nautilus never asks a wallet for credentials directly. It asks a `CredentialProvider` to
 * turn a policy challenge into a verifier session id, which is the only thing ocean-node
 * actually wants in its `policyServer` slot. That keeps the walt.id specifics — and the
 * fact that walt.id's v1 API is slated for deprecation — behind one interface.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import type { PolicyServerPayload } from '../ddo/types.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'

export interface CredentialChallenge {
  /** The asset whose service is gated. */
  asset: AssetV5
  /** The specific service being accessed — gating is per service, not per asset. */
  serviceId: string
  /** The address the node will attribute the request to. */
  consumerAddress: string
  /**
   * The node that will enforce this policy — for a download, the one in the service's
   * `serviceEndpoint`; for a compute job, the one running it.
   *
   * Part of the challenge because a session is only valid on the node that minted it. A
   * provider resolving against its own configured node instead created the session on one
   * node and submitted it to another, where it is simply unknown — which is exactly what
   * happens whenever a service points somewhere other than the configured node.
   */
  node: OceanNodeClient
}

export interface CredentialProvider {
  /**
   * Whether `resolve()` runs an interactive presentation flow.
   *
   * `skipCredentials` exists to skip *that flow*, so it only applies to providers that
   * have one. A provider which merely replays a session the caller already holds has
   * nothing to skip and is still consulted — which is what `skipCredentials` always
   * documented, and what short-circuiting the provider outright used to prevent.
   */
  readonly interactive?: boolean

  /**
   * Satisfies the policy for one (asset, service, consumer) triple and returns the payload
   * to hand ocean-node.
   *
   * Returns `null` when the deployment has no policy server, which callers must treat as
   * "no gating applies" rather than as a failure.
   */
  resolve(challenge: CredentialChallenge): Promise<PolicyServerPayload | null>
}

/**
 * How much credential gating this deployment enforces.
 *
 * Worth surfacing rather than assuming: ocean-node **fails open** when its
 * `POLICY_SERVER_URL` is unset, so an unconfigured node silently allows everything.
 */
export enum SsiMode {
  /** The node does not advertise a policy-server endpoint. */
  OFF = 'off',
  /** The endpoint exists, but this asset/service carries no SSI policy. */
  AVAILABLE = 'available',
  /** A presentation is required before access is granted. */
  REQUIRED = 'required'
}

/**
 * A provider that satisfies nothing. Used when no credential provider is configured, so
 * the flows do not need a null check on every call.
 */
export class NoopCredentialProvider implements CredentialProvider {
  readonly interactive = false

  async resolve(): Promise<null> {
    return null
  }
}

/**
 * Replays a session id the caller already holds — for example one cached from a browser
 * flow, or minted out of band. Skips the wallet round trip entirely.
 */
export class StaticCredentialProvider implements CredentialProvider {
  /** Nothing to present — the session already exists. */
  readonly interactive = false

  private readonly sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  async resolve(): Promise<PolicyServerPayload> {
    return emptyPolicyServerPayload(this.sessionId)
  }
}

/**
 * The payload shape ocean-node expects. Only `sessionId` carries information — the
 * redirect URIs are sent empty and the policy server substitutes its own configured
 * defaults, so they must be present but must not be invented.
 */
export function emptyPolicyServerPayload(
  sessionId: string
): PolicyServerPayload {
  return {
    sessionId,
    successRedirectUri: '',
    errorRedirectUri: '',
    responseRedirectUri: '',
    presentationDefinitionUri: ''
  }
}
