---
"@deltadao/nautilus": minor
---

Warnings are printed once per subject, node text in them is cleaned and shortened, and
ocean.js no longer prints "No config found" during an order.

**What changes for you**

- **The policy-server warning names the node and the asset, and is printed once for each
  pair.** `publish.preflight.denies_all` warns when a node's policy server would refuse every
  consumer, because the asset has no address allow list. It now warns for each node that has
  a policy server, the configured one and each service's `serviceEndpoint` (an endpoint with
  a trailing slash is the same node). Before, it stopped at the first. It is printed once per
  node and asset. The asset is its DID on an edit and in `completePublish`, which has the
  NFT; the event carries `did`. Before the mint there is no DID, so the key is the
  publisher's address and the asset's name: new assets of one publisher with the same name
  warn once per node, and the event carries `name`. Publishing or editing the same asset
  again no longer repeats the warning; publishing it and then editing it warns once for
  each.
- **Other warnings are printed once where repeating them adds nothing:**
  - `publish.preflight.indexer_nonce_will_stick`: once per node and nonce.
  - `compute.result.unavailable`: once per node, job and reason (the node does not know
    the job; the job has no `output`), however often `getComputeResult` is polled.
    `compute.result.not_ready` is unchanged.
  - `compute.duration.capped`: once per node, environment, requested duration and limit.

  These stay printed every time, because each one is a new failure:
  `publish.preflight.pending_unreadable`, `publish.metadata.events_unchecked` and
  `access.order.lookup_failed`. A logger remembers the last 1,000 keys; a key longer than
  256 characters is remembered by its hash.
- **A compute job's status text and result list are cleaned before they appear** in the
  `compute.result.unavailable` warning and in the errors `streamComputeResult` and
  `getComputeLogs` throw. Control characters and ANSI escapes are removed from each result
  entry, URLs keep only their origin, credentials are redacted, the status is cut at 200
  characters and the result list at 1,000; a cut list says how many results there are and
  that `getComputeStatus()` lists them all. Before, the list was put in as the node sent it,
  at any length. With the debug channel on, the full list goes to the `compute` topic.
- **Node text is redacted in bounded time, and a backslash no longer ends a URL.** The
  redaction of a node's text, an error or a log message reads only the start of a long
  text: 8,192 characters, or eight times the length it is cut to when that is more. The word
  that cut splits is dropped, so a cut JWT or URL never shows in part; a URL the cut goes
  through is dropped whole, so its user info (`https://user:secret,…@host`) is never read as
  its host. A URL whose authority is no host and port (a quote or a space in its password
  ended it) reads `scheme://<redacted>`. A URL with a backslash in its path
  (`https://host/x\y/v3/<key>`) now keeps only its origin in messages, and its path token is
  masked in the `sensitive` debug tier as well; before, the text after the backslash was
  printed. So does a URL with a BOM or a zero-width character in its path (the token after
  it used to be printed), and a URL without a scheme on an IP address, `localhost` or an
  IPv6 address in brackets (`127.0.0.1:8545/v3/<key>` reads `127.0.0.1:8545`).
- **No more `No config found for given network 'undefined'`.** The `FixedRateExchange` and
  `Dispenser` that nautilus builds for orders, prices and `editPrice` now get the chain id and
  the chain config, as the datatoken and the NFT already did. ocean.js used to print the line
  at its default level, twice per fixed-price order. Those contracts' transactions now also
  use the config's `gasFeeMultiplier`, and on an `sdk: 'oasis'` chain the wrapped signer.
  `getDatatokenBalance(signer, datatokenAddress, config?)` takes the chain config as an
  optional third argument. Without it, the chain id is read from the signer, and so does
  `getPricingInfo(signer, datatokenAddress)` without its config.
- **A node's reason ends in one period.** `PolicyDeniedError`, `PublishIncompleteError` and
  `waitForIndexer`'s timeout no longer read `…at asset level..` when the node's text already
  ends in `.`, `!`, `?` or `…`. A period is still added when it ends in none of these.
