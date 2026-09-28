/**
 * Off-chain storage for the signed DDO.
 *
 * Nautilus writes `{ remote: <StorageObject> }` on chain and ocean-node resolves it. The
 * node's `isRemoteDDO` accepts an object with exactly one key, `remote`, and then hands it
 * to the *same* `getStorageClass` it uses for asset files
 * (`oe-ocean-node/src/components/storage/getStorageClass.ts`). So any storage type
 * ocean-node supports for files works for the DDO too:
 *
 *   | type                   | pointer shape              |
 *   |------------------------|----------------------------|
 *   | `ipfs`                 | `{ type, hash }`           |
 *   | `url`                  | `{ type, url, method }`    |
 *   | `arweave`              | `{ type, transactionId }`  |
 *   | `s3`                   | `{ type, s3Access }`       |
 *   | `ftp`                  | `{ type, url }`            |
 *   | `nodePersistentStorage`| `{ type, bucketId, fileName }` |
 *
 * A `RemoteStore` persists the signed document and returns that pointer. Nautilus ships an
 * IPFS store and a node-persistent-storage store; implement the interface for anything else.
 */
import type { StorageObject } from '@oceanprotocol/lib'

export interface RemoteStore {
  /**
   * Persists the payload and returns the pointer ocean-node will dereference.
   *
   * @param payload the signed DDO document
   * @param hint a stable name derived from the DID, for stores that need a key
   */
  put(payload: string, hint: { did: string }): Promise<StorageObject>
}

/** The on-chain wrapper. Must carry exactly one key or the node will not treat it as remote. */
export function toRemotePointer(pointer: StorageObject): {
  remote: StorageObject
} {
  return { remote: pointer }
}
