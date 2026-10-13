/**
 * Smoke run of the example commands, so a runtime regression in the examples fails CI.
 *
 * The examples are only type-checked otherwise, and a typecheck misses what this catches: a
 * command that now throws, prints the wrong thing, or calls the API in a way that no longer
 * works. Each command runs in-process through `runCommand`, exactly as `npm start -- <name>`
 * does, against:
 *
 *   - the unit suite's ocean-node mock (`test/mocks/node.ts`), injected into every instance
 *     the examples create, plus the few calls the access and compute commands reach;
 *   - the unit suite's chain stubs: ocean.js's contract classes and nautilus's chain-write
 *     helpers, mocked as in `test/unit/PublishPreflight.test.ts`;
 *   - a local HTTP server for what the examples reach over the network themselves: a JSON-RPC
 *     endpoint (chain id, nonces, blocks and an empty log for the previous-order lookup, the
 *     NFT's `getMetaData()`), an IPFS upload API and the file a download fetches. An RPC call
 *     it does not answer fails the test, even when the command caught the error.
 *
 * What it does not cover: real contracts, a real ocean-node, starting a compute job, walt.id
 * presentations, or anything that waits on an indexer. Those runs stay manual on the dev
 * stack (L1/L2), per change.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AbiCoder, id, Wallet } from 'ethers'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import { Nautilus } from '../../src/index.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import {
  ASSET_DID,
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS
} from '../../test/fixtures/Asset.js'
import { signedProviderFee } from '../../test/fixtures/ProviderFee.js'
import { createNodeMock } from '../../test/mocks/node.js'
import { COMMANDS, runCommand } from '../commands.js'
import { publishSession } from '../publish.js'

/** The NFT as the chain stubs answer for it. */
const chain = vi.hoisted(() => ({ state: 0, owner: '' }))

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Nft: class {
      async getMetadata() {
        return ['', chain.owner, chain.state, true]
      }
      async getNftOwner() {
        return chain.owner
      }
      async getNftPermissions() {
        return {
          manager: true,
          deployERC20: true,
          updateMetadata: true,
          store: true
        }
      }
    },
    NftFactory: class {
      async checkNFT(nftAddress: string) {
        return nftAddress
      }
    }
  }
})

vi.mock('../../src/publish/index.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  const { DATATOKEN_ADDRESS, NFT_ADDRESS } = await import(
    '../../test/fixtures/Asset.js'
  )

  return {
    ...actual,
    createNftWithService: vi.fn(async () => ({
      nftAddress: NFT_ADDRESS,
      datatokenAddress: DATATOKEN_ADDRESS,
      tx: { hash: '0xnft' }
    })),
    createDatatokenForService: vi.fn(
      async ({ service }: { service: { datatokenAddress?: string } }) => {
        service.datatokenAddress = DATATOKEN_ADDRESS
        return { datatokenAddress: DATATOKEN_ADDRESS, tx: { hash: '0xdt' } }
      }
    ),
    createPricingForDatatoken: vi.fn(async () => ({ hash: '0xpricing' })),
    writeMetadata: vi.fn(async () => ({
      hash: '0xsetmetadata',
      blockNumber: 100
    })),
    waitForMetadataPermission: vi.fn(async () => undefined)
  }
})

vi.mock('../../src/utils/contracts.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  const { DATATOKEN_ADDRESS } = await import('../../test/fixtures/Asset.js')

  return {
    ...actual,
    getNftDatatokens: vi.fn(async () => [DATATOKEN_ADDRESS]),
    setMetadataState: vi.fn(async ({ state }: { state: number }) => {
      chain.state = state
      return { hash: '0xstate', status: 1 }
    }),
    getMetadataEventsInBlock: vi.fn(async () => [
      { transactionHash: '0xsetmetadata', index: 0 }
    ])
  }
})

vi.mock('../../src/utils/order.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  order: vi.fn(async () => ({ transferTxId: '0xorder', reused: false })),
  reuseOrder: vi.fn(async () => ({ transferTxId: '0xreuse', reused: true }))
}))

vi.mock('../../src/utils/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPricingInfo: vi.fn(async (_signer: unknown, datatokenAddress: string) => ({
    schema: 'free',
    templateId: 1,
    datatokenAddress,
    publishMarketFee: {}
  })),
  getOrderPrice: vi.fn(async () => ({ total: '0', consumeMarketFee: '0' }))
}))

const PUBLISHER_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'
const DATASET = '[{"row":1},{"row":2}]'
const JOB_ID = `env-1-${'a'.repeat(64)}`

let server: Server
let baseUrl: string
const output: string[] = []
/** RPC calls the stub does not answer. Any of them fails the command's test. */
const unstubbed: string[] = []
/** Every request the mock server received, as `METHOD url`. */
const received: string[] = []

