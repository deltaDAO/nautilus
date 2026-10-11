---
"@deltadao/nautilus": minor
---

ocean.js's own log lines go through nautilus's logger, redacted, by default.

ocean.js logs through one process-wide object, its `LoggerInstance`, straight to the console.
After a refused compute start or initialize it logs the request payload at error level, its
default: the request's nonce and the policy-server session ids, unredacted (the 2.0.0-beta.2
run printed them for an untrusted algorithm). None of nautilus's settings applied to those
lines: not the level, not the sink, not the redaction.

**What changes for you**

- **`configureLogging({ oceanjs })` is active, default `'capture'`.** ocean.js's lines become
  nautilus events of the component `oceanjs`: `oceanjs.logger.error`, `oceanjs.logger.warn`,
  `oceanjs.logger.log` (`info`, also ocean.js's `bypass`) and `oceanjs.logger.debug`, with the
  text ocean.js logged as the message and the objects after it in `fields.args` (a JSON
  string holding an object is read as the object), redacted by field and by text like every
  other event: the payload's `nonce`, `signature` and `sessionId`s are `<redacted>`. They
  print at nautilus's level, in its format and to its sink, so the payload dump now prints as
  a redacted `[oceanjs] error` line on stderr instead of an unredacted one on the console.
  The raw lines reach only the `sensitive` debug tier (topic `node`).
- `'passthrough'` keeps the old behaviour: ocean.js prints itself, unredacted. `'silent'`
  drops ocean.js's lines. `oceanjs: undefined` goes back to `'capture'`.
- ocean.js's own level (`LoggerInstance.setLevel`, errors only by default) still decides first
  which lines it emits, so `LoggerInstance.setLevel(LogLevel.None)` still silences it; nautilus's
  level then decides which of them print. `setLogLevel` sets both, as before.
- `LoggerInstance` is process-wide: the mode applies to every ocean.js user in the process.
  nautilus replaces that object's five logging methods (`error`, `warn`, `log`, `debug`,
  `bypass`) when it is imported, and calls ocean.js's own ones for `'passthrough'`. It does not
  patch `console`, and doesn't change ocean.js's level. Tests that spied on `console.error`
  to see ocean.js's lines now see them as nautilus events (on stderr, or through a `sink`), or
  can spy on `LoggerInstance.error` itself.
- Not captured: the few ocean.js functions that write to `console` directly (none of them on
  the paths nautilus calls logs a request payload), and the logger of ocean.js's other bundle,
  which an app gets when it loads ocean.js through `require`.
- The `config.oceanjs.not_active` warning is gone.
