---
"@deltadao/nautilus": minor
---

Every transaction now goes through a nonce guard, so concurrent publishes and orders from one
key no longer collide, a stale nonce from the RPC is recovered from, and a failed send says
why instead of "ocean.js returned no transaction".

**What changes for you**

- **Concurrent calls from one key work.** `Promise.all` of publishes, edits and orders from
  one `Wallet` used to lose one of them to `REPLACEMENT_UNDERPRICED` or "nonce too low",
  reported only as `… failed: ocean.js returned no transaction`. `Nautilus.create` now wraps
  the signer in a nonce guard: for a locally signing signer (an ethers `Wallet`) it sends one
  transaction at a time per chain and address (only the broadcast, not the wait for mining),
  with the nonce `max(its own counter, the RPC's pending count)`, advancing the counter only
  after a successful broadcast.
- **Recovery from nonce refusals only** (`NONCE_EXPIRED`, `REPLACEMENT_UNDERPRICED`,
  "already known"), for a refused transaction that is provably the call's own: one the chain
  already has is waited for and never sent again; one it does not have is sent again with a
  fresh nonce, at most three times. An order, purchase, approval or escrow payment is sent
  again only with proof from two RPCs that the first can never be mined (the account's
  mined count past its nonce on both, read first; the hash unknown on both; and, in the
  blocks since the send on each RPC, another call of the account holding that nonce in a
  finalized block, not the same call to the same contract, which may be this one sped up
  or retried; nautilus does not wait for finality, so on a chain that finalizes in minutes
  a fresh collision stops), so never
  without a `verificationProvider`; otherwise it stops with the new **`NonceGuardError`**
  (`reason: 'may-have-been-sent'`). A timeout, network error or any other refusal is never
  retried; a resend that fails that way is a `NonceGuardError` too, keeping the earlier
  refused transactions in `attempts` (`attemptsComplete` says whether that list is whole).
- **The counter survives a lagging RPC.** A send takes the RPC's pending count instead only
  when the earliest transaction the pending count does not cover was dropped from the pool
  (sent over a minute ago, unknown on two reads, and the account not mined past its nonce),
  so a dropped transaction no longer leaves a gap that later ones wait behind for ever. A
  send that fails to fill the gap leaves it to the next send.
- **New options on `Nautilus.create`:** `nonceManagement: 'auto' | 'off'` (default `'auto'`;
  `'off'` never sets a nonce or resends) and `verificationProvider`, a second RPC on the
  same chain for the "never sent" proofs, recommended for paid flows; `create` checks its
  chain and refuses the signer's own provider (the same object or URL).
  Wallet-managed signers (`JsonRpcSigner`, browser wallets) keep choosing their nonces.
- **`getSigner()` returns the guarded signer**, not the object you passed in, so
  `getSigner() instanceof Wallet` is `false`. It signs through your signer.
- **Errors name the cause.** `confirmTransaction(operation, response, signer?, to?)` takes
  the signer and the contract the call went to and, when ocean.js returned no transaction,
  names that contract's recorded failure, with "It may have been sent" unless it was refused
  before the broadcast, and puts it on `cause` (the `NonceGuardError`, or a sanitised copy of
  the wallet's or RPC's error). With two sends to one contract on record (a broadcast until
  it is mined, a failure for a minute) it cannot tell which call failed, and keeps the
  generic message (also through ocean.js's confidential-chain wrapper, which shares the
  record). No error carries a raw signed transaction or the RPC's URL path any more:
  ethers' errors reach you with `<signed transaction 0x…hash>` in place of the signed bytes
  (also where the RPC echoes them), the RPC URL cut to its origin (its path may hold an API
  key), and the HTTP `request`, `response` and response body of a failed request dropped
  (an error that cannot be changed in place, frozen or with read-only fields, is thrown as
  a sanitised copy with its `name`, `code`, `reason`, hashes and redacted messages);
  the raw values go to the debug channel (`NAUTILUS_DEBUG=sensitive`, topic `nonce`), with
  the nonce reads and the guard's decisions.
- **A metadata transaction refused for its nonce** keeps its stored envelope unless it is
  proven never mined (hash unknown on two reads, the account past its nonce at each RPC's
  finalized block, and no metadata event with this `metadataHash` up to a block each RPC
  names): `cleanup: 'removed'` only then, else `'kept'`. A nonce taken only in blocks not
  yet finalized keeps the envelope, as a reorg could still mine the metadata transaction.
  `REPLACEMENT_UNDERPRICED` no longer counts as "never broadcast" by itself.
- **New log events:** `chain.nonce.resending`, `chain.nonce.already_sent`,
  `chain.nonce.gave_up`, `chain.nonce.counter_reset`, `chain.send.failed`,
  `publish.metadata.nonce_refused`, `node.indexer_nonce.zero_byte_accepted`.
- **One key per process.** The guard covers one process; two processes sending with one key
  can still collide.
- **The indexer-nonce preflight knows ocean-node 4.2.2.** `isIndexerNonceSignable(address,
  nonce, nodeVersion?)` and `getIndexerNonceState()` (new field `nodeVersion`, from
  `GET /`) no longer report a zero-byte nonce hash as stuck on a node of 4.2.2 or later,
  which accepts it, so `publish()` no longer refuses there; it logs
  `node.indexer_nonce.zero_byte_accepted` at `info` instead. Unknown or older versions keep
  the refusal. The version is self-reported and the fix is in the OE fork (`oe-ocean-node`):
  an upstream ocean-node with the same number would leave such an asset unindexed. New
  export `nodeAcceptsZeroByteNonce(version)`.