/** `getMetaData()`'s selector. */
const GET_METADATA = id('getMetaData()').slice(0, 10)
const HEAD = 100
const NOW = Math.floor(Date.now() / 1000)

/** A block as ethers' formatter wants it, one every 2 s up to the head. */
function block(number: number) {
  const hash = `0x${number.toString(16).padStart(64, '0')}`

  return {
    number: `0x${number.toString(16)}`,
    hash,
    parentHash: `0x${Math.max(number - 1, 0)
      .toString(16)
      .padStart(64, '0')}`,
    timestamp: `0x${(NOW - (HEAD - number) * 2).toString(16)}`,
    nonce: '0x0000000000000000',
    difficulty: '0x0',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    miner: `0x${'0'.repeat(40)}`,
    extraData: '0x',
    baseFeePerGas: '0x1',
    transactions: []
  }
}

/** What the examples reach over HTTP themselves: the RPC, the IPFS API, a file. */
function startServer(): Promise<string> {
  const coder = AbiCoder.defaultAbiCoder()

  const rpc = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case 'eth_chainId':
        return `0x${CHAIN_ID.toString(16)}`
      case 'net_version':
        return String(CHAIN_ID)
      case 'eth_blockNumber':
        return `0x${HEAD.toString(16)}`
      case 'eth_getTransactionCount':
        return '0x4'
      case 'eth_getBlockByNumber': {
        // The previous-order lookup dates its search window by block timestamps.
        const [tag] = params as [string]
        const number = tag === 'latest' ? HEAD : Number(tag)
        return block(number)
      }
      case 'eth_getLogs':
        // No previous order: access places a fresh one.
        return []
      case 'eth_call': {
        // ERC721Template.getMetaData(): what examples/edit.ts reads after a state change.
        const [call] = params as [{ data?: string; input?: string }]
        const data = call.data ?? call.input ?? ''
        if (data.startsWith(GET_METADATA))
          return coder.encode(
            ['string', 'string', 'uint8', 'bool'],
            ['', chain.owner, chain.state, true]
          )
        unstubbed.push(`eth_call ${data.slice(0, 10)}`)
        throw new Error(`no eth_call stub for ${data.slice(0, 10)}`)
      }
      default:
        unstubbed.push(method)
        throw new Error(`no RPC stub for ${method}`)
    }
  }

  server = createServer((request, response) => {
    received.push(`${request.method} ${request.url}`)
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const url = request.url ?? '/'

      if (url === '/rpc') {
        const payload = JSON.parse(body)
        const answer = (one: { id: number; method: string; params: [] }) => {
          try {
            return {
              jsonrpc: '2.0',
              id: one.id,
              result: rpc(one.method, one.params)
            }
          } catch (error) {
            return {
              jsonrpc: '2.0',
              id: one.id,
              error: { code: -32601, message: (error as Error).message }
            }
          }
        }
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify(
            Array.isArray(payload) ? payload.map(answer) : answer(payload)
          )
        )
        return
      }

      if (url.startsWith('/ipfs/api/v0/add')) {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            Name: 'ddo',
            Hash: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
            Size: String(body.length)
          })
        )
        return
      }

      if (url.startsWith('/files/')) {
        response.end(DATASET)
        return
      }

      response.statusCode = 404
      response.end(`no stub for ${request.method} ${url}`)
    })
  })

  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    )
  )
}

/** The node mock, with the answers the access and compute commands need. */
function nodeClient(): OceanNodeClient {
  const { client } = createNodeMock({
    assets: { [ASSET_DID]: getAssetFixture() },
    policyServer: false
  })

  return Object.assign(client, {
    nodeUri: `${baseUrl}/node`,
    chainId: CHAIN_ID,
    // A free download: a zero fee, signed the way the datatoken verifies it.
    async initialize() {
      return {
        datatoken: DATATOKEN_ADDRESS,
        nonce: '1',
        providerFee: signedProviderFee({ providerFeeAmount: '0' }, 'contract')
      }
    },
    async getDownloadUrl() {
      return `${baseUrl}/files/download`
    },
    async getComputeEnvironments() {
      return [
        {
          id: 'env-1',
          consumerAddress: new Wallet(PUBLISHER_KEY).address,
          maxJobDuration: 3600,
          runningJobs: 0,
          free: { maxJobDuration: 60, resources: [] },
          resources: [{ id: 'cpu', min: 1, max: 2 }],
          fees: {}
        }
      ]
    },
    async getComputeJob(jobId: string) {
      return {
        jobId,
        status: 70,
        statusText: 'Job finished',
        dateCreated: '1700000000',
        dateFinished: '1700000100',
        results: [{ type: 'output', filename: 'outputs.tar', filesize: 10 }]
      }
    }
  }) as unknown as OceanNodeClient
}

