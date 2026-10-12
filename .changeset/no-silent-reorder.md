---
"@deltadao/nautilus": minor
---

`access()` no longer buys a paid service a second time, silently, when the RPC fails to
look up the order the account may already hold, or the lookup cannot read back over the
whole order window.

**Breaking (beta API)**

- **`access()` throws an `OrderCheckError` instead of ordering anew** when the previous-order
  lookup fails (an RPC rate limit, no answer, or an RPC error) or stops short (it reached
  its 100 000-block depth, its 100 rounds of reads or its 50 candidates before the end of
  the service's timeout), not when it finds no order, and the service costs anything (a
  price, a publish-market fee or a provider fee). It is thrown
  before any approval, purchase or order: nothing was paid, and the call can be retried.
  Before, any lookup error was logged and a new order placed, which pays twice when the
  account already holds a valid order. `settleOrder()` does the same when given `service`.
  The message says what happened, why it stopped (it could have paid twice, with the
  price), that nothing was paid, the cause in plain words, and what to do.
- **The lookup no longer takes a rate limit for a range refusal.** A 429 (also after
  ethers' retries), a `Retry-After`, a rate-limit `-32005` or "too many requests" ended in
  halving the block range until the reads ran out, then "not found" and a new order. It
  now fails the lookup (`reason: 'rate-limited'`).
- **An RPC answer without the data its own answers promise is a failed lookup, not "no
  order".** No newest block, no receipt for an order transaction the RPC's logs list (or
  for the order a reuse of the account names), or a receipt without one of the order events
  those logs list, as a load-balanced RPC whose backends lag each other answers for a
  recent order, gave "not found" and a second order. It now fails the lookup (`reason:
  'rpc-error'`, "the RPC's answer lacked data the check needs"). Orders of another
  service, past the timeout or of another account are still skipped.
- **A paid service whose orders never expire (`timeout: 0`), or whose timeout is longer
  than 100 000 blocks (about 55 hours on OP Sepolia), throws `OrderCheckError`
  (`'incomplete'`) when no order is found in the blocks read**, since an older order may
  still be in force. If the account never bought it, pass `orderOnLookupFailure: true`.

**What changes for you**

- **`OrderCheckError`** (exported): `code: 'ORDER_CHECK_FAILED'`, `reason`
  (`'rate-limited'`, `'unreachable'`, `'incomplete'` or `'rpc-error'`), `retryable: true`,
  `did`, `serviceId`, `consumer`, `price` (`{ amount, symbol }`, in whole tokens;
  `undefined` when the pricing could not be read either), `costs` (every part a new order
  pays: price, publish-market fee, provider fee), `checkedHours` and `windowHours` (for
  `incomplete`; `windowHours` is `Infinity` for orders that never expire), and `cause`, the
  RPC's error redacted (first line, `\u00XX` escapes undone so that an escaped key is
  redacted too, no URL, long hex shortened, at most 200 characters). The unredacted
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
