# @deltadao/nautilus

## 2.0.0-beta.3

### Minor Changes

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`6375d84`](https://github.com/deltaDAO/nautilus/commit/6375d84f6c5a2f332fc031a55c52b61fbb4daa99) Thanks [@Abrom8](https://github.com/Abrom8)! - ocean.js's own log lines go through nautilus's logger, redacted, by default.
  
  ocean.js logs through one process-wide object, its `LoggerInstance`, straight to the console.
  After a refused compute start or initialize it logs the request payload at error level, its
  default: the request's nonce and the policy-server session ids, unredacted (e.g. when the
  node refuses an untrusted algorithm). None of nautilus's settings applied to those
  lines: not the level, not the sink, not the redaction.
  
  **What changes for you**
  
  - **`configureLogging({ oceanjs })`, default `'capture'`.** ocean.js's lines become
    nautilus events of the component `oceanjs`: `oceanjs.logger.error`, `oceanjs.logger.warn`,
    `oceanjs.logger.log` (`info`, also ocean.js's `bypass`) and `oceanjs.logger.debug`, with the
    text ocean.js logged as the message and the objects after it in `fields.args` (a JSON
    string holding an object or array is read as it, up to 65,536 characters; a longer one
    stays text), redacted by field and by text like every
    other event: the payload's `nonce`, `signature` and `sessionId`s are `<redacted>`. They
    print at nautilus's level, in its format and to its sink, so the payload dump now prints as
    a redacted `[oceanjs] error` line on stderr instead of an unredacted one on the console.
    The raw lines of events that print reach only the debug channel (topic `node`): its `sensitive` tier, or
    `secrets` for a credential (an RPC key, a Bearer token). The arguments of one line hold at
    most 2,000 values, so a node's large answer body stays a short line.
  - `'passthrough'` keeps the old behaviour: ocean.js prints itself, unredacted. `'silent'`
    drops ocean.js's lines. `oceanjs: undefined` goes back to `'capture'`.
  - ocean.js's own level (`LoggerInstance.setLevel`, errors only by default) still decides first
    which lines it emits, so `LoggerInstance.setLevel(LogLevel.None)` still silences it, except
    ocean.js's `bypass` lines; nautilus's level then decides which of them print. The
    deprecated `setLogLevel` sets both, as before.
  - Captured lines always use the process-wide configuration from `configureLogging`, not an
    instance's own `logger`.
  - `LoggerInstance` is process-wide: the mode applies to every ocean.js user in the process.
    nautilus replaces that object's five logging methods (`error`, `warn`, `log`, `debug`,
    `bypass`) when it is imported, and calls ocean.js's own ones for `'passthrough'`. It does not
    patch `console`, and doesn't change ocean.js's level. Tests that spied on `console.error`
    to see ocean.js's lines now see them as nautilus events (on stderr, or through a `sink`), or
    can spy on `LoggerInstance.error` itself.
  - Not captured: the few ocean.js functions that write to `console` directly (none of them on
    the paths nautilus calls logs a request payload), and the logger of ocean.js's other bundle,
    which an app gets when it loads ocean.js through `require`.
  - Several copies of nautilus in one process share the capture: a copy loaded later keeps the
    mode in force, whichever copy set it, and the lines go to the copy that last set `oceanjs`
    (else to the first one loaded). The copy that received them until then warns
    (`oceanjs.capture.moved`), e.g. when a bundled copy sets `'passthrough'`. They share the
    operation context too, so a captured line carries the `opId` of the call that caused it,
    whichever copy ran the call and whichever receives the line.
  - A line ocean.js logs while nautilus captures one (a `sink` or debug sink that logs through
    `LoggerInstance`) is dropped, with one `oceanjs.capture.nested_dropped` warning; it never
    prints unredacted. A frozen or sealed `LoggerInstance`, or one whose logging methods are read-only, is left
    alone for those methods: they are not captured, and
    `oceanjs.capture.unavailable` warns once when nautilus is imported, with advice that works
    for the case (a frozen logger's level can't change after it is frozen).

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`4716dd5`](https://github.com/deltaDAO/nautilus/commit/4716dd512be5075251b318d66044e616faf6b1b3) Thanks [@Abrom8](https://github.com/Abrom8)! - A sensitive debug channel, off by default, shows the raw data nautilus redacts, so a failure
  the redacted error does not explain can be diagnosed without out-of-band queries.
  
  **What changes for you**
  
  - **`Nautilus.setDebug({ level, topics?, sink? })`, or `NAUTILUS_DEBUG`.** `level` is `'off'`
    (the default), `'sensitive'` (raw node, wallet, verifier and RPC answers, policy-server
    session ids and redirect URIs, the verifier's per-policy results with their full errors,
    request payloads with signatures and nonces, raw signed transactions, presented VP/VC
    JWTs, storage pointers without their credentials) or `'secrets'` (also the RPC URL's token,
    S3 secret keys, IPFS JWTs and `Authorization` headers). `topics` narrows it to `node`,
    `wallet`, `policy`, `rpc`, `order`, `nonce`, `store` or `compute`. In Node,
    `NAUTILUS_DEBUG=sensitive|secrets` and `NAUTILUS_DEBUG_TOPICS=policy,wallet` do the same
    without a code change; they are read once at import, and `setDebug` overrides them.
    `secrets` is reached only by naming it. In `NAUTILUS_DEBUG_TOPICS` an unknown topic is
    ignored with a `config.env.invalid` warning, and a list of unknown topics turns on none;
    `setDebug` throws a `TypeError` for an unknown level or topic. `sensitive`
    hides long-lived credentials best effort, by name and shape (any key or URL parameter
    ending in `token`, `key`, `secret`, `password`, `auth`, `cookie`, `jwt`, `credential(s)`,
    drpc's `dkey`, …, except session-scoped ones such as `vp_token`, `state`, `sessionId`,
    `nonce`, `signature`); scan its output before sharing it. New exported types: `DebugEvent`, `DebugTopic`,
    `DebugOptions`, `DebugLevel`, `DebugTier`, `DebugSink`.
  - **One line per event**, on stderr (in a browser, the console), prefixed `[nautilus:debug:sensitive]` or
    `[nautilus:debug:SECRETS]` and the topic; line breaks and control characters in the data
    are written as JSON escapes. After masking, a string is cut at 32,768 characters and an
    event at about 256 K; a string longer than 65,536 characters (or past the event's budget)
    is read only up to the last word before that point, so masking never sees part of a
    credential. A cut string ends in `…(cut: N of M characters shown)`. A `sink` receives
    `{ time, tier, topic, message, opId?, operation?, data }` instead.
  - **A warning when it is turned on**, once per tier, on stderr, whatever the log level or
    sink; stronger under `NODE_ENV=production`.
  - **Errors, return values and log events do not change.** They stay exactly as redacted as
    with the channel off; the raw values go to this channel only. A rejected presentation's
    per-policy results are shown in the channel (e.g. `holder-binding: failed
    (java.lang.NullPointerException)`), and an answer that is not the policy server's envelope
    (a proxy's 502 page) as it came; the error thrown is the same.
  - **The signer's private key or mnemonic is never printed**, at any tier: nautilus never
    holds them.
  
  **Also fixed**
  
  - **Wallet errors no longer carry the policy-server session id.** A `WaltIdWalletError`
    carries the wallet's answer with credentials redacted, URLs reduced to their origin, at
    most 500 characters; the raw answer goes to the debug channel (topic `wallet`). For a
    refused presentation, see the `CredentialPresentationError` entry.
  - **Raw signed transactions are redacted** in error texts, warnings and log events. ethers
    quotes the signed transaction of a failed `eth_sendRawTransaction` in its error message
    (`transaction="0x02f8…"`); one that was never mined (e.g. `INSUFFICIENT_FUNDS`) can still
    be sent by whoever reads the log. Short ones are recognised by their RLP length, down to a
    minimal legacy transfer (97 bytes) or contract creation.
  - **More credentials are redacted in error texts, warnings and log events:** a URL whose
    slashes are JSON-escaped (`https:\/\/host\/v3\/<key>`, as a JSON body quoted in JSON has
    it) is reduced to its origin like any other, and a `Cookie` header is redacted to the end
    of its line, every cookie of it (a quoted cookie value, or one with an apostrophe in it,
    included).

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`a8bea76`](https://github.com/deltaDAO/nautilus/commit/a8bea76523421c3409bdaafcbd250aa194af9322) Thanks [@Abrom8](https://github.com/Abrom8)! - nautilus has its own logger, and its warnings are now visible by default.
  
  **What changes for you**
  
  - **Warnings print by default.** nautilus logged most of its warnings through ocean.js's
    `LoggerInstance`, whose default level is errors only, so they were never shown: among them
    "this node's policy server will refuse every consumer of this asset", "requested
    `maxJobDuration` capped", "a free service's previous order could not be looked up,
    ordering anew", "asset is
    already in that state". They now print to stderr at the default level, `warn`. The
    one-time warnings that went to `console.warn` go to the same place. To silence them, set
    `Nautilus.configureLogging({ level: 'silent' })` or `NAUTILUS_LOG_LEVEL=silent`.
  - **Structured, catalogued events.** Every line is an event with a stable name
    (`component.step.outcome`, e.g. `publish.preflight.denies_all`), a level, a component, a
    message and fields. By default it prints as one readable line on a terminal or in a
    browser console, and as one JSON object per line when stderr is not a terminal. `LOG_EVENTS` lists every event with its level, component and fields.
  - **Output goes to `process.stderr`, not `console.warn`.** In Node, every line is written
    straight to `process.stderr` (JSON lines when stderr is not a terminal), so hooks on
    `console.warn` no longer see the one-time warnings that used to go there (the publisher is
    the node's own key, shared S3 credentials, a writable S3 read key, persisted presented
    sessions, an empty policy-server URL, the legacy `waitForIndexer` options). Hand them to your own code with a `sink`. In a
    browser, lines still go to the console.
  - **The log level now governs those warnings too.** They used to print at any level;
    `Nautilus.setLogLevel(LogLevel.None)` or `LogLevel.Error`, `configureLogging({ level:
    'silent' | 'error' })` and `NAUTILUS_LOG_LEVEL=silent|error` now silence them along with
    every other warning, security warnings included. Keep the level at `warn` or more verbose
    (`info`, `debug`, `trace`), or use a `sink`, where you rely on them.
  - **Redacted by field.** Before any output, fields are redacted by key, compared without
    case, `-`, `_`, spaces or invisible characters and matched whole, in nested objects and class
    instances too: the exact keys `nonce`, `sid`, `auth`, `bearer`, `seed`, `pk`, `privkey`,
    `otp`, `pin`, `hmac`, `dkey`, `sig`, `pass`, `pwd`, `requestUri`; any key holding
    `privateKey` or `privKey` (`privateKeyHex`); any key ending in the word `pass`
    (`DB_PASS`, `dbPass`, not `bypass`); any key ending in a credential name
    (`session_id`, `client_secret`, `aws_secret_access_key`, `x-api-key`, `passphrase`,
    `mnemonic`, `authorizationCode`, `presentation`, `rawTx`, …); any other key ending in
    `key` or `auth` (`accessKey`, `encryptionKey`, `apiAuth`) except `key`, `publicKey` and
    `objectKey`; any key ending in `token` unless its value is an EVM address
    (`paymentToken` stays readable); `code` and one-time codes (`otpCode`, `recoveryCode`,
    `txCode`, …) unless the value reads as an error code (`SERVER_ERROR`, `ECONNREFUSED`,
    `-32005`, ethers' `TIMEOUT`/`CANCELLED`). Other `…code` keys (`exitCode`, `bytecode`,
    `statusCode`) stay readable. Credentials become
    `<redacted>`, URLs are reduced to their origin, errors are sanitised with up to two levels
    of their `cause`, byte arrays print as `[N bytes]`.
  - **The same keys in text.** Messages, error messages (node answers, ethers errors and their
    `cause`s, e.g. an RPC response body) and other text have the value of every such key
    redacted when it is written as `key=value`, `key: value`, `'key': 'value'`, a JSON field or
    a JSON field inside a JSON string (at any depth), a key or a URL behind JSON escapes read
    decoded (`"session\u0049d"`, `https:\/\/host\/path`); `Bearer` and `Basic` credentials,
    JWTs and 65-byte hex signatures are redacted anywhere, URLs reduced to their origin.
    Before, only a short list of keys was redacted in text. Error messages thrown by nautilus
    change accordingly (e.g. a node's `nonce: 1 is not a valid nonce` now reads
    `nonce: <redacted> …`). Text is matched by pattern: a credential without a key in front of
    it is not recognised.
  - **Bounded and robust.** Messages, fields and errors are bounded in size; a sink that throws
    is ignored; fields that cannot be read become one `fieldsError` field.
  
  **New API**
  
  - `Nautilus.configureLogging({ level, format, components, sink, oceanjs })`, process-wide:
    levels `silent`, `error`, `warn` (default), `info`, `debug`, `trace`; `format` `'pretty'` or
    `'json'`; `components` to narrow `info`/`debug`/`trace` output; `sink(event)` to hand the
    redacted events to your own logger (pino, winston, the browser console) instead of stderr.
    `oceanjs` decides what happens to ocean.js's own lines (see ocean.js's own log lines,
    below). An unknown level, format, component or `oceanjs` mode, or a `sink` that is not a
    function, passed to `configureLogging` or `createLogger` throws a `TypeError`; the
    environment variables below only warn.
  - `Nautilus.create(signer, { logger })`: one instance's own level, format, components or
    sink, e.g. per tenant, as options or as a logger from `createLogger(options)` that several
    instances share. `S3RemoteStore`'s warnings always go to the process-wide configuration.
  - Environment variables, read once at import and overridden by `configureLogging`:
    `NAUTILUS_LOG_LEVEL`, `NAUTILUS_LOG_FORMAT` (`json` or `pretty`) and
    `NAUTILUS_LOG_COMPONENTS` (e.g. `publish,access`). An unknown value is ignored, with a
    warning. In a browser there is no environment; the console is the output.
  - `createLogger(options)`, `LOG_EVENTS` and the types `Logger`, `LogEvent`, `LogFields`,
    `LogSink`, `LogFormat`, `LoggingLevel`, `LogLevelName`, `LogComponent`, `LogEventName`,
    `LogEventSpec`, `LoggingOptions`, `LoggingConfig` and `OceanJsLogMode`. The node client
    takes a `logger` option.
  
  **Deprecated**
  
  - `Nautilus.setLogLevel(LogLevel)` still works: it maps `None`/`Error`/`Warn`/`Log`/`Verbose`
    to `silent`/`error`/`warn`/`info`/`trace`, and still sets ocean.js's `LoggerInstance` level
    as before. Use `configureLogging({ level })` instead. nautilus's own lines no longer go
    through ocean.js's `LoggerInstance`, so tests or hooks that spied on it to see nautilus's
    warnings must use a `sink` instead.

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`0e1e3da`](https://github.com/deltaDAO/nautilus/commit/0e1e3da2e31eb16a006fd4bd05d02db6162375ed) Thanks [@Abrom8](https://github.com/Abrom8)! - A refused presentation names the policies that failed, and no presentation error carries the
  policy-server session id or the wallet's redirect URI any more.
  
  **Breaking (beta API)**
  
  - **A presentation the verifier refuses is a `PolicyDeniedError`, also when the wallet reports
    it.** walt.id answers a refused presentation with an HTTP 400, so `WaltIdCredentialProvider`
    threw a `CredentialPresentationError` whose message was the wallet's raw answer (the
    verifier's error URL with the policy-server session id included), and the verifier's
    per-policy results were never read. Now, when `present()` throws a
    `CredentialPresentationError` with `reason: 'verifier-rejected'`, or any other kind of
    error, nautilus reads
    the verifier's record of the session (`checkSessionId`, through the node, best effort, cut
    after 15 seconds): when it names failed policies, you get a `PolicyDeniedError` whose
    `reason` lists them, with `policyResults` and the wallet's error as `cause`. Otherwise, or
    when the record cannot be read, the wallet's error is thrown as before; a failure before
    the verifier (no matching credential, no wallet, …) is thrown without the read. Code that
    caught `CredentialPresentationError` for a refused presentation should catch
    `PolicyDeniedError` as well. A refused session is never cached.
  - **A custom provider that throws `CredentialPresentationError` for a verifier refusal must
    pass `'verifier-rejected'` as the third argument.** Otherwise its `reason` is
    `'wallet-failed'` and the failed policies are not read.
  - **`PolicyDeniedError.reason` for a refused presentation reads differently.** It was
    `the verifier did not accept the presentation (…)`; it is now `the node reports that the
    verifier did not accept the presentation (holder-binding: java.lang.NullPointerException)`,
    because the node relays the verifier's record (and for a download the node is the
    publisher's choice). Code that matches on the old text must change. The list in parentheses
    always fits the reason's 200 characters, closing parenthesis included: each failure is cut
    at 80 characters, as many as fit are listed and the rest counted (`; 2 more in
    policyResults`).
  - **`CredentialPresentationError.details` no longer holds the wallet's whole answer.**
    `WaltIdHttpWallet` parses the wallet's 400 answer and keeps only its `errorMessage` (or the
    `message` of walt.id's error handler, for an exception in the wallet such as a malformed
    request), control characters stripped, credentials redacted, at most 500 characters. The
    `redirectUri`, the verifier's error page with the policy-server session id in it, is
    dropped. `details` is `{ errorMessage }` for a rejection (`'the wallet gave no reason'`
    when walt.id gives none), and `undefined` only when a custom wallet reports an error
    redirect without a message; no `redirectUri` is kept. The message reads `The verifier
    rejected the presentation: <errorMessage>` (or `The wallet could not present the
    credentials: …` when the wallet failed itself). `PresentationResult` gains
    `rejectedBy: 'verifier' | 'wallet'` for a 400 answer.
  
  **New**
  
  - **`CredentialPresentationError.reason`**, a stable `CredentialPresentationReason`:
    `'verifier-rejected'`, `'wallet-failed'`, `'no-matching-credential'`, `'none-selected'`,
    `'wallet-setup'` or `'request-invalid'`. The constructor takes it as a third argument
    (default `'wallet-failed'`). A custom provider that throws it with a reason other than
    `'verifier-rejected'` skips the verifier read.
  - **`PolicyDeniedError.cause`**: the provider's error, when the refusal was read after a
    failed `present()`.
  
  **Fixed**
  
  - **The policy-server session id is redacted from the wallet's text.** walt.id's verifier
    quotes it bare for an expired or unknown session (`Id parameter <id> doesn't refer to an
    existing session`), and the wallet passes that on. `WaltIdCredentialProvider` now removes
    the session id (and each of its two halves) from the wallet's message, whatever its length,
    also the start of it that a cut left before the message's closing `…` (`WaltIdHttpWallet`
    bounds the message before the provider sees it, so an id that crosses the 500th character
    is cut), and again after sanitising, where deleting a control or zero-width character
    joins it or a JSON or percent escape hides it. `checkPolicySession` removes the session id
    it read, whatever its shape, the same way from each per-policy name and error (also where
    deleting a control character joins it, an escape hides it, or the 100-character cut splits
    it) and from its own error, so neither `PolicyDeniedError.message`, `.reason` and
    `.policyResults` nor an `OceanNodeError` for an expired session quotes it. Every sanitiser
    also redacts the policy server's id shape (`<64 hex>-<64 hex>`, not after `0x`, which is a
    compute job id) wherever it stands, in node text and per-policy errors too. A URL quoted
    in the wallet's text still keeps its origin, so the verifier's host can appear.
  - **The node's per-policy results are bounded.** `checkPolicySession` keeps at most 50
    results (failures first), and strips control characters from, redacts and cuts at 100
    characters each policy and credential name and each error. Each is read up to 800
    characters only (a field of a bound of 100 characters or less is read at eight times it,
    not at 8,192), so a hostile record costs milliseconds.
  - **The `setVpPolicies` JSDoc** recommends the safe set
    (`[{ policy: 'signature' }, { policy: 'minimum-credentials', args: '1' }]`) and no longer
    suggests `holder-binding`.
  
  With `NAUTILUS_DEBUG=sensitive` and the `policy` and `wallet` topics, the wallet's answer and
  the verifier's record reach the debug channel as sent, long-lived credentials still masked. Don't send `policyResults` to a
  central log: a policy's error can quote a value of the presented credential.

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`dfca35b`](https://github.com/deltaDAO/nautilus/commit/dfca35b21883bc2ff83ec617a5773e0f46bfbd43) Thanks [@Abrom8](https://github.com/Abrom8)! - `access()` no longer buys a paid service a second time, silently, when the RPC fails to
  look up the order the account may already hold, or the lookup cannot read back over the
  whole order window.
  
  **Breaking (beta API)**
  
  - **`access()` throws an `OrderCheckError` instead of ordering anew** when the previous-order
    lookup fails (an RPC rate limit, no answer, or an RPC error) or stops short (it reached
    its depth of 100,000 blocks, its rounds of reads (as many as the window needs at 100
    blocks each, at least 100), its 5 minutes or its 50 candidates before the end of the
    service's timeout), not when it finds no order, and the service costs anything (a
    price, a publish-market fee or a provider fee). It is thrown
    before any approval, purchase or order: nothing was paid, and the call can be retried.
    Before, any lookup error was logged and a new order placed, which pays twice when the
    account already holds a valid order. `settleOrder()` does the same when given `service`.
    The message says what happened, why it stopped (it could have paid twice, with the
    price), that nothing was paid, the cause in plain words, and what to do.
  - **The lookup no longer takes a rate limit for a range refusal.** In 2.0.0-beta.2 a 429
    (also after ethers' retries), a `Retry-After`, a rate-limit `-32005` or "too many
    requests" was read as a refused range: the lookup halved its block range until its 100
    reads ran out, then reported "not found", and `access()` placed a new order. It now fails
    the lookup (`reason: 'rate-limited'`).
  - **An RPC that serves few blocks per `eth_getLogs` call no longer buys unchecked.** In
    2.0.0-beta.2 the lookup stopped after 100 reads wherever it was and reported "not found",
    so on a narrow RPC an order more than a few hours old was not seen and a second one was
    placed. The lookup now narrows a refused range to 1,000, 500, 200 and 100 blocks (and
    below), keeps the size that works, does not count refused ranges as reads, and reads as
    many rounds as the window needs at 100 blocks each (at least 100) for at most 5 minutes,
    which also bound each wait for the RPC: a call it does not answer in time ends the lookup
    at the 5 minutes, not when its answer comes. When the reads end before they cover the service's timeout, it throws `OrderCheckError`
    (`'incomplete'`) before anything is paid.
  - **Keep paid timeouts within what the check can read:** at most 24 hours on an RPC that
    serves 100 blocks per `eth_getLogs` call, up to about 55 hours (48 recommended) on one
    that serves 1,000 blocks or more.
  - **An RPC answer without the data its own answers promise is a failed lookup, not "no
    order".** No newest block, no receipt for an order transaction the RPC's logs list (or
    for the order a reuse of the account names), or a receipt without one of the order events
    those logs list, as a load-balanced RPC whose backends lag each other answers for a
    recent order, gave "not found" and a second order. It now fails the lookup (`reason:
    'rpc-error'`, "the RPC's answer lacked data the check needs"). Orders of another
    service, past the timeout or of another account are still skipped.
  - **A paid service throws `OrderCheckError` (`'incomplete'`) when no order is found in the
    blocks read but they do not cover its timeout**: orders that never expire (`timeout: 0`),
    a timeout longer than the 100,000-block depth (about 55 hours on OP Sepolia), reads that
    end first (an RPC that serves fewer than 100 blocks per call, or answers too slowly for
    the 5 minutes or not at all), or 50 candidates checked without one to reuse or extend, since an older order may
    still be in force. If the account never bought it, pass `orderOnLookupFailure: true`.
  
  **What changes for you**
  
  - **`OrderCheckError`** (exported): `code: 'ORDER_CHECK_FAILED'`, `reason`
    (`'rate-limited'`, `'unreachable'`, `'incomplete'` or `'rpc-error'`), `retryable: true`,
    `did`, `serviceId`, `consumer`, `price` (`{ amount, symbol }`, in whole tokens;
    `undefined` when the pricing could not be read either), `costs` (every part a new order
    pays: price, publish-market fee, provider fee), `checkedHours` and `windowHours` (for
    `incomplete`; `windowHours` is `Infinity` for orders that never expire), and `cause`, the
    RPC's error redacted (first line, credentials also under JSON escaping, so a key spelt
    `"api\u004bey"` is redacted too and a value with an escaped quote or delimiter in it is
    redacted whole, no URL, long hex shortened, at most 200 characters). The unredacted error
    goes to the debug channel (`NAUTILUS_DEBUG=sensitive`, topic `order`).
  - **`access({ orderOnLookupFailure: true })`** (also on `settleOrder()`) orders anyway, with a
    warning that it may pay twice. Only `true` opts in. When the price cannot be read either,
    nothing can be bought and `OrderCheckError` is thrown regardless.
  - **A free service** is still ordered when the lookup fails, now with one visible, redacted
    warning (`access.order.lookup_failed`, with `reason` and `free` fields), since a second
    order costs only gas. "No previous order found" orders as before, with no warning.
  - **`compute()` is unchanged:** it makes no previous-order lookup on chain, so it does not
    throw `OrderCheckError` and has no `orderOnLookupFailure` option. (It sends the node no
    `transferTxId`, so the node reports no valid order and each paid input is bought on every
    job; that known limitation is not changed here.)
  
  **Migrate:** catch `OrderCheckError` where you call `access()`, show its message (it names
  the cost, the cause and what to do) and retry later or with another RPC. Don't retry with
  `orderOnLookupFailure: true` on your own right after catching it: that is the second
  payment this change prevents. Offer it to the user, who knows whether the account already
  holds an order, and pass it only on their decision.

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`8be5d9b`](https://github.com/deltaDAO/nautilus/commit/8be5d9be1c743f033a2d6053f2c225f755822767) Thanks [@Abrom8](https://github.com/Abrom8)! - Every transaction now goes through a nonce guard, so concurrent publishes and orders from one
  key no longer collide, a publishing, pricing or metadata transaction refused for a stale nonce
  from the RPC is sent again, and a failed send says why instead of "ocean.js returned no
  transaction". A paid transaction (an order, purchase, approval or escrow payment) refused for
  its nonce is not sent again without proof that the first can never be mined, which gives up
  after 128 blocks: it stops with "may have been sent".
  
  **What changes for you**
  
  - **Concurrent calls from one key work.** `Promise.all` of publishes, edits and orders of
    different services from one `Wallet` used to lose one of them to `REPLACEMENT_UNDERPRICED` or "nonce too low",
    reported only as `… failed: ocean.js returned no transaction`. `Nautilus.create` now wraps
    the signer in a nonce guard: for a locally signing signer (an ethers `Wallet`) it sends one
    transaction at a time per chain and address (only the broadcast, not the wait for mining),
    with the nonce `max(its own counter, the RPC's pending count)`, advancing the counter only
    after a successful broadcast. Buying the same service in parallel is still a known
    limitation.
  - **Recovery from nonce refusals only** (`NONCE_EXPIRED`, `REPLACEMENT_UNDERPRICED`,
    "already known"), for a refused transaction that is provably the call's own: one the chain
    already has is waited for and never sent again; one it does not have is sent again with a
    fresh nonce, at most three attempts in all (an "already known" refusal is never sent
    again). An order, purchase, approval or escrow payment is sent
    again only with proof from two RPCs that the first can never be mined (the account's
    mined count past its nonce on both, read first; the hash unknown on both; and, in the
    blocks since the send on each RPC, another call of the account holding that nonce in a
    finalized block, not the same call to the same contract, which may be this one sped up
    or retried, searched over at most 128 blocks; nautilus does not wait for finality, so on
    a chain that finalizes in minutes a fresh collision stops), so never without a
    `verificationProvider`; otherwise it stops with the new **`NonceGuardError`**
    (`reason: 'may-have-been-sent'`). A timeout, network error or any other refusal is never
    retried; a resend that fails that way is a `NonceGuardError` too, keeping the earlier
    refused transactions in `attempts` (`attemptsComplete` says whether that list is whole).
    `NonceGuardError` has `code`, `reason` (`'may-have-been-sent'`, `'attempts-exhausted'`,
    `'unverifiable'` or `'not-managed'`), `attempts`, `attemptsComplete` and `moneySend`.
  - **The counter survives a lagging RPC.** A send takes the RPC's pending count instead only
    when the earliest transaction the pending count does not cover was dropped from the pool
    (sent over a minute ago, unknown on two reads, and the account not mined past its nonce),
    so a dropped transaction no longer leaves a gap that later ones wait behind for ever. A
    send that fails to fill the gap leaves it to the next send.
  - **New options on `Nautilus.create`:** `nonceManagement: 'auto' | 'off'` (default `'auto'`;
    `'off'` never sets a nonce or resends) and `verificationProvider`, a second RPC on the
    same chain for the "never sent" proofs, recommended for paid flows; `create` checks its
    chain and refuses the signer's own provider (the same object or URL), and refuses any
    other `nonceManagement` value.
    Wallet-managed signers (`JsonRpcSigner`, browser wallets) keep choosing their nonces.
  - **`getSigner()` returns the guarded signer**, not the object you passed in, so
    `getSigner() instanceof Wallet` is `false`. It signs through your signer. Passed to
    `Nautilus.create` again, it is not wrapped twice: the new instance applies its own
    `nonceManagement` and `verificationProvider` to your signer, and shares the per-address
    order and nonce counter with the first.
  - **Errors name the cause.** `confirmTransaction(operation, response, signer?, to?)` takes
    the signer and the contract the call went to and, when ocean.js returned no transaction,
    names that contract's recorded failure, with "It may have been sent" unless it was refused
    before the broadcast, and puts it on `cause` (the `NonceGuardError`, or a sanitised copy of
    the wallet's or RPC's error). With two sends to one contract on record (a broadcast until
    it is confirmed, a failure for a minute) it cannot tell which call failed, and keeps the
    generic message (also through ocean.js's confidential-chain wrapper, which shares the
    record). ocean.js's own errors for a failed datatoken creation or order also name the
    recorded failure. No error from a failed send carries a raw signed transaction or the RPC's URL path any more:
    ethers' errors reach you with `<signed transaction 0x…hash>` in place of the signed bytes
    (also where the RPC echoes them), the RPC URL cut to its origin (its path may hold an API
    key), and the HTTP `request`, `response` and response body of a failed request dropped
    (an error that cannot be changed in place, frozen or with read-only fields, is thrown as
    a sanitised copy with its `name`, `code`, `reason`, hashes and redacted messages);
    the raw values go to the debug channel (`NAUTILUS_DEBUG=sensitive`, topic `nonce`), with
    the nonce reads and the guard's decisions; credentials such as an RPC URL's token only at
    `NAUTILUS_DEBUG=secrets`.
  - **A failed send's error is bounded.** Each message of a failed send is cut to 16,000
    characters (a URL the cut runs through is dropped whole, so its user info cannot read as
    its host), with ANSI escapes and control characters removed, so a huge error body from an
    RPC is redacted in bounded time. The raw error is in the debug channel (topic `nonce`).
  - **A metadata transaction refused for its nonce** keeps its stored envelope unless it is
    proven never mined (hash unknown on two reads, the account past its nonce at each RPC's
    finalized block, and no metadata event with this `metadataHash` up to a block each RPC
    names): `cleanup: 'removed'` only then (`'not-removed'` if the store cannot remove it),
    else `'kept'`. A nonce taken only in blocks not yet finalized keeps the envelope, as a
    reorg could still mine the metadata transaction. On a confidential chain it is always kept.
    `REPLACEMENT_UNDERPRICED` no longer counts as "never broadcast" by itself.
  - **New log events:** `chain.nonce.resending`, `chain.nonce.already_sent`,
    `chain.nonce.gave_up`, `chain.nonce.counter_reset`, `chain.send.failed`,
    `publish.metadata.nonce_refused`, `node.indexer_nonce.zero_byte_accepted`.
  - **One key per process.** The guard covers one process; two processes sending with one key
    can still collide.
  - **The indexer-nonce preflight knows ocean-node 4.2.2.** `isIndexerNonceSignable(address,
    nonce, nodeVersion?)` and `getIndexerNonceState()` (new field `nodeVersion`, from
    `GET /`) no longer report a zero-byte nonce hash as stuck on a node of 4.2.2 or later,
    which accepts it, so `publish()` no longer refuses there; it logs
    `node.indexer_nonce.zero_byte_accepted` at `info` instead. Unknown or older versions keep
    the refusal. The version is self-reported and the fix is in the OE fork (`oe-ocean-node`):
    an upstream ocean-node with the same number would leave such an asset unindexed. New
    export `nodeAcceptsZeroByteNonce(version)`.

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`98231ac`](https://github.com/deltaDAO/nautilus/commit/98231ac2749db28fc77d57cd69f6b653e792abbe) Thanks [@Abrom8](https://github.com/Abrom8)! - Every log line names the call it comes from, so the lines of calls that run at the same time
  can be told apart, and a thrown error leads to its lines.
  
  **What changes for you**
  
  - **`opId` and `operation` on every event of a call.** `publish`, `completePublish`, `edit`,
    `setServicePrice`, `setAssetLifecycleState`, `access`, `compute`, `freeCompute`,
    `stopCompute`, `getComputeStatus`, `getComputeResult`, `streamComputeResult`,
    `getComputeLogs`, `waitForIndexer` and the reads `getAsset`, `getAssets`, `query`,
    `getComputeEnvironments` and `getComputeEnvironment` each give their call a random 12-hex-character `opId`. Every `LogEvent` the call causes carries it, with the
    call's name as `operation`, in the JSON and the pretty format and in a `sink`. In Node 22.3
    or newer it follows the call through every `await`, timer and callback (`AsyncLocalStorage`, read
    through `process.getBuiltinModule`, so no bundle has to resolve `node:async_hooks`), and so
    reaches the node client's, the process-wide logger's and the sensitive debug channel's
    events too (`DebugEvent.opId`, and `[access 3f9a2c1b07e4]` after the time on a debug line).
    In a browser, and in Node 22.0 to 22.2 (no `process.getBuiltinModule`), the call hands a
    logger bound to it to the steps it runs (orders, escrow, the NFT mint, price changes,
    compute start, publish's and edit's checks and metadata transaction); events of code it
    does not hand that logger (the node client, the policy-session resolver, the signer's
    nonce guard, an `S3RemoteStore`, the process-wide logger and the ocean.js lines it
    captures) carry no `opId`, never a wrong one.
  - **`error.opId`.** The error such a call throws carries the same `opId`. It is not
    enumerable, so the error compares, prints and serialises as before. One error object
    thrown by several calls (a cached rejection, a shared abort reason) has the latest call's
    `opId`, and `error.opIds` holds the first call's `opId` followed by the latest ones (at
    most 16). An error whose own `opId`
    nautilus did not set keeps it.
  - **Operation events with `durationMs`.** Each call logs `…operation.started` (`debug`) and
    `…operation.finished` or `…operation.failed` (`info`, with `durationMs`; `failed` with the
    redacted `error`) under its component: `publish`, `edit`, `lifecycle`, `access`, `compute`
    and `node` (`waitForIndexer`). The job reads, `getComputeStatus` and `getComputeResult`
    (which apps poll), `streamComputeResult` and `getComputeLogs` (which finish once the stream
    is open), and the environment reads log `compute.query.*`; the metadata reads `getAsset`,
    `getAssets` and `query` log `node.query.*`; all of these at `debug`. Nothing new prints at the
    default level (`warn`). In Node 22.3 or newer, a call made from inside another call of the
    same logger that is still running (from a `confirmProviderFees` callback, say) joins that
    one; a timer or listener a finished call left behind starts an operation of its own. With
    `NAUTILUS_DEBUG=sensitive` and the log level at `info` or more verbose, the raw error of a
    `failed` event goes to the debug topic of its origin where nautilus knows it (`policy`,
    `wallet`, `nonce`), else to the component's (`rpc` for publish, edit and lifecycle,
    `order` for access, `compute`, `node`).
  - New exported type `OperationName`; `LogEvent` and `DebugEvent` have `opId` and
    `operation`.
  
  - **Redaction fix.** A JWT, a signature or a signed transaction right after an escape
    sequence that ends in a letter (`Evil\u001b[2J<token>`) was printed: deleting the escape
    glued the token to the word before it. Such tokens are now redacted there too, in log
    lines and error messages, also when the JWT's payload JSON has whitespace (`{\n"sub":…}`,
    encoded `ewo…` rather than `eyJ…`). A JWT whose header JSON has whitespace is now redacted
    as well; it was printed even on its own.
  
  The `opId` is random and the operation a fixed name: neither carries your data, the node's
  or the chain's, and both pass the same field redaction as every other field.

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`a708dc9`](https://github.com/deltaDAO/nautilus/commit/a708dc9870fea44a3966956f5736cf3626c2220b) Thanks [@Abrom8](https://github.com/Abrom8)! - Warnings are printed once per subject, node text in them is cleaned and shortened, and
  ocean.js no longer prints "No config found" during an order.
  
  **What changes for you**
  
  - **The policy-server warning names the node and the asset, and is printed once for each
    pair.** `publish.preflight.denies_all` warns when a node's policy server would refuse every
    consumer, because the asset has no address allow list. It now warns for each node that has
    a policy server, the configured one and each service's `serviceEndpoint` (an endpoint with
    a trailing slash is the same node). Before, it stopped at the first. It is printed once per
    node and asset. The asset is its DID on an edit and in `completePublish`, which has the
    NFT; the event carries `did`. Before the mint there is no DID, so the key is the
    publisher's address and the asset's name: new assets of one publisher with the same name
    warn once per node, and the event carries `name`. Publishing or editing the same asset
    again no longer repeats the warning; publishing it and then editing it warns once for
    each.
  - **Other warnings are printed once where repeating them adds nothing:**
    - `publish.preflight.indexer_nonce_will_stick`: once per node and nonce.
    - `compute.result.unavailable`: once per node, job and reason (the node does not know
      the job; the job has no `output`), however often `getComputeResult` is polled.
      `compute.result.not_ready` is unchanged.
    - `compute.duration.capped`: once per node, environment, requested duration and limit.
  
    These stay printed every time, because each one is a new failure:
    `publish.preflight.pending_unreadable`, `publish.metadata.events_unchecked` and
    `access.order.lookup_failed`. A logger remembers the last 1,000 keys; a key longer than
    256 characters is remembered by its hash.
  - **A compute job's status text and result list are cleaned before they appear** in the
    `compute.result.unavailable` and `compute.result.not_ready` warnings and in the errors `streamComputeResult` and
    `getComputeLogs` throw. Control characters and ANSI escapes are removed from each result
    entry, URLs keep only their origin, credentials are redacted, the status is cut at 200
    characters and the result list at 1,000; a cut list says how many results there are and
    that `getComputeStatus()` lists them all. Before, the list was put in as the node sent it,
    at any length. When the list was cut or cleaned, the list as the node sent it goes to the
    debug channel (`compute` topic; credentials still masked).
  - **Node text is redacted in bounded time, and a backslash no longer ends a URL.** The
    redaction of a node's text, an error or a log message reads only the start of a long
    text: eight times the length it is cut to, at least 8,192 characters, except a short field
    (cut at 100 characters or less), read at eight times its length. The word that cut splits
    is dropped, so a cut JWT or URL never shows in part; a URL the cut goes through is dropped
    whole, so its user info (`https://user:secret,…@host`) is never read as its host. User
    info with a quote or `<`/`>` in it (`https://user:12345'secret@host`, also as a JSON
    escape, `\u0027`, or in a URL percent-encoded into a query) is dropped up to its
    `@`, also when the cut falls in it, in messages and in the `sensitive` debug tier; a URL
    whose authority is otherwise no host and port (a space in its password ended it) reads
    `scheme://<redacted>`. A URL with a backslash in its path
    (`https://host/x\y/v3/<key>`) now keeps only its origin in messages, and its path token is
    masked in the `sensitive` debug tier as well; before, the text after the backslash was
    printed. So does a URL with a BOM in its path (the token after the BOM used to be
    printed), and a URL without a scheme on an IP address, `localhost` or an
    IPv6 address in brackets (`127.0.0.1:8545/v3/<key>` reads `127.0.0.1:8545`).
  - **No more `No config found for given network 'undefined'`.** The `FixedRateExchange` and
    `Dispenser` that nautilus builds for orders, prices and `editPrice` now get the chain id and
    the chain config, as the datatoken and the NFT already did. ocean.js used to print the line
    at its default level, twice per fixed-price order. Those contracts' transactions now also
    use the config's `gasFeeMultiplier`, and on an `sdk: 'oasis'` chain the wrapped signer.
    `getDatatokenBalance(signer, datatokenAddress, config?)` takes the chain config as an
    optional third argument. Without it, the chain id is read from the signer, and so does
    `getPricingInfo(signer, datatokenAddress)` without its config.
  - **A node's reason ends in one period.** `PolicyDeniedError`, `PublishIncompleteError` and
    the error `waitForIndexer` throws after repeated failed lookups no longer read `…at asset level..` when the node's text already
    ends in `.`, `!`, `?` or `…`. A period is still added when it ends in none of these.

