---
"@deltadao/nautilus": minor
---

Lifecycle changes by NFT address, with the state read from the chain, and `getAssets()` on
ocean-node 4.x.

**What changes for you**

- **`setAssetLifecycleState(target, state)` takes the asset, its DID or its NFT address**
  (new type `LifecycleTarget`). ocean-node 4.2.x with Elasticsearch stops serving a
  DEPRECATED or REVOKED_BY_PUBLISHER asset, so a deprecated asset could not be revoked through
  nautilus; pass its NFT address. A mixed-case address must have a correct checksum. A DID is
  resolved, and the NFT the node names must be the one the DID is derived from on the
  configured chain, so a wrong or malicious node cannot redirect an irreversible revoke; when
  the node answers 404, the NFT in its indexing record is used under the same check, and
  without one (ocean-node 4.2.2 records none) the call asks for the NFT address. An asset
  object's NFT must be the one its `id` is derived from.
- **"Already in that state" is read from the chain**, not from the asset's possibly stale DDO,
  which sent redundant transactions or skipped needed ones.
- **Refused before any transaction, "Nothing was sent.":** an NFT the configured ERC721
  factory did not create, a signer without the NFT's metadata role, an NFT without metadata.
  For DEPRECATED and REVOKED_BY_PUBLISHER, the errors name the NFT's ERC721 name and symbol and
  its DID. **Breaking (beta API):** an NFT from another factory, or an asset object whose NFT
  does not match its id, was accepted before. A new `info` event, `lifecycle.state.set`, reports each change (DID, NFT, previous
  state, transaction); `lifecycle.state.unchanged` now carries the NFT address.
- **New `getAssetLifecycleState(target)`** reads the state from the NFT (`getMetaData()`).
- **A 404 for a dropped DDO explains itself:** for the node's "Schema for version deprecated
  not found" record, `AssetNotFoundError` and `IndexingError` add a hint to read the state
  from the chain and use the NFT address.
- **`getAssets()` (`OceanNodeClient.resolveMany`) reads ocean-node 4.x's metadata-query
  answer, `[{ results, totalResults }]`,** as well as `{ hits: { hits } }`. It returned `{}`
  against every 4.x node. The check that each DDO's id is a DID asked for is unchanged.
