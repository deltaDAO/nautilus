# @deltadao/nautilus

## 2.0.0-beta.2

### Patch Changes

- [#204](https://github.com/deltaDAO/nautilus/pull/204) [`c5ec236`](https://github.com/deltaDAO/nautilus/commit/c5ec2367e9b085d24711c1dd8145a9e5e1d5e5c3) Thanks [@Abrom8](https://github.com/Abrom8)! - Check the service and its consumer parameters before `access()` and `compute()` send
  anything.
  
  **Fixes**
  
  - **Consumer parameters are validated.** A value of the wrong type was sent on: a service
    declaring `rows` as a `number` took `userdata: { rows: 'not-a-number' }`, and the order
    was placed and the file downloaded. `access()` now checks `userdata` against the
    service's `consumerParameters` before the node is asked for a fee, and `compute()` /
    `freeCompute()` check every input's `userdata` and the algorithm's `algocustomdata`
    before the environment is read. `algocustomdata` is checked against the algorithm
    metadata's `consumerParameters`, else, when that is absent or empty, the
    `container.consumerParameters` some DDOs carry.
  - **`null` consumer parameters are not sent.** An explicit `null` counted as absent for an
    optional parameter but was still forwarded, reaching `initialize`, the download URL
    (`?age=null`) or the job. Keys set to `undefined` or `null` are now dropped from
    `userdata` and `algocustomdata` before anything is sent, whether or not the asset
    declares parameters; the caller's object is left unchanged.
  - **`userdata` reaches the node intact over HTTP.** ocean.js appended it to the download
    URL with `encodeURI`, which leaves `&`, `#`, `+` and `=` as they are: a value holding one
    of them, or a number such as `1e21` (sent as `1e+21`), broke the query, and the node ran
    the paid download without any `userdata`. It is now encoded as one query component. The
    download signature does not cover it, so the URL stays valid. P2P is unchanged.
  - **`access()` refuses a non-access service.** On a `compute` service it called the node's
    `initialize` and failed with a JSON parse error. It now throws before any node call, naming
    `compute()` and `freeCompute()`; an asset with only a `compute` service gets the same
    pointer.
  
  **Breaking (beta API)**
  
  - **`ConsumerParameterError`** (`did`, `serviceId`, `field`, `issues`) is thrown before
    anything is sent when the values do not fit what the asset declares. Each issue is
    `{ parameter, reason, message }`. A message gives the refused value's type and, for a
    string, its length, never the value, so a secret typed into the wrong field stays out of
    logs; parameter names and option keys, the publisher's text, are shown without control
    characters and cut to 40 characters, and lists of them, like the issues in the error's
    message, stop after 10 (`error.issues` keeps them all). `reason` is one of:
    - `'missing'`: a `required` parameter is absent (`undefined` or `null`);
    - `'wrong-type'`: `text` takes a string, `number` a finite number (not `'5'`), `boolean`
      a boolean, `select` a string, and any other type a string, a finite number or a
      boolean;
    - `'not-an-option'`: a `select` value is not the first key of one of its options (the
      key the node and the market read; other keys are refused);
    - `'invalid-declaration'`: a `select` whose options are missing, empty or malformed.
      Any value for it is refused (it used to take every string); an optional one can be
      left absent;
    - `'unknown'`: a key the asset does not declare;
    - `'not-object'`: the values are not a plain object. A `Date`, `Map`, `Set` or class
      instance is refused too.
  
    An asset that declares no parameters takes any keys, but not any values as it used to:
    they must be a plain object (`'not-object'`), each a string, a finite number or a
    boolean (`'wrong-type'`), since an object or an array reached the file's URL as
    `[object Object]`. Defaults are not filled in: an absent optional parameter stays
    absent, and values left empty once `undefined` and `null` keys are dropped are not sent.
  - **`access()` downloads from `access` services only**, with an `Error` for any other
    service type.
  
  **New**
  
  - `checkConsumerParameters(declared, values)` returns the same issues without throwing, to
    validate a form before calling. `declared` is a `DeclaredConsumerParameter[]`, which a
    service's or an algorithm's `consumerParameters` and ddo-js's v4 `ConsumerParameter[]`
    all fit.
  - `getAlgorithmConsumerParameters(asset)` returns the parameters an algorithm declares for
    `algocustomdata`.
  
  **Migration**
  
  Send values of the declared types, only for declared parameters, and every required one.
  For an asset that declares none, send strings, numbers and booleans only:
  
  ```ts
  await nautilus.access({
    assetDid,
    userdata: { rows: 5 } // was { rows: '5' }
  })
  ```
  
  For a `compute` service, run a job with `compute()` or `freeCompute()` instead of calling
  `access()`.

- [#204](https://github.com/deltaDAO/nautilus/pull/204) [`b928b3c`](https://github.com/deltaDAO/nautilus/commit/b928b3c411dcf90858ff000090c75487224862b8) Thanks [@Abrom8](https://github.com/Abrom8)! - Address a compute job by the id ocean-node gives it, read the job's `output` and final logs,
  request a CPU and memory limit by default, and publish algorithms without a dataset's
  compute settings.
  
  **Fixes**
  
  - **A job's status, result and logs are the job's own.** nautilus shortened a started job's
    id to the bare `<jobId>` and asked the node for that. ocean-node filters on a job only by
    `<environmentHash>-<jobId>`, and given a bare id answers with every job of the consumer;
    nautilus then took the first, so an unknown or mistyped id returned another job's status
    and `getComputeResult()` that job's output URL. Every status request also transferred the
    consumer's whole job history. Jobs are now addressed by the qualified id, and
    `getComputeStatus()` (and `OceanNodeClient.getComputeJob()`) return `undefined` when no
    job matches.
  - **`streamComputeResult()` streams the job's `output`.** It read the result at index 0,
    which on ocean-node 4.2 is the image log (`imageLog`, `configurationLog`, `algorithmLog`,
    `output`). It now picks the result as `getComputeResult()` does.
  - **A failed job has finished.** A job counts as finished once the node sets its
    `dateFinished`, as the node itself decides, rather than from status `70`: failed jobs end
    below it (`2`, `11`, `13`, `21`, `22`, `31`, `41`, `42`, `61`, `62`, …), so
    `getComputeResult()` reported them as not finished forever and `getComputeLogs()` failed
    on them. Both now read a failed job's results.
  - **A job at `71` without its `output` yet is not ready, not output-less.** The node sets
    `71` (`JobSettle`) before it writes `outputs.tar`, so `getComputeResult()` logs that the
    job has not listed its `output` yet instead of warning that it has none, and
    `streamComputeResult()` says so in its error.
  - **`getComputeLogs()` works on a finished job.** The node serves live logs only while the
    algorithm runs, so once the job has finished it streams the job's `algorithmLog` result,
    also when the job finishes between the status check and the log request.
  - **Job ids cannot add query parameters.** ocean.js puts the job id into the query string of
    signed requests unencoded, and nautilus accepted any id with a dash, so `h-x&index=3` added
    a parameter. Job ids must now be exactly what ocean-node builds (`0x` and 64 hex digits, a
    dash, 64 hex digits), result indexes non-negative safe integers; errors give a malformed
    id's length, not the id.
  - **Node URIs in compute errors and logs show only their origin**, since a URI can carry
    credentials; job ids are left out of those messages too.
  - **Jobs get a CPU and memory limit by default.** Without `resources` (or with `[]`), each resource
    defaulted to the environment's minimum, `0` for RAM and disk on ocean-node 4.2
    environments, so free jobs ran without a memory limit. `cpu`, `ram` and `disk` now
    default to at least `1` within the resource's maximum, on free and paid jobs; other
    resources default to their minimum. A non-empty `resources` list is sent exactly as
    given.
  - **Algorithms carry no `compute` block.** An algorithm's compute service was published with
    a dataset's settings (`allowRawAlgorithm`, `allowNetworkAccess`, an empty
    `publisherTrustedAlgorithms`, …), which ocean-node reads from datasets only. Assets of type
    `algorithm` are now published and edited without them.
  - **Docs:** the `output` result is `outputs.tar`, a tar archive; `configurationLog` is no
    longer misspelt. A qualified job id is to be kept secret: ocean-node 4.2.2 checks that a
    live-log request is signed, not that the signer owns the job.
  - **Example:** `retrieveComputeResult` no longer prints the signed result URL, and counts the
    archive's bytes as they stream instead of buffering it.
  
  **Breaking (beta API)**
  
  - **Job ids are `<environmentHash>-<jobId>`.** `compute()` and `freeCompute()` return the
    id as the node gives it, and `getComputeStatus()`, `getComputeResult()`,
    `streamComputeResult()`, `getComputeLogs()` and `stopCompute()` take it. A bare id throws,
    as it does on `OceanNodeClient`'s `computeStatus()`, `getComputeJob()`, `computeStop()`,
    `getComputeResultUrl()`, `getComputeResult()` and `getComputeLogs()`. Jobs from the
    node come back under the qualified id.
  - **`getComputeStatus()` returns `NodeComputeJob | undefined`**, which adds the node's
    `environment`, `resources` and `payment` to `ComputeJob`; so do
    `OceanNodeClient.computeStatus()` and `getComputeJob()`. `compute()` and `freeCompute()`
    return `jobs: NodeComputeJob[]`, and `stopCompute()`, `OceanNodeClient.computeStart()`,
    `freeComputeStart()` and `computeStop()` return `NodeComputeJob[]`.
  - **A job id must match ocean-node's exact format**, and `getComputeResultUrl()` and
    `getComputeResult()` throw a `RangeError` for an `index` that is not a non-negative safe
    integer.
  - **`getComputeLogs()` returns a `ComputeResultStream`** (`AsyncIterable<Uint8Array>`)
    instead of `unknown`, on `Nautilus` and `OceanNodeClient`. `OceanNodeClient.getComputeLogs()`
    throws when the node returns no stream.
  - **`streamComputeResult()` throws for a job that has not finished**, as well as for an
    unknown job or one without the result.
  - **Paid jobs request at least 1 CPU, 1 GB of RAM and 1 GB of disk by default**, so their
    escrow quote can be higher than with beta.1's defaults. Pass `resources` to choose.
  
  **Migration**
  
  Wait for a job on `dateFinished`, not on status `70` or `71`; a failed job never reaches
  them:
  
  ```ts
  const job = await nautilus.getComputeStatus({ jobId })
  if (job?.dateFinished) console.log('finished with', job.status, job.statusText)
  ```
  
  Keep the `jobId` that `compute()` or `freeCompute()` returned, whole. To rebuild it from a
  bare id stored with beta.1, put the first segment of the job's environment id in front of
  it:
  
  ```ts
  const jobId = `${environment.id.split('-')[0]}-${bareJobId}`
  const job = await nautilus.getComputeStatus({ jobId })
  ```
  
  Read logs as a stream:
  
  ```ts
  for await (const chunk of await nautilus.getComputeLogs({ jobId }))
    process.stdout.write(chunk)
  ```

- [#204](https://github.com/deltaDAO/nautilus/pull/204) [`c06369b`](https://github.com/deltaDAO/nautilus/commit/c06369b16ea8fb82c4547a6e7d60a08c151e8008) Thanks [@Abrom8](https://github.com/Abrom8)! - Report what ocean-node answered when a call fails.
  
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
  - **`initialize` over HTTP** has a timeout of `requestTimeoutMs` (default 120 s).
    `getComputeLogs` signs within it, then waits for the job's first output with no timeout,
    as before: ocean-node sends no headers until the job writes. It holds the signing queue
    for at most 10 s meanwhile. `Nautilus.getComputeLogs` takes a `signal`
    (`ComputeLogsConfig`) to stop waiting. A finished job's logs still come from its
    `algorithmLog` result.
  
  **New**
  
  - `AssetNotFoundError`, and `OceanNodeError.status`.

- [#204](https://github.com/deltaDAO/nautilus/pull/204) [`c84dfd1`](https://github.com/deltaDAO/nautilus/commit/c84dfd1834006e02a15204fb40956b1fc6f1cbc3) Thanks [@Abrom8](https://github.com/Abrom8)! - Reuse a download order that is still valid, so `access()` no longer pays for a new order
  on every call within the service's timeout.
  
  ocean-node's access `initialize` reports no `validOrder` (only its compute `initialize`
  checks a previous order), and nautilus reused an order only when the node reported one.
  
  **Fixes**
  
  - **`access()` finds the previous order on chain.** When `initialize` reports no
    `validOrder`, nautilus reads the datatoken's `OrderStarted` events with the account as
    consumer and its `OrderReused` events with the account as caller, and checks each
    transaction, newest first, from its receipt as the node checks a download. It counts only
    what both upstream ocean-node (4.2.0) and OceanProtocolEnterprise ocean-node (4.2) accept.
    It follows the first `OrderReused` (whose caller must be the account) and takes the first
    `OrderStarted` for the account (consumer or payer), which must be the datatoken's
    (upstream takes it from any contract, enterprise the datatoken's first). It refuses that
    order for another service index, and keeps it while inside the service's `timeout`
    counted from the `OrderStarted` block (`0`, or a missing timeout, never expires). A
    transaction with two orders (the wrong service index first), with a look-alike order
    from another contract first, or with a bogus reuse ahead of a valid one, is refused. A
    transaction not sent to the datatoken itself (an order through the factory, a contract
    wallet or a relayer), which upstream refuses as it reads the datatoken from its `to`, is
    only extended.
  - **Used as it stands, or extended.** When the transaction carries a provider fee signed
    by the service's node for this service that the node keeps (`validUntil` `0`, or the
    time since the transaction's block at most `validUntil`, the node's own comparison),
    the download uses it and nothing is sent. Otherwise the order is extended with
    `reuseOrder` and the fee the node quotes now. Either way the result has
    `reusedOrder: true`, and `transferTxId` is the transaction the download uses. An order
    is reused only with at least 10 minutes of its timeout left, since a reuse does not
    restart it, and only with three confirmations, so a shallow reorg cannot drop it.
  - **Consent only for the fee that is paid.** `access()` decides on reuse before it asks
    for consent, then asks `maxProviderFee` / `confirmProviderFees` once, for the fee it
    will pay: none for an order used as it stands, even when the node quotes a fee; the fee
    quoted now for an order extended or placed. Before, the quoted fee was authorised first,
    so an order used as it stands asked the callback for nothing, or threw a
    `ProviderFeeNotAllowedError` with no limit set. Every check still runs before the first
    transaction, and the order may pay exactly the fee allowed.
  - **Bounded reads.** The events are read newest first, 2 000 blocks per `eth_getLogs`
    call, halved while the RPC refuses the range, back to the first block inside the
    service's timeout (found from at most three block reads), and at most 100 000 blocks or 100
    rounds of reads, checking at most 50 candidates (each up to two receipt reads), since
    anyone can emit orders naming the account. An order beyond that is not found, and a new
    one is placed; so is one when the RPC fails otherwise.
  
  A node that reports `validOrder` is followed as before, with no chain read.
  `settleOrder()` takes an optional `service: { id, timeout? }` to look the order up;
  without it, only the node's `validOrder` is reused. It also takes an optional `did`, named
  with the service in the fee passed to `confirmProviderFees`.

- [#204](https://github.com/deltaDAO/nautilus/pull/204) [`0ecee9a`](https://github.com/deltaDAO/nautilus/commit/0ecee9a641ed119dd30a35b7f273699988769aa2) Thanks [@Abrom8](https://github.com/Abrom8)! - Open the policy-server session in nautilus itself, on every download and compute job the
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
    does not say (upstream ocean-node 4.2.0), from its answer to `initiate`, so there is
    nothing to skip.
  - **`WaltIdCredentialProvider`** implements `present()`: it no longer calls `initiate`, takes
    no `sessionStore`, and has no `clearSessions()` or `explainFailure()`. The session cache is
    `Nautilus.create`'s new `sessionStore` option; the failed policies are on
    `PolicyDeniedError.reason`.
  - **`OceanNodeClient.initializePolicyVerification` returns the reply, `null` or throws.** It
    returns `null` only for a node without a policy server, which answers a 404 with no body
    (over P2P, a bare 404 status), and `hasPolicyServer()` then answers `false` for 10
    minutes, unless it knew the node to have one (an empty `POLICY_SERVER_URL` answers this
    way too, and is warned about). It throws a `PolicyDeniedError` only for the policy server's own refusal (a reply
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

- [#204](https://github.com/deltaDAO/nautilus/pull/204) [`4c3b185`](https://github.com/deltaDAO/nautilus/commit/4c3b185e0007a2e975c616f326b17a2b257b5d25) Thanks [@Abrom8](https://github.com/Abrom8)! - Store SSI policies in the form ocean-node 4.2.x indexes and the policy server parses, so
  credential-gated assets are indexed.
  
  **Fixes**
  
  - **Credential-gated assets are indexed.** An asset whose `vp_policies` mixed a name with a
    `{ policy, args }` object, as the identity guide showed, was published but never indexed by
    ocean-node 4.2.x. Every VP policy is
    now written as `{ policy }` or `{ policy, args }`, as the enterprise market writes them.
  - **Per-credential policies take effect.** `request_credentials[].policies` are stored
    JSON-encoded (`'signature'` becomes `'"signature"'`, an object its JSON), the form the
    policy server parses and the enterprise market writes. The policy server skipped a bare
    name, so those checks never ran.
  - **Edits write no legacy form back.** Editing an asset normalises the policies it loads
    (asset level, every service, including services the edit does not touch): bare-name VP
    policies become objects, non-string `args` are JSON-stringified, and raw per-credential
    policies are encoded, so a per-credential check stored as a bare name starts being
    enforced once the edit is published.
  - **Loaded VC policies are normalised too.** `{ policy }` objects in `vc_policies` become
    names (deduplicated).
  - **The address helpers read bare-string addresses.** `addCredentialAddresses()` no longer
    writes `{ address: undefined }` and `removeCredentialAddresses()` no longer throws on an
    asset whose address `values` are bare strings. An entry stored as bare strings only stays
    that way, a mixed one is written back as `{ address }`, and an edit leaves address entries
    it does not touch as stored, since upstream ocean-node 4.2.0 without a policy server
    reads only bare strings. `AddressCredential.values` is typed
    `({ address: string } | string)[]` accordingly.
  - **`removeCredentialAddresses()` removes from every address entry of the list.** It
    changed only the first, so an address also held by a second entry stayed allowed by the
    policy server, which reads them as one list.
  - **Loading reads every stored shape the policy server accepts.** A single policy or request
    credential stored without its array is wrapped in one, and list entries that are not
    objects are skipped, so even a metadata-only edit of such an asset no longer throws.
  - **Unreadable policies fail closed.** An edit throws, naming the entry, on a VP policy,
    request credential or per-credential policy it cannot read, rather than dropping it and
    leaving the asset open under the remaining policies. `setVpPolicies()` refuses one too,
    and writes a bare name from an untyped caller as `{ policy }`.
  - **A stored per-credential policy is not encoded twice** when passed back into
    `addRequestCredentials()`.
  - **Edits keep every `SSIpolicy` value.** Only the first value of the entry was kept, so the
    request credentials of the others were dropped. Values (and a second `SSIpolicy` entry in
    the same list) are merged into one, as the policy server reads them, so `setVcPolicies()`
    and `setVpPolicies()` replace the policies of all of them.
  - **Removing the last allowed address keeps the gate.** `removeCredentialAddresses()`
    dropped the allow entry once it was empty, which lifted the address gate; the node and
    the policy server read an empty allow list as "deny everyone". The entry is now kept as
    `values: []`. An emptied deny entry is still dropped.
  
  **Breaking (beta API)**
  
  - **`VpPolicy` is `{ policy: string; args?: string }`.** `setVpPolicies()` and the
    `vpPolicies` of `addRequestCredentials()` no longer accept bare names, and `args` is a
    string. The policy server parses it as JSON when it can, so `'1'` reaches the verifier
    as `1`.
  - **`SsiPolicyValue.request_credentials` is `StoredRequestCredential[]`**, whose
    `policies` are JSON strings. `RequestCredential`, which the builders take, is unchanged.
  
  **Migration**
  
  VP policies are now stored as objects. Write each one as an object, and pass structured
  arguments through `JSON.stringify`:
  
  ```ts
  builder.setVpPolicies(CredentialListTypes.ALLOW, [
    { policy: 'holder-binding' }, // was 'holder-binding'
    { policy: 'minimum-credentials', args: '1' }
  ])
  ```
  
  An asset already published with a mixed `vp_policies` list was never indexed, so publish
  it again. An indexed asset with bare names is rewritten to objects by its next edit.

## 2.0.0-beta.1

### Patch Changes

- [#201](https://github.com/deltaDAO/nautilus/pull/201) [`d6894bf`](https://github.com/deltaDAO/nautilus/commit/d6894bfb27df45918e49f29720c021487df4df10) Thanks [@Abrom8](https://github.com/Abrom8)! - Pay a node's provider fee and compute escrow payment only with the caller's consent, and
  fund only the escrow contract pinned for the chain: the chain's `EnterpriseEscrow` by
  default.
  
  The node chooses the provider fee of a download or compute input (its token, its amount
  and who receives it). For a download that node is the service's `serviceEndpoint`, which
  the publisher chooses, and the fee signature check only proves the node signed the fee.
  For a paid compute job the node also names the escrow contract and the amount to lock.
  nautilus approved and paid what the node quoted, and funded escrow through ocean.js's
  `verifyFundsForEscrowPayment`, which approves the escrow contract for an amount scaled by
  the token's decimals a second time.
  
  **Breaking (beta API)**
  
  - **A non-zero provider fee needs consent.** `access()`, `compute()`, `order()`,
    `reuseOrder()` and `settleOrder()` pay one only within `maxProviderFee` (per token, in
    the token's smallest unit; a compute job's fees are summed per token) or when
    `confirmProviderFees(fees)` returns `true`. Otherwise they throw a
    `ProviderFeeNotAllowedError` (`fees`, `reason`) before any approval, purchase, escrow
    or order. A zero fee needs nothing.
  - **A paid compute job needs consent for its escrow payment**: within `maxEscrowPayment`
    or when `confirmEscrowPayment(payment)` returns `true`, or an
    `EscrowPaymentNotAllowedError` (`payment`, `reason`) is thrown before anything is sent.
    A zero payment needs nothing: its amount is read first, and a zero amount funds nothing
    and is not checked further, so it may name no escrow contract. A malformed amount is
    still refused.
  - **Exactly one escrow contract is funded, `EnterpriseEscrow` first**:
    1. `config.escrow`, when the caller passes it to `Nautilus.create`: that contract, and no
       other;
    2. otherwise the chain's `EnterpriseEscrow` in Ocean's address data (ocean.js's bundled
       addresses, or `ADDRESS_FILE` when set), the contract ocean-node 4.2.0 uses where the
       chain has one (OP Sepolia, Optimism, Sepolia, Ethereum mainnet);
    3. otherwise the chain's `Escrow`.
  
    The `escrow` ocean.js's `ConfigHelper` fills in (the address data's plain `Escrow`) is not
    a caller's choice and is not used, so on OP Sepolia the plain `Escrow` is refused unless
    set explicitly. A quote naming any other contract, another chain, token or payee, or an
    inexact amount, is refused (`EscrowPaymentNotAllowedError`, its message naming the
    expected contract and the rule that chose it), and no callback overrides it. On a chain
    with no escrow in the address data (Pontus-X devnet among them), paid compute is refused
    until `config.escrow` is set to the chain's EnterpriseEscrow contract. A malformed
    `config.escrow` fails `Nautilus.create`. The standalone `compute(config, context)` takes
    the explicit choice as `context.escrow`, and does not read `context.chainConfig.escrow`.
  - **Escrow is funded in exact amounts.** nautilus approves the escrow contract for the
    deposit only, deposits what escrow lacks for the job, and authorises the environment's
    account to lock the job's amount on top of its current locks, leaving a standing
    allowance or authorisation that already covers the job alone. A wallet that cannot cover
    the deposit is refused before any transaction.
  - **Every input is checked before escrow is funded.** `compute()` reads each input's
    pricing and refuses one that cannot be ordered before the escrow approval, deposit or
    authorisation, so every refusal comes before the first transaction.
  - **Paid jobs are serialised per payer within an instance.** A `Nautilus` instance runs
    the escrow reads, deposit, authorisation, orders and `computeStart` of jobs that share a
    chain, payer, payment token and environment account one at a time, so concurrent
    `compute()` calls do not overwrite each other's escrow authorisation. Jobs from other
    instances or processes are not covered. The standalone `compute(config, context)`
    serialises when given a lock as `context.escrowLock`.
  
  **Migration**
  
  Set the most you are prepared to pay, once for the instance or per call:
  
  ```ts
  const nautilus = await Nautilus.create(signer, {
    config,
    maxProviderFee: { token: feeToken, amount: parseUnits('0.5', 18) },
    maxEscrowPayment: { token: paymentToken, amount: parseUnits('5', 18) }
  })
  ```
  
  The instance defaults come in pairs, `maxProviderFee` with `confirmProviderFees` and
  `maxEscrowPayment` with `confirmEscrowPayment`: a call that sets either option of a pair,
  even to `undefined`, uses its own pair and neither default of it, so a tighter per-call
  ceiling never falls back to a permissive default callback. An app that asks its user can
  pass `confirmProviderFees` / `confirmEscrowPayment` instead, or as well: they are asked
  only for what the ceiling does not cover. `Nautilus.create` refuses a malformed ceiling.
  
  **New**
  
  - `TokenAmount`, `ProviderFeeQuote`, `EscrowPaymentQuote`, `ProviderFeeLimits`,
    `EscrowPaymentLimits`, `ProviderFeeNotAllowedError` and `EscrowPaymentNotAllowedError`
    are exported, and so are the `OrderRequest` and `OrderResult` types.

- [#200](https://github.com/deltaDAO/nautilus/pull/200) [`de1f1ff`](https://github.com/deltaDAO/nautilus/commit/de1f1ffbac6a7847dbdad807b0f28ccdbc104240) Thanks [@Abrom8](https://github.com/Abrom8)! - Make published and edited assets indexable by OceanProtocolEnterprise ocean-node 4.2.x.
  
  2.0.0-beta.0 stored the bare signed JWS and hashed its claims. ocean-node 4.2 expects a
  JSON envelope and hashes that, so every asset went on chain and was never indexed. This
  release stores the format the 4.2 node (and the enterprise market) uses, works with an
  unmodified 4.2.x node, and is encrypted only: no plaintext pointer or envelope is ever
  written, and the DDO never goes on chain.
  
  **Breaking (beta API)**
  
  - **`encrypt` is removed.** `PublishOptions.encrypt` is gone and `encrypt: false` throws:
    the `{ remote }` pointer and the stored envelope are always node-encrypted (flags `0x02`).
  - **`waitForIndexer` throws instead of returning `undefined`, and its options are
    renamed.** It resolves to `AssetV5`, throws an `IndexingError` when the node records a
    failure for the transaction and an `OceanNodeError` on timeout or after repeated failed
    requests. `OceanNodeClient.waitForIndexer`'s `{ interval, maxRetries }` became
    `{ intervalMs, timeoutMs }` (default 7 s / 5 minutes). The old keys still work for now,
    mapped to `intervalMs = interval` and `timeoutMs = interval × maxRetries` (`maxRetries`
    alone: beta.0's 30 s × `maxRetries`, still polled every 7 s), with a one-time
    `console.warn`; they will be removed. A negative or non-finite timing option (e.g.
    `timeoutMs: Infinity`) throws an `OceanNodeError`.
  - **`writeMetadata` is no longer exported.** Metadata is only written through
    `Nautilus.publish()`, `completePublish()` and `edit()`, which run every encrypted-only
    check first. `prepareMetadata` stays and returns redacted pointers.
  - **`prepareMetadata` stores the envelope.** Its `encrypt` parameter is removed
    (`encrypt: false` throws). It stores the node-encrypted envelope instead of the bare JWS,
    its `metadataHash` is `0x` + sha256 of that envelope instead of the JWS claims, and
    `flags` is always `0x02`. `WrittenMetadata` gained `stored` (the redacted store pointer
    and the envelope hash) and `encryptedBy` (the URI of the node that encrypted it).
  - **`signS3Request` is not exported.** Unreleased builds of this change exported it; SigV4
    is an internal detail of `S3RemoteStore`, and it now refuses URLs with a query string.
  - **`NodePersistentRemoteStore` is rejected as the DDO store.** ocean-node 4.2 cannot read
    a remote DDO from its own bucket storage. Use `IpfsRemoteStore` or `S3RemoteStore`.
  - **The remote-store payload is now the envelope**, not the JWS:
    `{"encryptedData": node.encrypt({ encryptedData: hexlify(JSON.stringify(jws)) })}`. The
    on-chain metadata hash is `sha256` of exactly that string. Custom `RemoteStore`s must
    store it unchanged, and the pointer they return is validated: `type` must be `ipfs`,
    `url`, `s3`, `arweave` or `ftp`, with the fields the node needs for that type (an IPFS
    CIDv0/CIDv1 `hash`; an absolute http(s) `url` and GET/POST `method`; the five non-empty
    `s3Access` strings; an Arweave `transactionId` that is not a URL or path; an
    `ftp://`/`ftps://` `url`).
  - **`PublishResponse.stored.pointer` (and `prepareMetadata`'s `pointer`/`stored`) is
    redacted**: an S3 `secretAccessKey`, `url` header values, and a URL's user name,
    password, every query value (parameter names stay) and fragment read `'<redacted>'`. `S3RemoteStore.remove()` works with the redacted pointer.
  - **Plain `http://` is refused** for `oceanNodeUri`, the `S3RemoteStore` `endpoint` and the
    `IpfsRemoteStore` `uploadUrl`/`gatewayUrl`/`probe.url`/`unpin.url`, except on
    `localhost`, `127.0.0.0/8`, `::1` and `*.localhost`. Opt out with
    `allowInsecureTransport: true` (`Nautilus.create`, `S3RemoteStore`, `IpfsRemoteStore`).
    URLs are judged as `fetch` parses them: `http:host`, `http:/host`, `http:\\host` and
    similar spellings are plain `http://`, and a URL containing a tab, CR, LF or another
    control character is refused. A URL with a scheme other than `http:`/`https:` throws,
    and so does a scheme-less `host:port`, which parses as a scheme (peer ids and multiaddrs
    are unaffected); only the `S3RemoteStore` `endpoint` takes a bare host, meaning
    `https://`. `S3RemoteStore.nodeEndpoint` may stay `http://` (e.g. `http://minio:9000`):
    only the node connects to it. The `OceanNodeClient` constructor enforces the same rule on
    `nodeUri` (an `OceanNodeError`, opt out with its own `allowInsecureTransport: true`), and
    so do `forEndpoint`, which carries the flag over, and `encrypt` and `getFileInfo` for a
    `nodeUri` other than the client's own (a service's `serviceEndpoint`).
  - **Redirects are not followed** on the requests nautilus sends with credentials or a body:
    every `S3RemoteStore` request, and `IpfsRemoteStore` uploads, `probe`, `unpin` and Kubo
    `cat` reads. A 3xx fails the request and names the target origin. The read-only node GETs
    (`waitForIndexer`'s asset lookup, indexing state, node address, indexer nonce) and the
    `gatewayUrl` read in `IpfsRemoteStore.verify()` send neither, so they follow redirects; a
    redirect that ends on plain `http://` on a non-loopback host fails them, unless the
    requested URL was such a URL already (`allowInsecureTransport`). Requests ocean.js sends
    (`encrypt`, `initialize`, `getFileInfo`, `resolve`, …) are unchanged.
  - **`IpfsRemoteStore` refuses `user:password@` credentials** in `uploadUrl`, `gatewayUrl`,
    `probe.url` and `unpin.url` (pass them in `headers`), and URLs that do not parse.
  - **`Nautilus.create` refuses a `config.chainId` that differs from the signer's chain.**
  - **The signer is checked before any transaction.** `publish()` and `completePublish()`
    refuse an `asset.owner` other than the signer before the mint. `completePublish()` and
    `edit()` check the NFT's lifecycle state and the signer's `updateMetadata` permission
    (plus `deployERC20` when datatokens or pricing will be created); `edit()` does all of its
    preflight inside the per-NFT lock.
  - **`PublishedService.tx` is optional**: absent for a datatoken `completePublish()` reused.
  - **`publish`, `completePublish` and `edit` check the node's indexer nonce** before their
    first transaction: they read `OceanNodeClient.getIndexerNonceState()` (two GETs, nothing
    signed) and throw the new `IndexerNonceStuckError` when the node would not accept its
    indexer's next decrypt call, so the asset would not be indexed. A node that does not
    answer is skipped; opt out with `PublishOptions.checkIndexerNonce: false`. They warn when
    this publish's own second decrypt call would use a nonce the node does not accept.
  - **DDOs too large for the node to decrypt are refused.** The node accepts decrypt requests
    up to 100 KB, so the signed JWS may be at most about 24 000 characters.
    `publish`/`completePublish`/`edit` check before the first transaction from an upper bound
    of the signed DDO (encrypted files and credential claims at their real size, plus 1024
    characters for the JWS header and signature), and
    again from the exact request size before anything is encrypted or stored (4 KB margin).
  - **Provider fees are checked before ordering.** nautilus checks that the provider fee is
    complete (`providerFeeAddress`, `providerFeeToken`, `providerFeeAmount`, `providerData`,
    `validUntil`, `v`, `r`, `s`) and that its signature recovers to `providerFeeAddress` the
    way the datatoken contract verifies it (the `\n32` digest; an unusable signature
    recovers to the zero address, as with `ecrecover`), since `startOrder`/`reuseOrder`
    revert otherwise. When the signature fails, `access()` calls `initialize` again 1.1 s
    later, at most 3 calls in total (2 retries), stopping early when the node signs the same
    fee again; for a service with `timeout: 0` it does not ask again. `compute()` calls
    `initializeCompute` once, since a compute fee is the same on every request. A missing,
    incomplete or unencodable fee is refused at once. `order()`, `reuseOrder()` and
    `settleOrder` refuse any such fee; an order reused as it stands sends no fee and needs
    none. All throw the new `ProviderFeeSignatureError` before any approval, purchase, escrow
    or order transaction.
  - **`waitForIndexer` polls every 7 s by default** (at most 18 requests a minute, under
    ocean-node's default `MAX_REQ_PER_MINUTE` of 30) and backs off on `429` or `403` "Too many
    active connections" instead of counting it as a failed lookup: `2 × intervalMs`,
    doubling with each rate-limit answer in a row, and at least as long as the node asks
    ("Try again in N seconds", or `Retry-After` in seconds or as an HTTP date) plus 1 s, but
    never more than 60 s. An `intervalMs` under 1 s counts as 1 s for the backoff, so
    `intervalMs: 0` still waits 2, 4, 8 … s.
  - **The same-block guard changed.** `edit()` no longer waits for this instance's previous
    metadata change to be indexed; see `MetadataConflictError` below.
  - **nautilus now calls a store's `remove()` itself**, only when no metadata transaction can
    point at the envelope it stored: `publish`, `completePublish` or `edit` failed before the
    transaction was sent (a failed `verify()`, pointer encryption or transaction build, a
    wallet or RPC refusal), or the transaction was mined and reverted. The object is removed,
    best effort (`stored.cleanup: 'removed'`); never once the transaction may have been
    mined. To tell these apart, nautilus builds the transaction with ocean.js
    (`Nft.setMetadataTx`) and sends it with the signer. A send error that carries a
    transaction hash (ethers' `info.sendTransactionHash` after `JsonRpcSigner` stops polling,
    or `transactionHash`/`hash`) counts as sent whatever its code, and so does ethers'
    "provider destroyed" for a request already at the RPC: the envelope is kept. On
    `sdk: 'oasis'` chains the send stays with ocean.js, unchanged, so there a rejection or
    revert after the send keeps the envelope (`'kept'`).
  - **A `DdoSigner`'s output is checked**: the returned JWS must decode, and its payload (`vc`
    unwrapped, as the node does) must be the validated DDO. Allowed on top: the JWT
    registered claims, `type: ['VerifiableCredential']`, an `issuer` differing only in the
    case of an Ethereum address (or any issuer when the DDO declares none), and claims
    outside a `vc` wrapper. Anything else is refused before the envelope is stored. The
    built-in signers and walt.id already sign exactly this.
  - **`IpfsRemoteStore` reads every envelope back, or refuses to publish.** `verify()` reads
    through `gatewayUrl` when set, otherwise, for a Kubo `uploadUrl` (`…/api/v0/add`), through
    the same node's `/api/v0/cat`. Any other `uploadUrl` (Pinata, custom uploaders) needs
    `gatewayUrl` or the new `verify: false`; without either, `check()` throws before anything
    is minted, and `verify()` throws instead of passing without a read.
  
  **New**
  
  - **`RemoteStore.verify?(pointer, expectedHash)`**, called right before `setMetaData` by
    `publish`, `completePublish` and `edit`: it reads the stored object back and checks
    `"0x" + sha256(JSON.stringify(JSON.parse(body)))`, exactly as the node does, so a store
    that alters bytes or a key the node cannot read with now fails before the transaction.
    `S3RemoteStore` verifies with the read key; `IpfsRemoteStore` through `gatewayUrl` or a
    Kubo node's `/api/v0/cat`; `verify: false` opts out explicitly.
  - **New optional `RemoteStore.check()`** (run before the first transaction of `publish`,
    `completePublish` and `edit`) and **`RemoteStore.remove(pointer)`**.
  - **New `S3RemoteStore`** for AWS S3, Exoscale SOS or MinIO, with no AWS SDK dependency
    (SigV4 over `fetch` and WebCrypto). It uploads with a write key and puts a separate
    read-only key into the node-encrypted pointer, whose `endpoint` always carries an
    explicit, lowercase scheme (none means `https://`). `check()` writes a random probe in
    the shape of a real object, `<prefix>nautilus-store-check/<hex>.json`, reads it back with
    the read key, refuses a read key that can PUT or DELETE (only an explicit
    `403 AccessDenied` counts as "cannot"; `allowWritableReadKey` turns that into a
    warning), counts a 404 on probe cleanup as removed, and never lets a failed cleanup hide
    the first error. `allowSharedCredentials` warns once that the write key ends up in every
    on-chain pointer. The bucket name must follow the S3 naming rules, and a dotted bucket
    over https needs `forcePathStyle`; an `endpoint` or `nodeEndpoint` with a scheme other
    than `http(s)://`, or with a user name or password (requests are signed with the key pairs
    only, and the userinfo would end up in the pointer and in error messages), is refused; keys and `prefix` with `.`/`..` or empty segments, a
    leading `/` or a backslash are refused; virtual-host addressing on an IP or `localhost`
    endpoint is refused with a hint to set `forcePathStyle: true` (also for `nodeEndpoint`).
    `remove()` only deletes keys of the exact shape `put()` writes, in the configured bucket,
    and counts `NoSuchKey` as removed. Signed requests never follow redirects: a redirect or
    a region mismatch names the region and endpoint to fix, and `NoSuchKey` is reported as a
    missing object. Network errors carry method, bucket, key and role, and every request has
    a timeout (`requestTimeoutMs`, default 30 s; the constructor throws unless it is a finite
    number of milliseconds above 0, and clamps it to 2^31−1).
  - **`IpfsRemoteStore`**: works with Pinata's `pinFileToIPFS`; `probe` (`'upload'` or
    `{ url, method?, headers? }`, validated in the constructor) catches a bad key before
    anything is minted, and the upload headers only go to a probe URL on the upload origin
    unless `probe.headers` is given; `gatewayUrl` (or a Kubo `uploadUrl`) drives `verify()`,
    `verify: false` opts out; returned CIDs are validated; `requestTimeoutMs` (default 60 s,
    checked in the constructor as for `S3RemoteStore`).
    Error bodies, a non-CID 2xx body included, are cut to 300 characters and scrubbed of the
    configured header values and tokens; the text is bounded before any pattern runs, so a
    large hostile body cannot block the event loop. Network errors carry no raw fetch error
    as `cause`.
  - **Encrypted-only guards against the known plaintext.** Every ciphertext the node returns
    (envelope and pointer) must be at least plaintext + 97 bytes (ECIES on ocean-node 4.2) and
    must not contain the plaintext as UTF-8, hex, base64 or a JSON string, with any prefix or
    suffix. The envelope is checked before it reaches the store.
  - **`completePublish` checks before any transaction** that the signer owns the NFT, that
    the configured ERC721 factory created it and that every datatoken a service names
    belongs to it. It reuses the NFT's datatokens (the one bundled at mint and those from
    `PublishIncompleteError.datatokens`) for services without one, prices a reused datatoken
    whose pricing failed, creates only the missing ones, and lists every service. It refuses
    a reused datatoken whose existing pricing differs from the service's pricing config
    (scheme, rate, base token, owner, payment collector, fees, dispenser limits), and a
    creation-order match whose pricing does not fit. So that the metadata is not written
    twice, it refuses while the signer has pending transactions, and takes
    `metadataTxHash` (new `CompletePublishOptions`, from `PublishIncompleteError.stored.txHash`):
    it then also refuses while that transaction is pending or once it succeeded.
  - **Results survive a failed wait.** When the metadata transaction was mined but
    `waitForIndexer` fails or times out, the thrown error carries the full `PublishResponse`
    as `error.published` (type `PublishedNotIndexed`), for `publish`, `completePublish` and
    `edit`.
  - **`MetadataConflictError`**: after the receipt, nautilus checks the block for another
    `MetadataCreated`/`MetadataUpdated` of the same NFT and throws (with `published`,
    `conflictingTxIds`, `indexedFirst`), because the node indexes only the first. Within one
    instance, publish, edit and lifecycle calls for one NFT are serialized.
  - **`waitForIndexer`** also takes `requestTimeoutMs` (default 15 s; capped by the time
    left, but at least 1 s unless `requestTimeoutMs` is shorter) and `maxConsecutiveFailures`
    (default 5), rejects with the `signal`'s reason on abort, polls once more when
    `timeoutMs` is up, and names the last request error in the timeout message, unless a
    later answer cleared it. Over a P2P node URI, `requestTimeoutMs` bounds each asset lookup
    as a whole (ocean.js's dial and retries included), and a lookup that runs out counts
    towards `maxConsecutiveFailures`, so the wait ends on time even without a `signal`.
    `publish`/`edit` accept
    `waitForIndexer: { intervalMs, timeoutMs, signal }`; an abort reason that cannot take
    `error.published` (a `DOMException`, a string) is wrapped in an `Error` that carries it,
    with the reason as `cause`.
  - **`OceanNodeClientOptions.requestTimeoutMs`** (default 120 s, carried over to
    `forEndpoint`): each `encrypt` call, its nonce retry included, times out with an
    `OceanNodeError` and the next queued call runs; aborting `signal` while a call is queued
    rejects at once with the signal's reason. `Nautilus.create` takes the same
    `requestTimeoutMs` option and passes it to its node clients.
  - **`OceanNodeClient.getIndexingState({ did } | { txId } | { nft })`** reads the node's
    record (checksummed `nft`, lower-case `txId`, validated response; an abort rejects with
    the signal's reason), and
    **`OceanNodeClient.getNodeAddress()`** reads the node's `providerAddress`, and throws an
    `OceanNodeError` on a network error, timeout, non-2xx status or a non-JSON body. `publish`,
    `completePublish` and `edit` warn once when the publisher is the node's own key, which
    makes the indexer's decrypt fail with 401.
  - **Metadata is only written where the node can index it.** `publish`/`completePublish`/
    `edit` refuse a DEPRECATED or REVOKED_BY_PUBLISHER asset, the DDO id must be the NFT's
    DID, and the node named on chain must be the node that encrypted.
  - **`IpfsRemoteStore.remove(pointer)`** unpins a CID: `DELETE /pinning/unpin/<cid>` on
    Pinata and `POST /api/v0/pin/rm?arg=<cid>` on Kubo, derived from `uploadUrl`, or any service
    through the new `unpin: { url, method?, headers? }` option (`{cid}` placeholder, `https://`
    rule as for the other URLs, upload headers only to the upload origin). A CID that is not
    pinned counts as removed: Kubo's or Pinata's own JSON answer for it, or a 404 from a
    configured `unpin`. The examples gained `store:remove <cid|objectKey>`.
  - **`error.stored`** (type `StoredBeforeFailure`, also `PublishIncompleteError.stored`): when a
    write fails after the envelope was stored, the redacted pointer, the hash and
    `cleanup: 'removed' | 'not-removed' | 'kept'`. `'kept'` means the metadata transaction was
    sent and may be mined, and `txHash` names it when its hash is known;
    `PublishIncompleteError` then no longer claims the NFT has no metadata. `PublishIncompleteError.cause` is the native `Error.cause`.
  - **Hardening:** the store's pointer is validated and encrypted as one plain snapshot (an
    inherited `type` or a getter can no longer pass the check and serialize differently); an
    unreadable on-chain metadata state now throws instead of reading as ACTIVE; `S3RemoteStore`
    retries a network error or a 500/502/503/504 once, freshly signed; ocean.js's `null`
    transaction result is reported as "rejected, or sent and then reverted or timed out", not as
    "not submitted".
  - **`PublishResponse.stored`** (`{ pointer, metadataHash }`, pointer redacted) records where
    the envelope went and the hash written on chain, so callers can verify or clean up.
    `PublishedService.reused` marks a datatoken `completePublish()` reused.
  - **`OceanNodeClient.getIndexerNonceState()`** (`{ nodeAddress, storedNonce, nextNonce,
    stuck }`, two GETs, nothing signed) and **`isIndexerNonceSignable(nodeAddress, nonce)`**
    report whether the node will accept its indexer's next decrypt call.
  - **`IndexingError` messages carry a hint** for two errors the node records when its
    decrypt call during indexing did not succeed: a 401 Unauthorized from that call (with a
    pointer to `getIndexerNonceState()`), and the "invalid codepoint" decoding error, whose
    hint names the likely causes (a 401, a 413 from the 100 KB decrypt limit, or a 429/403
    rate-limit answer) and the node settings to check.
  - **Clearer edit error:** editing a loaded service's `serviceEndpoint` without adding its
    files again now explains that files are encrypted for the node in the endpoint, so both
    must change together.
  - **New exported types:** `CompletePublishOptions`, `FailedWithStoredObject`,
    `StoredBeforeFailure`, `PublishedNotIndexed`, `IndexerNonceState`, `IndexingState`,
    `IndexingStateQuery`, `WaitForIndexerOptions`.
  - **No more orphaned NFTs without a way back.** A failure after the NFT is minted throws a
    `PublishIncompleteError` with `nftAddress` and `datatokens`; `completePublish(nftAddress,
    asset)` finishes the publish on that NFT. `edit()` runs the store check before minting a
    datatoken, and an `edit()` that fails after creating datatokens names them as
    `error.datatokens`.
  
  **Fixes**
  
  - **`encrypt` now rejects non-ciphertext node responses.** ocean.js returns the body of a
    failed encrypt call as if it were ciphertext, so a node error (e.g. 401 `nonce: 1 is not
    a valid nonce`) could be stored as a service's encrypted `files`. `OceanNodeClient.encrypt`
    now throws an `OceanNodeError` with the node's message unless it gets `0x` hex, retries
    once on a nonce rejection when it signs with a `Signer`, and runs a `Signer`'s encrypt
    calls one at a time per client (a multi-service publish encrypted them concurrently, so
    they reused a nonce).
  - **A datatoken is recorded before its pricing**, so `PublishIncompleteError.datatokens`
    includes one whose pricing failed.
  - **`publish()` clears a `datatokenAddress`** left on a service by an earlier attempt or
    copied by `ServiceBuilder`. Such an address ended up in `PublishIncompleteError.datatokens`
    and made `completePublish()` refuse.
  - **One approval per token and spender.** `order()` now approves the provider fee as well,
    and approves one allowance for the sum of everything the same spender pulls in the same
    token (the purchase, the publish-market fee and the provider fee); `reuseOrder()`
    approves the provider fee. Before, the provider-fee allowance set by `settleOrder` was
    replaced by the publish-market fee approval (or, on templates 2 and 4, the purchase
    approval) when they shared a token, and the order reverted, on template 1 after the
    purchase. Every check (pricing, exchange, fee collectors, provider fee) now runs before
    the first approval. Approvals in different tokens are unchanged.
  - **`order()` and `settleOrder()` refuse a `payer` other than the signer** before any
    allowance read or transaction. The datatoken and the exchange take every amount from the
    transaction's sender; another payer's allowance could skip the merged purchase approval on
    templates 2 and 4, so `buyFromFreAndOrder` reverted.
  - **`edit()` writes the NFT's current on-chain lifecycle state** unless the builder sets one
    with `setLifecycleState()` (new `NautilusAsset.hasRequestedLifecycleState`), so an edit
    built from a stale copy no longer undoes `setAssetLifecycleState()`.
  - **A metadata transaction the wallet sped up** (`TRANSACTION_REPLACED`, `reason:
    'repriced'`) is no longer reported as a failure: the replacement's receipt is the result,
    and a reverted replacement is handled as a revert.
  - **A provider fee amount of `'0x0'` or `'00'` is no fee due**: the amount is compared as a
    number, so an order in force with such a fee is reused as it stands.
  - **A stored pointer that cannot be redacted** no longer stops `RemoteStore.remove()` after
    a failed write.
  
  **Docs**
  
  - Browser use (CORS for S3 buckets, MinIO and Kubo, and why write keys must not ship
    in a web app), cleaning up superseded and revoked versions, and why node encryption is not
    access control on a default 4.2 node (`AUTHORIZED_DECRYPTERS`).
  - **Keep the creation envelope.** A node reindex replays an asset from its creation
    event, so removing the envelope `publish()` stored drops the asset from the index. The
    remote-stores guide, the `remove()` docs and the examples' `store:remove` (which now
    refuses a creation or latest envelope listed in `PUBLISH_LOG` unless given `force`) say
    so.
  - `setAssetLifecycleState` and `setMetadataState` now say that they resolve with
    the mined receipt and throw when the transaction was not submitted or reverted, as they
    already did in 2.0.0-beta.0.

## 2.0.0-beta.0

### Major Changes

- [#182](https://github.com/deltaDAO/nautilus/pull/182) [`f636f33`](https://github.com/deltaDAO/nautilus/commit/f636f3360e4b09b182dfdac24f4ab0fe04428126) Thanks [@Abrom8](https://github.com/Abrom8)! - Modernize nautilus for the current Ocean stack.
  
  nautilus v1 targeted `@oceanprotocol/lib` 3.4.6, ethers v5, Aquarius, Provider and DDO
  v4.1.0 — none of which a current Ocean deployment runs. v2 targets
  `@oceanprotocol/lib` 9.x, ethers v6, ocean-node, DDO v5 via `@oceanprotocol/ddo-js`,
  and adds first-class support for the policy server and the walt.id identity stack.
  
  The builder pattern is unchanged as the primary API: `AssetBuilder`, `ServiceBuilder` and
  `ConsumerParameterBuilder` keep their fluent shape, and every v1 capability still has a
  method. This is a breaking major because the DDO model, the transport and the signer
  library all changed underneath.
  
  **What changed**
  
  - **ocean-node replaces Aquarius and Provider.** One `OceanNodeClient` wraps both, and
    `Config.oceanNodeUri` replaces `metadataCacheUri` and `providerUri`.
  - **The subgraph is gone.** Pricing is derived from chain reads and the DDO's indexed
    stats, so `urql`, `graphql` and graphql-codegen are no longer dependencies.
  - **DDO v5.** Assets are W3C Verifiable Credentials: everything moved under
    `credentialSubject`, DIDs use the `did:ope:` prefix, `description` and `displayTitle` are
    language-tagged, `license` is structured, and `providedBy` is required.
  - **DDOs are signed and stored off chain.** Only a `{remote}` pointer is written on chain.
    The remote backend is configurable — IPFS, or ocean-node's own persistent storage.
  - **Credential-gated access.** nautilus resolves policy-server challenges through the
    walt.id wallet and verifier, headless by default with optional selection callbacks.
  - **Compute is C2D v2.** Explicit resource requests, escrow payment, free compute,
    streamable logs and results.
  - **Local DDO validation** via ddo-js SHACL, before any gas is spent.
  - **`strict` TypeScript** is enabled, and ethers v6 is required.
  - **DDO v5 types from the package root.** nautilus re-exports the ddo-js v5 types its API
    surfaces — `AssetV5`, `ServiceV5`, `MetadataV5`, `State` and friends — so consumers need no
    direct `@oceanprotocol/ddo-js` dependency and never have to dedupe it.
  - **No install-time patching.** nautilus requires `@oceanprotocol/ddo-js` ^1.0.0, whose
    `exports` map carries `types` conditions, so its declarations resolve under `nodenext`,
    `node16` and `bundler` unaided. The `postinstall` hook that used to rewrite the installed
    manifest is gone: nautilus runs no lifecycle script on install, and works unchanged under
    `--ignore-scripts` and pnpm. ddo-js 1.0.0 also tightens the DDO v5 schema: `credentials`
    is now required on the asset and on every service. The builders always emit it, and an
    edit normalizes untouched services that lack it.
  
  See `MIGRATION.md` for a call-by-call mapping from v1.

## 1.1.0

### Minor Changes

- [#160](https://github.com/deltaDAO/nautilus/pull/160) [`2e7070b`](https://github.com/deltaDAO/nautilus/commit/2e7070b27db19fbd2526ef1ad84ba90030972d9a) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Adds functionality to compute on multiple datasets within one compute job

  - Currently only datasets that are encrypted by the same provider are supported

- [#160](https://github.com/deltaDAO/nautilus/pull/160) [`2e7070b`](https://github.com/deltaDAO/nautilus/commit/2e7070b27db19fbd2526ef1ad84ba90030972d9a) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Add helper functions to set name, symbol, tokenUri, transferable and templateIndex of data NFTs

## 1.0.3

### Patch Changes

- [#151](https://github.com/deltaDAO/nautilus/pull/151) [`034fd2d`](https://github.com/deltaDAO/nautilus/commit/034fd2d063db109a5ebee62e424e1f2ec276d465) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Bump dependencies

## 1.0.2

### Patch Changes

- [#134](https://github.com/deltaDAO/nautilus/pull/134) [`f7cc0a3`](https://github.com/deltaDAO/nautilus/commit/f7cc0a34d5c84ce270d2773a7721c5b4fcf8b7b5) Thanks [@Abrom8](https://github.com/Abrom8)! - Fix publishing/editing of multi-service assets

## 1.0.1

### Patch Changes

- [`c8b4d4d`](https://github.com/deltaDAO/nautilus/commit/c8b4d4d5978a4a48c7a5ab198f82042440d4b9c5) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Version Bump

## 1.0.0

### Patch Changes

- [#108](https://github.com/deltaDAO/nautilus/pull/108) [`3e8b148`](https://github.com/deltaDAO/nautilus/commit/3e8b1484fa5656a0a46fc818ca118dfda32786fc) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Fix error in next build

  - Fixes an error with starting compute jobs
  - Fixes `tslib` dependency issues

- [#103](https://github.com/deltaDAO/nautilus/pull/103) [`8f71689`](https://github.com/deltaDAO/nautilus/commit/8f71689b3cd4fa02502e01adddfe309afecdf5d2) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - next release

- [#106](https://github.com/deltaDAO/nautilus/pull/106) [`399cd55`](https://github.com/deltaDAO/nautilus/commit/399cd55ead131534f0165ef01f698553cb26290d) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - bump ocean.js

- [#83](https://github.com/deltaDAO/nautilus/pull/83) [`59b5d93`](https://github.com/deltaDAO/nautilus/commit/59b5d9348ca75300523c9857eba1f99abe441c01) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - - add stopCompute functionality
  - fix an issue with setting trusted algorithms

## 1.0.0-next.5

### Patch Changes

- [#108](https://github.com/deltaDAO/nautilus/pull/108) [`3e8b148`](https://github.com/deltaDAO/nautilus/commit/3e8b1484fa5656a0a46fc818ca118dfda32786fc) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Fix error in next build
  - Fixes an error with starting compute jobs
  - Fixes `tslib` dependency issues

## 1.0.0-next.4

### Patch Changes

- [#106](https://github.com/deltaDAO/nautilus/pull/106) [`399cd55`](https://github.com/deltaDAO/nautilus/commit/399cd55ead131534f0165ef01f698553cb26290d) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - bump ocean.js

## 1.0.0-next.3

### Patch Changes

- [#103](https://github.com/deltaDAO/nautilus/pull/103) [`8f71689`](https://github.com/deltaDAO/nautilus/commit/8f71689b3cd4fa02502e01adddfe309afecdf5d2) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - next release

## 1.0.0-beta.2

### Patch Changes

- [#83](https://github.com/deltaDAO/nautilus/pull/83) [`59b5d93`](https://github.com/deltaDAO/nautilus/commit/59b5d9348ca75300523c9857eba1f99abe441c01) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - - add stopCompute functionality
  - fix an issue with setting trusted algorithms
