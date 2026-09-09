import type { AssetV5 } from '@oceanprotocol/ddo-js'

/**
 * A published DDO v5 asset, shaped like the ones ocean-node actually returns.
 *
 * Modelled on `ocean-cli/metadata/simpleDownloadDatasetV5.json` and
 * `ddo.js/src/test/data/ddo.ts`, including the parts the TypeScript types get wrong:
 * `credentials` is an object, and SSI gating uses `type: 'SSIpolicy'`.
 */
export const NFT_ADDRESS = '0xBB1081DbF3227bbB233Db68f7117114baBb43656'
export const DATATOKEN_ADDRESS = '0xfF4AE9869Cafb5Ff725f962F3Bbc22Fb303A8aD8'
export const OWNER_ADDRESS = '0x0DB823218e337a6817e6D7740eb17635DEAdafAF'
export const CHAIN_ID = 32456
export const SERVICE_ID =
  'ccb398c50d6abd5b456e8d7242bd856a1767a890b537c2f8c10ba8b8a10e6025'

/**
 * Derived from (NFT_ADDRESS, CHAIN_ID) by `V5DDO.makeDid` — note the `did:ope:` prefix,
 * where v4 used `did:op:`. Validation recomputes this, so it cannot be an arbitrary string.
 */
export const ASSET_DID =
  'did:ope:7e03381026d60723ad1e7629744d07f0bfa294fb4dbb94115602f362d8bc0566'

export function getAssetFixture(overrides: Partial<AssetV5> = {}): AssetV5 {
  const asset = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: ASSET_DID,
    type: ['VerifiableCredential'],
    version: '5.0.0',
    issuer: 'did:jwk:test-issuer',
    credentialSubject: {
      id: ASSET_DID,
      chainId: CHAIN_ID,
      nftAddress: NFT_ADDRESS,
      version: '5.0.0',
      metadata: {
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
        type: 'dataset',
        name: 'Test Dataset',
        description: {
          '@value': 'A dataset used by the nautilus test suite',
          '@language': 'en',
          '@direction': 'ltr'
        },
        author: 'deltaDAO',
        providedBy: 'deltaDAO AG',
        copyrightHolder: 'deltaDAO AG',
        license: { name: 'https://market.oceanprotocol.com/terms' },
        tags: ['test'],
        categories: ['testing']
      },
      services: [
        {
          id: SERVICE_ID,
          type: 'access',
          name: 'Access Service',
          datatokenAddress: DATATOKEN_ADDRESS,
          serviceEndpoint: 'https://node.test.invalid',
          files: 'encrypted-files-blob',
          timeout: 86400,
          state: 0,
          credentials: {}
        }
      ],
      credentials: {
        allow: [{ type: 'address', values: [{ address: '*' }] }],
        deny: [],
        match_deny: 'any'
      },
      datatokens: [
        {
          address: DATATOKEN_ADDRESS,
          name: 'Test Access Token',
          symbol: 'TEST-AT',
          serviceId: SERVICE_ID
        }
      ]
    },
    indexedMetadata: {
      nft: {
        address: NFT_ADDRESS,
        name: 'Test Data NFT',
        symbol: 'TEST-NFT',
        owner: OWNER_ADDRESS,
        state: 0,
        created: '2026-01-01T00:00:00Z',
        tokenURI: ''
      },
      event: {
        txid: '0xabc',
        block: 1,
        from: OWNER_ADDRESS,
        contract: NFT_ADDRESS,
        datetime: '2026-01-01T00:00:00Z'
      },
      purgatory: { state: false },
      stats: [
        {
          datatokenAddress: DATATOKEN_ADDRESS,
          name: 'Test Access Token',
          symbol: 'TEST-AT',
          serviceId: SERVICE_ID,
          orders: 0,
          prices: [
            {
              type: 'dispenser',
              price: '0',
              contract: '0x0000000000000000000000000000000000000000'
            }
          ]
        }
      ]
    },
    ...overrides
  }

  return asset as unknown as AssetV5
}

/** A compute-service variant, for trusted-algorithm and compute tests. */
export function getComputeAssetFixture(): AssetV5 {
  const asset = getAssetFixture()
  const service = asset.credentialSubject.services[0]

  service.type = 'compute'
  service.name = 'Compute Service'
  service.compute = {
    allowRawAlgorithm: false,
    allowNetworkAccess: false,
    publisherTrustedAlgorithmPublishers: [],
    publisherTrustedAlgorithms: []
  }

  return asset
}

/** An algorithm asset, for the trusted-algorithm resolver. */
export function getAlgorithmAssetFixture(): AssetV5 {
  const asset = getComputeAssetFixture()

  asset.credentialSubject.metadata.type = 'algorithm'
  asset.credentialSubject.metadata.name = 'Test Algorithm'
  asset.credentialSubject.metadata.algorithm = {
    language: 'python',
    version: '0.1.0',
    container: {
      entrypoint: 'python $ALGO',
      image: 'oceanprotocol/algo_dockers',
      tag: 'python-branin',
      checksum:
        'sha256:8f36c4b2b7b4b0e6b0d0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0'
    }
  }

  return asset
}
