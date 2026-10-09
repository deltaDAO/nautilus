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
  without a policy server is read from its status (`isPSConfigured`) or, where the status
  does not say (ocean-node 4.2.0), from its answer to `initiate`, so there is nothing to
  skip.
- **`WaltIdCredentialProvider`** implements `present()`: it no longer calls `initiate`, takes
  no `sessionStore`, and has no `clearSessions()` or `explainFailure()`. The session cache is
  `Nautilus.create`'s new `sessionStore` option; the failed policies are on
  `PolicyDeniedError.reason`.
- **`OceanNodeClient.initializePolicyVerification` returns the reply, `null` or throws.** It
  returns `null` only for a node without a policy server, which answers a 404 with no body
  (over P2P, a bare 404 status), and `hasPolicyServer()` then answers `false` for 10
  minutes. It throws a `PolicyDeniedError` only for the policy server's own refusal (a reply
  with `success: false` and a 4xx), and an `OceanNodeError` with the status for everything
  else: the node's own 401 (nonce, signature, "Auth not configured"), 404 (asset not indexed
  there) and 400 (policy server unreachable), a network error, a timeout, a rate limit or a
  5xx. With a Signer, a rejected nonce is retried
  once. Over HTTP it signs and sends the command itself, as ocean.js signs it: ocean.js 9.2
  throws `JSON.stringify(await response.json())` for a failed answer, which keeps the policy
  server's JSON reply but turns the node's plain-text errors into a `SyntaxError`, losing
  their status and text (the rejected nonce among them). Over P2P, where ocean.js keeps the
  node's text, it goes through ocean.js.
- **`PolicyDeniedError.details` is replaced by `policyResults`**: the verifier's per-policy
  name, outcome and error only. `details` held the verifier's whole record, the presentation
  (`vp_token`) included. `reason` is bounded, without control characters.
- **`checkPolicySession` returns `{ verified, policyResults }`** instead of
  `{ verified, result }`, for the same reason. Over HTTP nautilus sends it itself, with a
  bounded read, since ocean.js logs the body of the error answer (the record with the
  presentation).
- **A `sessionStore` of your own gets only address-only sessions.** The id of a presented
  session lets anyone read the presentation through the node (`checkSessionId` is not
  signed), so presented sessions stay in the resolver's memory unless
  `persistPresentedSessions: true` (new option of `Nautilus.create` and
  `PolicySessionResolver`, which warns once).
- **`WaltIdCredentialProvider` checks what the node sends.** For a download that node is the
  publisher's `serviceEndpoint`. It refuses a request that is not `openid4vp://`, a
  `request_uri`, `response_uri` or `presentation_definition_uri` that is not `https://` (or
  `http://` on a loopback host, or anywhere with its new `allowInsecureTransport`), or that
  points at a link-local or metadata address; refuses a presentation definition with an input
  descriptor for a credential type the asset's or service's `request_credentials` do not
  name; presents only credentials of the requested types; and refuses when its signer is not
  the session's consumer.
- **`PolicyServerAction` moved to the node client** (still exported from the package root)
  and has only `GET_PD` and `CHECK_SESSION_ID`.
- **`setCredentialProvider(undefined)`** removes the provider; the instance no longer writes
  the provider into its options.
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
  passes it to the download URL. The session id is `message.sessionId` from `initiate`, which
  policy server 1.3 always sends.
- **A refused compute job keeps the policy server's reason.** `compute()` and
  `freeCompute()` open one session per input, the algorithm included, each for its own asset
  and service, before escrow, approvals and orders, and send the same array to
  `initializeCompute` and `computeStart` / `freeComputeStart`. A refusal throws a
  `PolicyDeniedError` with the policy server's message.
- **A presentation is checked before the order.** After the provider presents, nautilus asks
  the policy server (`checkSessionId`) and goes on only on `verificationResult: true`, else a
  `PolicyDeniedError` names the failed VC/VP policies.
- **Refusals are never cached**, and the session is opened for and cached under the address
  the node forwards to the policy server (`OceanNodeClient.policySessionAddress`):
  `signer.getAddress()` unchanged for a Signer, which also goes to the download or compute
  call, and the token's address for a JWT, which the node uses whatever the request says. The
  policy server hashes it into the session id as it is, so a session opened for the
  checksummed address is never handed to a request with the lower-cased one.
- **Parallel calls to one node no longer sign the same nonce.** `forEndpoint` returns one
  client per normalised node URI, shared by every client derived from the same one, with
  one signing queue and one `hasPolicyServer` answer; it used to build a new client, and
  queue, on every call.
- **Response bodies are read up to a limit**: 8 MiB by default for every request nautilus
  sends itself, 256 KiB for policy-server answers.
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

- `PolicyDeniedError` (`did`, `serviceId`, `consumerAddress`, `code`, `reason`,
  `policyResults`) and `PolicyCheckResult`, exported. It is not an `OceanNodeError`.
- `PolicySessionResolver`, exported, with `resolve()`, `setCredentialProvider()` and
  `clearSessions()`; it and `Nautilus.create` take `sessionStore`, `persistPresentedSessions`
  and `sessionTtlMs` (`DEFAULT_SESSION_TTL_MS`, exported).
- `sessionKeyString(key)`: the key `MemorySessionStore` stores an entry under.
- `OceanNodeClient.hasPolicyServer()` (the node's `isPSConfigured`, or what an `initiate`
  showed; a "yes" kept per client, a "no" for 10 minutes),
  `policySessionAddress(consumerAddress)` and `checkPolicySession(sessionId)`;
  `authTokenAddress(token)`, the address in a node JWT.
- `hasCredentials(ddo, service)`: whether ocean-node checks credentials for a service.
