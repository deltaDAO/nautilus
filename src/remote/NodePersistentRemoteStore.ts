/**
 * Stores the signed DDO in an ocean-node persistent-storage bucket.
 *
 * Worth preferring where it is available: the node already hosts the storage, so publishing
 * needs no external IPFS or S3 at all, and the pointer resolves over the same connection
 * the node uses for everything else.
 */
import type { StorageObject } from '@oceanprotocol/lib'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import type { RemoteStore } from './RemoteStore.js'

export interface NodePersistentRemoteStoreOptions {
  /** An existing bucket. Omit to have one created on first use. */
  bucketId?: string
  /** Access lists for a bucket created by this store. */
  accessLists?: Parameters<OceanNodeClient['createBucket']>[0]
  /** Label for a bucket created by this store. */
  label?: string
}

/**
 * ocean.js streams the request body, so it wants an async iterable rather than
 * a string: HttpProvider.uploadPersistentStorageFile calls
 * `content[Symbol.asyncIterator]()` directly and throws
 * "n[Symbol.asyncIterator] is not a function" on anything else.
 */
async function* asStream(payload: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(payload)
}

export class NodePersistentRemoteStore implements RemoteStore {
  private readonly node: OceanNodeClient
  private readonly options: NodePersistentRemoteStoreOptions
  private bucketId?: string

  constructor(
    node: OceanNodeClient,
    options: NodePersistentRemoteStoreOptions = {}
  ) {
    this.node = node
    this.options = options
    this.bucketId = options.bucketId
  }

  async put(payload: string, hint: { did: string }): Promise<StorageObject> {
    const bucketId = await this.getBucketId()
    const fileName = `${hint.did.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`

    await this.node.uploadFile(bucketId, fileName, asStream(payload) as never)

    // Ask the node for the canonical pointer rather than constructing one, so the exact
    // shape stays the node's business.
    return this.node.getFileObject(bucketId, fileName)
  }

  private async getBucketId(): Promise<string> {
    if (this.bucketId) return this.bucketId

    this.bucketId = await this.node.createBucket(
      this.options.accessLists || [],
      this.options.label || 'nautilus-ddo'
    )

    return this.bucketId
  }
}