/** Runs one command the way `npm start -- <name> ...args` does. */
async function run(name: string, ...args: string[]): Promise<string> {
  const command = COMMANDS[name]
  if (!command) throw new Error(`no example command ${name}`)

  output.length = 0
  publishSession.command = undefined
  publishSession.args = []

  await runCommand(name, command, args, {})

  return output.join('\n')
}

beforeAll(async () => {
  baseUrl = await startServer()

  // Every instance an example builds talks to the node mock instead of an ocean-node.
  const create = Nautilus.create.bind(Nautilus)
  vi.spyOn(Nautilus, 'create').mockImplementation(async (...args) => {
    const instance = await create(...args)
    ;(instance as unknown as { node: OceanNodeClient }).node = nodeClient()
    return instance
  })
})

afterAll(() => {
  vi.restoreAllMocks()
  server?.close()
})

beforeEach(() => {
  received.length = 0
  chain.state = 0
  chain.owner = new Wallet(PUBLISHER_KEY).address

  vi.stubEnv('NETWORK', 'CUSTOM')
  vi.stubEnv('CHAIN_ID', String(CHAIN_ID))
  vi.stubEnv('RPC_URL', `${baseUrl}/rpc`)
  vi.stubEnv('OCEAN_NODE_URI', `${baseUrl}/node`)
  vi.stubEnv('PRIVATE_KEY', PUBLISHER_KEY)
  vi.stubEnv('CONSUMER_PRIVATE_KEY', '')
  vi.stubEnv('DDO_STORE', 'ipfs')
  vi.stubEnv('IPFS_UPLOAD_URL', `${baseUrl}/ipfs/api/v0/add`)
  vi.stubEnv('IPFS_VERIFY', 'false')
  vi.stubEnv('ASSET_BASE_URL', `${baseUrl}/files`)
  vi.stubEnv('PUBLISH_LOG', '')
  vi.stubEnv('SSI_WALLET_API', `${baseUrl}/wallet`)
  vi.stubEnv('SSI_TRUSTED_ISSUERS', 'did:web:issuer.example')

  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    output.push(parts.map(String).join(' '))
  })
})

afterEach(() => {
  vi.unstubAllEnvs()

  // A command that reached the RPC for something the stub does not answer ran a path this
  // smoke does not model, even when the command itself caught the error.
  expect(unstubbed.splice(0)).toEqual([])
})

describe('example commands', () => {
  it('publish:access-dataset publishes and prints the DID', async () => {
    const out = await run('publish:access-dataset')

    expect(out).toMatch(/\nPublished\n/)
    expect(out).toMatch(/DID: +did:ope:[0-9a-f]{64}/)
    expect(out).toContain(`NFT:      ${NFT_ADDRESS}`)
    expect(out).toContain(`-> ${DATATOKEN_ADDRESS}`)
  })

  it('access:download downloads the file', async () => {
    const out = await run('access:download', ASSET_DID)

    expect(out).toContain(`Downloaded ${DATASET.length} bytes`)
  })

  it('compute:envs lists the environments', async () => {
    const out = await run('compute:envs')

    expect(out).toContain('The node offers 1 compute environment(s)')
    expect(out).toContain('env-1')
  })

  it('compute:status prints a job', async () => {
    const out = await run('compute:status', JOB_ID)

    expect(out).toContain(`Job ${JOB_ID}`)
    expect(out).toContain('status:  70 (Job finished)')
  })

  it('ssi:publish-gated publishes the safe policy set', async () => {
    const out = await run('ssi:publish-gated', 'gx:LegalPerson')

    expect(out).toContain('allowed-issuer')
    expect(out).toContain('did:web:issuer.example')
    expect(out).toMatch(
      /"vp_policies": \[\s*\{\s*"policy": "signature"\s*\},\s*\{\s*"policy": "minimum-credentials",\s*"args": "1"\s*\}\s*\]/
    )
    expect(out).not.toContain('holder-binding')
  })

  it('ssi:publish-gated refuses to publish without trusted issuers', async () => {
    vi.stubEnv('SSI_TRUSTED_ISSUERS', '')

    await expect(run('ssi:publish-gated')).rejects.toThrow(
      /SSI_TRUSTED_ISSUERS/
    )
  })

  it('ssi:publish-gated refuses an issuer that is not a DID before sending anything', async () => {
    vi.stubEnv(
      'SSI_TRUSTED_ISSUERS',
      'did:web:issuer.example, https://issuer.example'
    )

    await expect(run('ssi:publish-gated')).rejects.toThrow(
      /SSI_TRUSTED_ISSUERS contains 'https:\/\/issuer\.example', which is not a DID/
    )
    expect(received).toEqual([])
  })

  it('asset:revoke reads the new state from the chain', async () => {
    const out = await run('asset:revoke', ASSET_DID)

    expect(out).toContain(`Revoked ${ASSET_DID}`)
    expect(out).toContain('state on chain: 3')
  })
})
