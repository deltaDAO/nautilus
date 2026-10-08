---
'@deltadao/nautilus': patch
---

Open the policy-server session in nautilus itself, on every download and compute job the
node checks, and report a refusal before anything is ordered.

On a node with a policy server, ocean-node checks a policy-server session on every download
and compute job of an asset whose asset or service has `credentials` (`{}` included), whether
it is gated by addresses or by an `SSIpolicy`. The policy server opens that session in
`initiate`, after checking the consumer's address against the asset's allow list, and binds
it to (consumer, asset, service). beta.1 opened it only through a `CredentialProvider`, read
it only from a redirect containing `success` and `id=`, and took any failed `initiate` for
"no policy server". So an address-gated download was ordered and then refused, a refused
compute job lost the policy server's reason, and a presentation the verifier did not accept
was found out only after the order.

**Breaking (beta API)**

- **`CredentialProvider` is presentation-only.** Its one method is
  `present(challenge): Promise<void>`, called only for a service whose `SSIpolicy` asks for
  credentials, with the open session (`sessionId`) and the openid4vp request (`redirectUri`)
  on the challenge. `resolve()` and `interactive` are removed. nautilus opens the session,
  reads its id and checks the result itself (`PolicySessionResolver`).
- **`StaticCredentialProvider` and `NoopCredentialProvider` are removed.** No provider is
  the default, and address-gated assets need none. An asset that asks for a presentation is
  refused before anything is signed or ordered when no provider is set.
- **`skipCredentials` is removed** from `access()`, `compute()` and `freeCompute()`. A node
  without a policy server is read from its status (`isPSConfigured`), so there is nothing to
  skip.
- **`WaltIdCredentialProvider`** implements `present()`: it no longer calls `initiate`, takes
  no `sessionStore`, and has no `clearSessions()` or `explainFailure()`. The session cache is
  `Nautilus.create`'s new `sessionStore` option; the failed policies are on
  `PolicyDeniedError.reason`.
- **`OceanNodeClient.initializePolicyVerification` throws on a refusal.** It returns `null`
  only when the node has no policy server (`isPSConfigured: false`, or a 404 with an empty
  body), throws a `PolicyDeniedError` on any other 4xx, and an `OceanNodeError` on a network
  error, a timeout, a rate limit or a 5xx. Over HTTP it signs and sends the command itself,
  as ocean.js signs it, because ocean.js reports a failed answer without its status.
- **`access()` and `compute()` take `policySessions`** (a `PolicySessionResolver`) in their
  standalone `context` instead of `credentials`.
- **`SessionEntry` is `{ sessionId, createdAt, presented }`**: `skipped` is removed (only
  verified sessions are cached), and a `SessionStore` of your own must keep when the session
  was opened and whether it was presented. `MemorySessionStore` keys the consumer address
  exactly as given, no longer lower-cased; key a store of your own on `sessionKeyString(key)`.
- **`assertPolicySatisfied`** now refuses a service that asks for a presentation when no
  provider can make one (`canPresent`), and `shouldResolveCredentials` is removed.

**Fixes**

- **An allowlisted download is no longer refused after the order.** `access()` opens the
  session before `initialize` and the order whenever the service's node has a policy server
  and the asset or service has `credentials`, with no wallet for an address-only gate, and
  passes it to the download URL. The session id is `message.sessionId` from `initiate`, else
  the redirect's `sessionId=`, `id=` or `state=`.
- **A refused compute job keeps the policy server's reason.** `compute()` and
  `freeCompute()` open one session per input, the algorithm included, each for its own asset
  and service, before escrow, approvals and orders, and send the same array to
  `initializeCompute` and `computeStart` / `freeComputeStart`. A refusal throws a
  `PolicyDeniedError` with the policy server's message.
- **A presentation is checked before the order.** After the provider presents, nautilus asks
  the policy server (`checkSessionId`) and goes on only on `verificationResult: true`, else a
  `PolicyDeniedError` names the failed VC/VP policies.
- **Refusals are never cached**, and the same address string (`signer.getAddress()`,
  unchanged) goes to `initiate`, to the download or compute call and into the cache key: the
  policy server hashes it into the session id as it is sent, so a session opened for the
  checksummed address is never handed to a request with the lower-cased one.
- **A cached session is never spent stale.** It is reused for at most `sessionTtlMs` from
  `initiate` (2 minutes by default, well inside the 5 minutes walt.id's verifier keeps a
  session), and one that needed a presentation is checked again (`checkSessionId`) before
  it is reused. A stale one, also from a `sessionStore` that outlived the policy server or
  its restart, is opened again before anything is ordered.
- **`publish()` and `edit()` warn about an asset no consumer can use**: when a node the
  asset is served from has a policy server and the asset-level `credentials` are `{}`, or
  have an `allow` list without an `address` entry, that policy server refuses every
  consumer. They log a warning and go on.

**New**

- `PolicyDeniedError` (`did`, `serviceId`, `consumerAddress`, `code`, `reason`, `details`),
  exported. It is not an `OceanNodeError`.
- `PolicySessionResolver`, exported, with `resolve()`, `setCredentialProvider()` and
  `clearSessions()`; it and `Nautilus.create` take `sessionStore` and `sessionTtlMs`
  (`DEFAULT_SESSION_TTL_MS`, exported).
- `sessionKeyString(key)`: the key `MemorySessionStore` stores an entry under.
- `OceanNodeClient.hasPolicyServer()` (the node's `isPSConfigured`, read once per client) and
  `checkPolicySession(sessionId)`.
- `hasCredentials(ddo, service)`: whether ocean-node checks credentials for a service.
