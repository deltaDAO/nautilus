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
  object's NFT must be the one its `id` is derived from. The call joins the instance's queue
  for the asset when it is called, whatever the target, so an `edit()` started after a
  revoke by DID runs after it.
- **"Already in that state" is read from the chain**, not from the asset's possibly stale DDO,
  which sent redundant transactions or skipped needed ones.
- **Refused before any transaction, "Nothing was sent.":** a state other than 0 to 5, a
  malformed DID, an NFT the configured ERC721 factory did not create (checked before anything
  is read from the NFT), a signer without the NFT's `updateMetadata` role, an NFT without
  metadata, and a chain read that failed (without the RPC's error, which may carry its URL
  and key). For DEPRECATED and REVOKED_BY_PUBLISHER, the errors name the NFT's ERC721 name and
  symbol and its DID. **Breaking (beta API):** an NFT from another factory, an asset object
  whose NFT does not match its id, or a state above 5 was accepted before.
- **New events:** `lifecycle.state.retired` (`warn`, printed by default) reports a change to
  DEPRECATED or REVOKED_BY_PUBLISHER, `lifecycle.state.set` (`info`) any other change (DID,
  NFT, previous state, transaction); `lifecycle.state.unchanged` now carries the NFT address.
- **An unlisted asset stays served after a revoke:** ocean-node 4.2.2 drops the DDO only for
  a move from ACTIVE; one unlisted first keeps being served, with `nft.state` 3.
- **New `getAssetLifecycleState(target)`** reads the state from the NFT (`getMetaData()`).
- **A 404 for a dropped DDO explains itself:** for the node's "Schema for version deprecated
  not found" record, `AssetNotFoundError` and `IndexingError` add a hint to read the state
  from the chain and use the NFT address.
- **`getAssets()` (`OceanNodeClient.resolveMany`) reads ocean-node 4.x's metadata-query
  answers,** `[{ results, totalResults }]` with Elasticsearch (verified against 4.2.2) and
  `[{ hits: [{ document }], found }]` with Typesense (from the 4.2.2 source), as well as
  `{ hits: { hits } }`. It returned `{}` against every 4.x node. The check that each DDO's id
  is a DID asked for is unchanged; two different DDOs for one DID are now refused.
- **Chain read errors carry no RPC detail:** a failed `getMetaData()` read (also in `edit()`
  and `completePublish()`) or factory check throws without the RPC's error, which goes to the
  `rpc` debug topic.
