---
"@deltadao/nautilus": minor
---

Every log line names the call it comes from, so the lines of calls that run at the same time
can be told apart, and a thrown error leads to its lines.

**What changes for you**

- **`opId` and `operation` on every event of a call.** `publish`, `completePublish`, `edit`,
  `setServicePrice`, `setAssetLifecycleState`, `access`, `compute`, `freeCompute`,
  `stopCompute`, `getComputeStatus`, `getComputeResult` and `waitForIndexer` each give their
  call a random 12-hex-character `opId`. Every `LogEvent` the call causes carries it, with the
  call's name as `operation`, in the JSON and the pretty format and in a `sink`. In Node 22.3
  or newer it follows the call through every `await`, timer and callback (`AsyncLocalStorage`, read
  through `process.getBuiltinModule`, so no bundle has to resolve `node:async_hooks`), and so
  reaches the node client's, the process-wide logger's and the sensitive debug channel's
  events too (`DebugEvent.opId`, and `[access 3f9a2c1b07e4]` after the time on a debug line).
  In a browser, and in Node 22.0 to 22.2 (no `process.getBuiltinModule`), the call hands a
  logger bound to it to the steps it runs (orders, escrow, the NFT mint, price changes,
  compute start, publish's and edit's checks and metadata transaction); events of code it
  does not hand that logger (the node client, the policy-session resolver, the signer's
  nonce guard, an `S3RemoteStore`) carry no `opId`, never a wrong one.
- **`error.opId`.** The error such a call throws carries the same `opId`. It is not
  enumerable, so the error compares, prints and serialises as before. One error object
  thrown by several calls (a cached rejection, a shared abort reason) has the latest call's
  `opId`, and every call's in `error.opIds` (the first one first). An error whose own `opId`
  nautilus did not set keeps it.
- **Operation events with `durationMs`.** Each call logs `…operation.started` (`debug`) and
  `…operation.finished` or `…operation.failed` (`info`, with `durationMs`; `failed` with the
  redacted `error`) under its component: `publish`, `edit`, `lifecycle`, `access`, `compute`
  and `node` (`waitForIndexer`). The job reads apps poll, `getComputeStatus` and
  `getComputeResult`, log `compute.query.*`, all at `debug`. Nothing new prints at the
  default level (`warn`). In Node 22.3 or newer, a call made from inside another call of the
  same logger that is still running (from a `confirmProviderFees` callback, say) joins that
  one; a timer or listener a finished call left behind starts an operation of its own. With
  `NAUTILUS_DEBUG=sensitive`, the raw error of a `failed` event goes to the debug topic of
  its origin where nautilus knows it (`policy`, `wallet`, `nonce`), else to the operation's.
- New exported type: `OperationName`. `LogEvent` gains `operation`; `DebugEvent` gains
  `opId` and `operation`.

- **Redaction fix.** A JWT, a signature or a signed transaction right after an escape
  sequence that ends in a letter (`Evil\u001b[2J<token>`) was printed: deleting the escape
  glued the token to the word before it. Such tokens are now redacted there too, in log
  lines and error messages, also when the JWT's payload JSON has whitespace (`{\n"sub":…}`,
  encoded `ewo…` rather than `eyJ…`). A JWT whose header JSON has whitespace is now redacted
  as well; it was printed even on its own.

The `opId` is random and the operation a fixed name: neither carries your data, the node's
or the chain's, and both pass the same field redaction as every other field.
