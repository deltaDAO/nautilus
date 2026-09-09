import {
  type CredentialProvider,
  type DdoSigner,
  IpfsRemoteStore,
  LogLevel,
  Nautilus,
  NodePersistentRemoteStore,
  type RemoteStore
} from '@deltadao/nautilus'
import { JsonRpcProvider, type Signer, Wallet } from 'ethers'
import { type NetworkConfig, resolveNetwork } from './config'

/**
 * Shared setup for every example.
 *
 * Two things are worth understanding here, because they are the biggest changes from
 * nautilus v1.
 *
 * **The signer is ethers v6.** `JsonRpcProvider` is a top-level export now; the `providers`
 * namespace is gone.
 *
 * **Publishing needs a remote store.** nautilus signs the DDO as a verifiable credential,
 * stores it off chain, and writes only a `{ remote }` pointer on chain. That pointer needs
 * somewhere to point, so `Nautilus.create` takes a `RemoteStore`. The store itself needs an
 * ocean-node client, which is why the instance is built in two steps below.
 */

export function getSigner(networkConfig: NetworkConfig): Signer {
  const privateKey = process.env.PRIVATE_KEY

  if (!privateKey)
    throw new Error(
      'Set PRIVATE_KEY in your .env file. Copy example.env to get started.'
    )

  /**
   * `cacheTimeout: -1` turns off ethers' 250ms cache on
   * eth_getTransactionCount. Leave it on and two sends less than 250ms apart
   * reuse the same nonce, so the second is rejected as "nonce too low" — which
   * a public chain never shows you, because its block time is far longer than
   * the cache window, but a local chain hits constantly.
   */
  const provider = new JsonRpcProvider(networkConfig.nodeUri, undefined, {
    cacheTimeout: -1
  })

  return new Wallet(privateKey, provider)
}

/**
 * Where the signed DDO is stored.
 *
 * Defaults to the ocean-node's own persistent storage, so the examples need no external
 * service. Set `IPFS_UPLOAD_URL` to use IPFS instead.
 *
 * ocean-node resolves the pointer through the same storage layer it uses for asset files, so
 * `url`, `ipfs`, `arweave`, `s3`, `ftp` and `nodePersistentStorage` all work — implement
 * `RemoteStore` for anything else.
 */
export function getRemoteStore(nautilus: Nautilus): RemoteStore {
  if (process.env.IPFS_UPLOAD_URL)
    return new IpfsRemoteStore({ uploadUrl: process.env.IPFS_UPLOAD_URL })

  return new NodePersistentRemoteStore(nautilus.getNodeClient())
}

export interface SetupOptions {
  /** Show nautilus's internal logs. */
  verbose?: boolean
  /** Satisfies credential-gated assets. See identity.ts. */
  credentials?: CredentialProvider
  /** Signs the DDO. Defaults to signing with the Ethereum key. See identity.ts. */
  ddoSigner?: DdoSigner
  /** Skip building a remote store — fine for read-only flows. */
  withoutRemoteStore?: boolean
}

export interface Setup {
  nautilus: Nautilus
  signer: Signer
  owner: string
  networkConfig: NetworkConfig
  pricingConfig: ReturnType<typeof resolveNetwork>['pricingConfig']
}

/** Builds a ready-to-use nautilus instance for the network named in `.env`. */
export async function setup(options: SetupOptions = {}): Promise<Setup> {
  const { name, networkConfig, pricingConfig } = resolveNetwork()

  console.log(`Network:    ${name}`)
  console.log(`RPC:        ${networkConfig.nodeUri}`)
  console.log(`ocean-node: ${networkConfig.oceanNodeUri}`)

  if (options.verbose) Nautilus.setLogLevel(LogLevel.Verbose)

  const signer = getSigner(networkConfig)
  const owner = await signer.getAddress()

  console.log(`Account:    ${owner}`)

  // First instance: gives us a node client to build the remote store from.
  const bootstrap = await Nautilus.create(signer, { config: networkConfig })

  if (options.withoutRemoteStore)
    return { nautilus: bootstrap, signer, owner, networkConfig, pricingConfig }

  const nautilus = await Nautilus.create(signer, {
    config: networkConfig,
    remoteStore: getRemoteStore(bootstrap),
    credentials: options.credentials,
    ddoSigner: options.ddoSigner
  })

  return { nautilus, signer, owner, networkConfig, pricingConfig }
}

/**
 * Checks what is actually listening at `oceanNodeUri`.
 *
 * Worth running first, because the failure it catches is confusing otherwise. nautilus v2
 * needs an **ocean-node**; a legacy standalone Provider answers on the same paths for some
 * calls but advertises none of the endpoints ocean-node adds, so publishing gets as far as
 * encrypting files and then fails with "does not answer as an ocean-node".
 *
 * The node's root URL is its discovery document: it lists `serviceEndpoints`, which is how
 * ocean.js finds every route.
 */
export async function checkNode(oceanNodeUri: string): Promise<{
  reachable: boolean
  software?: string
  version?: string
  isOceanNode: boolean
}> {
  // Endpoints ocean-node advertises and the legacy Provider does not.
  const OCEAN_NODE_MARKERS = [
    'PolicyServerPassthrough',
    'initializePSVerification',
    'freeCompute',
    'computeStreamableLogs',
    'jobs',
    'directCommand'
  ]

  let document: {
    software?: string
    version?: string
    serviceEndpoints?: Record<string, unknown>
  }

  try {
    const response = await fetch(oceanNodeUri)

    if (!response.ok) {
      console.log(
        `✗ ${oceanNodeUri} answered ${response.status} ${response.statusText}`
      )
      return { reachable: false, isOceanNode: false }
    }

    document = await response.json()
  } catch (error) {
    console.log(
      `✗ ${oceanNodeUri} is not reachable: ${error instanceof Error ? error.message : error}`
    )
    console.log('  Set OCEAN_NODE_URI in .env to an ocean-node you can reach.')
    return { reachable: false, isOceanNode: false }
  }

  const endpoints = Object.keys(document.serviceEndpoints ?? {})
  const found = OCEAN_NODE_MARKERS.filter((marker) =>
    endpoints.includes(marker)
  )
  const isOceanNode = found.length > 0

  console.log(`${isOceanNode ? '✓' : '✗'} ${oceanNodeUri}`)
  console.log(
    `  software:  ${document.software ?? 'unknown'} ${document.version ?? ''}`
  )
  console.log(`  endpoints: ${endpoints.length}`)

  if (isOceanNode) {
    console.log(`  ocean-node endpoints: ${found.join(', ')}`)
  } else {
    console.log(
      '  This looks like the legacy standalone Provider, not an ocean-node.'
    )
    console.log(
      '  nautilus v2 needs an ocean-node. Publishing will fail against this URL.'
    )
    console.log('  Set OCEAN_NODE_URI in .env to an ocean-node you can reach.')
  }

  return {
    reachable: true,
    software: document.software,
    version: document.version,
    isOceanNode
  }
}
