import {
  AssetBuilder,
  CredentialListTypes,
  type CredentialProvider,
  type DdoSigner,
  type FileTypes,
  getCredentials,
  getMetadata,
  getServiceByType,
  getServices,
  Nautilus,
  type PricingConfigWithoutOwner,
  ServiceBuilder,
  ServiceTypes,
  StaticCredentialProvider,
  WaltIdCredentialProvider,
  WaltIdHttpWallet,
  WaltIdVcSigner,
  type WaltIdWallet
} from '@deltadao/nautilus'
import type { Signer } from 'ethers'
import { EXAMPLE_DATASET_URL } from './assets'
import type { NetworkConfig } from './config'
import { resolveNetwork } from './config'
import {
  describeRemoteStore,
  getRemoteStore,
  getSigner,
  type Role
} from './nautilus'
import { publishAsset } from './publish'

/**
 * Credential-gated publishing and consuming, with the walt.id identity stack.
 *
 * All of this is new in nautilus v2 — the stack it depends on did not exist in v1.
 *
 * ## How the pieces fit
 *
 * Four components are involved, in a deliberate loop so the node observes every exchange:
 *
 *     nautilus ──▶ ocean-node ──▶ policy server ──▶ walt.id verifier
 *                                       ▲                   │
 *     walt.id wallet ──▶ policy-server proxy ───────────────┘
 *
 * nautilus only talks to two of them: **ocean-node**, through its policy-server passthrough,
 * and the **walt.id wallet**, to present credentials. What it needs out of the exchange is one
 * value — a verifier **session id** — which is what ocean-node wants when you download or run
 * compute.
 *
 * ## What you need
 *
 * Set `SSI_WALLET_API` in `.env`. Run `connectSsiWallet()` first to see which wallets, keys
 * and DIDs your account has, then optionally pin them with `SSI_WALLET_ID`,
 * `SSI_WALLET_KEY_ID` and `SSI_WALLET_DID`.
 *
 * With `CONSUMER_PRIVATE_KEY` set, publishing runs as `PRIVATE_KEY` and consuming as the
 * consumer, each logging in to walt.id with its own Ethereum key. The pinned `SSI_WALLET_*`
 * values belong to one account, so set `CONSUMER_SSI_WALLET_ID` and `CONSUMER_SSI_WALLET_DID`
 * for the consumer's wallet (or leave them unset to use its first wallet and DID).
 */

function getWalletApi(): string {
  const api = process.env.SSI_WALLET_API

  if (!api)
    throw new Error(
      'Set SSI_WALLET_API in your .env file — the base URL of your walt.id wallet API.'
    )

  return api
}

/**
 * The pinned wallet and DID for a role. The consumer has its own variables: the publisher's
 * pins name a wallet the consumer's account does not own.
 */
function walletEnv(role: Role): { walletId?: string; did?: string } {
  if (role === 'consumer' && process.env.CONSUMER_PRIVATE_KEY)
    return {
      walletId: process.env.CONSUMER_SSI_WALLET_ID || undefined,
      did: process.env.CONSUMER_SSI_WALLET_DID || undefined
    }

  return {
    walletId: process.env.SSI_WALLET_ID || undefined,
    did: process.env.SSI_WALLET_DID || undefined
  }
}

/** A wallet client. Swap this out for a walt.id api2 backend when you move to one. */
export function getWallet(): WaltIdWallet {
  return new WaltIdHttpWallet({ apiUrl: getWalletApi() })
}

/**
 * Step one: log in to the wallet and print what the account holds.
 *
 * Run this before anything else. Authentication is a nonce-sign-verify handshake using your
 * **Ethereum** key — the same key that signs transactions — so no separate walt.id password
 * is involved. walt.id registers the account the first time it sees the address.
 */
