/**
 * The seam between nautilus and an identity wallet.
 *
 * nautilus opens the policy-server session itself (`PolicySessionResolver`): it starts the
 * verification, reads the session id and, after a presentation, checks that the verifier
 * accepted it. A `CredentialProvider` does only the one step nautilus cannot: answering
 * the openid4vp request from a wallet. That keeps the walt.id specifics, and the fact that
 * walt.id's v1 API is slated for deprecation, behind one method.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import type { PolicyServerPayload } from '../ddo/types.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'

/** One presentation the policy server asked for. */
export interface CredentialChallenge {
  /** The asset whose service is gated. */
  asset: AssetV5
  /** The specific service being accessed: gating is per service, not per asset. */
  serviceId: string
  /** The address the session is bound to, and the node will attribute the request to. */
  consumerAddress: string
  /**
   * The node that opened the session and will enforce the policy: for a download, the one
   * in the service's `serviceEndpoint`; for a compute job, the one running it. Only the
   * policy server behind it knows the session, so anything the provider asks the policy
   * server (the presentation definition, for one) goes through this node.
   */
  node: OceanNodeClient
  /** The session the policy server opened for this (consumer, asset, service). */
  sessionId: string
  /** The openid4vp request the wallet has to answer. */
  redirectUri: string
}

export interface CredentialProvider {
  /**
   * Answers the policy server's openid4vp request for one session from the wallet, and
   * resolves once the verifier has the presentation.
   *
   * Called only for a service whose `SSIpolicy` asks for credentials, after nautilus has
   * opened the session. Whether the verifier accepted the presentation is checked by
   * nautilus afterwards (`checkSessionId`), so a provider throws only when it could not
   * present at all: no matching credential, a rejected request, a wallet that does not
   * answer.
   */
  present(challenge: CredentialChallenge): Promise<void>
}

/**
 * How much credential gating this deployment enforces.
 *
 * Worth surfacing rather than assuming: ocean-node checks credentials with its policy
 * server only when it has one (`POLICY_SERVER_URL`), and checks only address and access
 * lists itself otherwise.
 */
export enum SsiMode {
  /** The node has no policy server. */
  OFF = 'off',
  /** The node has one, but this asset/service carries no SSI policy. */
  AVAILABLE = 'available',
  /** A presentation is required before access is granted. */
  REQUIRED = 'required'
}

/**
 * The payload shape ocean-node expects. Only `sessionId` carries information: the
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
