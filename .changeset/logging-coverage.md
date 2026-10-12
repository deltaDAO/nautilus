---
"@deltadao/nautilus": minor
---

Every public operation now logs what it does: at `info` one line per milestone, with
transaction hashes, DIDs and durations; at `debug` each step and decision; at `trace` each
request. Nothing new prints at the default level (`warn`).

**What changes for you**

- **`info` tells the story of a call.** A publish is 5 to 8 lines: `publish.tokens.created`,
  `publish.datatoken.created` (each further service), `publish.ddo.stored`,
  `publish.ddo.verified`, `publish.metadata.sent`, `publish.metadata.confirmed`,
  `publish.indexer.indexed` and `publish.operation.finished`. `edit()` and `completePublish()`
  log the same write milestones; `completePublish()` adds `publish.pricing.created`. An access
  logs `access.order.settled`, now `info` (was `debug`), with the order's transaction.
- **`…operation.finished` names what the call produced:** the asset's `did` and the last
  `txHash` (publish, completePublish, edit, setServicePrice, setAssetLifecycleState, access),
  the `nftAddress`, the job ids of compute calls, the job status of `getComputeStatus`.
  There is no separate "done" line.
- **`debug` shows the steps and decisions** the beta.2 run needed outside queries for:
  - the nonce of every transaction and where it came from (`chain.nonce.chosen`, the RPC's
    pending count and nautilus's counter), each broadcast (`chain.send.broadcast`), and a
    refusal for the nonce (`chain.nonce.refused`) before the nonce guard's decision;
  - the previous-order lookup: what it found and how long it took
    (`access.order.lookup_finished`), and how the order is settled (`access.order.planned`:
    used as it stands, extended, or a new order at its price);
  - how the policy session came about (`identity.session.resolved`: not gated, no policy
    server, cached, opened, presented; never the session id). A refused presentation names
    the failed policies in `access.operation.failed`, as before;
  - the provider fee quoted and a fee requested again, the download URL's node (never the
    URL), the publish checks passed, the DDO signed, both node encryptions and the upload,
    `completePublish()`'s reuse plan, a lifecycle change, a compute job's quote and orders,
    each failed node request with its HTTP status (`node.request.failed`), a signed command
    sent again after a refused nonce, and an indexer wait's result and failed lookups.
- **`trace` adds each request:** `node.request.answered` (command, node origin, duration),
  each read of the previous-order lookup and each lookup of an indexer wait.
- **Redacted like every other event.** No line holds a signed transaction, a session id, a
  download URL or request arguments; error fields carry nautilus's sanitised error, never an
  RPC's raw one. Values the redaction removes go to the sensitive debug channel, under
  `order` for the order lookup's errors whichever call ordered, `store` for the stored DDO's
  pointer and `nonce` for the nonce lines.

The list of events per call is in the `configureLogging` reference, "What each operation
logs", and each operation's page has a "Log" section.