export async function connectSsiWallet(role: Role = 'publisher') {
  const { networkConfig } = resolveNetwork()
  const account = getSigner(networkConfig, role)
  const wallet = getWallet()

  console.log(
    `Authenticating to ${getWalletApi()} as ${await account.getAddress()}...`
  )

  const session = await wallet.authenticate(account)

  if (!session?.token) throw new Error('walt.id returned no session token.')

  console.log('Authenticated.\n')

  const wallets = await wallet.listWallets(session.token)

  console.log(`Wallets (${wallets.length}):`)
  for (const entry of wallets) console.log(`  ${entry.id} ${entry.name ?? ''}`)

  if (wallets.length === 0) {
    console.log(
      '\nThis account owns no wallet yet. Create one in the walt.id UI first.'
    )
    return { session, wallets, keys: [], dids: [] }
  }

  const walletId = walletEnv(role).walletId ?? wallets[0].id

  const keys = await wallet.listKeys(walletId, session.token)
  console.log(`\nKeys in ${walletId} (${keys.length}):`)
  for (const key of keys)
    console.log(`  ${key.keyId.id} ${key.algorithm ?? ''}`)

  const dids = await wallet.listDids(walletId, session.token)
  console.log(`\nDIDs in ${walletId} (${dids.length}):`)
  for (const did of dids)
    console.log(`  ${did.did}${did.default ? ' (default)' : ''}`)

  const prefix = role === 'consumer' ? 'CONSUMER_' : ''

  console.log('\nPin these in .env to skip the lookup:')
  console.log(`  ${prefix}SSI_WALLET_ID="${walletId}"`)
  if (keys[0] && role === 'publisher')
    console.log(`  SSI_WALLET_KEY_ID="${keys[0].keyId.id}"`)
  if (dids[0]) console.log(`  ${prefix}SSI_WALLET_DID="${dids[0].did}"`)

  return { session, wallets, keys, dids }
}

/**
 * A credential provider, which is what lets nautilus consume gated assets.
 *
 * Headless by default: it presents every credential matching the verifier's request and uses
 * the wallet's first DID, so this works unattended in a script or in CI. Pass the callbacks
 * to drive a UI instead.
 */
export function createCredentialProvider(
  nautilus: Nautilus,
  options: {
    interactive?: boolean
    role?: Role
  } = {}
): CredentialProvider {
  const { walletId, did } = walletEnv(options.role ?? 'publisher')

  return new WaltIdCredentialProvider(nautilus.getNodeClient(), {
    walletApi: getWalletApi(),
    walletId,
    did,

    ...(options.interactive
      ? {
          onSelectCredentials: async (matches, definition) => {
            console.log(
              '\nThe verifier asked for:',
              JSON.stringify(definition, null, 2)
            )
            console.log(
              `Your wallet holds ${matches.length} matching credential(s):`
            )
            for (const match of matches) console.log(`  ${match.id}`)
            // A real application would prompt here. This presents them all.
            return matches
          },
          onSelectDid: async (dids) => {
            console.log('\nPresenting as:', dids[0].did)
            return dids[0].did
          }
        }
      : {})
  })
}

/**
 * A DDO signer that issues from a real DID.
 *
 * By default nautilus signs the DDO with your Ethereum key using a non-standard
 * `alg: 'ETH-EIP191'` header, and the issuer is your address. That works with no SSI setup,
 * but the credential is not verifiable by a standard JOSE verifier. Signing with a
 * wallet-held key gives the asset a proper `did:` issuer.
 */
export async function createDidSigner(signer: Signer): Promise<DdoSigner> {
  const wallet = getWallet()
  const session = await wallet.authenticate(signer)

  if (!session?.token) throw new Error('walt.id returned no session token.')

  const walletId =
    process.env.SSI_WALLET_ID ??
    (await wallet.listWallets(session.token))[0]?.id

  if (!walletId) throw new Error('This walt.id account owns no wallet.')

  const keys = await wallet.listKeys(walletId, session.token)
  const keyId = process.env.SSI_WALLET_KEY_ID ?? keys[0]?.keyId.id

  if (!keyId)
    throw new Error(
      `Wallet ${walletId} holds no signing key. Create one in the walt.id UI.`
    )

  const dids = await wallet.listDids(walletId, session.token)
  const did =
    process.env.SSI_WALLET_DID ??
    dids.find((entry) => entry.default)?.did ??
    dids[0]?.did

  if (!did) throw new Error(`Wallet ${walletId} holds no DID.`)

  console.log(`Signing DDOs with key ${keyId}, issuing as ${did}`)

  return new WaltIdVcSigner({
    wallet,
    walletId,
    keyId,
    did,
    token: session.token
  })
}

/**
 * A nautilus instance wired for identity.
 *
 * `credentials` lets it consume gated assets; `ddoSigner` makes it publish with a DID issuer.
 * Both are optional and independent. `role: 'consumer'` builds it for the
 * `CONSUMER_PRIVATE_KEY` account, without a DDO store; `withRemoteStore` adds the store a
 * publish needs.
 */