### Patch Changes

- [#212](https://github.com/deltaDAO/nautilus/pull/212) [`6be269d`](https://github.com/deltaDAO/nautilus/commit/6be269df2910ecbfbb525499f2a2bef9788b0ac8) Thanks [@Abrom8](https://github.com/Abrom8)! - Credentials hidden by escaping in an RPC's answer are redacted, and the known limits of this
  release are documented on one page.
  
  **What changes for you**
  
  - **Credentials under escaping in an RPC's answer are redacted in errors and log lines.**
    When an RPC answers with an error, ethers quotes its answer in the error message, and each
    level of quoting escapes it again. A credential the answer carried as a JSON field (a
    `pinataGatewayToken`, an `apiToken` in a body quoted inside JSON, a field written with
    `\u0022` or `\'` quotes) or percent-encoded (`apiToken%3D…`, an encoded JSON field, an
    encoded RPC URL) reached the `error` field of a log event, an operation's
    `…operation.failed` event, an `OceanNodeError` and the message of a failed send, because
    the redaction did not look under the escapes. It now reads the text with up to eight levels
    of JSON escaping and percent-encoding undone, one level at a time, so a quote escaped inside
    a value stays part of it, and flattens deeper JSON escaping and percent-encoding of any
    depth (also mixed, and chains where undoing one escape makes the next, such as
    `\u005cu005c…u003d`) for one more read; what it finds there is redacted with the rest of
    the text after it. Text that hides nothing keeps its escapes. The raw value is still in the debug
    channel: at `NAUTILUS_DEBUG=secrets`, not at `sensitive`, which now reads the same escapes,
    JSON-escaped URLs included.
  - **A download URL can be replaced by a newer one.** The URL `access()` returns carries a
    one-time number the node checks. Two URLs requested for the same consumer and node before
    either is fetched carry the same number: the first one fetched works, and the other answers
    HTTP 401 `nonce: … is not a valid nonce`. nautilus does not fetch the URL, so it cannot
    change that answer. Fetch each URL before you request the next one; after such a 401, call
    `access()` again and fetch the new URL right away (for a paid service, only once at least
    2 more blocks are mined after the purchase: sooner, `access()` does not find the order yet
    and pays again). The `access()` docs and the download guide say so.
  - **Known limitations page.** [Known limitations](https://nautilus.delta-dao.com/docs/known-limitations)
    lists what this release does not handle yet, each with what to do instead: the credential
    type alone is not a reliable gate (enforce trust with trusted issuers and an explicit
    address allow list), one download URL at a time, buying the same service in parallel from
    one key, a second `access()` right after buying a paid service (wait until at least 2 more
    blocks are mined after the purchase, or it pays again; a lagging RPC extends that wait),
    every `compute()` buying its paid datasets and algorithms again (price compute services as
    free, or expect one purchase per job), orders older than about 55 hours (less on an RPC
  that serves 100 blocks per `eth_getLogs` call: keep paid services at 24 hours or less
  there), a stuck fee
    approval, `getAssets` on ocean-node 4.2, and revoking after deprecating.

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
