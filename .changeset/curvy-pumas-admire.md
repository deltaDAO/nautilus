---
'@deltadao/nautilus': patch
---

Make published and edited assets indexable by OceanProtocolEnterprise ocean-node 4.2.x.

2.0.0-beta.0 stored the bare signed JWS and hashed its claims. ocean-node 4.2 expects a
JSON envelope and hashes that, so every asset went on chain and was never indexed. This
release stores the format the 4.2 node (and the enterprise market) uses, works with an
unmodified 4.2.x node, and is encrypted only: no plaintext pointer or envelope is ever
written, and the DDO never goes on chain.

**Breaking (beta API)**

- **`encrypt` is removed.** `PublishOptions.encrypt` is gone and `encrypt: false` throws:
  the `{ remote }` pointer and the stored envelope are always node-encrypted (flags `0x02`).
- **`waitForIndexer` throws instead of returning `undefined`, and its options are
  renamed.** It resolves to `AssetV5`, throws an `IndexingError` when the node records a
  failure for the transaction and an `OceanNodeError` on timeout or after repeated failed
  requests. `OceanNodeClient.waitForIndexer`'s `{ interval, maxRetries }` became
  `{ intervalMs, timeoutMs }` (default 7 s / 5 minutes). The old keys still work for now,
  mapped to `intervalMs = interval` and `timeoutMs = interval × maxRetries`, with a
  one-time `console.warn`; they will be removed.
- **`writeMetadata` is no longer exported.** Metadata is only written through
  `Nautilus.publish()`, `completePublish()` and `edit()`, which run every encrypted-only
  check first. `prepareMetadata` stays and returns redacted pointers.
- **`signS3Request` is not exported.** Unreleased builds of this change exported it; SigV4
  is an internal detail of `S3RemoteStore`.
- **`NodePersistentRemoteStore` is rejected as the DDO store.** ocean-node 4.2 cannot read
  a remote DDO from its own bucket storage. Use `IpfsRemoteStore` or `S3RemoteStore`.
- **The remote-store payload is now the envelope**, not the JWS:
  `{"encryptedData": node.encrypt({ encryptedData: hexlify(JSON.stringify(jws)) })}`. The
  on-chain metadata hash is `sha256` of exactly that string. Custom `RemoteStore`s must
  store it unchanged, and the pointer they return is validated: `type` must be `ipfs`,
  `url`, `s3`, `arweave` or `ftp`, and an IPFS `hash` must be a CIDv0 or CIDv1.