export async function setupWithIdentity(
  options: {
    withDidIssuer?: boolean
    interactive?: boolean
    role?: Role
    withRemoteStore?: boolean
  } = {}
): Promise<{
  nautilus: Nautilus
  signer: Signer
  owner: string
  networkConfig: NetworkConfig
  pricingConfig: { [key: string]: PricingConfigWithoutOwner }
}> {
  const role = options.role ?? 'publisher'
  const { networkConfig, pricingConfig } = resolveNetwork()
  const signer = getSigner(networkConfig, role)
  const owner = await signer.getAddress()

  console.log(`SSI ${role}: ${owner}`)

  // The credential provider needs a node client, which only an instance has, so this is
  // built in two steps. (The DDO stores need none.)
  const bootstrap = await Nautilus.create(signer, { config: networkConfig })

  const remoteStore = options.withRemoteStore ? getRemoteStore() : undefined
  const credentials = createCredentialProvider(bootstrap, {
    interactive: options.interactive,
    role
  })
  const ddoSigner = options.withDidIssuer
    ? await createDidSigner(signer)
    : undefined

  if (remoteStore) console.log(`DDO store: ${describeRemoteStore()}`)

  const nautilus = await Nautilus.create(signer, {
    config: networkConfig,
    remoteStore,
    credentials,
    ddoSigner
  })

  return { nautilus, signer, owner, networkConfig, pricingConfig }
}

/**
 * Publishes a dataset that requires a verifiable credential to access.
 *
 * The `SSIpolicy` block this produces is what the policy server actually parses. Note that
 * the ddo-js TypeScript types declare a different shape (`type: 'verifiableCredential'` with
 * `requestCredentials`) which nothing in the running stack reads — nautilus emits the working
 * one.
 *
 * **VC policies** check each presented credential; **VP policies** check the presentation as
 * a whole. The policy server's defaults are `signature`, `not-before` and
 * `revoked-status-list`. Valid names can be listed from the verifier's
 * `/openid4vc/policy-list` endpoint.
 */
export async function publishGatedDataset(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string,
  credentialType = 'VerifiableId'
) {
  console.log(`Publishing a dataset gated on a ${credentialType} credential...`)

  const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Credential-Gated Access')
    .setDescription('Requires a verifiable credential to download')
    .setTimeout(3600)
    .addFile({
      type: 'url',
      url: EXAMPLE_DATASET_URL(),
      method: 'GET'
    })
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Gated Access Token', 'GAT')
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Credential-Gated Dataset')
    .setDescription(
      '# Credential-Gated Dataset\n\nDownloading this asset requires presenting a verifiable credential.'
    )
    .setAuthor('Company Name')
    .setProvidedBy('Company Name')
    .setLicense('MIT')
    .addService(service)
    .setOwner(owner)
    .addRequestCredentials(CredentialListTypes.ALLOW, [
      { type: credentialType, format: 'jwt_vc_json' }
    ])
    .setVcPolicies(CredentialListTypes.ALLOW, [
      'signature',
      'not-before',
      'revoked-status-list'
    ])
    .setVpPolicies(CredentialListTypes.ALLOW, [
      'holder-binding',
      { policy: 'minimum-credentials', args: '1' }
    ])
    .build()

  const result = await publishAsset(nautilus, asset)

  console.log(
    '  credentials:',
    JSON.stringify(getCredentials(result.ddo), null, 2)
  )

  return result
}

/**
 * Publishes a **compute** dataset that requires a verifiable credential.
 *
 * The compute counterpart of `publishGatedDataset`, and what `ssi:compute` consumes: the
 * policy server checks the credential at `startCompute`, before any order is placed. The
 * algorithms to trust are pinned at publish time — nautilus resolves their container and
 * file checksums from the live DDOs — so the job can start without a separate
 * `edit:trusted-algorithms`. Publish one with `publish:compute-algorithm`.
 */
