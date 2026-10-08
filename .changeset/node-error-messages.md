---
'@deltadao/nautilus': patch
---

Report what ocean-node answered when a call fails.

**Fixes**

- **`initialize` and the compute logs report the node's message.** ocean-node answers many
  errors in plain text, and ocean.js reads them as JSON, so a refused call surfaced as
  `initialize: Unexpected token 'U', "Use the in"... is not valid JSON`, also on the
  access-denied path, and `getComputeLogs` as `Unexpected token 'J', "Job not fo"...`. Over
  HTTP, nautilus now sends these two requests itself (signed as ocean.js signs them), and a
  refusal throws an `OceanNodeError` with the node's status and text: `[ocean-node]
  initialize: HTTP 400 Bad Request: Use the initializeCompute endpoint to initialize compute
  jobs`. ocean.js no longer logs these failures to the console. Over P2P they still go
  through ocean.js.
- **Other node messages are unwrapped.** For the calls that still go through ocean.js, a
  JSON string answer is unquoted (`freeComputeStart: Error: Access to asset … was denied`,
  not `"Error: …"`) and the `error` of a JSON object answer is used. A plain-text answer,
  whose status and text ocean.js does not pass on, reads "the node's error answer is not
  JSON" instead of a JSON parse fragment, which stays on `cause`.
- **The node's text is sanitized.** Before it goes into a message, ANSI escapes and control
  characters (CR, LF) are removed; signatures, tokens (`vp_token`, `id_token`, bare JWTs,
  bearer credentials), `request_uri`, `code`, `nonce`, passwords and API keys are redacted in
  a query, a JSON field or `key: value` prose; a URL keeps its origin only, so a policy
  server's redirect URI or an internal host's path is not relayed; and the text is cut at
  200 characters. An error answer's body is read up to 64 KB, within the request's timeout.
  For an ocean.js error, `cause` is a sanitized copy rather than the error itself. An
  indexing record's `txId` is named only when it is a transaction hash.
- **A missing asset is reported as missing.** `resolve()` (and `getAsset()`) dropped the
  node's 404, so an unknown DID surfaced as `resolve: HTTP request failed`. It now reads the
  DDO itself and throws an `AssetNotFoundError`. After a 404 it reads the node's indexing
  state for the DID, and when the node recorded an indexing failure the message says so:
  `no asset found for did:ope:… (HTTP 404); the node recorded an indexing error for tx
  0x…: …`. The two indexing-state reads run in parallel. Over P2P, the node's `Not found`
  answer throws an `AssetNotFoundError` too, without the indexing state (served over HTTP
  only).
- **Redirects.** `initialize` does not follow redirects: its query carries the consumer's
  address and `userdata`. The read-only node GETs (`resolve`, `waitForIndexer`,
  `getIndexingState`, `getNodeAddress`, `getIndexerNonceState`) refuse a redirect from a
  public node to a loopback, private or link-local host (cloud metadata, for one), so its
  answer cannot end up in an error message.
- **The compute logs request with a JWT.** Without `consumerAddress` it threw; the address
  is now read from the token's `address` claim, as ocean.js reads it, and `consumerAddress`
  is optional for a JWT. With a Signer, the request is serialized with the client's other
  signed commands, so concurrent calls no longer reuse a nonce, and it is retried once when
  the node rejects the nonce.
- **`PolicyDeniedError.consumerAddress` is the address sent**: a Signer's own, not the one
  the request named.

**Breaking (beta API)**

- **Node error messages changed form.** A failure the node answered reads `[ocean-node]
  <operation>: HTTP <status> <statusText>: <text>`, and `OceanNodeError.status` holds the
  status. `getNodeAddress`, `getIndexerNonceState`, `getIndexingState` and
  `initializePolicyVerification` (for an answer that is not a refusal) use the same form.
  An `OceanNodeError` thrown inside a wrapped call (`requireSigner` in `validateRemote`) is
  passed on rather than wrapped again.
- **`resolve()` throws an `AssetNotFoundError`** (`did`, `status` 404, and `state` with the
  node's indexing failure record when there is one) for an asset the node does not serve.
  Over HTTP it reads the DDO itself, with a 15 s timeout.
- **`OceanNodeError.cause`** of a wrapped ocean.js error is a sanitized copy, and
  `IndexingError` messages are cut at 200 characters. `initialize` throws on a redirect.
- **`initialize` and `getComputeLogs` over HTTP** have a timeout of `requestTimeoutMs`
  (default 120 s; for the logs, until the stream starts). A finished job's logs still come
  from its `algorithmLog` result (`Nautilus.getComputeLogs`).

**New**

- `AssetNotFoundError`, and `OceanNodeError.status`.
