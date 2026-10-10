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
- **Redacted by field.** Before any output, fields are redacted by key: session ids,
  signatures, nonces, JWTs, tokens, `Authorization` and S3 secret keys become
  `<redacted>`, URLs are reduced to their origin, errors are sanitised. Messages and other
  text are sanitised too. `sessionId=` and `"sessionId": …` are now also redacted from node
  text in error messages.

**New API**

- `Nautilus.configureLogging({ level, format, components, sink, oceanjs })`, process-wide:
  levels `silent`, `error`, `warn` (default), `info`, `debug`, `trace`; `format` `'pretty'` or
  `'json'`; `components` to narrow `info`/`debug`/`trace` output; `sink(event)` to hand the
  redacted events to your own logger (pino, winston, the browser console) instead of stderr.
  `oceanjs` is accepted but not acted on yet; ocean.js prints as before.
- `Nautilus.create(signer, { logger })`: one instance's own level, format, components or
  sink, e.g. per tenant.
- Environment variables, read once at import and overridden by `configureLogging`:
  `NAUTILUS_LOG_LEVEL`, `NAUTILUS_LOG_FORMAT` (`json` or `pretty`) and
  `NAUTILUS_LOG_COMPONENTS` (e.g. `publish,access`). An unknown value is ignored, with a
  warning. In a browser there is no environment; the console is the output.
- `createLogger(options)`, `LOG_EVENTS` and the `LogEvent`, `LogSink`, `LoggingOptions`,
  `LoggingConfig` types. The node client takes a `logger` option.

**Deprecated**

- `Nautilus.setLogLevel(LogLevel)` still works: it maps `None`/`Error`/`Warn`/`Log`/`Verbose`
  to `silent`/`error`/`warn`/`info`/`trace`, and still sets ocean.js's `LoggerInstance` level
  as before. Use `configureLogging({ level })` instead. nautilus's own lines no longer go
  through ocean.js's `LoggerInstance`, so tests or hooks that spied on it to see nautilus's
  warnings must use a `sink` instead.
