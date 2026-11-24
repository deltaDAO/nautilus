/**
 * The seam between nautilus and an identity wallet.
 *
 * nautilus opens the session itself (`PolicySessionResolver`): it starts the verification,
 * reads the session id and, after a presentation, checks that the verifier accepted it. A
 * `CredentialProvider` does only the one step nautilus cannot: answering the openid4vp
 * request from a wallet. That keeps the walt.id specifics behind one method.
 *
 * Two protocols reach a provider, told apart by `challenge.protocol`:
 *
 *   - `'policy-server'`: a node with a policy server; an openid4vp request with a
 *     presentation definition, answered with walt.id's v1 wallet API
 *     (`WaltIdCredentialProvider`);
 *   - `'oid4vp'`: a node with the native SSI module (`ssiInitiate`); an OpenID4VP 1.0
 *     request with a DCQL query, answered with walt.id's wallet-api2
 *     (`WalletApi2CredentialProvider`).
 *
 * A provider throws a `CredentialPresentationError` with reason `request-invalid` for a
 * protocol it does not speak.
 */
import type { AssetV5 } from '@oceanprotocol/ddo-js'
import type { DcqlQuery, PolicyServerPayload } from '../ddo/types.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'

/** One presentation the node asked for. */
export interface CredentialChallenge {
  /**
   * Which protocol asks: `'policy-server'` (a node with a policy server: an openid4vp
   * request with a presentation definition) or `'oid4vp'` (a node with the native SSI
   * module: an OpenID4VP 1.0 request with a DCQL query). `undefined` in challenges built
   * by code written before the native SSI module: read as `'policy-server'`.
   */
  protocol?: 'policy-server' | 'oid4vp'
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
  /** The session the node opened for this (consumer, asset, service). */
  sessionId: string
  /** The openid4vp request the wallet has to answer (`requestUri` for `'oid4vp'`). */
  redirectUri: string
  /** `'oid4vp'` only: the DCQL query the node asked the verifier for. */
  dcql?: DcqlQuery
  /** `'oid4vp'` only: when the presentation window closes (ISO 8601), when the node says. */
  expiresAt?: string
  /**
   * `'oid4vp'` only: the host of the node's public verifier (`status.ssi.verifierPublicHost`).
   * A request whose `request_uri` or `response_uri` points elsewhere was not created by this
   * node's verifier, and must not be answered. `undefined` when the node does not say.
   */
  verifierHost?: string
}

export interface CredentialProvider {
  /**
   * Answers the node's openid4vp request for one session from the wallet, and resolves
   * once the verifier has the presentation.
   *
   * Called only for a service whose credentials ask for a presentation, after nautilus has
   * opened the session. Whether the verifier accepted the presentation is checked by
   * nautilus afterwards (`checkSessionId`, or `ssiStatus` on a node with the native SSI
   * module), so a provider throws only when it could not present at all: no matching
   * credential, a rejected request, a wallet that does not answer.
   */
  present(challenge: CredentialChallenge): Promise<void>
  /**
   * Optional. Called before nautilus opens a session on a node with the native SSI module
   * (`ssiInitiate`), for a service that asks for a presentation. Throw here (a
   * `CredentialPresentationError` with reason `wallet-setup`, say) when the provider can
   * already tell it cannot present for this consumer: no session is opened then. A session
   * opened and never presented stays pending at the node until its presentation window
   * closes, and the node allows a consumer only a few pending sessions (429 after that).
   */
  prepare?(context: CredentialPreparation): Promise<void>
}

/** What `CredentialProvider.prepare` is told before a session is opened. */
export interface CredentialPreparation {
  asset: AssetV5
  serviceId: string
  /** The address the session will be bound to. */
  consumerAddress: string
  /** The node that will open the session. */
  node: OceanNodeClient
}

/**
 * How much credential gating this deployment enforces.
 *
 * Worth surfacing rather than assuming: a node with a policy server checks credentials with
 * it (`POLICY_SERVER_URL`), a node with the native SSI module with its verifier
 * (`status.ssi.enabled`), and a node with neither checks only address and access lists.
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
