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
  JSON" instead of a JSON parse fragment, which stays on `cause`. Signatures and tokens in
  the node's text are redacted, and the text is cut at 200 characters.
- **A missing asset is reported as missing.** `resolve()` (and `getAsset()`) dropped the
  node's 404, so an unknown DID surfaced as `resolve: HTTP request failed`. It now reads the
  DDO itself and throws an `AssetNotFoundError`. After a 404 it reads the node's indexing
  state for the DID, and when the node recorded an indexing failure the message says so:
  `no asset found for did:ope:… (HTTP 404); the node recorded an indexing error for tx
  0x…: …`.

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
- **`initialize` and `getComputeLogs` over HTTP** have a timeout of `requestTimeoutMs`
  (default 120 s; for the logs, until the stream starts). A finished job's logs still come
  from its `algorithmLog` result (`Nautilus.getComputeLogs`).

**New**

- `AssetNotFoundError`, and `OceanNodeError.status`.
