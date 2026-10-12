---
"@deltadao/nautilus": minor
---

`access()` no longer buys a paid service a second time, silently, when the RPC fails to
look up the order the account may already hold, or the lookup cannot read back over the
whole order window.

**Breaking (beta API)**

- **`access()` throws an `OrderCheckError` instead of ordering anew** when the previous-order
  lookup fails (an RPC rate limit, no answer, or an RPC error) or stops short (it reached
  its depth of 100,000 blocks, its rounds of reads (as many as the window needs at 100
  blocks each, at least 100), its 5 minutes or its 50 candidates before the end of the
  service's timeout), not when it finds no order, and the service costs anything (a
  price, a publish-market fee or a provider fee). It is thrown
  before any approval, purchase or order: nothing was paid, and the call can be retried.
  Before, any lookup error was logged and a new order placed, which pays twice when the
  account already holds a valid order. `settleOrder()` does the same when given `service`.
  The message says what happened, why it stopped (it could have paid twice, with the
  price), that nothing was paid, the cause in plain words, and what to do.
- **The lookup no longer takes a rate limit for a range refusal.** In 2.0.0-beta.2 a 429
  (also after ethers' retries), a `Retry-After`, a rate-limit `-32005` or "too many
  requests" was read as a refused range: the lookup halved its block range until its 100
  reads ran out, then reported "not found", and `access()` placed a new order. It now fails
  the lookup (`reason: 'rate-limited'`).
- **An RPC that serves few blocks per `eth_getLogs` call no longer buys unchecked.** In
  2.0.0-beta.2 the lookup stopped after 100 reads wherever it was and reported "not found",
  so on a narrow RPC an order more than a few hours old was not seen and a second one was
  placed. The lookup now narrows a refused range to 1,000, 500, 200 and 100 blocks (and
  below), keeps the size that works, does not count refused ranges as reads, and reads as
  many rounds as the window needs at 100 blocks each (at least 100) for at most 5 minutes,
  which also bound each wait for the RPC: a call it does not answer in time ends the lookup
  at the 5 minutes, not when its answer comes. When the reads end before they cover the service's timeout, it throws `OrderCheckError`
  (`'incomplete'`) before anything is paid.
- **Keep paid timeouts within what the check can read:** at most 24 hours on an RPC that
  serves 100 blocks per `eth_getLogs` call, up to about 55 hours (48 recommended) on one
  that serves 1,000 blocks or more.
- **An RPC answer without the data its own answers promise is a failed lookup, not "no
  order".** No newest block, no receipt for an order transaction the RPC's logs list (or
  for the order a reuse of the account names), or a receipt without that order's event,
  as a load-balanced RPC whose backends lag each other answers for a recent order, gave
  "not found" and a second order. It now fails the lookup (`reason: 'rpc-error'`, "the
  RPC's answer lacked data the check needs"). Orders of another service, past the timeout
  or of another account are still skipped.
- **A paid service throws `OrderCheckError` (`'incomplete'`) when no order is found in the
  blocks read but they do not cover its timeout**: orders that never expire (`timeout: 0`),
  a timeout longer than the 100,000-block depth (about 55 hours on OP Sepolia), reads that
  end first (an RPC that serves fewer than 100 blocks per call, or answers too slowly for
  the 5 minutes or not at all), or 50 candidates checked without one to reuse or extend, since an older order may
  still be in force. If the account never bought it, pass `orderOnLookupFailure: true`.

**What changes for you**

- **`OrderCheckError`** (exported): `code: 'ORDER_CHECK_FAILED'`, `reason`
  (`'rate-limited'`, `'unreachable'`, `'incomplete'` or `'rpc-error'`), `retryable: true`,
  `did`, `serviceId`, `consumer`, `price` (`{ amount, symbol }`, in whole tokens;
  `undefined` when the pricing could not be read either), `costs` (every part a new order
  pays: price, publish-market fee, provider fee), `checkedHours` and `windowHours` (for
  `incomplete`; `windowHours` is `Infinity` for orders that never expire), and `cause`, the RPC's error
  redacted (first line, no URL, long hex shortened, at most 200 characters). The unredacted
  error goes to the debug channel (`NAUTILUS_DEBUG=sensitive`, topic `order`).
- **`access({ orderOnLookupFailure: true })`** (also on `settleOrder()`) orders anyway, with a
  warning that it may pay twice. Only `true` opts in. When the price cannot be read either,
  nothing can be bought and `OrderCheckError` is thrown regardless.
- **A free service** is still ordered when the lookup fails, now with one visible, redacted
  warning (`access.order.lookup_failed`, with `reason` and `free` fields), since a second
  order costs only gas. "No previous order found" orders as before, with no warning.
- **`compute()` is unchanged:** it makes no previous-order lookup on chain, so it does not
  throw `OrderCheckError` and has no `orderOnLookupFailure` option. (It sends the node no
  `transferTxId`, so the node reports no valid order and each paid input is bought on every
  job; that known limitation is not changed here.)

**Migrate:** catch `OrderCheckError` where you call `access()`, show its message (it names
the cost, the cause and what to do) and retry later or with another RPC. Don't retry with
`orderOnLookupFailure: true` on your own right after catching it: that is the second
payment this change prevents. Offer it to the user, who knows whether the account already
holds an order, and pass it only on their decision.
