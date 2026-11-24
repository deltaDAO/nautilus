---
'@deltadao/nautilus': minor
---

Support nodes with the native SSI module (pontusx-node: ocean-node with walt.id
verifier-api2, OpenID4VP 1.0 and DCQL), which replaced the policy server, and walt.id's
wallet-api2 as the wallet.

nautilus picks the flow from the node's status: a node that announces an `ssi` block gets the
native SSI flow; a node with a policy server keeps the policy-server flow unchanged.

**Consuming**

- **`ssiInitiate` / `ssiStatus`.** `access()`, `compute()` and `freeCompute()` open an SSI
  session for every service whose asset or service has an `SSIpolicyV2` (or deprecated
  `SSIpolicy`) entry, have the credential provider present the OpenID4VP request, and poll
  `ssiStatus` until it is `verified`, all before the fee request and any order. A refusal is
  a `PolicyDeniedError` with `source: 'ssi'`: 403 (address) or 422 (an SSI policy the node
  cannot satisfy) from `ssiInitiate`, or a `failed`/`expired` session, with the node's results
  in `policyResults` (`scope`: `vc`, `vp`, `gaiax`, `rego`, `binding`; `credential`: the DCQL
  query id). A rego deny shows as the `vc` policy `dynamic`, which is how verifier-api2 runs
  rego.
- **`initialize`** gets the session too (`policyServer` query parameter): the node checks it
  before it quotes the fee. An asset without SSI entries needs no session: the node checks addresses
  itself.
- **`policyServer` payloads.** A download sends `{ sessionId }`; a compute job sends
  `{ sessionId, sessionIds: { <did>: <sessionId> } }`, one session per input with an SSI
  requirement, the algorithm included. Native sessions are never cached: the node consumes
  them (one order for a download, one job for compute).
- **`WalletApi2CredentialProvider`.** Presents from walt.id wallet-api2 with its handle-based
  flow (`present/preview-handle`, then `submit-handle` or `reject-handle`), authenticated
  with the account's session token (a Hanko session JWT on the pontusx platform). By default
  it presents from the organisation wallet of the consumer's address and picks, for every
  required credential combination, the first one the wallet holds. It checks the request
  first and declines it (`reject-handle`) when the request or the `response_uri` is not on
  the node's announced verifier host, when the wallet offers credentials for a DCQL query the
  node did not ask for, or when `transaction_data` is not the node's asset-access item for
  this consumer, asset and service. `onSelectCredentials` drives the choice from a UI.
- **`CredentialProvider.prepare()`** (optional) runs before `ssiInitiate`. A provider that can
  already tell it cannot present (no wallet for the consumer's address, a rejected token)
  throws there, and no node session is opened: one that is opened and never presented stays
  pending until its window closes, and the node allows a consumer only 5 pending sessions.
  `WalletApi2CredentialProvider` resolves the consumer's wallet in it.
- **`CredentialChallenge`** gains `protocol` (`'policy-server'` | `'oid4vp'`), `dcql`,
  `expiresAt` and `verifierHost`. `WaltIdCredentialProvider` refuses an `oid4vp` challenge and
  `WalletApi2CredentialProvider` a policy-server one, both as `request-invalid`.
- **`PolicySessionResolver.resolveSession()`** returns the session with its protocol;
  `resolve()` returns `PolicyServerPayload | SsiSessionPayload`. New option
  `ssiStatusPolling` (also on `Nautilus.create`): default 5 attempts, 2 s apart.
- New log events `identity.ssi.legacy_policy` (the node translated a deprecated `SSIpolicy`)
  and `identity.ssi.verifier_unannounced` (the node does not announce its verifier host).

**Publishing**

- **`AssetBuilder.addSsiPolicyV2()` / `ServiceBuilder.addSsiPolicyV2()`** (and
  `removeSsiPolicyV2()`) write an `SSIpolicyV2` value into `credentials.allow`. The value is
  first checked against the node's rules (`validateSsiPolicyV2Value`: formats, the VC policy
  allowlist without `regex` and `webhook`, holder binding, reserved Gaia-X query ids, no
  Gaia-X with W3C queries, rego static checks). A value the node would refuse throws an
  `SsiPolicyValidationError` before anything is published. `addRequestCredentials` (the
  policy server's `SSIpolicy`) is deprecated for these nodes.
- **`Nautilus.validateRego(code, { policy, nodeUri })`** checks rego locally, then has the
  node compile it in its verifier's OPA (`validateRego`, authorized publishers and admins
  only). **`Nautilus.getSsiCapabilities(nodeUri?)`** reads a node's `status.ssi`.
- New publish preflight warnings: `publish.preflight.ssi_v2_unsupported`,
  `ssi_disabled`, `ssi_legacy` and `gaiax_unsupported`.

**Node client**

- `OceanNodeClient.ssiInitiate()`, `ssiStatus()`, `validateRego()` and
  `getSsiCapabilities()`. The commands are signed on their own
  (`address + nonce + command`, or a node auth token), over HTTP only: a pre-computed
  signature and a P2P node URI are refused before anything is sent.

**Verified end to end** against the pontusx stack (pontusx-wallet-ui `deploy/e2e`: node
`f1724658`, walt.id `85e302a67`, Hanko test double): capabilities, `access()` with explicit and
headless credential choice, a rego deny, a wallet-setup refusal that opens no node session,
`validateRego`, a nautilus publish with `addSsiPolicyV2` consumed by nautilus, a Gaia-X L1 asset
(granted, and refused with an untrusted label), a `dc+sd-jwt` asset consumed with an SD-JWT VC, and
Compute-to-Data on a docker-in-docker environment: `freeCompute()` and paid `compute()` on an
SSI-gated dataset and algorithm (one session per input, job finished, result checked) and a rego
deny refused before any job.
