---
"@deltadao/nautilus": minor
---

A sensitive debug channel, off by default, shows the raw data nautilus redacts, so a failure
the redacted error does not explain can be diagnosed without out-of-band queries.

**What changes for you**

- **`Nautilus.setDebug({ level, topics?, sink? })`, or `NAUTILUS_DEBUG`.** `level` is `'off'`
  (the default), `'sensitive'` (raw node, wallet, verifier and RPC answers, policy-server
  session ids and redirect URIs, the verifier's per-policy results with their full errors,
  request payloads with signatures and nonces, raw signed transactions, presented VP/VC
  JWTs, storage pointers without their credentials) or `'secrets'` (also the RPC URL's token,
  S3 secret keys, IPFS JWTs and `Authorization` headers). `topics` narrows it to `node`,
  `wallet`, `policy`, `rpc`, `order`, `nonce`, `store` or `compute`. In Node,
  `NAUTILUS_DEBUG=sensitive|secrets` and `NAUTILUS_DEBUG_TOPICS=policy,wallet` do the same
  without a code change; they are read once at import, and `setDebug` overrides them.
  `secrets` is reached only by naming it. In `NAUTILUS_DEBUG_TOPICS` an unknown topic is
  ignored with a `config.env.invalid` warning, and a list of unknown topics turns on none;
  `setDebug` throws a `TypeError` for an unknown level or topic. `sensitive`
  hides long-lived credentials best effort, by name and shape (any key or URL parameter
  ending in `token`, `key`, `secret`, `password`, `auth`, `cookie`, `jwt`, `credential(s)`,
  drpc's `dkey`, …, except session-scoped ones such as `vp_token`, `state`, `sessionId`,
  `nonce`, `signature`); scan its output before sharing it. New exported types: `DebugEvent`, `DebugTopic`,
  `DebugOptions`, `DebugLevel`, `DebugTier`, `DebugSink`.
- **One line per event**, on stderr (in a browser, the console), prefixed `[nautilus:debug:sensitive]` or
  `[nautilus:debug:SECRETS]` and the topic; line breaks and control characters in the data
  are written as JSON escapes. After masking, a string is cut at 32,768 characters and an
  event at about 256 K; a string longer than 65,536 characters (or past the event's budget)
  is read only up to the last word before that point, so masking never sees part of a
  credential. A cut string ends in `…(cut: N of M characters shown)`. A `sink` receives
  `{ time, tier, topic, message, opId?, operation?, data }` instead.
- **A warning when it is turned on**, once per tier, on stderr, whatever the log level or
  sink; stronger under `NODE_ENV=production`.
- **Errors, return values and log events do not change.** They stay exactly as redacted as
  with the channel off; the raw values go to this channel only. A rejected presentation's
  per-policy results are shown in the channel (e.g. `holder-binding: failed
  (java.lang.NullPointerException)`).
- **The signer's private key or mnemonic is never printed**, at any tier: nautilus never
  holds them.

**Also fixed**

- **Wallet errors no longer carry the policy-server session id.** A `WaltIdWalletError`
  carries the wallet's answer with credentials redacted, URLs reduced to their origin, at
  most 500 characters; the raw answer goes to the debug channel (topic `wallet`). For a
  refused presentation, see the `CredentialPresentationError` entry.
- **Raw signed transactions are redacted** in error texts, warnings and log events. ethers
  quotes the signed transaction of a failed `eth_sendRawTransaction` in its error message
  (`transaction="0x02f8…"`); one that was never mined (e.g. `INSUFFICIENT_FUNDS`) can still
  be sent by whoever reads the log.
- **More credentials are redacted in error texts, warnings and log events:** a URL whose
  slashes are JSON-escaped (`https:\/\/host\/v3\/<key>`, as a JSON body quoted in JSON has
  it) is reduced to its origin like any other, and a `Cookie` header is redacted to the end
  of its line, every cookie of it.
