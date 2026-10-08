# @deltadao/nautilus

## 2.0.0-beta.1

### Patch Changes

- [#201](https://github.com/deltaDAO/nautilus/pull/201) [`d6894bf`](https://github.com/deltaDAO/nautilus/commit/d6894bfb27df45918e49f29720c021487df4df10) Thanks [@Abrom8](https://github.com/Abrom8)! - Pay a node's provider fee and compute escrow payment only with the caller's consent, and
  fund only the escrow contract pinned for the chain: the chain's `EnterpriseEscrow` by
  default.
  
  The node chooses the provider fee of a download or compute input (its token, its amount
  and who receives it). For a download that node is the service's `serviceEndpoint`, which
  the publisher chooses, and the fee signature check only proves the node signed the fee.
  For a paid compute job the node also names the escrow contract and the amount to lock.
  nautilus approved and paid what the node quoted, and funded escrow through ocean.js's
  `verifyFundsForEscrowPayment`, which approves the escrow contract for an amount scaled by
  the token's decimals a second time.
  
  **Breaking (beta API)**
  
  - **A non-zero provider fee needs consent.** `access()`, `compute()`, `order()`,
    `reuseOrder()` and `settleOrder()` pay one only within `maxProviderFee` (per token, in
    the token's smallest unit; a compute job's fees are summed per token) or when
    `confirmProviderFees(fees)` returns `true`. Otherwise they throw a
    `ProviderFeeNotAllowedError` (`fees`, `reason`) before any approval, purchase, escrow
    or order. A zero fee needs nothing.
  - **A paid compute job needs consent for its escrow payment**: within `maxEscrowPayment`
    or when `confirmEscrowPayment(payment)` returns `true`, or an
    `EscrowPaymentNotAllowedError` (`payment`, `reason`) is thrown before anything is sent.
    A zero payment needs nothing: its amount is read first, and a zero amount funds nothing
    and is not checked further, so it may name no escrow contract. A malformed amount is
    still refused.
  - **Exactly one escrow contract is funded, `EnterpriseEscrow` first**:
    1. `config.escrow`, when the caller passes it to `Nautilus.create`: that contract, and no
       other;
    2. otherwise the chain's `EnterpriseEscrow` in Ocean's address data (ocean.js's bundled
       addresses, or `ADDRESS_FILE` when set), the contract ocean-node 4.2.0 uses where the
       chain has one (OP Sepolia, Optimism, Sepolia, Ethereum mainnet);
    3. otherwise the chain's `Escrow`.
  
    The `escrow` ocean.js's `ConfigHelper` fills in (the address data's plain `Escrow`) is not
    a caller's choice and is not used, so on OP Sepolia the plain `Escrow` is refused unless
    set explicitly. A quote naming any other contract, another chain, token or payee, or an
    inexact amount, is refused (`EscrowPaymentNotAllowedError`, its message naming the
    expected contract and the rule that chose it), and no callback overrides it. On a chain
    with no escrow in the address data (Pontus-X devnet among them), paid compute is refused
    until `config.escrow` is set to the chain's EnterpriseEscrow contract. A malformed
    `config.escrow` fails `Nautilus.create`. The standalone `compute(config, context)` takes
    the explicit choice as `context.escrow`, and does not read `context.chainConfig.escrow`.
  - **Escrow is funded in exact amounts.** nautilus approves the escrow contract for the
    deposit only, deposits what escrow lacks for the job, and authorises the environment's
    account to lock the job's amount on top of its current locks, leaving a standing
    allowance or authorisation that already covers the job alone. A wallet that cannot cover
    the deposit is refused before any transaction.
  - **Every input is checked before escrow is funded.** `compute()` reads each input's
    pricing and refuses one that cannot be ordered before the escrow approval, deposit or
    authorisation, so every refusal comes before the first transaction.
  - **Paid jobs are serialised per payer within an instance.** A `Nautilus` instance runs
    the escrow reads, deposit, authorisation, orders and `computeStart` of jobs that share a
    chain, payer, payment token and environment account one at a time, so concurrent
    `compute()` calls do not overwrite each other's escrow authorisation. Jobs from other
    instances or processes are not covered. The standalone `compute(config, context)`
    serialises when given a lock as `context.escrowLock`.
  
  **Migration**
  
  Set the most you are prepared to pay, once for the instance or per call:
  
  ```ts
  const nautilus = await Nautilus.create(signer, {
    config,
    maxProviderFee: { token: feeToken, amount: parseUnits('0.5', 18) },
    maxEscrowPayment: { token: paymentToken, amount: parseUnits('5', 18) }
  })
  ```
  
  The instance defaults come in pairs, `maxProviderFee` with `confirmProviderFees` and
  `maxEscrowPayment` with `confirmEscrowPayment`: a call that sets either option of a pair,
  even to `undefined`, uses its own pair and neither default of it, so a tighter per-call
  ceiling never falls back to a permissive default callback. An app that asks its user can
  pass `confirmProviderFees` / `confirmEscrowPayment` instead, or as well: they are asked
  only for what the ceiling does not cover. `Nautilus.create` refuses a malformed ceiling.
  
  **New**
  
  - `TokenAmount`, `ProviderFeeQuote`, `EscrowPaymentQuote`, `ProviderFeeLimits`,
    `EscrowPaymentLimits`, `ProviderFeeNotAllowedError` and `EscrowPaymentNotAllowedError`
    are exported, and so are the `OrderRequest` and `OrderResult` types.

