import type { AssetV5 } from '@oceanprotocol/ddo-js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'

/**
 * A stand-in for `OceanNodeClient`.
 *
 * One mock replaces v1's separate `aquarius` and `provider` mocks, because the client is now
 * the single seam to ocean-node. Only the methods a unit test actually reaches are
 * implemented; anything else throws loudly rather than returning `undefined`, so a test that
 * accidentally depends on a network call fails with a clear message.
 */
export interface NodeMockOptions {
  assets?: Record<string, AssetV5>
  encrypted?: string
  fileInfoValid?: boolean
  fileChecksum?: string
  validNode?: boolean
}

export interface NodeMock {
  client: OceanNodeClient
  calls: {
    encrypt: unknown[]
    getFileInfo: unknown[]
    checkDidFiles: unknown[]
    resolve: string[]
  }
}

export function createNodeMock(options: NodeMockOptions = {}): NodeMock {
  const calls: NodeMock['calls'] = {
    encrypt: [],
    getFileInfo: [],
    checkDidFiles: [],
    resolve: []
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

    async encrypt(data: unknown) {
      calls.encrypt.push(data)
      return options.encrypted ?? 'encrypted-files-blob'
    },

    async getFileInfo(file: unknown) {
      calls.getFileInfo.push(file)
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

    requireSigner: notImplemented('requireSigner'),
    getConsumerAddress: notImplemented('getConsumerAddress'),
    initialize: notImplemented('initialize'),
    getDownloadUrl: notImplemented('getDownloadUrl'),
    computeStart: notImplemented('computeStart')
  } as unknown as OceanNodeClient

  return { client, calls }
}
