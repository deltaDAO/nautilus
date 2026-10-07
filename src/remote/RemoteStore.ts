/**
 * Off-chain storage for the signed DDO.
 *
 * Nautilus writes a node-encrypted `{ remote: <StorageObject> }` pointer on chain and
 * ocean-node resolves it. The node's `isRemoteDDO` accepts an object with exactly one key,
 * `remote`, and then hands it to the *same* `getStorageClass` it uses for asset files
 * (`oe-ocean-node/src/components/storage/getStorageClass.ts`). So, in principle, any
 * storage type ocean-node supports for files works for the DDO too:
 *
 *   | type                   | pointer shape              |
 *   |------------------------|----------------------------|
 *   | `ipfs`                 | `{ type, hash }`           |
 *   | `url`                  | `{ type, url, method }`    |
 *   | `arweave`              | `{ type, transactionId }`  |
 *   | `s3`                   | `{ type, s3Access }`       |
 *   | `ftp`                  | `{ type, url }`            |
 *
 * `nodePersistentStorage` is the exception: ocean-node 4.2 resolves a remote DDO without a
 * consumer address, and a bucket refuses that read. So it cannot hold DDOs, and nautilus
 * refuses it.
 *
 * What gets stored is not the DDO in clear but the encrypted envelope
 * `{ "encryptedData": "0x…" }` (see `prepareMetadata`). A `RemoteStore` persists that
 * string as is and returns the pointer. Nautilus ships an IPFS store and an S3 store;
 * implement the interface for anything else.
 *
 * The pointer goes on chain only node-encrypted. The copy nautilus returns in
 * `PublishResponse.stored.pointer` is redacted: an S3 `secretAccessKey`, `url` header values
 * and URL passwords read `'<redacted>'`.
 */
import type { StorageObject } from '@oceanprotocol/lib'

export interface RemoteStore {
  /**
   * Persists the payload and returns the pointer ocean-node will dereference.
   *
   * @param payload the encrypted DDO envelope, a JSON string `{ "encryptedData": "0x…" }`.
   * Store it unchanged: its sha256 is the on-chain metadata hash. Re-serializing the JSON
   * is harmless (it has a single string-valued key), anything else breaks indexing.
   * @param hint a stable name derived from the DID, for stores that need a key
   */
  put(payload: string, hint: { did: string }): Promise<StorageObject>

  /**
   * Optional preflight, called by `publish()` before the first transaction.
   *
   * The NFT has to exist before the DDO can be stored, because the DID derives from its
   * address. A store that fails only then leaves an NFT without metadata behind, so a
   * store that can tell up front that it will fail (bad credentials, missing scopes, an
   * unreachable endpoint) should throw here.
   */
  check?(): Promise<void>

  /**
   * Optional read-back, called by `publish()`, `completePublish()` and `edit()` after
   * `put()` and right before the metadata transaction.
   *
   * Read the object behind `pointer` the way the node will (with the credentials the
   * pointer carries) and throw unless `"0x" + sha256(JSON.stringify(JSON.parse(body)))`
   * equals `expectedHash`, which is exactly the node's check. On ocean-node 4.2 a failed
   * `MetadataCreated` cannot be repaired by nautilus, so catching a store that alters bytes
   * or a key the node cannot read with before the transaction is worth a round trip.
   * Stores without it are not verified.
   */
  verify?(pointer: StorageObject, expectedHash: string): Promise<void>

  /**
   * Optional cleanup: deletes what a pointer from `put()` refers to. Must work with the
   * redacted pointer from `PublishResponse.stored` (secrets replaced by `'<redacted>'`).
   *
   * nautilus calls it itself in one case only: `publish()`, `completePublish()` or `edit()`
   * stored the envelope and then failed before the metadata transaction was sent, so
   * nothing can point at it (the outcome is on `error.stored`). It never removes an object
   * once the transaction may have been sent, since an indexed asset needs its DDO for
   * re-indexing. Removing superseded versions or those of revoked assets is up to you.
   */
  remove?(pointer: StorageObject): Promise<void>
}

/** The on-chain wrapper. Must carry exactly one key or the node will not treat it as remote. */
export function toRemotePointer(pointer: StorageObject): {
  remote: StorageObject
} {
  return { remote: pointer }
}
