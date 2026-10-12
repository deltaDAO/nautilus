---
"@deltadao/nautilus": minor
---

The previous-order lookup of `access()` is several times faster, covers far more of the
order window, and closes the remaining ways a paid service could be bought twice. Three
concurrent paid accesses of one service from one key pay once and all download.

- **Faster:** the datatoken's events are read in 10,000-block chunks (was 2,000), the newest
  alone and then up to four at a time, checked newest first. A day's window takes about 10
  `eth_getLogs` calls in 3 round trips instead of 46 in 23, and an order in the newest
  chunk is returned without waiting for anything else. A range the RPC refuses as too wide
  sets a smaller size for that range and every range not read yet; the size grows back
  after accepted reads, never to a width refused in the lookup, one wider read at a time.
  The accepted size, and the refused width for an hour, are remembered per provider
  instance and chain. An RPC that serves 1,000 or 2,000 blocks per call covers a 48-hour
  window. At most four chunks (eight requests) are in flight. The lookup makes at most 150
  reads (was 100) with at most 20 refused ranges.
- **Rate limits are waited out** on every read of the lookup (logs, blocks, receipts,
  code), honouring `Retry-After` (else 1, 2, 4 s), up to three times per read and 20 seconds
  in all, and never shrink the range. Once the lookup has returned or thrown, its reads
  still running make no further call and their waits end. QuickNode's `-32007`, "request
  limit reached", "capacity exceeded" and a thrown "Too Many Requests" string count as rate
  limits.
- **Deeper:** at most 1,000,000 blocks (was 100,000): a 7-day service on OP Sepolia no
  longer always stops short. For a service whose orders never expire (`timeout: 0`), the
  lookup reads back to the datatoken's creation block when the RPC can prove it (the
  datatoken's code first appears there and the NFT factory logged its creation in it), so a
  first purchase no longer needs `orderOnLookupFailure: true` on a long chain.
- **No re-buy on a fast retry:** an order of the account in the last two blocks (not
  confirmed yet) makes the lookup `incomplete` (`OrderCheckError.limit: 'unconfirmed'`),
  not "not found"; a retry once the chain has mined two more blocks reuses it. The account
  holds that order, so the message says so ("already has an order for it that is too new
  to use"), offers no opt-in, and `orderOnLookupFailure: true` does not buy it again. A
  service whose timeout is 10 minutes or less now reuses an order with at least half its
  timeout left instead of buying anew every time.
- **No re-buy through a lagging RPC:** an RPC whose newest block is older than the order
  window is a failed lookup (`rpc-error`), not "not found"; the message gives the age in
  seconds, minutes or hours and names a chain that has not mined since (a local chain that
  mines only on demand). The process also records each order it confirms: while the RPC
  does not show it with its confirmations (a backend a block or more behind), a retry stops
  with `limit: 'unconfirmed'` instead of buying again. A new process retrying within
  seconds through a lagging RPC is not covered.
- **A flood of `OrderReused` events** (anyone can send them, for gas) that the RPC refuses
  to return no longer makes every consumer's lookup `incomplete`: those events are read
  again alone in smaller ranges, and only a single block refused even alone is read with
  the account's own `OrderStarted` events (with a debug event, topic `order`). A refusal
  that names a timeout never switches to that.
- **New field `OrderCheckError.limit`** (type `IncompleteLookupLimit`, now exported:
  `'reads' | 'depth' | 'candidates' | 'unconfirmed'`) for `incomplete`, so a program can
  tell a retryable stop from one that ends the same way without parsing the message.
- **Concurrent purchases from one key pay once:** `access()` and `settleOrder()` run one
  purchase per (chain, datatoken, consumer, service index) at a time in the process; a
  concurrent call waits for it and shares its result (its `transferTxId`, with `reused:
  true`, or its error), sending nothing. Before, each call bought (three prices for three
  downloads), or two of three reverted.
- **Concurrent orders sharing an allowance:** an approval sets the allowance rather than
  adding to it, so concurrent orders of one key each approved their own amount and all but
  one reverted. Each (chain, payer, token, spender) allowance is now held from its approval
  until the order spending it is confirmed, process-wide.
- **New `OrderInProgressError`** (`code: 'ORDER_IN_PROGRESS'`, `retryable: true`): a call
  that waits more than five minutes for another purchase of the same service, or for an
  allowance another order holds (a pending or dropped transaction), throws it before
  sending anything.
- The pricing read no longer skips a fixed-rate exchange whose read was rate-limited or not
  answered (which could make a paid datatoken look free). It throws an `Error` named
  `PricingReadError`, whose message and `cause` hold no RPC URL (ethers' error names it,
  with any API key in it); the raw error goes to the debug channel's `rpc` topic.