- [#200](https://github.com/deltaDAO/nautilus/pull/200) [`de1f1ff`](https://github.com/deltaDAO/nautilus/commit/de1f1ffbac6a7847dbdad807b0f28ccdbc104240) Thanks [@Abrom8](https://github.com/Abrom8)! - Make published and edited assets indexable by OceanProtocolEnterprise ocean-node 4.2.x.
  
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
    mapped to `intervalMs = interval` and `timeoutMs = interval × maxRetries` (`maxRetries`
    alone: beta.0's 30 s × `maxRetries`, still polled every 7 s), with a one-time
    `console.warn`; they will be removed. A negative or non-finite timing option (e.g.
    `timeoutMs: Infinity`) throws an `OceanNodeError`.
  - **`writeMetadata` is no longer exported.** Metadata is only written through
    `Nautilus.publish()`, `completePublish()` and `edit()`, which run every encrypted-only
    check first. `prepareMetadata` stays and returns redacted pointers.
  - **`prepareMetadata` stores the envelope.** Its `encrypt` parameter is removed
    (`encrypt: false` throws). It stores the node-encrypted envelope instead of the bare JWS,
    its `metadataHash` is `0x` + sha256 of that envelope instead of the JWS claims, and
    `flags` is always `0x02`. `WrittenMetadata` gained `stored` (the redacted store pointer
    and the envelope hash) and `encryptedBy` (the URI of the node that encrypted it).
  - **`signS3Request` is not exported.** Unreleased builds of this change exported it; SigV4
    is an internal detail of `S3RemoteStore`, and it now refuses URLs with a query string.
  - **`NodePersistentRemoteStore` is rejected as the DDO store.** ocean-node 4.2 cannot read
    a remote DDO from its own bucket storage. Use `IpfsRemoteStore` or `S3RemoteStore`.
  - **The remote-store payload is now the envelope**, not the JWS:
    `{"encryptedData": node.encrypt({ encryptedData: hexlify(JSON.stringify(jws)) })}`. The
    on-chain metadata hash is `sha256` of exactly that string. Custom `RemoteStore`s must
    store it unchanged, and the pointer they return is validated: `type` must be `ipfs`,
    `url`, `s3`, `arweave` or `ftp`, with the fields the node needs for that type (an IPFS
    CIDv0/CIDv1 `hash`; an absolute http(s) `url` and GET/POST `method`; the five non-empty
    `s3Access` strings; an Arweave `transactionId` that is not a URL or path; an
    `ftp://`/`ftps://` `url`).
  - **`PublishResponse.stored.pointer` (and `prepareMetadata`'s `pointer`/`stored`) is
    redacted**: an S3 `secretAccessKey`, `url` header values, and a URL's user name,
    password, every query value (parameter names stay) and fragment read `'<redacted>'`. `S3RemoteStore.remove()` works with the redacted pointer.
  - **Plain `http://` is refused** for `oceanNodeUri`, the `S3RemoteStore` `endpoint` and the
    `IpfsRemoteStore` `uploadUrl`/`gatewayUrl`/`probe.url`/`unpin.url`, except on
    `localhost`, `127.0.0.0/8`, `::1` and `*.localhost`. Opt out with
    `allowInsecureTransport: true` (`Nautilus.create`, `S3RemoteStore`, `IpfsRemoteStore`).
    URLs are judged as `fetch` parses them: `http:host`, `http:/host`, `http:\\host` and
    similar spellings are plain `http://`, and a URL containing a tab, CR, LF or another
    control character is refused. A URL with a scheme other than `http:`/`https:` throws,
    and so does a scheme-less `host:port`, which parses as a scheme (peer ids and multiaddrs
    are unaffected); only the `S3RemoteStore` `endpoint` takes a bare host, meaning
    `https://`. `S3RemoteStore.nodeEndpoint` may stay `http://` (e.g. `http://minio:9000`):
    only the node connects to it. The `OceanNodeClient` constructor enforces the same rule on
    `nodeUri` (an `OceanNodeError`, opt out with its own `allowInsecureTransport: true`), and
    so do `forEndpoint`, which carries the flag over, and `encrypt` and `getFileInfo` for a
    `nodeUri` other than the client's own (a service's `serviceEndpoint`).
  - **Redirects are not followed** on the requests nautilus sends with credentials or a body:
    every `S3RemoteStore` request, and `IpfsRemoteStore` uploads, `probe`, `unpin` and Kubo
    `cat` reads. A 3xx fails the request and names the target origin. The read-only node GETs
    (`waitForIndexer`'s asset lookup, indexing state, node address, indexer nonce) and the
    `gatewayUrl` read in `IpfsRemoteStore.verify()` send neither, so they follow redirects; a
    redirect that ends on plain `http://` on a non-loopback host fails them, unless the
    requested URL was such a URL already (`allowInsecureTransport`). Requests ocean.js sends
    (`encrypt`, `initialize`, `getFileInfo`, `resolve`, …) are unchanged.
  - **`IpfsRemoteStore` refuses `user:password@` credentials** in `uploadUrl`, `gatewayUrl`,
    `probe.url` and `unpin.url` (pass them in `headers`), and URLs that do not parse.
  - **`Nautilus.create` refuses a `config.chainId` that differs from the signer's chain.**
  - **The signer is checked before any transaction.** `publish()` and `completePublish()`
    refuse an `asset.owner` other than the signer before the mint. `completePublish()` and
    `edit()` check the NFT's lifecycle state and the signer's `updateMetadata` permission
    (plus `deployERC20` when datatokens or pricing will be created); `edit()` does all of its
    preflight inside the per-NFT lock.
  - **`PublishedService.tx` is optional**: absent for a datatoken `completePublish()` reused.
  - **`publish`, `completePublish` and `edit` check the node's indexer nonce** before their
    first transaction: they read `OceanNodeClient.getIndexerNonceState()` (two GETs, nothing
    signed) and throw the new `IndexerNonceStuckError` when the node would not accept its
    indexer's next decrypt call, so the asset would not be indexed. A node that does not
    answer is skipped; opt out with `PublishOptions.checkIndexerNonce: false`. They warn when
    this publish's own second decrypt call would use a nonce the node does not accept.
  - **DDOs too large for the node to decrypt are refused.** The node accepts decrypt requests
    up to 100 KB, so the signed JWS may be at most about 24 000 characters.
    `publish`/`completePublish`/`edit` check before the first transaction from an upper bound
    of the signed DDO (encrypted files and credential claims at their real size, plus 1024
    characters for the JWS header and signature), and
    again from the exact request size before anything is encrypted or stored (4 KB margin).
  - **Provider fees are checked before ordering.** nautilus checks that the provider fee is
    complete (`providerFeeAddress`, `providerFeeToken`, `providerFeeAmount`, `providerData`,
    `validUntil`, `v`, `r`, `s`) and that its signature recovers to `providerFeeAddress` the
    way the datatoken contract verifies it (the `\n32` digest; an unusable signature
    recovers to the zero address, as with `ecrecover`), since `startOrder`/`reuseOrder`
    revert otherwise. When the signature fails, `access()` calls `initialize` again 1.1 s
    later, at most 3 calls in total (2 retries), stopping early when the node signs the same
    fee again; for a service with `timeout: 0` it does not ask again. `compute()` calls
    `initializeCompute` once, since a compute fee is the same on every request. A missing,
    incomplete or unencodable fee is refused at once. `order()`, `reuseOrder()` and
    `settleOrder` refuse any such fee; an order reused as it stands sends no fee and needs
    none. All throw the new `ProviderFeeSignatureError` before any approval, purchase, escrow
    or order transaction.
  - **`waitForIndexer` polls every 7 s by default** (at most 18 requests a minute, under
    ocean-node's default `MAX_REQ_PER_MINUTE` of 30) and backs off on `429` or `403` "Too many
    active connections" instead of counting it as a failed lookup: `2 × intervalMs`,
    doubling with each rate-limit answer in a row, and at least as long as the node asks
    ("Try again in N seconds", or `Retry-After` in seconds or as an HTTP date) plus 1 s, but
    never more than 60 s. An `intervalMs` under 1 s counts as 1 s for the backoff, so
    `intervalMs: 0` still waits 2, 4, 8 … s.
  - **The same-block guard changed.** `edit()` no longer waits for this instance's previous
    metadata change to be indexed; see `MetadataConflictError` below.
  - **nautilus now calls a store's `remove()` itself**, only when no metadata transaction can
    point at the envelope it stored: `publish`, `completePublish` or `edit` failed before the
    transaction was sent (a failed `verify()`, pointer encryption or transaction build, a
    wallet or RPC refusal), or the transaction was mined and reverted. The object is removed,
    best effort (`stored.cleanup: 'removed'`); never once the transaction may have been
    mined. To tell these apart, nautilus builds the transaction with ocean.js
    (`Nft.setMetadataTx`) and sends it with the signer. A send error that carries a
    transaction hash (ethers' `info.sendTransactionHash` after `JsonRpcSigner` stops polling,
    or `transactionHash`/`hash`) counts as sent whatever its code, and so does ethers'
    "provider destroyed" for a request already at the RPC: the envelope is kept. On
    `sdk: 'oasis'` chains the send stays with ocean.js, unchanged, so there a rejection or
    revert after the send keeps the envelope (`'kept'`).
  - **A `DdoSigner`'s output is checked**: the returned JWS must decode, and its payload (`vc`
    unwrapped, as the node does) must be the validated DDO. Allowed on top: the JWT
    registered claims, `type: ['VerifiableCredential']`, an `issuer` differing only in the
    case of an Ethereum address (or any issuer when the DDO declares none), and claims
    outside a `vc` wrapper. Anything else is refused before the envelope is stored. The
    built-in signers and walt.id already sign exactly this.
  - **`IpfsRemoteStore` reads every envelope back, or refuses to publish.** `verify()` reads
    through `gatewayUrl` when set, otherwise, for a Kubo `uploadUrl` (`…/api/v0/add`), through
    the same node's `/api/v0/cat`. Any other `uploadUrl` (Pinata, custom uploaders) needs
    `gatewayUrl` or the new `verify: false`; without either, `check()` throws before anything
    is minted, and `verify()` throws instead of passing without a read.
  
  **New**
  
  - **`RemoteStore.verify?(pointer, expectedHash)`**, called right before `setMetaData` by
    `publish`, `completePublish` and `edit`: it reads the stored object back and checks
    `"0x" + sha256(JSON.stringify(JSON.parse(body)))`, exactly as the node does, so a store
    that alters bytes or a key the node cannot read with now fails before the transaction.
    `S3RemoteStore` verifies with the read key; `IpfsRemoteStore` through `gatewayUrl` or a
    Kubo node's `/api/v0/cat`; `verify: false` opts out explicitly.
  - **New optional `RemoteStore.check()`** (run before the first transaction of `publish`,
    `completePublish` and `edit`) and **`RemoteStore.remove(pointer)`**.
  - **New `S3RemoteStore`** for AWS S3, Exoscale SOS or MinIO, with no AWS SDK dependency
    (SigV4 over `fetch` and WebCrypto). It uploads with a write key and puts a separate
    read-only key into the node-encrypted pointer, whose `endpoint` always carries an
    explicit, lowercase scheme (none means `https://`). `check()` writes a random probe in
    the shape of a real object, `<prefix>nautilus-store-check/<hex>.json`, reads it back with
    the read key, refuses a read key that can PUT or DELETE (only an explicit
    `403 AccessDenied` counts as "cannot"; `allowWritableReadKey` turns that into a
    warning), counts a 404 on probe cleanup as removed, and never lets a failed cleanup hide
    the first error. `allowSharedCredentials` warns once that the write key ends up in every
    on-chain pointer. The bucket name must follow the S3 naming rules, and a dotted bucket
    over https needs `forcePathStyle`; an `endpoint` or `nodeEndpoint` with a scheme other
    than `http(s)://`, or with a user name or password (requests are signed with the key pairs
    only, and the userinfo would end up in the pointer and in error messages), is refused; keys and `prefix` with `.`/`..` or empty segments, a
    leading `/` or a backslash are refused; virtual-host addressing on an IP or `localhost`
    endpoint is refused with a hint to set `forcePathStyle: true` (also for `nodeEndpoint`).
    `remove()` only deletes keys of the exact shape `put()` writes, in the configured bucket,
    and counts `NoSuchKey` as removed. Signed requests never follow redirects: a redirect or
    a region mismatch names the region and endpoint to fix, and `NoSuchKey` is reported as a
    missing object. Network errors carry method, bucket, key and role, and every request has
    a timeout (`requestTimeoutMs`, default 30 s; the constructor throws unless it is a finite
    number of milliseconds above 0, and clamps it to 2^31−1).
  - **`IpfsRemoteStore`**: works with Pinata's `pinFileToIPFS`; `probe` (`'upload'` or
    `{ url, method?, headers? }`, validated in the constructor) catches a bad key before
    anything is minted, and the upload headers only go to a probe URL on the upload origin
    unless `probe.headers` is given; `gatewayUrl` (or a Kubo `uploadUrl`) drives `verify()`,
    `verify: false` opts out; returned CIDs are validated; `requestTimeoutMs` (default 60 s,
    checked in the constructor as for `S3RemoteStore`).
    Error bodies, a non-CID 2xx body included, are cut to 300 characters and scrubbed of the
    configured header values and tokens; the text is bounded before any pattern runs, so a
    large hostile body cannot block the event loop. Network errors carry no raw fetch error
    as `cause`.
  - **Encrypted-only guards against the known plaintext.** Every ciphertext the node returns
    (envelope and pointer) must be at least plaintext + 97 bytes (ECIES on ocean-node 4.2) and
    must not contain the plaintext as UTF-8, hex, base64 or a JSON string, with any prefix or
    suffix. The envelope is checked before it reaches the store.
  - **`completePublish` checks before any transaction** that the signer owns the NFT, that
    the configured ERC721 factory created it and that every datatoken a service names
    belongs to it. It reuses the NFT's datatokens (the one bundled at mint and those from
    `PublishIncompleteError.datatokens`) for services without one, prices a reused datatoken
    whose pricing failed, creates only the missing ones, and lists every service. It refuses
    a reused datatoken whose existing pricing differs from the service's pricing config
    (scheme, rate, base token, owner, payment collector, fees, dispenser limits), and a
    creation-order match whose pricing does not fit. So that the metadata is not written
    twice, it refuses while the signer has pending transactions, and takes
    `metadataTxHash` (new `CompletePublishOptions`, from `PublishIncompleteError.stored.txHash`):
    it then also refuses while that transaction is pending or once it succeeded.
  - **Results survive a failed wait.** When the metadata transaction was mined but
    `waitForIndexer` fails or times out, the thrown error carries the full `PublishResponse`
    as `error.published` (type `PublishedNotIndexed`), for `publish`, `completePublish` and
    `edit`.
  - **`MetadataConflictError`**: after the receipt, nautilus checks the block for another
    `MetadataCreated`/`MetadataUpdated` of the same NFT and throws (with `published`,
    `conflictingTxIds`, `indexedFirst`), because the node indexes only the first. Within one
    instance, publish, edit and lifecycle calls for one NFT are serialized.
  - **`waitForIndexer`** also takes `requestTimeoutMs` (default 15 s; capped by the time
    left, but at least 1 s unless `requestTimeoutMs` is shorter) and `maxConsecutiveFailures`
    (default 5), rejects with the `signal`'s reason on abort, polls once more when
    `timeoutMs` is up, and names the last request error in the timeout message, unless a
    later answer cleared it. Over a P2P node URI, `requestTimeoutMs` bounds each asset lookup
    as a whole (ocean.js's dial and retries included), and a lookup that runs out counts
    towards `maxConsecutiveFailures`, so the wait ends on time even without a `signal`.
    `publish`/`edit` accept
    `waitForIndexer: { intervalMs, timeoutMs, signal }`; an abort reason that cannot take
    `error.published` (a `DOMException`, a string) is wrapped in an `Error` that carries it,
    with the reason as `cause`.
  - **`OceanNodeClientOptions.requestTimeoutMs`** (default 120 s, carried over to
    `forEndpoint`): each `encrypt` call, its nonce retry included, times out with an
    `OceanNodeError` and the next queued call runs; aborting `signal` while a call is queued
    rejects at once with the signal's reason. `Nautilus.create` takes the same
    `requestTimeoutMs` option and passes it to its node clients.
  - **`OceanNodeClient.getIndexingState({ did } | { txId } | { nft })`** reads the node's
    record (checksummed `nft`, lower-case `txId`, validated response; an abort rejects with
    the signal's reason), and
    **`OceanNodeClient.getNodeAddress()`** reads the node's `providerAddress`, and throws an
    `OceanNodeError` on a network error, timeout, non-2xx status or a non-JSON body. `publish`,
    `completePublish` and `edit` warn once when the publisher is the node's own key, which
    makes the indexer's decrypt fail with 401.
  - **Metadata is only written where the node can index it.** `publish`/`completePublish`/
    `edit` refuse a DEPRECATED or REVOKED_BY_PUBLISHER asset, the DDO id must be the NFT's
    DID, and the node named on chain must be the node that encrypted.
  - **`IpfsRemoteStore.remove(pointer)`** unpins a CID: `DELETE /pinning/unpin/<cid>` on
    Pinata and `POST /api/v0/pin/rm?arg=<cid>` on Kubo, derived from `uploadUrl`, or any service
    through the new `unpin: { url, method?, headers? }` option (`{cid}` placeholder, `https://`
    rule as for the other URLs, upload headers only to the upload origin). A CID that is not
    pinned counts as removed: Kubo's or Pinata's own JSON answer for it, or a 404 from a
    configured `unpin`. The examples gained `store:remove <cid|objectKey>`.
  - **`error.stored`** (type `StoredBeforeFailure`, also `PublishIncompleteError.stored`): when a
    write fails after the envelope was stored, the redacted pointer, the hash and
    `cleanup: 'removed' | 'not-removed' | 'kept'`. `'kept'` means the metadata transaction was
    sent and may be mined, and `txHash` names it when its hash is known;
    `PublishIncompleteError` then no longer claims the NFT has no metadata. `PublishIncompleteError.cause` is the native `Error.cause`.
  - **Hardening:** the store's pointer is validated and encrypted as one plain snapshot (an
    inherited `type` or a getter can no longer pass the check and serialize differently); an
    unreadable on-chain metadata state now throws instead of reading as ACTIVE; `S3RemoteStore`
    retries a network error or a 500/502/503/504 once, freshly signed; ocean.js's `null`
    transaction result is reported as "rejected, or sent and then reverted or timed out", not as
    "not submitted".
  - **`PublishResponse.stored`** (`{ pointer, metadataHash }`, pointer redacted) records where
    the envelope went and the hash written on chain, so callers can verify or clean up.
    `PublishedService.reused` marks a datatoken `completePublish()` reused.
  - **`OceanNodeClient.getIndexerNonceState()`** (`{ nodeAddress, storedNonce, nextNonce,
    stuck }`, two GETs, nothing signed) and **`isIndexerNonceSignable(nodeAddress, nonce)`**
    report whether the node will accept its indexer's next decrypt call.
  - **`IndexingError` messages carry a hint** for two errors the node records when its
    decrypt call during indexing did not succeed: a 401 Unauthorized from that call (with a
    pointer to `getIndexerNonceState()`), and the "invalid codepoint" decoding error, whose
    hint names the likely causes (a 401, a 413 from the 100 KB decrypt limit, or a 429/403
    rate-limit answer) and the node settings to check.
  - **Clearer edit error:** editing a loaded service's `serviceEndpoint` without adding its
    files again now explains that files are encrypted for the node in the endpoint, so both
    must change together.
  - **New exported types:** `CompletePublishOptions`, `FailedWithStoredObject`,
    `StoredBeforeFailure`, `PublishedNotIndexed`, `IndexerNonceState`, `IndexingState`,
    `IndexingStateQuery`, `WaitForIndexerOptions`.
  - **No more orphaned NFTs without a way back.** A failure after the NFT is minted throws a
    `PublishIncompleteError` with `nftAddress` and `datatokens`; `completePublish(nftAddress,
    asset)` finishes the publish on that NFT. `edit()` runs the store check before minting a
    datatoken, and an `edit()` that fails after creating datatokens names them as
    `error.datatokens`.
  
  **Fixes**
  
  - **`encrypt` now rejects non-ciphertext node responses.** ocean.js returns the body of a
    failed encrypt call as if it were ciphertext, so a node error (e.g. 401 `nonce: 1 is not
    a valid nonce`) could be stored as a service's encrypted `files`. `OceanNodeClient.encrypt`
    now throws an `OceanNodeError` with the node's message unless it gets `0x` hex, retries
    once on a nonce rejection when it signs with a `Signer`, and runs a `Signer`'s encrypt
    calls one at a time per client (a multi-service publish encrypted them concurrently, so
    they reused a nonce).
  - **A datatoken is recorded before its pricing**, so `PublishIncompleteError.datatokens`
    includes one whose pricing failed.
  - **`publish()` clears a `datatokenAddress`** left on a service by an earlier attempt or
    copied by `ServiceBuilder`. Such an address ended up in `PublishIncompleteError.datatokens`
    and made `completePublish()` refuse.
  - **One approval per token and spender.** `order()` now approves the provider fee as well,
    and approves one allowance for the sum of everything the same spender pulls in the same
    token (the purchase, the publish-market fee and the provider fee); `reuseOrder()`
    approves the provider fee. Before, the provider-fee allowance set by `settleOrder` was
    replaced by the publish-market fee approval (or, on templates 2 and 4, the purchase
    approval) when they shared a token, and the order reverted, on template 1 after the
    purchase. Every check (pricing, exchange, fee collectors, provider fee) now runs before
    the first approval. Approvals in different tokens are unchanged.
  - **`order()` and `settleOrder()` refuse a `payer` other than the signer** before any
    allowance read or transaction. The datatoken and the exchange take every amount from the
    transaction's sender; another payer's allowance could skip the merged purchase approval on
    templates 2 and 4, so `buyFromFreAndOrder` reverted.
  - **`edit()` writes the NFT's current on-chain lifecycle state** unless the builder sets one
    with `setLifecycleState()` (new `NautilusAsset.hasRequestedLifecycleState`), so an edit
    built from a stale copy no longer undoes `setAssetLifecycleState()`.
  - **A metadata transaction the wallet sped up** (`TRANSACTION_REPLACED`, `reason:
    'repriced'`) is no longer reported as a failure: the replacement's receipt is the result,
    and a reverted replacement is handled as a revert.
  - **A provider fee amount of `'0x0'` or `'00'` is no fee due**: the amount is compared as a
    number, so an order in force with such a fee is reused as it stands.
  - **A stored pointer that cannot be redacted** no longer stops `RemoteStore.remove()` after
    a failed write.
  
  **Docs**
  
  - Browser use (CORS for S3 buckets, MinIO and Kubo, and why write keys must not ship
    in a web app), cleaning up superseded and revoked versions, and why node encryption is not
    access control on a default 4.2 node (`AUTHORIZED_DECRYPTERS`).
  - **Keep the creation envelope.** A node reindex replays an asset from its creation
    event, so removing the envelope `publish()` stored drops the asset from the index. The
    remote-stores guide, the `remove()` docs and the examples' `store:remove` (which now
    refuses a creation or latest envelope listed in `PUBLISH_LOG` unless given `force`) say
    so.
  - `setAssetLifecycleState` and `setMetadataState` now say that they resolve with
    the mined receipt and throw when the transaction was not submitted or reverted, as they
    already did in 2.0.0-beta.0.

## 2.0.0-beta.0

### Major Changes

- [#182](https://github.com/deltaDAO/nautilus/pull/182) [`f636f33`](https://github.com/deltaDAO/nautilus/commit/f636f3360e4b09b182dfdac24f4ab0fe04428126) Thanks [@Abrom8](https://github.com/Abrom8)! - Modernize nautilus for the current Ocean stack.
  
  nautilus v1 targeted `@oceanprotocol/lib` 3.4.6, ethers v5, Aquarius, Provider and DDO
  v4.1.0 — none of which a current Ocean deployment runs. v2 targets
  `@oceanprotocol/lib` 9.x, ethers v6, ocean-node, DDO v5 via `@oceanprotocol/ddo-js`,
  and adds first-class support for the policy server and the walt.id identity stack.
  
  The builder pattern is unchanged as the primary API: `AssetBuilder`, `ServiceBuilder` and
  `ConsumerParameterBuilder` keep their fluent shape, and every v1 capability still has a
  method. This is a breaking major because the DDO model, the transport and the signer
  library all changed underneath.
  
  **What changed**
  
  - **ocean-node replaces Aquarius and Provider.** One `OceanNodeClient` wraps both, and
    `Config.oceanNodeUri` replaces `metadataCacheUri` and `providerUri`.
  - **The subgraph is gone.** Pricing is derived from chain reads and the DDO's indexed
    stats, so `urql`, `graphql` and graphql-codegen are no longer dependencies.
  - **DDO v5.** Assets are W3C Verifiable Credentials: everything moved under
    `credentialSubject`, DIDs use the `did:ope:` prefix, `description` and `displayTitle` are
    language-tagged, `license` is structured, and `providedBy` is required.
  - **DDOs are signed and stored off chain.** Only a `{remote}` pointer is written on chain.
    The remote backend is configurable — IPFS, or ocean-node's own persistent storage.
  - **Credential-gated access.** nautilus resolves policy-server challenges through the
    walt.id wallet and verifier, headless by default with optional selection callbacks.
  - **Compute is C2D v2.** Explicit resource requests, escrow payment, free compute,
    streamable logs and results.
  - **Local DDO validation** via ddo-js SHACL, before any gas is spent.
  - **`strict` TypeScript** is enabled, and ethers v6 is required.
  - **DDO v5 types from the package root.** nautilus re-exports the ddo-js v5 types its API
    surfaces — `AssetV5`, `ServiceV5`, `MetadataV5`, `State` and friends — so consumers need no
    direct `@oceanprotocol/ddo-js` dependency and never have to dedupe it.
  - **No install-time patching.** nautilus requires `@oceanprotocol/ddo-js` ^1.0.0, whose
    `exports` map carries `types` conditions, so its declarations resolve under `nodenext`,
    `node16` and `bundler` unaided. The `postinstall` hook that used to rewrite the installed
    manifest is gone: nautilus runs no lifecycle script on install, and works unchanged under
    `--ignore-scripts` and pnpm. ddo-js 1.0.0 also tightens the DDO v5 schema: `credentials`
    is now required on the asset and on every service. The builders always emit it, and an
    edit normalizes untouched services that lack it.
  
  See `MIGRATION.md` for a call-by-call mapping from v1.

## 1.1.0

### Minor Changes

- [#160](https://github.com/deltaDAO/nautilus/pull/160) [`2e7070b`](https://github.com/deltaDAO/nautilus/commit/2e7070b27db19fbd2526ef1ad84ba90030972d9a) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Adds functionality to compute on multiple datasets within one compute job

  - Currently only datasets that are encrypted by the same provider are supported

- [#160](https://github.com/deltaDAO/nautilus/pull/160) [`2e7070b`](https://github.com/deltaDAO/nautilus/commit/2e7070b27db19fbd2526ef1ad84ba90030972d9a) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Add helper functions to set name, symbol, tokenUri, transferable and templateIndex of data NFTs

## 1.0.3

### Patch Changes

- [#151](https://github.com/deltaDAO/nautilus/pull/151) [`034fd2d`](https://github.com/deltaDAO/nautilus/commit/034fd2d063db109a5ebee62e424e1f2ec276d465) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Bump dependencies

## 1.0.2

### Patch Changes

- [#134](https://github.com/deltaDAO/nautilus/pull/134) [`f7cc0a3`](https://github.com/deltaDAO/nautilus/commit/f7cc0a34d5c84ce270d2773a7721c5b4fcf8b7b5) Thanks [@Abrom8](https://github.com/Abrom8)! - Fix publishing/editing of multi-service assets

## 1.0.1

### Patch Changes

- [`c8b4d4d`](https://github.com/deltaDAO/nautilus/commit/c8b4d4d5978a4a48c7a5ab198f82042440d4b9c5) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Version Bump

## 1.0.0

### Patch Changes

- [#108](https://github.com/deltaDAO/nautilus/pull/108) [`3e8b148`](https://github.com/deltaDAO/nautilus/commit/3e8b1484fa5656a0a46fc818ca118dfda32786fc) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Fix error in next build

  - Fixes an error with starting compute jobs
  - Fixes `tslib` dependency issues

- [#103](https://github.com/deltaDAO/nautilus/pull/103) [`8f71689`](https://github.com/deltaDAO/nautilus/commit/8f71689b3cd4fa02502e01adddfe309afecdf5d2) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - next release

- [#106](https://github.com/deltaDAO/nautilus/pull/106) [`399cd55`](https://github.com/deltaDAO/nautilus/commit/399cd55ead131534f0165ef01f698553cb26290d) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - bump ocean.js

- [#83](https://github.com/deltaDAO/nautilus/pull/83) [`59b5d93`](https://github.com/deltaDAO/nautilus/commit/59b5d9348ca75300523c9857eba1f99abe441c01) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - - add stopCompute functionality
  - fix an issue with setting trusted algorithms

## 1.0.0-next.5

### Patch Changes

- [#108](https://github.com/deltaDAO/nautilus/pull/108) [`3e8b148`](https://github.com/deltaDAO/nautilus/commit/3e8b1484fa5656a0a46fc818ca118dfda32786fc) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Fix error in next build
  - Fixes an error with starting compute jobs
  - Fixes `tslib` dependency issues

## 1.0.0-next.4

### Patch Changes

- [#106](https://github.com/deltaDAO/nautilus/pull/106) [`399cd55`](https://github.com/deltaDAO/nautilus/commit/399cd55ead131534f0165ef01f698553cb26290d) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - bump ocean.js

## 1.0.0-next.3

### Patch Changes

- [#103](https://github.com/deltaDAO/nautilus/pull/103) [`8f71689`](https://github.com/deltaDAO/nautilus/commit/8f71689b3cd4fa02502e01adddfe309afecdf5d2) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - next release

## 1.0.0-beta.2

### Patch Changes

- [#83](https://github.com/deltaDAO/nautilus/pull/83) [`59b5d93`](https://github.com/deltaDAO/nautilus/commit/59b5d9348ca75300523c9857eba1f99abe441c01) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - - add stopCompute functionality
  - fix an issue with setting trusted algorithms
