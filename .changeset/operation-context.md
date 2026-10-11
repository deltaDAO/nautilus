---
"@deltadao/nautilus": minor
---

Every log line names the call it comes from, so the lines of calls that run at the same time
can be told apart, and a thrown error leads to its lines.

**What changes for you**

- **`opId` and `operation` on every event of a call.** `publish`, `completePublish`, `edit`,
  `setServicePrice`, `setAssetLifecycleState`, `access`, `compute`, `freeCompute`,
  `stopCompute`, `getComputeStatus`, `getComputeResult` and `waitForIndexer` each give their
  call a random 8-hex-character `opId`. Every `LogEvent` the call causes carries it, with the
  call's name as `operation`, in the JSON and the pretty format and in a `sink`. In Node it
  follows the call through every `await`, timer and callback (`AsyncLocalStorage`, read
  through `process.getBuiltinModule`, so no bundle has to resolve `node:async_hooks`), and so
  reaches the node client's, the process-wide logger's and the sensitive debug channel's
  events too (`DebugEvent.opId`, and `[access 3f9a2c1b]` after the time on a debug line).
  In a browser, without `AsyncLocalStorage`, the call hands a logger bound to it to the steps
  it runs (orders, escrow, the NFT mint, price changes, compute start); events of code it
  does not hand that logger carry no `opId`, never a wrong one.
- **`error.opId`.** The error such a call throws carries the same `opId`. It is not
  enumerable, so the error compares, prints and serialises as before. An error that already
  has an `opId` keeps it.
- **Operation events with `durationMs`.** Each call logs `…operation.started` (`debug`) and
  `…operation.finished` or `…operation.failed` (`info`, with `durationMs`; `failed` with the
  redacted `error`) under its component: `publish`, `edit`, `lifecycle`, `access`, `compute`
  and `node` (`waitForIndexer`). The job reads apps poll, `getComputeStatus` and
  `getComputeResult`, log `compute.query.*`, all at `debug`. Nothing new prints at the
  default level (`warn`). A call made from inside another (from a `confirmProviderFees`
  callback, say) joins that one.
- New exported type: `OperationName`. `LogEvent` gains `operation`; `DebugEvent` gains
  `opId` and `operation`.

The `opId` is random and the operation a fixed name: neither carries your data, the node's
or the chain's, and both pass the same field redaction as every other field.