- **`PublishResponse.stored.pointer` (and `prepareMetadata`'s `pointer`/`stored`) is
  redacted**: an S3 `secretAccessKey`, `url` header values and URL passwords read
  `'<redacted>'`. `S3RemoteStore.remove()` works with the redacted pointer.
- **Plain `http://` is refused** for `oceanNodeUri`, the `S3RemoteStore` `endpoint` and the
  `IpfsRemoteStore` `uploadUrl`/`gatewayUrl`/`probe.url`, except on `localhost`,
  `127.0.0.1`, `::1` and `*.localhost`. Opt out with `allowInsecureTransport: true`
  (`Nautilus.create`, `S3RemoteStore`, `IpfsRemoteStore`). `S3RemoteStore.nodeEndpoint`
  may stay `http://` (e.g. `http://minio:9000`): only the node connects to it. The
  `OceanNodeClient` constructor enforces the same rule on `nodeUri` (an `OceanNodeError`,
  opt out with its own `allowInsecureTransport: true`), and so does `forEndpoint`, which
  carries the flag over.
- **`OceanNodeClient.getNodeAddress()` throws an `OceanNodeError`** on a network error,
  timeout, non-2xx status or a non-JSON body, instead of returning `undefined` for a non-2xx
  and rejecting with the raw error otherwise.
- **`Nautilus.create` refuses a `config.chainId` that differs from the signer's chain.**
- **`PublishedService.tx` is optional**: absent for a datatoken `completePublish()` reused.
- **`publish`, `completePublish` and `edit` check the node's indexer nonce** before their
  first transaction: they read `OceanNodeClient.getIndexerNonceState()` (two GETs, nothing
  signed) and throw the new `IndexerNonceStuckError` when the node would not accept its
  indexer's next decrypt call, so the asset would not be indexed. A node that does not
  answer is skipped; opt out with `PublishOptions.checkIndexerNonce: false`. They warn when
  this publish's own second decrypt call would use a nonce the node does not accept.
- **DDOs too large for the node to decrypt are refused.** The node accepts decrypt requests
  up to 100 KB, so the signed JWS may be at most about 24 000 characters.
  `publish`/`completePublish`/`edit` check from the DDO before the first transaction, and
  again from the exact request size before anything is encrypted or stored (4 KB margin).
- **Provider fees are signature-checked before ordering.** Before ordering, nautilus checks
  that the provider fee signature recovers to `providerFeeAddress` the way the datatoken
  contract verifies it (the `\n32` digest), since `startOrder`/`reuseOrder` revert
  otherwise. On a mismatch, `access()` and `compute()` ask the node for a new fee (up to 3
  times, a second apart); `order()`, `reuseOrder()` and `settleOrder` refuse such a fee.
  All throw the new `ProviderFeeSignatureError` before any approval or transaction. Compute
  fees and download fees of a `timeout: 0` service are the same on every request, so those
  are refused at once.
- **`waitForIndexer` polls every 7 s by default** (at most 18 requests a minute, under
  ocean-node's default `MAX_REQ_PER_MINUTE` of 30) and backs off on `429` or `403` "Too many
  active connections", honouring "Try again in N seconds" or `Retry-After`, up to 60 s,
  instead of counting it as a failed lookup.
- **The same-block guard changed.** `edit()` no longer waits for this instance's previous
  metadata change to be indexed; see `MetadataConflictError` below.
- **nautilus now calls a store's `remove()` itself**, in one case only: `publish`,
  `completePublish` or `edit` stored the envelope and then failed before the metadata
  transaction was sent (a failed `verify()`, pointer encryption or transaction build).
  Nothing points at that object, so it is removed, best effort. Never once the transaction
  may have been sent.
- **A `DdoSigner`'s output is checked**: the returned JWS must decode, and its payload (`vc`
  unwrapped, as the node does) must carry the validated DDO's `id` and `version`.

**New**

- **`RemoteStore.verify?(pointer, expectedHash)`**, called right before `setMetaData` by
  `publish`, `completePublish` and `edit`: it reads the stored object back and checks
  `"0x" + sha256(JSON.stringify(JSON.parse(body)))`, exactly as the node does, so a store
  that alters bytes or a key the node cannot read with now fails before the transaction.
  `S3RemoteStore` verifies with the read key; `IpfsRemoteStore` does when its new
  `gatewayUrl` option is set.
- **New optional `RemoteStore.check()`** (run before the first transaction of `publish`,
  `completePublish` and `edit`) and **`RemoteStore.remove(pointer)`**.
- **New `S3RemoteStore`** for AWS S3, Exoscale SOS or MinIO, with no AWS SDK dependency
  (SigV4 over `fetch` and WebCrypto). It uploads with a write key and puts a separate
  read-only key into the node-encrypted pointer. `check()` uses a random probe key, reads
  it back with the read key, refuses a read key that can PUT or DELETE (only an explicit
  403 `AccessDenied` counts as "cannot"; `allowWritableReadKey` turns that into a warning),
  and never lets a failed cleanup hide the first error. `allowSharedCredentials` now warns
  once that the write key ends up in every on-chain pointer. Keys and `prefix` with `.`/`..`
  or empty segments, a leading `/` or a backslash are refused, `remove()` only deletes under
  `prefix` in the configured bucket, virtual-host addressing on an IP or `localhost`
  endpoint is refused with a hint to set `forcePathStyle: true` (also for `nodeEndpoint`),
  network errors carry method, bucket, key and role, and every request has a timeout
  (`requestTimeoutMs`, default 30 s).
- **`IpfsRemoteStore`**: works with Pinata's `pinFileToIPFS`; `probe` (`'upload'` or
  `{ url, method?, headers? }`) catches a bad key before anything is minted, and the upload
  headers only go to a probe URL on the upload origin unless `probe.headers` is given;
  `gatewayUrl` enables `verify()`; error bodies are cut to 300 characters and scrubbed of
  tokens; returned CIDs are validated; `requestTimeoutMs` (default 60 s).
- **Encrypted-only guards against the known plaintext.** Every ciphertext the node returns
  (envelope and pointer) must be at least plaintext + 97 bytes (ECIES on ocean-node 4.2) and
  must not contain the plaintext as UTF-8, hex, base64 or a JSON string, with any prefix or
  suffix. The envelope is checked before it reaches the store.
- **`encrypt` now rejects non-ciphertext node responses.** ocean.js returns the body of a
  failed encrypt call as if it were ciphertext, so a node error (e.g. 401 `nonce: 1 is not
  a valid nonce`) could be stored as a service's encrypted `files`. `OceanNodeClient.encrypt`
  now throws an `OceanNodeError` with the node's message unless it gets `0x` hex, retries
  once on a nonce rejection when it signs with a `Signer`, and runs a `Signer`'s encrypt
  calls one at a time per client (a multi-service publish encrypted them concurrently, so
  they reused a nonce).
- **`completePublish` checks before any transaction** that the signer owns the NFT, that
  the configured ERC721 factory created it and that every datatoken a service names
  belongs to it. It reuses the NFT's datatokens (the one bundled at mint and those from
  `PublishIncompleteError.datatokens`) for services without one, prices a reused datatoken
  whose pricing failed, creates only the missing ones, and lists every service.
- **A datatoken is recorded before its pricing**, so `PublishIncompleteError.datatokens`
  includes one whose pricing failed.
- **Results survive a failed wait.** When the metadata transaction was mined but
  `waitForIndexer` fails or times out, the thrown error carries the full `PublishResponse`
  as `error.published` (type `PublishedNotIndexed`), for `publish`, `completePublish` and
  `edit`.
