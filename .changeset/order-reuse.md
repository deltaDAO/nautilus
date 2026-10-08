---
'@deltadao/nautilus': patch
---

Reuse a download order that is still valid, so `access()` no longer pays for a new order
on every call within the service's timeout.

ocean-node's access `initialize` reports no `validOrder` (only its compute `initialize`
checks a previous order), and nautilus reused an order only when the node reported one.

**Fixes**

- **`access()` finds the previous order on chain.** When `initialize` reports no
  `validOrder`, nautilus reads the datatoken's `OrderStarted` events with the account as
  consumer and its `OrderReused` events with the account as caller, and checks each
  transaction, newest first, from its receipt exactly as the node checks a download: it
  follows the first `OrderReused` (whose caller must be the account), takes the first
  `OrderStarted` of the datatoken for the account (consumer or payer) and refuses it for
  another service index, and keeps the order while inside the service's `timeout`
  counted from the `OrderStarted` block (`0`, or a missing timeout, never expires). A
  transaction with two orders (the wrong service index first), or with a bogus reuse
  ahead of a valid one, is refused as the node refuses it.
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
  rounds of reads. An order beyond that is not found, and a new one is placed; so is one
  when the RPC fails otherwise.

A node that reports `validOrder` is followed as before, with no chain read.
`settleOrder()` takes an optional `service: { id, timeout? }` to look the order up;
without it, only the node's `validOrder` is reused. It also takes an optional `did`, named
with the service in the fee passed to `confirmProviderFees`.
