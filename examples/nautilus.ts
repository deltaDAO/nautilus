import {
  type CredentialProvider,
  type DdoSigner,
  IpfsRemoteStore,
  LogLevel,
  Nautilus,
  type RemoteStore,
  S3RemoteStore,
  type WaitForIndexerOptions
} from '@deltadao/nautilus'
import { isAddress, JsonRpcProvider, type Signer, Wallet } from 'ethers'
import { type NetworkConfig, resolveNetwork } from './config'
import { describeStoredEnvelope } from './ledger'

/**
 * Shared setup for every example.
 *
 * Two things here are the biggest changes from nautilus v1, and a third is how these
 * examples are meant to be run.
 *
 * **The signer is ethers v6.** `JsonRpcProvider` is a top-level export now; the `providers`
 * namespace is gone.
 *
 * **Publishing needs a remote store.** nautilus signs the DDO as a verifiable credential, has
 * the node encrypt it, stores that envelope off chain, and writes only an encrypted
 * `{ remote }` pointer on chain. So `Nautilus.create` takes a `RemoteStore`: IPFS or S3, see
 * `getRemoteStore()` below.
 *
 * **Publisher and consumer can be different accounts.** `PRIVATE_KEY` publishes and edits;
 * `CONSUMER_PRIVATE_KEY`, if set, orders, downloads and runs compute. That is the usual
 * production split, and it is what makes the allowlists in publish.ts meaningful.
 */

export type Role = 'publisher' | 'consumer'

