---
"@deltadao/nautilus": minor
---

The previous-order lookup of `access()` is several times faster, covers far more of the
order window, and closes the remaining ways a paid service could be bought twice. Three
concurrent paid accesses from one key no longer revert.

- **Faster:** the datatoken's events are read in 10,000-block chunks (was 2,000), the newest
  alone and then up to four at a time, checked newest first. A day's window takes about 10
  `eth_getLogs` calls in 3 round trips instead of 46 in 23. A range the RPC refuses is
  halved and grows back after accepted reads; the accepted size is remembered per provider
  instance and chain.
- **Rate limits are waited out**, honouring `Retry-After` (else 1, 2, 4 s), up to three
  times per read, and never shrink the range. QuickNode's `-32007`, "request limit reached",
  "capacity exceeded" and a thrown "Too Many Requests" string count as rate limits.
- **Deeper:** at most 1,000,000 blocks (was 100,000): a 7-day service on OP Sepolia no
  longer always stops short. For a service whose orders never expire (`timeout: 0`), the
  lookup reads back to the datatoken's creation block when the RPC can prove it (the
  datatoken's code first appears there and the NFT factory logged its creation in it), so a
  first purchase no longer needs `orderOnLookupFailure: true` on a long chain.
- **No re-buy on a fast retry:** an order of the account in the last two blocks (not
  confirmed yet) makes the lookup `incomplete` (`OrderCheckError.limit: 'unconfirmed'`),
  not "not found"; a retry once the chain has mined two more blocks reuses it. A service
  whose timeout is 10 minutes or less now reuses an order with at least half its timeout
  left instead of buying anew every time.
- **No re-buy through a lagging RPC:** an RPC whose newest block is older than the order
  window is a failed lookup (`rpc-error`), not "not found".
- **A flood of `OrderReused` events** (anyone can send them, for gas) that the RPC refuses
  to return no longer makes every consumer's lookup `incomplete`: that range is read with
  the account's own `OrderStarted` events.
- **New field `OrderCheckError.limit`** (`'reads' | 'depth' | 'candidates' |
  'unconfirmed'`) for `incomplete`, so a program can tell a retryable stop from one that
  ends the same way without parsing the message.
- **Concurrent orders from one key:** an approval sets the allowance rather than adding to
  it, so concurrent `access()` calls for one paid asset each approved one price and two of
  three `buyFromFreAndOrder` calls reverted. Each (chain, payer, token, spender) allowance
  is now held from its approval until the order spending it is confirmed, process-wide.
- The pricing read no longer skips a fixed-rate exchange whose read was rate-limited or not
  answered (which could make a paid datatoken look free); the error is thrown.
