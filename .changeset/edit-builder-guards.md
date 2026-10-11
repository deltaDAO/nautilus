---
"@deltadao/nautilus": minor
---

`edit()` gives the datatokens of new services to the NFT's owner as the chain reports it,
and an edit builder refuses the setters an edit cannot apply instead of ignoring them.

**Breaking (beta API)**

- **`setType()`, `setNftData()` and `setNftToken{Name,Symbol,Uri,Transferable,Template}()`
  throw on an `AssetBuilder` constructed from a resolved asset.** Before, they were
  accepted and ignored: the NFT exists already, and a published asset's type cannot change.
- **`setDatatokenData()` and `setDatatokenNameAndSymbol()` throw on a `ServiceBuilder`
  loaded with `{ asset, serviceId }`**, whose datatoken exists already. They stay valid on a
  new service, also one an edit adds.
- **The edit builder no longer seeds `owner` from the resolved DDO** (`build().owner` is
  `undefined` unless `setOwner()` was called). ocean-node reports the last metadata writer
  as `nft.owner`, not the NFT's owner, and a stale or malicious node can name anyone.
- **`edit()` reads `ownerOf` on chain** and makes that address the minter and payment
  collector of every datatoken it creates, also when a manager-role account signs. Before,
  after a manager's edit, the owner's next edit adding a priced service made the manager
  the new datatoken's minter (free tokens) and payment collector (revenue).
- **`setOwner()` on an edit accepts only the signer or the on-chain owner**; any other
  address throws before any transaction. Naming the signer when it is not the owner logs a
  visible warning, `edit.owner.not_nft_owner`. An owner read that fails stops the edit
  before any transaction; the raw RPC error goes to the debug channel (topic `rpc`).

**Fixed**

- An edit signed by an identity other than the asset's last signer (a manager, or the new
  owner after a transfer, with `setIssuer()`) failed with "signed a document that differs
  from the validated DDO at iss", after any new datatoken was created: the previous
  credential's JWT claims (`iss`, `sub`, `jti`, …) were carried into the edited document.
  They are now dropped with the other indexer-derived fields.
