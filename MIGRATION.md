# Migrating from nautilus v1 to v2

nautilus v2 keeps the builder pattern but sits on a different stack: `@oceanprotocol/lib`
9.x instead of 3.4.6, ethers v6 instead of v5, ocean-node instead of Aquarius and
Provider, and DDO v5 instead of v4.1.0.

This is a call-by-call map. If something is not listed, it did not change.

## Upgrading from 2.0.0-beta.0

2.0.0-beta.1 makes published and edited assets indexable by an unmodified
[OceanProtocolEnterprise ocean-node](https://github.com/OceanProtocolEnterprise/ocean-node)
4.2.x. beta.0 stored the bare signed JWS and hashed its claims; the 4.2 node expects a JSON
envelope and hashes that, so every beta.0 asset went on chain and was never indexed. Those
assets cannot be repaired — publish them again with beta.1.

**Switch the remote store to IPFS (or S3).** `NodePersistentRemoteStore` is rejected as the
DDO store, because ocean-node 4.2 cannot read a DDO from its own bucket storage. The bootstrap
instance is no longer needed for the store:

```diff
- const bootstrap = await Nautilus.create(signer, { config })
- const nautilus = await Nautilus.create(signer, {
-   config,
-   remoteStore: new NodePersistentRemoteStore(bootstrap.getNodeClient())
- })
+ const nautilus = await Nautilus.create(signer, {
+   config,
+   remoteStore: new IpfsRemoteStore({
+     uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
+     headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
+     probe: 'upload',
+     gatewayUrl: 'https://gateway.pinata.cloud'
+   })
+ })
```

**Drop `encrypt`.** nautilus is encrypted only: the stored envelope and the on-chain pointer
are always node-encrypted (flags `0x02`), and the DDO never goes on chain. Passing
`encrypt: false` throws.

```diff
- await nautilus.publish(asset, { encrypt: false })
+ await nautilus.publish(asset)
```

**Custom `RemoteStore`s receive the envelope.** `put(payload)` now gets the JSON string
`{"encryptedData":"0x…"}`, not the JWS. Store it byte for byte — its sha256 is the on-chain
metadata hash — and return an `ipfs`, `url`, `s3`, `arweave` or `ftp` pointer; an `ipfs`
`hash` must be a CIDv0 or CIDv1. Three optional methods are new: `check()`, which runs before
the first transaction of `publish()`, `completePublish()` and `edit()`; `verify(pointer,
expectedHash)`, which runs right before the metadata transaction and reads the stored object
back; and `remove(pointer)` for cleanup, which must accept the redacted pointer from
`PublishResponse.stored`. See
[writing your own](https://nautilus.delta-dao.com/docs/guides/remote-stores#writing-your-own).

**`waitForIndexer` throws instead of returning `undefined`.** It polls every 7 s for up to
5 minutes by default, rather than about 50 minutes, and throws an `IndexingError` with the
node's message as soon as the node records a failure, or an `OceanNodeError` on timeout or
after repeated failed requests. On `OceanNodeClient.waitForIndexer`, the `interval` and
`maxRetries` options are replaced by `intervalMs` and `timeoutMs`; `signal` stays. The old
keys still work for now, mapped to `intervalMs = interval` and
`timeoutMs = interval × maxRetries` (`maxRetries` alone: beta.0's 30 s × `maxRetries`) with a
one-time warning, but will be removed.
`publish`/`edit` take the same timing:

```diff
- const indexed = await nautilus.waitForIndexer(did, txid) // AssetV5 | undefined
- if (!indexed) throw new Error('not indexed')
+ const indexed = await nautilus.waitForIndexer(did, txid, { timeoutMs: 600_000 }) // AssetV5
+ await nautilus.publish(asset, { waitForIndexer: { timeoutMs: 600_000 } })
```

**Also breaking:**

- `writeMetadata` is no longer exported. Metadata is only written through
  `Nautilus.publish()`, `completePublish()` and `edit()`, which run every encrypted-only check
  first. `prepareMetadata` stays and returns redacted pointers.
- `prepareMetadata` no longer takes `encrypt` (`encrypt: false` throws). It stores the
  node-encrypted envelope instead of the bare JWS, and its `metadataHash` is `0x` + sha256 of
  that envelope instead of the JWS claims. `WrittenMetadata` gained `stored` (the redacted
  store pointer and the envelope hash) and `encryptedBy` (the URI of the node that encrypted
  it).
- `signS3Request` is not exported (unreleased builds of this change exported it); SigV4 is an
  internal detail of `S3RemoteStore`.
- `PublishResponse.stored.pointer` (and `prepareMetadata`'s `pointer`/`stored`) is
  **redacted**: an S3 `secretAccessKey`, `url` header values, and a URL's user name,
  password, query values (all of them; the parameter names stay) and fragment read
  `'<redacted>'`. `S3RemoteStore.remove()` works with the redacted pointer.
- `IpfsRemoteStore` reads every envelope back before the metadata transaction, and refuses
  to publish when it cannot: through `gatewayUrl` when set, otherwise, for a Kubo `uploadUrl`
  (`…/api/v0/add`), through the same node's `/api/v0/cat`. Any other `uploadUrl` (Pinata,
  your own uploader) needs `gatewayUrl`, or the new `verify: false` to publish without the
  read-back; without either, `check()` throws before anything is minted and `verify()`
  throws instead of passing without a read.
- Plain `http://` is refused for `oceanNodeUri`, the `S3RemoteStore` `endpoint` and the
  `IpfsRemoteStore` `uploadUrl`/`gatewayUrl`/`probe.url`/`unpin.url`, except on
  `localhost`, `127.0.0.0/8`, `::1` and `*.localhost`. Opt out with
  `allowInsecureTransport: true` on `Nautilus.create`, `S3RemoteStore` or `IpfsRemoteStore`.
  `S3RemoteStore.nodeEndpoint` may stay `http://`: only the node connects to it. URLs are
  judged as `fetch` parses them, so `http:host` or `http:/host` is plain `http://` too, and
  a URL containing a tab, CR, LF or another control character is refused. A URL with a
  scheme other than `http(s)` as `oceanNodeUri`/`nodeUri` or a store URL, or a scheme-less
  `host:port` (it parses as a scheme), now throws; use `https://host:port`. Only the
  `S3RemoteStore` `endpoint` takes a bare host, meaning `https://`. A
  `new OceanNodeClient({ nodeUri })` applies the same rule and throws an `OceanNodeError`
  (opt out with its own `allowInsecureTransport: true`), and so does `forEndpoint(uri)`,
  which carries the flag over from the client it is called on. Service endpoints on plain
  `http://` (non-loopback) now fail in `getFileInfo`/`encrypt` unless
  `allowInsecureTransport: true`.
- nautilus no longer follows redirects on the requests it sends itself: node lookups, every
  `S3RemoteStore` request, and `IpfsRemoteStore` uploads, `probe`, `unpin` and Kubo `cat`
  reads. Only the `IpfsRemoteStore` `gatewayUrl` read still follows them, and requests
  ocean.js sends (`encrypt`, `initialize`, …) are unchanged. If your node or store sits
  behind a redirect, configure the final URL.
- `IpfsRemoteStore`: move URL credentials (`https://user:pass@…`) into `headers`
  (`Authorization: 'Basic …'`). A redirecting `uploadUrl`/`probe.url`/`unpin.url` must be
  replaced by its final URL. A custom `unpin` service must answer 404 (or 2xx) for a CID
  that isn't pinned to count as removed.
- `OceanNodeClient.encrypt` now times out after 120 s with an `OceanNodeError`; pass
  `requestTimeoutMs` to `Nautilus.create` or `new OceanNodeClient()` for slower nodes or
  signers.
- `Nautilus.create` refuses a `config.chainId` that differs from the signer's chain.
- An `asset.owner` other than the signer now throws in `publish()` and `completePublish()`
  before the mint. Publish with the owner's signer, then transfer the NFT if needed.
- `publish()` resets `service.datatokenAddress` on every service before minting, so
  `PublishIncompleteError.datatokens` lists only the datatokens this `publish()` created.
- `PublishedService.tx` is optional: it is absent for a datatoken `completePublish()` reused
  as it was (`reused: true`).
- `edit()` no longer waits for this instance's previous metadata change to be indexed.
  Instead, one instance's writes to an NFT are serialized, and a metadata transaction that
  shares its block with another one for the same NFT throws a `MetadataConflictError`.
- A custom `RemoteStore`'s `remove()` is now called by nautilus when no metadata transaction
  can point at the envelope: `publish()`, `completePublish()` or `edit()` stored it and then
  failed before the transaction was sent, or the transaction was rejected, or mined and
  reverted. It is never called once that transaction may have been mined.
- The JWS a custom `DdoSigner` returns is decoded before it is stored, and its payload (`vc`
  unwrapped, as the node does) must be the validated DDO. Allowed on top: the JWT registered
  claims (`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`), `type: ['VerifiableCredential']`,
  an `issuer` that differs only in the case of an Ethereum address (or any issuer when the DDO
  declares none), and any claim outside a `vc` wrapper. Anything else that differs is refused
  before the envelope is stored. The built-in signers already sign exactly this.
- `publish()`, `completePublish()` and `edit()` check the node before their first
  transaction and throw an `IndexerNonceStuckError` when the node would not accept its
  indexer's next decrypt call, since the asset would not be indexed. Opt out with
  `checkIndexerNonce: false`; a node that does not answer the check is skipped.
- They also refuse a DDO whose signed envelope the node could not decrypt: the node accepts
  decrypt requests up to 100 KB, so the JWS must stay under about 24 000 characters.
  Checked before the first transaction from an upper bound of the signed DDO (encrypted
  files and credential claims at their real size, plus 1024 characters for the JWS header
  and signature), and exactly before the envelope is stored.
- The pointer a `RemoteStore` returns must carry what the node needs for its type: `url` an
  absolute `http(s)` `url` and a `GET`/`POST` `method` (and string `headers`, if any); `s3` an
  `s3Access` with non-empty `bucket`, `objectKey`, `endpoint`, `accessKeyId` and
  `secretAccessKey`; `arweave` a `transactionId` that is not a URL or path; `ftp` an
  `ftp://`/`ftps://` `url`. Others are refused before the pointer is encrypted.
- `access()`, `compute()`, `order()` and `reuseOrder()` throw a `ProviderFeeSignatureError`,
  before any approval, purchase or order, for a provider fee that is missing, lacks a field,
  or whose signature does not recover to `providerFeeAddress` the way the datatoken
  contract verifies it. When the signature fails, `access` asks the node for a new fee
  (1.1 s later, at most 3 `initialize` calls in total) unless the service has `timeout: 0`;
  `compute` calls `initializeCompute` once.
- `order()` and `reuseOrder()` approve the provider fee themselves, combined into one
  allowance with the publish-market fee and the purchase where they share a token and
  spender. If you approve the provider fee before calling them, you can drop that approval
  (or keep it: an allowance that already covers the sum is not approved again).
- `waitForIndexer` polls every 7 s by default (at most 18 requests a minute, under the node's
  default rate limit of 30) and backs off on a `429` or a `403` "Too many active
  connections" instead of counting it as a failed request, never waiting more than 60 s.
- `waitForIndexer({ timeoutMs: Infinity })` (or `NaN`/negative values for any timing option)
  now throws an `OceanNodeError`; pass a large finite number.

**New:**

- `S3RemoteStore` — the envelope in an S3 bucket (AWS S3, Exoscale SOS, MinIO), with a
  separate write key and a read-only key for the node, `verify()` with the read key, and
  `remove(pointer)` to clean up. Read and write key policies must cover
  `<prefix>nautilus-store-check/*`, where `check()` puts its probes (in the shape of real
  objects), and a bare 403 on the read-key probe fails `check()`: a proxy or firewall in
  front of the bucket must let S3's `AccessDenied` through. Bucket names must follow the S3
  rules (lowercase, 3–63 characters, no IP address), and dotted buckets over https need
  `forcePathStyle: true`. The pointer's endpoint always carries a lowercase scheme, and
  `remove()` refuses keys `put()` would not have written.
- `PublishResponse.stored` — `{ pointer, metadataHash }`: the store's pointer (for IPFS, the
  CID to unpin), redacted, and the on-chain hash.
- `OceanNodeClient.getIndexingState({ did } | { nft } | { txId })` — the node's indexing
  record, the only place it says why an asset was not indexed. Failures are filed by
  transaction (query `{ txId }`); successes by DID (`{ did }`).
- `OceanNodeClient.getNodeAddress()` — the node's `providerAddress`. `publish`,
  `completePublish` and `edit` warn once when the publisher is that key, which makes the
  indexer's decrypt fail with 401.
- `OceanNodeClient.getIndexerNonceState()` and `isIndexerNonceSignable()` — a read-only
  check (two `GET`s) of whether the node will accept its indexer's next decrypt call;
  `IndexerNonceStuckError` and `PublishOptions.checkIndexerNonce` use it.
- `ProviderFeeSignatureError` — the provider-fee pre-check above, with the fee, the address
  `ecrecover` would return and the number of attempts.
- `RemoteStore.check()` and `IpfsRemoteStore`'s `probe` option — the store is tested before
  anything is minted. `RemoteStore.verify()` and `IpfsRemoteStore`'s `gatewayUrl` (or a
  Kubo node's `/api/v0/cat`) — the stored envelope is read back before the metadata
  transaction; `IpfsRemoteStore`'s `verify: false` opts out explicitly.
- `PublishIncompleteError` and `nautilus.completePublish(nftAddress, asset)` — finish a
  publish that failed after the NFT was minted. `completePublish` checks that the signer owns
  the NFT and that the configured factory created it, and reuses the NFT's datatokens. It
  refuses a reused datatoken whose existing pricing differs from the service's pricing
  config: make the service's `setPricing()` match what is on chain. When a datatoken would
  be matched only by creation order and its pricing does not fit, set `datatokenAddress` on
  each service to say which datatoken belongs to it.
- `PublishedNotIndexed` — when the metadata transaction was mined but the wait for the
  indexer fails, the error carries the full `PublishResponse` as `error.published`.
- `MetadataConflictError` (`published`, `conflictingTxIds`, `indexedFirst`) — ocean-node
  indexes only the first metadata event of an asset per block, so nautilus checks the block
  after every metadata transaction.
- `WaitForIndexerOptions.requestTimeoutMs` (default 15 s) and `maxConsecutiveFailures`
  (default 5); `S3RemoteStore` and `IpfsRemoteStore` take `requestTimeoutMs` (30 s and 60 s).
- `IpfsRemoteStore.remove(pointer)` unpins a CID: derived from `uploadUrl` for Pinata
  (`DELETE /pinning/unpin/<cid>`) and Kubo (`POST /api/v0/pin/rm`), or set with the new
  `unpin: { url, method?, headers? }` option.
- `error.stored` (type `StoredBeforeFailure`, also on `PublishIncompleteError.stored`) — when
  a write fails after the envelope was stored, the redacted pointer, the hash and what became
  of the object: `'removed'` (the transaction was never sent, was rejected, or was mined and
  reverted, so nautilus removed it), `'not-removed'` or `'kept'` (the transaction was sent
  and may be mined). See
  [when a write fails](https://nautilus.delta-dao.com/docs/guides/remote-stores#when-a-write-fails-after-the-envelope-is-stored).
- `S3RemoteStore` retries a network error or a 500, 502, 503 or 504 once, freshly signed;
  other statuses are not retried.

**Know:** keep the **creation envelope** (from `publish()`) and the current one of every
asset that should stay indexed. A node reindex replays the asset from its creation event and
drops it from the index when that envelope is gone. See
[cleaning up](https://nautilus.delta-dao.com/docs/guides/remote-stores#cleaning-up).

**Know:** `DEPRECATED` and `REVOKED_BY_PUBLISHER` are one-way on ocean-node — the indexer
replaces the DDO with a stub — so `publish()` and `edit()` refuse to write metadata in either
state. See
[lifecycle states](https://nautilus.delta-dao.com/docs/api/nautilus/setAssetLifecycleState#states).

## 1. Dependencies

```diff
- "@oceanprotocol/lib": "3.4.6",
- "ethers": "^5.7.2"
+ "@oceanprotocol/lib": "^9.2.1",
+ "ethers": "^6.17.0"
```

`@oceanprotocol/lib` re-exports only the **v4** `DDO` type. The DDO v5 types — `AssetV5`,
`ServiceV5`, `MetadataV5` and the rest — are exported by `@deltadao/nautilus` itself, so you
do not need a direct `@oceanprotocol/ddo-js` dependency:

```ts
import type { AssetV5, MetadataV5, ServiceV5 } from '@deltadao/nautilus'
```

ocean.js 9.2.1 still nests an older ddo-js under `@oceanprotocol/lib` for its own internals.
It is harmless and needs no override.

DDO v5 now requires a `credentials` object on the asset and on every service (ddo-js 1.0.0).
The builders always emit one (`{}` when no access rules are set), so this only matters if you
assemble or patch DDOs by hand.

## 2. Setting up

ethers v6 removed the `providers` namespace.

```diff
- import { Wallet, providers } from 'ethers'
- const provider = new providers.JsonRpcProvider('https://rpc.dev.pontus-x.eu')
+ import { JsonRpcProvider, Wallet } from 'ethers'
+ const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')

  const signer = new Wallet('0x…', provider)
```

`Nautilus.create` now takes an options object rather than a bare `Partial<Config>`:

```diff
- const nautilus = await Nautilus.create(signer, { providerUri: '…' })
+ const nautilus = await Nautilus.create(signer, {
+   config: { oceanNodeUri: 'https://node.example.org' }
+ })
```

### Config fields

| v1 | v2 |
| --- | --- |
| `metadataCacheUri` | `oceanNodeUri` |
| `providerUri` | `oceanNodeUri` |
| `subgraphUri` | *removed* — pricing comes from chain reads |
| — | `escrow`, `accessListFactory`, `sdk: 'evm' \| 'oasis'` |

`ConfigHelper` ships contract addresses for a set of chains, including Pontus-X devnet
(32456) and OP Sepolia (11155420). On a chain it does not know, pass the addresses
explicitly in `config`.

v2 needs an OceanProtocolEnterprise ocean-node 4.2.x. For access to the deltaDAO test
environment, or to have your own ocean-node run as a service, contact deltaDAO at
https://delta-dao.com/contact or contact@delta-dao.com.

## 3. Reading assets

```diff
- const asset = await nautilus.getAquariusAsset(did)
- const assets = await nautilus.getAquariusAssets(dids)
+ const asset = await nautilus.getAsset(did)
+ const assets = await nautilus.getAssets(dids)
```

DDO v5 nests everything under `credentialSubject`, so read through the helpers rather than
indexing into the document — that way a future DDO v6 does not break your code:

```diff
- asset.metadata.name
- asset.services[0].id
- asset.nft.owner
- asset.nft.state
+ import { getMetadata, getServices, getOwner, getLifecycleState } from '@deltadao/nautilus'
+ getMetadata(asset).name
+ getServices(asset)[0].id
+ getOwner(asset)
+ getLifecycleState(asset)
```

New: `nautilus.query(searchQuery)` and `nautilus.waitForIndexer(did, txid?, options?)`.

## 4. Publishing

Publishing now signs the DDO as a verifiable credential and stores it off chain, writing
only a `{remote}` pointer. So it needs a **remote store**:

```ts
import { IpfsRemoteStore, Nautilus } from '@deltadao/nautilus'

const nautilus = await Nautilus.create(signer, {
  config,
  // A Kubo node; Pinata's pinFileToIPFS works too, with a Bearer JWT in `headers`.
  remoteStore: new IpfsRemoteStore({ uploadUrl: 'http://127.0.0.1:5001/api/v0/add' })
})
```

The store holds a node-encrypted envelope, never the DDO in clear, and the on-chain pointer
is node-encrypted too. The node's own storage (`NodePersistentRemoteStore`) cannot hold DDOs
on ocean-node 4.2, so nautilus rejects it.

`publish()` gained options and returns a little more:

```diff
- const { nftAddress, services, ddo, setMetadataTxReceipt } = await nautilus.publish(asset)
+ const { nftAddress, services, ddo, setMetadataTxReceipt, credential, stored, indexed } =
+   await nautilus.publish(asset, { waitForIndexer: true })
```

It is also cheaper: the NFT, its first datatoken and that service's pricing are created in
**one** transaction rather than three.

## 5. `AssetBuilder`

Every v1 method still exists. Three behave differently, and there are new ones.

```diff
- new AssetBuilder(aquariusAsset)
+ new AssetBuilder(asset)   // the asset from nautilus.getAsset()
```

| v1 | v2 |
| --- | --- |
| `setDescription('text')` | same call; wrapped into a language-tagged object |
| `setLicense('url')` | same call; wrapped into `{ name }`. Also accepts a `License` object |
| `addLinks(['url'])` | same call; projected into v5's `{ label: url }` map. Also accepts a map |
| `setContentLanguage('en')` | **repurposed**: no longer a metadata field, it now sets the `@language`/`@direction` tag applied to every language-tagged value |

**Now required**: `setProvidedBy()`. DDO v5's schema requires `providedBy`, and `build()`
rejects a new asset without it (alongside `name` and `type`).

**New**:

```ts
builder
  .setDisplayTitle('A nicer title')
  .addAttachments([{ name: 'terms', fileType: 'pdf', sha256: '…', mirrors: [] }])
  .setIssuer('did:web:example.org')
  .addCredentialAccessList(CredentialListTypes.ALLOW, { chainId: 32456, accessList: '0x…' })
  .addRequestCredentials(CredentialListTypes.ALLOW, [
    { type: 'VerifiableId', format: 'jwt_vc_json' }
  ])
  .setVcPolicies(CredentialListTypes.ALLOW, ['signature', 'not-before'])
  .setVpPolicies(CredentialListTypes.ALLOW, [{ policy: 'minimum-credentials', args: '1' }])
  .setCredentialMatchRules({ match_allow: 'all', match_deny: 'any' })
```

Also fixed: `reset()` now returns to the loaded asset in edit mode rather than emptying the
builder, and NFT defaults no longer leak between assets built in the same process.

## 6. `ServiceBuilder`

```diff
- new ServiceBuilder({ aquariusAsset, serviceId })
+ new ServiceBuilder({ asset, serviceId })
```

**File types changed**, because ocean-node changed what it can read:

| v1 `FileTypes` | v2 |
| --- | --- |
| `URL` | `URL` — but the object is now `UrlFileObject` |
| `IPFS` | `IPFS` — `{ type, hash }` |
| `ARWEAVE` | `ARWEAVE` — `{ type, transactionId }` |
| `GRAPHQL` | **removed** |
| `SMARTCONTRACT` | **removed** |
| — | `S3`, `FTP`, `NODE_PERSISTENT_STORAGE` (new) |

`setName()` is effectively required now (v5 requires `Service.name`); `build()` defaults it
rather than failing.

`addTrustedAlgorithms()` finally honours `serviceIds`, because v5's
`PublisherTrustedAlgorithms` carries a required `serviceId`:

```ts
builder.addTrustedAlgorithms([{ did: 'did:ope:…', serviceIds: ['service-a', 'service-b'] }])
```

**New**: `setState()`, `setDisplayName()`, `setDataSchema()`, `setInputSchema()`,
`setOutputSchema()`, and per-service gating via `addCredentialAddresses()` /
`addRequestCredentials()`.

## 7. `ConsumerParameterBuilder`

Two v1 workarounds are gone, because v5 fixed what forced them:

```diff
  builder.setType('select').addOption({ eu: 'Europe' })
- // v4 emitted options as a JSON string
+ // v5 emits a structured array

  builder.setDefault(false)
- // v4 coerced this to the string "false"
+ // v5 keeps the boolean
```

## 8. Access

```diff
- const url: string = await nautilus.access({ assetDid })
+ const { url, transferTxId, reusedOrder } = await nautilus.access({ assetDid })
```

If the service is credential-gated, nautilus resolves the policy before placing any order —
so a failed presentation costs nothing. See §10.

## 9. Compute

Compute changed the most, because C2D v2 is a different model.

```diff
- const job = await nautilus.compute({ dataset, algorithm, additionalDatasets })
+ const { jobs, environment, orders } = await nautilus.compute({
+   dataset, algorithm, additionalDatasets,
+   computeEnv: env.id,          // pick deliberately; v1 silently used [0]
+   resources: [{ id: 'cpu', amount: 2 }, { id: 'ram', amount: 2 }],
+   paymentToken: '0x…',
+   maxJobDuration: 3600
+ })
```

- **Environments**: `nautilus.getComputeEnvironments()` lists them with their resources,
  limits and per-chain fees. `resources` and `paymentToken` default from the environment.
- **Escrow**: paid jobs lock funds in the `Escrow` contract. nautilus funds and authorises
  it from what the node quotes.
- **Free compute**: `nautilus.freeCompute({ dataset, algorithm })` — no order, no escrow, no
  payment token. Requires an environment exposing `free`.
- **Output**: `ComputeOutput` is now `{ remoteStorage?, encryption? }`. The old
  `publishAlgorithmLog` / `publishOutput` flags no longer exist.
- **Renamed**: `getComputeEnviroment` (sic) → `getComputeEnvironments`.
- **New**: `nautilus.streamComputeResult()`, `nautilus.getComputeLogs()`.

`stopCompute` and `getComputeStatus` no longer need a `providerUri`; they default to the
node the instance is configured with.

## 10. Credential-gated assets

New in v2. Configure a credential provider and nautilus handles the whole presentation
exchange — initiate, fetch the presentation definition, authenticate to the wallet, match
credentials, present, and carry the resulting session into the download or compute call.

```ts
import { Nautilus, WaltIdCredentialProvider } from '@deltadao/nautilus'

const bootstrap = await Nautilus.create(signer, { config })

const nautilus = await Nautilus.create(signer, {
  config,
  credentials: new WaltIdCredentialProvider(bootstrap.getNodeClient(), {
    walletApi: 'https://wallet.example.org'
    // Headless by default: all matching credentials, the wallet's first DID.
    // Supply onSelectCredentials / onSelectDid to drive a UI instead.
  })
})

// Nothing else changes at the call site.
const { url } = await nautilus.access({ assetDid: 'did:ope:…' })
```

Two things worth knowing about how deployments behave:

- ocean-node **fails open** when its `POLICY_SERVER_URL` is unset, so an unconfigured node
  allows everything. `initializePSVerification` returning `null` is the clean signal.
- Publish-time policy enforcement does not exist yet: the policy server's `newDDO`,
  `updateDDO`, `validateDDO`, `encrypt` and `decrypt` actions are stubs that always allow.

## 11. Validation

New in v2, and worth using: DDO validation is entirely local, so it costs nothing and it
names the failing field.

```ts
import { validate } from '@deltadao/nautilus'

const { valid, errors } = await validate(ddo)
// errors: { providedBy: ['Less than 1 values'] }
```

`publish()` and `edit()` run this automatically before spending gas.

## 12. Removed

| Removed | Replacement |
| --- | --- |
| `utils/aquarius.ts`, `utils/provider.ts` | `OceanNodeClient` |
| `utils/subgraph/*`, `getAccessDetails` | chain reads — `getPricingInfo`, `getOrderPrice` |
| `AccessDetails`, `AssetWithAccessDetails`, `OrderPriceAndFees` | `PricingInfo`, `OrderPrice` |
| local `ComputeAsset` / `ComputeAlgorithm` | `ComputeAssetRef` / `ComputeAlgorithmRef` |
| `transformAquariusAssetToDDO` | unnecessary — v5 keeps indexed data separate |
| `getComputeEnviroment` | `getComputeEnvironments` |