/** The signer for a role. The consumer falls back to `PRIVATE_KEY` when it has no key. */
export function getSigner(
  networkConfig: NetworkConfig,
  role: Role = 'publisher'
): Signer {
  const privateKey =
    role === 'consumer'
      ? process.env.CONSUMER_PRIVATE_KEY || process.env.PRIVATE_KEY
      : process.env.PRIVATE_KEY

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

/** Whether consuming runs as a separate account. */
export function hasSeparateConsumer(): boolean {
  return Boolean(process.env.CONSUMER_PRIVATE_KEY)
}

/**
 * Who may consume the allowlisted examples: the owner, the `CONSUMER_PRIVATE_KEY` account,
 * and every address in `CONSUMER_ADDRESSES` (comma separated).
 *
 * Allowlisting only the owner, as these examples used to, makes an asset nobody else can
 * download — fine for a demo, useless for a publisher/consumer test.
 */
export function allowlist(owner: string): string[] {
  const addresses = [owner]

  if (process.env.CONSUMER_PRIVATE_KEY)
    addresses.push(new Wallet(process.env.CONSUMER_PRIVATE_KEY).address)

  for (const entry of (process.env.CONSUMER_ADDRESSES ?? '').split(',')) {
    const address = entry.trim()

    if (!address) continue
    if (!isAddress(address))
      throw new Error(
        `CONSUMER_ADDRESSES contains '${address}', which is not an address.`
      )

    addresses.push(address)
  }

  // Deduplicated case-insensitively, keeping the first spelling.
  const seen = new Set<string>()

  return addresses.filter((address) => {
    const key = address.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * How long publish and edit wait for the indexer: `INDEXER_TIMEOUT_MS` (default 5 minutes,
 * nautilus's own default) and `INDEXER_INTERVAL_MS` (default 7 s).
 *
 * `waitForIndexer` throws when the time is up — an `OceanNodeError` — or as soon as the node
 * records that it could not index the transaction — an `IndexingError` with the node's
 * message. It never returns `undefined`.
 */
export function indexerOptions(): WaitForIndexerOptions {
  const read = (name: string) => {
    const value = process.env[name]?.trim()
    if (!value) return undefined

    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0)
      throw new Error(`${name} must be a positive number of milliseconds.`)

    return parsed
  }

  return {
    timeoutMs: read('INDEXER_TIMEOUT_MS'),
    intervalMs: read('INDEXER_INTERVAL_MS')
  }
}

const STORE_HELP = `Publishing and editing need a DDO store. Set DDO_STORE in .env to one of:

  DDO_STORE=ipfs  IPFS_UPLOAD_URL  an upload endpoint taking a multipart file:
                                    a Kubo node, http://127.0.0.1:5001/api/v0/add, or
                                    Pinata, https://api.pinata.cloud/pinning/pinFileToIPFS
                  IPFS_JWT          optional, sent as "Authorization: Bearer <IPFS_JWT>"
                                    (Pinata: a key with the pin and unpin scopes; the
                                    unpin scope is what store:remove needs)
                  IPFS_GATEWAY_URL  the gateway each envelope is read back from before the
                                    metadata transaction, ideally the node's IPFS_GATEWAY.
                                    Needed for anything but Kubo (Kubo is read back through
                                    its own /api/v0/cat), unless IPFS_VERIFY=false
                  IPFS_VERIFY       false to publish without that read-back

  DDO_STORE=s3    S3_ENDPOINT, S3_BUCKET, S3_WRITE_ACCESS_KEY_ID/_SECRET_ACCESS_KEY and
                  S3_READ_ACCESS_KEY_ID/_SECRET_ACCESS_KEY (a separate read-only key: it
                  goes, node-encrypted, into every on-chain pointer). Optional: S3_REGION,
                  S3_PREFIX, S3_NODE_ENDPOINT, S3_FORCE_PATH_STYLE.

The ocean-node's own storage (NodePersistentRemoteStore) cannot hold DDOs, and nautilus
rejects it. See example.env.`

/** The required S3 variables, or one error naming every one that is missing. */
function s3Env<const Names extends readonly string[]>(
  names: Names
): Record<Names[number], string> {
  const values: Record<string, string> = {}
  const missing: string[] = []

  for (const name of names) {
    const value = process.env[name]?.trim()

    if (value) values[name] = value
    else missing.push(name)
  }

  if (missing.length)
    throw new Error(
      `DDO_STORE=s3 needs ${missing.join(', ')}.\n\n${STORE_HELP}`
    )

  return values as Record<Names[number], string>
}

/** `true` / `false` from the environment, or `undefined` when unset. */
function envFlag(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase()

  if (!value) return undefined
  if (['true', '1', 'yes'].includes(value)) return true
  if (['false', '0', 'no'].includes(value)) return false

  throw new Error(`${name} must be true or false, not '${value}'.`)
}

/**
 * Path-style addressing (`endpoint/bucket/key`) is what MinIO and any IP or localhost
 * endpoint need; virtual-host style (`bucket.endpoint/key`) cannot work without a DNS name.
 * So it defaults to on for those, and to off (AWS, Exoscale) otherwise.
 */
function defaultPathStyle(endpoint: string): boolean {
  const host = new URL(
    /^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
  ).hostname

  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith('[')
  )
}

/** Which store `DDO_STORE` selects, or `undefined` if none is configured. */
function selectedStore(): 'ipfs' | 's3' | undefined {
  const value = process.env.DDO_STORE?.trim().toLowerCase()

  if (!value) {
    // An IPFS_UPLOAD_URL on its own still means IPFS, as it did before DDO_STORE existed.
    if (process.env.IPFS_UPLOAD_URL?.trim()) return 'ipfs'
    return undefined
  }

  if (value === 'ipfs' || value === 's3') return value

  throw new Error(`Unknown DDO_STORE '${value}'.\n\n${STORE_HELP}`)
}

/**
 * Where the encrypted DDO envelope is stored, from `DDO_STORE`.
 *
 * - **IPFS** (`IpfsRemoteStore`): any upload endpoint taking a multipart file. `IPFS_JWT`, if
 *   set, goes in as a Bearer token, which is what Pinata needs. `probe: 'upload'` makes
 *   `check()` do a real upload of a tiny fixed probe before `publish()` mints anything —
 *   the only check that catches a Pinata key without the pin scope. The envelope is read
 *   back before the metadata transaction: through `IPFS_GATEWAY_URL` when set, otherwise
 *   from a Kubo node's `/api/v0/cat`. Pinata needs `IPFS_GATEWAY_URL` (or `IPFS_VERIFY=false`
 *   to publish without the read-back); `check()` says so before anything is minted.
 * - **S3** (`S3RemoteStore`): AWS S3, Exoscale SOS, MinIO. Two key pairs: the write key
 *   uploads and never leaves this machine; the read key is written, node-encrypted, into
 *   every on-chain pointer, so it must be read-only and scoped to `S3_PREFIX`.
 *
 * There is no default: the ocean-node's own bucket storage cannot hold DDOs on ocean-node
 * 4.2 (it resolves a DDO without a consumer address, which a bucket refuses), so nautilus
 * rejects `NodePersistentRemoteStore` before any transaction.
 */
export function getRemoteStore(): RemoteStore {
  const store = selectedStore()

  if (store === 'ipfs') {
    const uploadUrl = process.env.IPFS_UPLOAD_URL?.trim()

    if (!uploadUrl)
      throw new Error(`DDO_STORE=ipfs needs IPFS_UPLOAD_URL.\n\n${STORE_HELP}`)

    if (/pinJSONToIPFS/i.test(uploadUrl))
      throw new Error(
        "IPFS_UPLOAD_URL points at Pinata's pinJSONToIPFS, which re-wraps the body so the node refuses to index it. Use https://api.pinata.cloud/pinning/pinFileToIPFS."
      )

    const jwt = process.env.IPFS_JWT?.trim()
    const gatewayUrl = process.env.IPFS_GATEWAY_URL?.trim() || undefined

    return new IpfsRemoteStore({
      uploadUrl,
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
      probe: 'upload',
      // Reads each envelope back before the metadata transaction. A Kubo uploadUrl needs
      // neither: it is read back through the same node's /api/v0/cat.
      ...(gatewayUrl ? { gatewayUrl } : {}),
      ...(envFlag('IPFS_VERIFY') === false ? { verify: false as const } : {})
    })
  }

  if (store === 's3') {
    const env = s3Env([
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_WRITE_ACCESS_KEY_ID',
      'S3_WRITE_SECRET_ACCESS_KEY',
      'S3_READ_ACCESS_KEY_ID',
      'S3_READ_SECRET_ACCESS_KEY'
    ] as const)

    return new S3RemoteStore({
      endpoint: env.S3_ENDPOINT,
      nodeEndpoint: process.env.S3_NODE_ENDPOINT?.trim() || undefined,
      region: process.env.S3_REGION?.trim() || undefined,
      bucket: env.S3_BUCKET,
      prefix: process.env.S3_PREFIX?.trim() || undefined,
      // MinIO and any IP/localhost endpoint need path-style; see defaultPathStyle().
      forcePathStyle:
        envFlag('S3_FORCE_PATH_STYLE') ?? defaultPathStyle(env.S3_ENDPOINT),
      writeCredentials: {
        accessKeyId: env.S3_WRITE_ACCESS_KEY_ID,
        secretAccessKey: env.S3_WRITE_SECRET_ACCESS_KEY
      },
      readCredentials: {
        accessKeyId: env.S3_READ_ACCESS_KEY_ID,
        secretAccessKey: env.S3_READ_SECRET_ACCESS_KEY
      }
    })
  }

  throw new Error(`No DDO store configured.\n\n${STORE_HELP}`)
}

/** One line on the configured store, without any secret. */
export function describeRemoteStore(): string {
  const store = selectedStore()

  if (store === 'ipfs')
    return `ipfs ${process.env.IPFS_UPLOAD_URL?.trim()}${process.env.IPFS_JWT ? ' (with IPFS_JWT)' : ''}`

  if (store === 's3')
    return `s3 ${process.env.S3_ENDPOINT?.trim()} bucket=${process.env.S3_BUCKET?.trim()} prefix=${process.env.S3_PREFIX?.trim() || '(none)'}`

  return 'none'
}

/**
 * `store:check` — runs the configured store's `check()`, exactly what `publish()` runs before
 * its first transaction. Needs no key, no chain and no node.
 *
 * For IPFS that uploads a fixed probe of a few bytes (the same CID every time); for S3 it
 * writes a probe with the write key, reads it back with the read key, makes sure the read
 * key can neither write nor delete, and deletes the probes.
 */
export async function checkRemoteStore(): Promise<void> {
  const store = getRemoteStore()

  console.log(`DDO store: ${describeRemoteStore()}`)

  if (!store.check) {
    console.log('  This store has no check(); nothing to run.')
    return
  }

  await store.check()

  console.log(
    '  ✓ check() passed: publish() would get past the store preflight.'
  )
}

/**
 * `store:remove` — deletes one stored envelope with the store's `remove()`: unpins a CID
 * (Pinata, Kubo) or deletes an S3 object with the write key. Needs no key, no chain and no
 * node.
 *
 * Only for envelopes no live asset needs: an intermediate version a later edit superseded, a
 * revoked asset, or one a failed publish left behind (`error.stored` says whether nautilus
 * already removed it). The **creation** envelope (from the publish) and the **current** one
 * of an asset that should stay indexed must stay: a node reindex replays the asset from its
 * creation event and drops it when that envelope is gone. The CIDs and object keys are in
 * `PUBLISH_LOG`; when the log shows the envelope is a creation or current one, this refuses
 * unless `force` is passed.
 */
export async function removeStoredEnvelope(
  reference: string,
  force?: string
): Promise<void> {
  const value = reference?.trim()

  if (!value)
    throw new Error(
      'Pass the CID (DDO_STORE=ipfs) or the S3 object key (DDO_STORE=s3) to remove.'
    )

  const store = getRemoteStore()

  console.log(`DDO store: ${describeRemoteStore()}`)
  console.log(
    '  Keep the creation envelope (from the publish) and the current one of every asset that should stay indexed: a node reindex replays the asset from its creation event, and drops it from the index when that envelope is gone.'
  )

  const key = value.replace(/^s3:\/\/[^/]+\//, '').replace(/^ipfs:(\/\/)?/, '')
  const known = describeStoredEnvelope(key)

  if (known && (known.creation || known.latest)) {
    const which = known.creation
      ? 'the creation envelope'
      : 'the latest envelope logged'
    if (force !== 'force')
      throw new Error(
        `PUBLISH_LOG lists ${value} as ${which} of ${known.did}. Removing it would drop the asset on the next node reindex${known.creation ? '' : ', or roll it back to an older version'}. Revoke the asset first (asset:revoke), or pass 'force' as a second argument if it is retired for good.`
      )
    console.log(
      `  ⚠ ${value} is ${which} of ${known.did}; removing it anyway (force).`
    )
  }

  if (!store.remove) {
    console.log('  This store has no remove(); nothing to do.')
    return
  }

  // The pointer as PublishResponse.stored carries it, redacted: remove() needs no secret.
  const pointer =
    selectedStore() === 's3'
      ? {
          type: 's3',
          s3Access: {
            bucket: process.env.S3_BUCKET?.trim(),
            objectKey: value.replace(/^s3:\/\/[^/]+\//, '')
          }
        }
      : { type: 'ipfs', hash: value.replace(/^ipfs:(\/\/)?/, '') }

  await store.remove(
    pointer as unknown as Parameters<NonNullable<RemoteStore['remove']>>[0]
  )

  console.log(`  ✓ removed ${value}`)
}

export interface SetupOptions {
  /** Show nautilus's internal logs. */
  verbose?: boolean
  /** Satisfies credential-gated assets. See identity.ts. */
  credentials?: CredentialProvider
  /** Signs the DDO. Defaults to signing with the Ethereum key. See identity.ts. */
  ddoSigner?: DdoSigner
  /** Build the DDO store. Only publishing and editing need one. */
  withRemoteStore?: boolean
}

export interface Setup {
  /** The publisher's instance: publishes, edits, changes lifecycle and prices. */
  nautilus: Nautilus
  /** The consumer's instance: orders, downloads, runs compute. The same as `nautilus` without `CONSUMER_PRIVATE_KEY`. */
  consumer: Nautilus
  signer: Signer
  owner: string
  consumerAddress: string
  networkConfig: NetworkConfig
  pricingConfig: ReturnType<typeof resolveNetwork>['pricingConfig']
}

/**
 * `Nautilus.create` takes its chain id from the signer, then lets `config` override it. So
 * an RPC on the wrong chain would silently run with another chain's addresses. Check first.
 */
async function assertChain(signer: Signer, networkConfig: NetworkConfig) {
  const network = await signer.provider?.getNetwork()

  if (network && Number(network.chainId) !== networkConfig.chainId)
    throw new Error(
      `The RPC ${networkConfig.nodeUri} is on chain ${network.chainId}, but NETWORK=${process.env.NETWORK} expects chain ${networkConfig.chainId}. Check NETWORK, RPC_URL and CHAIN_ID.`
    )
}

/** Builds ready-to-use nautilus instances for the network named in `.env`. */
export async function setup(options: SetupOptions = {}): Promise<Setup> {
  const { name, networkConfig, pricingConfig } = resolveNetwork()

  console.log(
    `Network:    ${name} (${networkConfig.network}, chain ${networkConfig.chainId})`
  )
  console.log(`RPC:        ${networkConfig.nodeUri}`)
  console.log(`ocean-node: ${networkConfig.oceanNodeUri}`)

  if (options.verbose) Nautilus.setLogLevel(LogLevel.Verbose)

  const signer = getSigner(networkConfig)
  const owner = await signer.getAddress()

  await assertChain(signer, networkConfig)

  console.log(`Publisher:  ${owner}`)

  const remoteStore = options.withRemoteStore ? getRemoteStore() : undefined

  if (remoteStore) console.log(`DDO store:  ${describeRemoteStore()}`)

  // Neither store needs an ocean-node client, so the store is built before the instance.
  const nautilus = await Nautilus.create(signer, {
    config: networkConfig,
    remoteStore,
    credentials: options.credentials,
    ddoSigner: options.ddoSigner
  })

  if (!hasSeparateConsumer())
    return {
      nautilus,
      consumer: nautilus,
      signer,
      owner,
      consumerAddress: owner,
      networkConfig,
      pricingConfig
    }

  const consumerSigner = getSigner(networkConfig, 'consumer')
  const consumerAddress = await consumerSigner.getAddress()

  console.log(`Consumer:   ${consumerAddress}`)

  const consumer = await Nautilus.create(consumerSigner, {
    config: networkConfig,
    credentials: options.credentials
  })

  return {
    nautilus,
    consumer,
    signer,
    owner,
    consumerAddress,
    networkConfig,
    pricingConfig
  }
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
