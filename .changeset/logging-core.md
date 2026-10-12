---
"@deltadao/nautilus": minor
---

nautilus has its own logger, and its warnings are now visible by default.

**What changes for you**

- **Warnings print by default.** nautilus logged most of its warnings through ocean.js's
  `LoggerInstance`, whose default level is errors only, so they were never shown: among them
  "this node's policy server will refuse every consumer of this asset", "requested
  `maxJobDuration` capped", "could not look up a previous order, ordering anew", "asset is
  already in that state". They now print to stderr at the default level, `warn`. The
  one-time warnings that went to `console.warn` go to the same place. To silence them, set
  `Nautilus.configureLogging({ level: 'silent' })` or `NAUTILUS_LOG_LEVEL=silent`.
- **Structured, catalogued events.** Every line is an event with a stable name
  (`component.step.outcome`, e.g. `publish.preflight.denies_all`), a level, a component, a
  message and fields. On a terminal it prints as one readable line, otherwise as one JSON
  object per line. `LOG_EVENTS` lists every event with its level, component and fields.
- **Output goes to `process.stderr`, not `console.warn`.** In Node, every line is written
  straight to `process.stderr` (JSON lines when stderr is not a terminal), so hooks on
  `console.warn` no longer see the one-time warnings that used to go there (the publisher is
  the node's own key, shared S3 credentials, a writable S3 read key, persisted presented
  sessions, an empty policy-server URL, the legacy `waitForIndexer` options). Hand them to your own code with a `sink`. In a
  browser, lines still go to the console.
- **The log level now governs those warnings too.** They used to print at any level;
  `Nautilus.setLogLevel(LogLevel.None)` or `LogLevel.Error`, `configureLogging({ level:
  'silent' | 'error' })` and `NAUTILUS_LOG_LEVEL=silent|error` now silence them along with
  every other warning, security warnings included. Keep the level at `warn` or above (or a
  `sink`) where you rely on them.
- **Redacted by field.** Before any output, fields are redacted by key, compared without
  case, `-`, `_` or invisible characters and matched whole, in nested objects and class
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
  a JSON field inside a JSON string (at any depth), JSON escapes in a key or a URL decoded
  first (`"session\u0049d"`, `https:\/\/host\/path`); `Bearer` and `Basic` credentials,
  JWTs and 65-byte hex signatures are redacted anywhere, URLs reduced to their origin.
  Before, only a short list of keys was redacted in text. Error messages thrown by nautilus change accordingly (e.g. a
  node's `nonce: 1 is not a valid nonce` now reads `nonce: <redacted> …`). Text is matched by
  pattern: a credential without a key in front of it is not recognised.

**New API**

- `Nautilus.configureLogging({ level, format, components, sink, oceanjs })`, process-wide:
  levels `silent`, `error`, `warn` (default), `info`, `debug`, `trace`; `format` `'pretty'` or
  `'json'`; `components` to narrow `info`/`debug`/`trace` output; `sink(event)` to hand the
  redacted events to your own logger (pino, winston, the browser console) instead of stderr.
  `oceanjs` is accepted but not active yet: ocean.js prints as before, unredacted, at its own
  level, and every mode (`'capture'` included) warns once. To silence ocean.js now, call
  `LoggerInstance.setLevel(LogLevel.None)`.
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