export async function publishGatedComputeDataset(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string,
  algorithmDids: string[],
  credentialType = 'VerifiableId'
) {
  console.log(
    `Publishing a compute dataset gated on a ${credentialType} credential...`
  )

  const service = new ServiceBuilder<ServiceTypes.COMPUTE, FileTypes.URL>({
    serviceType: ServiceTypes.COMPUTE
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Credential-Gated Compute')
    .setDescription('Requires a verifiable credential to run algorithms on')
    .setTimeout(3600)
    .addFile({
      type: 'url',
      url: EXAMPLE_DATASET_URL(),
      method: 'GET'
    })
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Gated Compute Token', 'GCT')
    .allowAlgorithmNetworkAccess(false)
    .allowRawAlgorithms(false)

  if (algorithmDids.length)
    service.addTrustedAlgorithms(algorithmDids.map((did) => ({ did })))

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Credential-Gated Compute Dataset')
    .setDescription(
      '# Credential-Gated Compute Dataset\n\nRunning algorithms on this asset requires presenting a verifiable credential.'
    )
    .setAuthor('Company Name')
    .setProvidedBy('Company Name')
    .setLicense('MIT')
    .addService(service.build())
    .setOwner(owner)
    .addRequestCredentials(CredentialListTypes.ALLOW, [
      { type: credentialType, format: 'jwt_vc_json' }
    ])
    .setVcPolicies(CredentialListTypes.ALLOW, [
      'signature',
      'not-before',
      'revoked-status-list'
    ])
    .setVpPolicies(CredentialListTypes.ALLOW, ['holder-binding'])
    .build()

  const result = await publishAsset(nautilus, asset)

  console.log(
    '  trusted algorithms:',
    JSON.stringify(
      getServiceByType(result.ddo, 'compute')?.compute
        ?.publisherTrustedAlgorithms ?? []
    )
  )
  console.log(
    `\nRun it: npm start -- ssi:compute ${result.ddo.id} ${algorithmDids[0] ?? '<algorithmDid>'}`
  )

  return result
}

/**
 * Publishes with the DDO signed by a walt.id key, so the asset has a real DID issuer.
 *
 * Requires the instance to have been built with `setupWithIdentity({ withDidIssuer: true })`.
 */
export async function publishWithDidIssuer(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log('Publishing with a DID issuer...')

  const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Access Service')
    .setTimeout(3600)
    .addFile({
      type: 'url',
      url: EXAMPLE_DATASET_URL(),
      method: 'GET'
    })
    .setPricing(pricingConfig.FREE)
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: DID-Issued Dataset')
    .setDescription(
      'The DDO of this asset is a verifiable credential issued by a DID.'
    )
    .setAuthor('Company Name')
    .setProvidedBy('Company Name')
    .setLicense('MIT')
    .addService(service)
    .setOwner(owner)
    .build()

  // In the output, a did: issuer rather than a 0x address means the walt.id signer was used.
  const result = await publishAsset(nautilus, asset)

  return result
}

/**
 * Publishes an asset whose *services* are gated differently: an open preview alongside a
 * credential-gated full dataset.
 *
 * Gating is per service as well as per asset in DDO v5, and the policy server merges both
 * when deciding whether a presentation is needed.
 */
export async function publishPartiallyGatedDataset(
  nautilus: Nautilus,
  networkConfig: NetworkConfig,
  pricingConfig: { [key: string]: PricingConfigWithoutOwner },
  owner: string
) {
  console.log(
    'Publishing a dataset with an open preview and a gated full service...'
  )

  const file = {
    type: 'url' as const,
    url: EXAMPLE_DATASET_URL(),
    method: 'GET'
  }

  const preview = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Open Preview')
    .setTimeout(600)
    .addFile(file)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Preview Token', 'PREV')
    .build()

  const full = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
    serviceType: ServiceTypes.ACCESS
  })
    .setServiceEndpoint(networkConfig.oceanNodeUri)
    .setName('Gated Full Access')
    .setTimeout(3600)
    .addFile(file)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('Full Access Token', 'FULL')
    // Gating on the service, not the asset.
    .addRequestCredentials(CredentialListTypes.ALLOW, [
      { type: 'VerifiableId', format: 'jwt_vc_json' }
    ])
    .build()

  const asset = new AssetBuilder()
    .setType('dataset')
    .setName('Nautilus-Example: Preview and Gated Access')
    .setDescription(
      'The preview is open; the full dataset requires a credential.'
    )
    .setProvidedBy('Company Name')
    .setAuthor('Company Name')
    .setLicense('MIT')
    .addService(preview)
    .addService(full)
    .setOwner(owner)
    .build()

  const result = await publishAsset(nautilus, asset)

  for (const service of getServices(result.ddo))
    console.log(
      `  ${service.name} (${service.id}) gated=${JSON.stringify(service.credentials) !== '{}'}`
    )

  return result
}

/**
 * Consumes a credential-gated asset.
 *
 * Nothing about the call site changes — `access()` looks exactly as it does for an open
 * asset. The exchange happens inside, and **before** any order is placed, so a policy you
 * cannot satisfy costs nothing.
 */
