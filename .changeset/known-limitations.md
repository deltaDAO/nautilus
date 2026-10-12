---
"@deltadao/nautilus": patch
---

Credentials hidden by escaping in an RPC's answer are redacted, and the known limits of this
release are documented on one page.

**What changes for you**

- **Credentials under escaping in an RPC's answer are redacted in errors and log lines.**
  When an RPC answers with an error, ethers quotes its answer in the error message, and each
  level of quoting escapes it again. A credential the answer carried as a JSON field (a
  `pinataGatewayToken`, an `apiToken` in a body quoted inside JSON, a field written with
  `\u0022` or `\'` quotes) or percent-encoded (`apiToken%3D…`, an encoded JSON field, an
  encoded RPC URL) reached the `error` field of a log event, an operation's
  `…operation.failed` event, an `OceanNodeError` and the message of a failed send, because
  the redaction did not look under the escapes. It now reads the text with up to eight levels
  of JSON escaping and percent-encoding undone, and flattens deeper JSON escaping and
  percent-encoding of any depth (also mixed, and chains where undoing one escape makes the
  next, such as `\u005cu005c…u003d`) for one more read, and redacts what it finds
  there. Text that hides nothing keeps its escapes. The raw value is still in the debug
  channel: at `NAUTILUS_DEBUG=secrets`, not at `sensitive`, which now reads the same escapes,
  JSON-escaped URLs included.
- **A download URL can be replaced by a newer one.** The URL `access()` returns carries a
  one-time number the node checks. Two URLs requested for the same consumer and node before
  either is fetched carry the same number: the first one fetched works, and the other answers
  HTTP 401 `nonce: … is not a valid nonce`. nautilus does not fetch the URL, so it cannot
  change that answer. Fetch each URL before you request the next one; after such a 401, call
  `access()` again and fetch the new URL right away (for a paid service, only once at least
  2 more blocks are mined after the purchase: sooner, `access()` does not find the order yet
  and pays again). The `access()` docs and the download guide say so.
- **Known limitations page.** [Known limitations](https://nautilus.delta-dao.com/docs/known-limitations)
  lists what this release does not handle yet, each with what to do instead: the credential
  type alone is not a reliable gate (enforce trust with trusted issuers and an explicit
  address allow list), one download URL at a time, buying the same service in parallel from
  one key, a second `access()` right after buying a paid service (wait until at least 2 more
  blocks are mined after the purchase, or it pays again; a lagging RPC extends that wait),
  every `compute()` buying its paid datasets and algorithms again (price compute services as
  free, or expect one purchase per job), orders older than about 55 hours (less on an RPC
that serves 100 blocks per `eth_getLogs` call: keep paid services at 24 hours or less
there), a stuck fee
  approval, `getAssets` on ocean-node 4.2, and revoking after deprecating.