- **`MetadataConflictError`**: after the receipt, nautilus checks the block for another
  `MetadataCreated`/`MetadataUpdated` of the same NFT and throws (with `published`,
  `conflictingTxIds`, `indexedFirst`), because the node indexes only the first. Within one
  instance, publish, edit and lifecycle calls for one NFT are serialized.
- **`waitForIndexer`** also takes `requestTimeoutMs` (default 15 s) and
  `maxConsecutiveFailures` (default 5), rejects with the `signal`'s reason on abort, and
  names the last request error in the timeout message. `publish`/`edit` accept
  `waitForIndexer: { intervalMs, timeoutMs }`.
- **`OceanNodeClient.getIndexingState({ did } | { txId } | { nft })`** reads the node's
  record (checksummed `nft`, lower-case `txId`, validated response), and
  **`OceanNodeClient.getNodeAddress()`** reads the node's `providerAddress`. `publish`,
  `completePublish` and `edit` warn once when the publisher is the node's own key, which
  makes the indexer's decrypt fail with 401.
- **Metadata is only written where the node can index it.** `publish`/`completePublish`/
  `edit` refuse a DEPRECATED or REVOKED_BY_PUBLISHER asset, the DDO id must be the NFT's
  DID, and the node named on chain must be the node that encrypted.
- **`IpfsRemoteStore.remove(pointer)`** unpins a CID: `DELETE /pinning/unpin/<cid>` on
  Pinata and `POST /api/v0/pin/rm?arg=<cid>` on Kubo, derived from `uploadUrl`, or any service
  through the new `unpin: { url, method?, headers? }` option (`{cid}` placeholder, `https://`
  rule as for the other URLs, upload headers only to the upload origin). A CID that is not
  pinned counts as removed. The examples gained `store:remove <cid|objectKey>`.
- **`error.stored`** (type `StoredBeforeFailure`, also `PublishIncompleteError.stored`): when a
  write fails after the envelope was stored, the redacted pointer, the hash and
  `cleanup: 'removed' | 'not-removed' | 'kept'`. `'kept'` means the metadata transaction was
  sent and may be mined; `PublishIncompleteError` then no longer claims the NFT has no
  metadata. `PublishIncompleteError.cause` is the native `Error.cause`.
- **Hardening:** the store's pointer is validated and encrypted as one plain snapshot (an
  inherited `type` or a getter can no longer pass the check and serialize differently); an
  unreadable on-chain metadata state now throws instead of reading as ACTIVE; `S3RemoteStore`
  retries a network error or a 500/502/503/504 once, freshly signed; ocean.js's `null`
  transaction result is reported as "rejected, or sent and then reverted or timed out", not as
  "not submitted".
- **Docs:** browser use (CORS for S3 buckets, MinIO and Kubo, and why write keys must not ship
  in a web app), cleaning up superseded and revoked versions, and why node encryption is not
  access control on a default 4.2 node (`AUTHORIZED_DECRYPTERS`).
- **Docs: keep the creation envelope.** A node reindex replays an asset from its creation
  event, so removing the envelope `publish()` stored drops the asset from the index. The
  remote-stores guide, the `remove()` docs and the examples' `store:remove` (which now
  refuses a creation or latest envelope listed in `PUBLISH_LOG` unless given `force`) say
  so.
- **`PublishResponse.stored`** (`{ pointer, metadataHash }`, pointer redacted) records where
  the envelope went and the hash written on chain, so callers can verify or clean up.
  `PublishedService.reused` marks a datatoken `completePublish()` reused.
- **`setAssetLifecycleState` waits for the receipt.** The underlying `setMetadataState`
  resolved before the transaction was mined; it now resolves with the receipt and throws
  when the transaction was not submitted or reverted.
- **`OceanNodeClient.getIndexerNonceState()`** (`{ nodeAddress, storedNonce, nextNonce,
  stuck }`, two GETs, nothing signed) and **`isIndexerNonceSignable(nodeAddress, nonce)`**
  report whether the node will accept its indexer's next decrypt call.
- **`IndexingError` messages carry a hint** when the node's decrypt call during indexing
  failed: a 401 (with a pointer to `getIndexerNonceState()`), a 413 from the 100 KB decrypt
  limit, a 429/403 rate-limit answer, and the "invalid codepoint" decoding error the node
  records when that decrypt call did not succeed.
- **Clearer edit error:** editing a loaded service's `serviceEndpoint` without adding its
  files again now explains that files are encrypted for the node in the endpoint, so both
  must change together.
- **New exported types:** `FailedWithStoredObject`, `StoredBeforeFailure`,
  `PublishedNotIndexed`, `IndexerNonceState`, `IndexingState`, `IndexingStateQuery`,
  `WaitForIndexerOptions`.
- **No more orphaned NFTs without a way back.** A failure after the NFT is minted throws a
  `PublishIncompleteError` with `nftAddress` and `datatokens`; `completePublish(nftAddress,
  asset)` finishes the publish on that NFT. `edit()` runs the store check before minting a
  datatoken.