export async function consumeGatedAsset(
  nautilus: Nautilus,
  assetDid: string,
  serviceId?: string
) {
  const asset = await nautilus.getAsset(assetDid)

  console.log(`Consuming ${getMetadata(asset).name}`)
  console.log('  asset credentials:', JSON.stringify(getCredentials(asset)))

  const result = await nautilus.access({ assetDid, serviceId })

  console.log('\nDownload URL:', result.url)
  console.log(`  order tx:     ${result.transferTxId}`)
  console.log(`  reused order: ${result.reusedOrder}`)

  const response = await fetch(result.url)
  const data = await response.text()

  console.log(`\nDownloaded ${data.length} bytes`)

  return data
}

/**
 * Runs compute on a gated dataset.
 *
 * Every input is checked independently, and the policy server receives one payload per
 * (asset, service) pair. As with access, all of it is resolved before any order is placed, so
 * a failure aborts the whole job with nothing spent.
 */
export async function computeOnGatedDataset(
  nautilus: Nautilus,
  datasetDid: string,
  algorithmDid: string
) {
  const environments = await nautilus.getComputeEnvironments()
  const environment =
    environments.find((candidate) => candidate.free) ?? environments[0]

  if (!environment)
    throw new Error('The node advertises no compute environment.')

  const dataset = await nautilus.getAsset(datasetDid)
  const computeService = getServiceByType(dataset, 'compute')

  if (!computeService)
    throw new Error(`Asset ${datasetDid} has no compute service.`)

  console.log(`Running compute in ${environment.id} on a gated dataset...`)

  const result = environment.free
    ? await nautilus.freeCompute({
        dataset: { did: datasetDid },
        algorithm: { did: algorithmDid },
        computeEnv: environment.id
      })
    : await nautilus.compute({
        dataset: { did: datasetDid },
        algorithm: { did: algorithmDid },
        computeEnv: environment.id
      })

  console.log(`Job started: ${result.jobs[0].jobId}`)

  return result.jobs[0]
}

/**
 * Reusing a session you already hold.
 *
 * Useful when the exchange happened elsewhere — in a browser, say — and you only need to
 * replay the result.
 *
 * Never invent a session id. The policy server derives it from
 * `sha256(consumerAddress:documentId:serviceId)` plus a random half, and rejects any session
 * whose context does not match the request. A session is valid for exactly one
 * (asset, service, consumer) triple.
 */
export async function consumeWithExistingSession(
  networkConfig: NetworkConfig,
  sessionId: string,
  assetDid: string
) {
  // The session is bound to the consumer address, so replay it as the consumer.
  const signer = getSigner(networkConfig, 'consumer')

  const nautilus = await Nautilus.create(signer, {
    config: networkConfig,
    credentials: new StaticCredentialProvider(sessionId)
  })

  const result = await nautilus.access({ assetDid })

  console.log('Download URL:', result.url)

  return result
}

/**
 * Explains why a presentation was refused.
 *
 * The reason is usually one specific policy rather than a general refusal, and the verifier's
 * report says which.
 */
export async function explainCredentialFailure(
  nautilus: Nautilus,
  sessionId: string
) {
  const provider = createCredentialProvider(
    nautilus
  ) as WaltIdCredentialProvider

  const reason = await provider.explainFailure(sessionId)

  console.log(
    reason ? `Refused because: ${reason}` : 'No failing policy was reported.'
  )

  return reason
}

/**
 * End to end: publish a gated dataset, then consume it.
 *
 * The single most useful flow to run first, because it exercises both halves against your own
 * deployment.
 *
 * Two things worth knowing about deployments before you conclude gating works:
 *
 *   - ocean-node **fails open** when its `POLICY_SERVER_URL` is unset, so an unconfigured node
 *     allows everything. nautilus detects this and continues without SSI rather than failing.
 *   - Publish-time enforcement does not exist yet: the policy server's `newDDO`, `updateDDO`,
 *     `validateDDO`, `encrypt` and `decrypt` actions are stubs that always allow. Only
 *     `download` and `startCompute` are genuinely checked.
 */
export async function runGatedPublishAndConsume(
  credentialType = 'VerifiableId'
) {
  const { nautilus, networkConfig, pricingConfig, owner } =
    await setupWithIdentity({ withRemoteStore: true })

  const published = await publishGatedDataset(
    nautilus,
    networkConfig,
    pricingConfig,
    owner,
    credentialType
  )

  console.log('\n--- now consuming it ---\n')

  // As the consumer account, when CONSUMER_PRIVATE_KEY is set; otherwise the same one.
  const consumer = await setupWithIdentity({ role: 'consumer' })

  return consumeGatedAsset(consumer.nautilus, published.ddo.id as string)
}
