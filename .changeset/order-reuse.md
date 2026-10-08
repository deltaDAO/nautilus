---
'@deltadao/nautilus': patch
---

Reuse a download order that is still valid, so `access()` no longer pays for a new order
on every call within the service's timeout.

ocean-node's access `initialize` reports no `validOrder` (only its compute `initialize`
checks a previous order), and nautilus reused an order only when the node reported one.

**Fixes**

- **`access()` finds the previous order on chain.** When `initialize` reports no
  `validOrder`, nautilus reads the datatoken's `OrderStarted`, `OrderReused` and
  `ProviderFee` events and keeps the account's newest order for the service only where
  the node would accept it at download: the account is its consumer or payer, the
  service index matches, it is inside the service's `timeout` counted from the
  `OrderStarted` block (`0` never expires), with at least 60 s to go.
- **Used as it stands, or extended.** When the order or a reuse of it carries a provider
  fee signed by the service's node for this service that has not expired, the download
  uses that transaction and nothing is sent. Otherwise the order is extended with
  `reuseOrder` and the fee the node quotes now. Either way the result has
  `reusedOrder: true`, and `transferTxId` is the transaction the download uses.
- **Bounded reads.** The events are read newest first, 10 000 blocks per `eth_getLogs`
  call, no further back than the service's timeout and at most 100 000 blocks. A lookup
  the RPC refuses falls back to a new order.

A node that reports `validOrder` is followed as before, with no chain read.
`settleOrder()` takes an optional `service: { id, timeout }` to look the order up;
without it, only the node's `validOrder` is reused.
