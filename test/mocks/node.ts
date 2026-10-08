import type { AssetV5 } from '../../src/ddo/index.js'
import type {
  IndexerNonceState,
  OceanNodeClient,
  WaitForIndexerOptions
} from '../../src/node/OceanNodeClient.js'

/**
 * A stand-in for `OceanNodeClient`.
 *
 * One mock replaces v1's separate `aquarius` and `provider` mocks, because the client is now
 * the single seam to ocean-node. Only the methods a unit test actually reaches are
 * implemented; anything else throws loudly rather than returning `undefined`, so a test that
 * accidentally depends on a network call fails with a clear message.
 */
/**
 * The mock's stand-in for node encryption of DDO metadata: a 97-byte header (ECIES's
 * ephemeral key, nonce and tag on ocean-node 4.2, here a fixed filler starting with `0x04`)
 * followed by the UTF-8 JSON (what ocean.js sends) XOR-ed with a fixed key, as `0x` hex.
 *
 * Reversible, so a test can play the node and decrypt it again (`mockDecrypt`), and
 * deterministic, so golden values stay fixed. It has the length real ECIES output has and
 * deliberately does not contain the plaintext in any encoding, so it passes nautilus's
 * known-plaintext checks the way node ciphertext does.
 */
export function mockEncrypt(data: unknown): string {
  const bytes = Buffer.from(
    typeof data === 'string' ? data : JSON.stringify(data),
    'utf8'
  )

  return `0x${MOCK_HEADER.toString('hex')}${Buffer.from(bytes.map((byte) => byte ^ MOCK_KEY)).toString('hex')}`
}

/** Reverses `mockEncrypt`, the way the node's decrypt handler reverses its ECIES. */
export function mockDecrypt(ciphertext: string): string {
  const bytes = Buffer.from(ciphertext.replace(/^0x/, ''), 'hex').subarray(
    MOCK_HEADER.length
  )

  return Buffer.from(bytes.map((byte) => byte ^ MOCK_KEY)).toString('utf8')
}

/** 65 + 16 + 16 bytes, as eciesjs 0.5 prepends on the node. */
export const MOCK_HEADER = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.alloc(96, 0xee)
])

const MOCK_KEY = 0x5a

/** The two metadata payloads `prepareMetadata` encrypts: the envelope content and the pointer. */
function isMetadataPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false

  const keys = Object.keys(data)

  return (
    keys.length === 1 && (keys[0] === 'encryptedData' || keys[0] === 'remote')
  )
}

export interface NodeMockOptions {
  assets?: Record<string, AssetV5>
  /** Ciphertext returned for service file objects. Metadata uses `mockEncrypt`. */
  encrypted?: string
  fileInfoValid?: boolean
  fileChecksum?: string
  validNode?: boolean
  /** Makes `waitForIndexer` reject with this, as the node does for a failed event. */
  indexingError?: Error
  /** What `getNodeAddress` answers (the node's `providerAddress`). */
  nodeAddress?: string
  /** What `getIndexerNonceState` answers, or throws. Default: `undefined` (not served). */
  indexerNonce?: IndexerNonceState | Error
}

export interface NodeMock {
  client: OceanNodeClient
  calls: {
    /** Every `encrypt` call, file objects and metadata alike. */
    encrypt: unknown[]
    /** The metadata `encrypt` calls only, in order: envelope content, then pointer. */
    metadataEncrypt: unknown[]
    /** Every `waitForIndexer` call, with the polling options it was given. */
    waitForIndexer: {
      did: string
      txid?: string
      options?: WaitForIndexerOptions
    }[]
    getFileInfo: unknown[]
    checkDidFiles: unknown[]
    getIndexerNonceState: number
    resolve: string[]
    /** The node each `encrypt` call was addressed to — services must use their own. */
    encryptTargets: string[]
    /** The node each `getFileInfo` call was addressed to. */
    fileInfoTargets: string[]
  }
}

export function createNodeMock(options: NodeMockOptions = {}): NodeMock {
  const calls: NodeMock['calls'] = {
    encrypt: [],
    metadataEncrypt: [],
    waitForIndexer: [],
    getFileInfo: [],
    checkDidFiles: [],
    getIndexerNonceState: 0,
    resolve: [],
    encryptTargets: [],
    fileInfoTargets: []
  }

  const notImplemented = (name: string) => () => {
    throw new Error(
      `The node mock has no ${name}(); this test reached the network unexpectedly.`
    )
  }

  const client = {
    nodeUri: 'https://node.test.invalid',
    chainId: 32456,

    async isValidNode() {
      return options.validNode !== false
    },

    async encrypt(
      data: unknown,
      _policyServer?: unknown,
      _signal?: unknown,
      nodeUri: string = 'https://node.test.invalid'
    ) {
      calls.encrypt.push(data)
      calls.encryptTargets.push(nodeUri)

      if (isMetadataPayload(data)) {
        calls.metadataEncrypt.push(data)
        return mockEncrypt(data)
      }

      return options.encrypted ?? 'encrypted-files-blob'
    },

    async getFileInfo(
      file: unknown,
      _withChecksum?: boolean,
      _signal?: unknown,
      nodeUri: string = 'https://node.test.invalid'
    ) {
      calls.getFileInfo.push(file)
      calls.fileInfoTargets.push(nodeUri)
      return [{ valid: options.fileInfoValid !== false }]
    },

    async checkDidFiles(did: string, serviceId: string) {
      calls.checkDidFiles.push({ did, serviceId })
      return [
        { valid: true, checksum: options.fileChecksum ?? 'files-checksum' }
      ]
    },

    async resolve(did: string) {
      calls.resolve.push(did)

      const asset = options.assets?.[did]
      if (!asset) throw new Error(`node mock has no asset for ${did}`)

      return asset
    },

    async waitForIndexer(
      did: string,
      txid?: string,
      indexerOptions?: WaitForIndexerOptions
    ) {
      calls.waitForIndexer.push({ did, txid, options: indexerOptions })

      if (options.indexingError) throw options.indexingError

      return options.assets?.[did] ?? { id: did }
    },

    async getNodeAddress() {
      return options.nodeAddress
    },

    async getIndexerNonceState() {
      calls.getIndexerNonceState++
      if (options.indexerNonce instanceof Error) throw options.indexerNonce
      return options.indexerNonce
    },

    requireSigner: notImplemented('requireSigner'),
    getConsumerAddress: notImplemented('getConsumerAddress'),
    initialize: notImplemented('initialize'),
    getDownloadUrl: notImplemented('getDownloadUrl'),
    computeStart: notImplemented('computeStart')
  } as unknown as OceanNodeClient

  return { client, calls }
}
