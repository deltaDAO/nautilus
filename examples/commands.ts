/**
 * The example catalogue, as a command map.
 *
 * Every entry is one runnable example. Selecting one by name — rather than by
 * editing and uncommenting `index.ts` — is what lets the end-to-end scenarios
 * and CI drive these without touching source.
 *
 * Each `run` receives the shared setup plus whatever positional arguments the
 * command declares in `args`.
 */

import type { Nautilus, PricingConfigWithoutOwner } from '@deltadao/nautilus'
import {
  access,
  accessSpecificService,
  accessWithUserdata,
  checkPrice,
  download
} from './access'
import {
  compute,
  computeMultipleDatasets,
  freeCompute,
  getComputeLogs,
  getComputeStatus,
  listComputeEnvironments,
  retrieveComputeResult,
  runFullComputeFlow,
  stopCompute,
  streamComputeResult,
  waitForComputeJob
} from './compute'
import type { NetworkConfig } from './config'
import {
  addComputeService,
  editAlgoMetadata,
  editDescription,
  editMetadata,
  editService,
  editServiceAllowlist,
  editServiceFiles,
  editServicePrice,
  editToSaas,
  editTrustedAlgorithms,
  inspectAsset,
  removeService,
  revokeAsset,
  unlistAsset
} from './edit'
import {
  computeOnGatedDataset,
  connectSsiWallet,
  consumeGatedAsset,
  explainCredentialFailure,
  publishGatedComputeDataset,
  publishGatedDataset,
  publishPartiallyGatedDataset,
  publishWithDidIssuer,
  runGatedPublishAndConsume,
  setupWithIdentity
} from './identity'
import { showIndexingState } from './indexing'
import {
  checkNode,
  checkRemoteStore,
  removeStoredEnvelope,
  setup
} from './nautilus'
import {
  publishAccessAlgorithm,
  publishAccessDataset,
  publishComputeAlgorithm,
  publishComputeDataset,
  publishMultiServiceDataset,
  publishSaaSOffer,
  publishSession,
  validateBeforePublishing
} from './publish'

/** Whatever `setup()` produced, handed to every command. */
export type Context = {
  /** The publisher's instance (`PRIVATE_KEY`). */
  nautilus: Nautilus
  /** The consumer's instance (`CONSUMER_PRIVATE_KEY`), or the publisher's without one. */
  consumer: Nautilus
  networkConfig: NetworkConfig
  pricingConfig: { [key: string]: PricingConfigWithoutOwner }
  owner: string
  consumerAddress: string
}

export type Command = {
  /** One line, shown by `npm start -- help`. */
  summary: string
  /** Positional argument names, for the usage line. Suffix `?` if optional. */
  args?: string[]
  /**
   * What the command needs before it runs:
   *
   *   - `'node'` (the default): NETWORK, PRIVATE_KEY, a reachable RPC and ocean-node.
   *   - `'store'`: all of that plus a DDO store (DDO_STORE) — publishing and editing.
   *   - `'none'`: nothing from setup(); the command reads what it needs itself.
   */
  requires?: 'none' | 'node' | 'store'
  /** `true` for `requires: 'none'` commands that build their own DDO store. */
  usesStore?: boolean
  /**
   * Which account it acts as. Consumer commands use CONSUMER_PRIVATE_KEY when set;
   * `'none'` commands read no key and send no transaction.
   */
  role?: 'publisher' | 'consumer' | 'none'
  /** `true` when the command builds its own Nautilus with an SSI wallet. */
  identity?: boolean
  run: (ctx: Context, ...args: string[]) => Promise<unknown>
}

/** Publish helpers all take the same four arguments. */
const publishes =
  (
    fn: (
      nautilus: Nautilus,
      networkConfig: NetworkConfig,
      pricingConfig: { [key: string]: PricingConfigWithoutOwner },
      owner: string
    ) => Promise<unknown>
  ): Command['run'] =>
  (ctx) =>
    fn(ctx.nautilus, ctx.networkConfig, ctx.pricingConfig, ctx.owner)

export const COMMANDS: Record<string, Command> = {
  // ─── diagnostics ───────────────────────────────────────────────────────────
  'check:node': {
    summary:
      'Report what is actually listening at oceanNodeUri (ocean-node vs legacy Provider)',
    run: (ctx) => checkNode(ctx.networkConfig.oceanNodeUri)
  },
  'store:check': {
    summary:
      "Run the DDO store's check() (what publish runs before minting); no key, no tx",
    requires: 'none',
    usesStore: true,
    role: 'none',
    run: () => checkRemoteStore()
  },
  'store:remove': {
    summary:
      'Unpin a CID or delete an S3 object from the DDO store; never the creation or current envelope of a live asset (a reindex drops it); no key, no tx',
    args: ['cid|objectKey', 'force?'],
    requires: 'none',
    usesStore: true,
    role: 'none',
    run: (_ctx, reference, force) => removeStoredEnvelope(reference, force)
  },

  // ─── publish ───────────────────────────────────────────────────────────────
  'publish:access-dataset': {
    requires: 'store',
    summary: 'Publish a dataset with an access service',
    run: publishes(publishAccessDataset)
  },
  'publish:compute-dataset': {
    requires: 'store',
    summary: 'Publish a dataset with a compute service',
    run: publishes(publishComputeDataset)
  },
  'publish:access-algorithm': {
    requires: 'store',
    summary: 'Publish an algorithm with an access service',
    run: publishes(publishAccessAlgorithm)
  },
  'publish:compute-algorithm': {
    requires: 'store',
    summary: 'Publish an algorithm that can run as a C2D job',
    run: publishes(publishComputeAlgorithm)
  },
  'publish:saas': {
    requires: 'store',
    summary: 'Publish a SaaS offer',
    run: publishes(publishSaaSOffer)
  },
  'publish:multi-service': {
    requires: 'store',
    summary: 'Publish one NFT carrying two services',
    run: publishes(publishMultiServiceDataset)
  },
  'publish:resume': {
    usesStore: true,
    summary:
      'Finish a publish that failed after the mint, with completePublish (no new NFT)',
    args: ['publishCommand', 'nftAddress', '...datatokens', '...commandArgs'],
    requires: 'none',
    run: async (_ctx, publishCommand, nftAddress, ...rest) => {
      const target = COMMANDS[publishCommand]
      // Addresses are the datatokens the failed run created; anything else (a credential
      // type, an algorithm DID) is an argument of the publish command itself.
      const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value)
      const datatokens = rest.filter(isAddress)
      const commandArgs = rest.filter((value) => !isAddress(value))

      if (!isAddress(nftAddress ?? ''))
        throw new Error(`'${nftAddress}' is not an NFT address.`)

      if (
        !target ||
        !(
          publishCommand.startsWith('publish:') ||
          publishCommand.startsWith('ssi:publish-')
        ) ||
        publishCommand === 'publish:resume' ||
        publishCommand === 'publish:validate'
      )
        throw new Error(
          `'${publishCommand}' is not a publish command. Pass the command the failed publish ran, e.g. publish:access-dataset.`
        )

      // The asset is rebuilt by the same command, and publishAsset() completes it on the
      // existing NFT instead of minting. So the command must build the same asset as the
      // failed run: same command, same arguments, same .env. The hint the failed run
      // printed carries all of them; check at least that the count fits the command.
      const declared = target.args ?? []
      const required = requiredArgs(target)
      const hasRest = declared.some((a) => a.startsWith('...'))

      if (
        commandArgs.length < required.length ||
        (!hasRest && commandArgs.length > declared.length)
      )
        throw new Error(
          `Got ${commandArgs.length} argument(s) for ${publishCommand} after the datatokens, but its usage is: ${formatUsage(publishCommand, target)}. Resume with the arguments the failed publish ran with, as its hint printed them.`
        )

      publishSession.command = publishCommand
      publishSession.args = commandArgs
      publishSession.resume = { nftAddress, datatokens }

      return runCommand(publishCommand, target, commandArgs, {
        verbose: process.env.VERBOSE === 'true'
      })
    }
  },
  'publish:validate': {
    summary: 'Build and validate a DDO without publishing it',
    run: publishes(validateBeforePublishing)
  },

  // ─── inspect and edit ──────────────────────────────────────────────────────
  'asset:indexing-state': {
    summary:
      "The node's indexing record: why an asset on chain is (not) indexed",
    args: ['did|nft|txId'],
    run: (ctx, reference) => showIndexingState(ctx.nautilus, reference)
  },
  'asset:inspect': {
    summary: 'Print an asset as the node has indexed it',
    args: ['did'],
    run: (ctx, did) => inspectAsset(ctx.nautilus, did)
  },
  'edit:metadata': {
    requires: 'store',
    summary: 'Change an asset name',
    args: ['did', 'name'],
    run: (ctx, did, name) => editMetadata(ctx.nautilus, did, name)
  },
  'edit:description': {
    requires: 'store',
    summary: 'Change an asset description',
    args: ['did', 'description', 'language?'],
    run: (ctx, did, description, language = 'en') =>
      editDescription(ctx.nautilus, did, description, language)
  },
  'edit:service': {
    requires: 'store',
    summary:
      "Change a service's name, description and timeout (keeps its id and orders)",
    args: ['did', 'serviceId|first', 'name', 'description?', 'timeoutSeconds?'],
    run: (ctx, did, serviceId, name, description, timeout) =>
      editService(ctx.nautilus, did, serviceId, name, description, timeout)
  },
  'edit:service-files': {
    requires: 'store',
    summary:
      "Replace a service's file, optionally with a new endpoint (gives a new service id)",
    args: ['did', 'serviceId|first', 'url', 'serviceEndpoint?'],
    run: (ctx, did, serviceId, url, endpoint) =>
      editServiceFiles(ctx.nautilus, did, serviceId, url, endpoint)
  },
  'edit:service-allow': {
    requires: 'store',
    summary:
      'Restrict one service to these addresses (service-level credentials)',
    args: ['did', 'serviceId|first', '...addresses'],
    run: (ctx, did, serviceId, ...addresses) =>
      editServiceAllowlist(ctx.nautilus, did, serviceId, addresses)
  },
  'edit:price': {
    summary: 'Reprice an existing fixed-rate exchange',
    args: ['did', 'price'],
    run: (ctx, did, price) => editServicePrice(ctx.nautilus, did, price)
  },
  'edit:saas': {
    requires: 'store',
    summary: 'Convert a service to a SaaS offer',
    args: ['did', 'redirectUrl', 'paymentMode?'],
    run: (ctx, did, url, mode = 'payperuse') =>
      editToSaas(ctx.nautilus, did, url, mode as never)
  },
  'edit:trusted-algorithms': {
    requires: 'store',
    summary: 'Set the algorithms a compute dataset trusts',
    args: ['datasetDid', '...algorithmDids'],
    run: (ctx, datasetDid, ...algorithmDids) =>
      editTrustedAlgorithms(
        ctx.nautilus,
        datasetDid,
        algorithmDids.map((did) => ({ did })),
        []
      )
  },
  'edit:algo-metadata': {
    requires: 'store',
    summary: 'Update an algorithm container tag and checksum',
    args: ['did', 'tag', 'checksum'],
    run: (ctx, did, tag, checksum) =>
      editAlgoMetadata(ctx.nautilus, did, tag, checksum)
  },
  'edit:add-compute-service': {
    requires: 'store',
    summary: 'Add a compute service to an existing asset',
    args: ['did'],
    run: (ctx, did) =>
      addComputeService(ctx.nautilus, did, ctx.networkConfig.oceanNodeUri)
  },
  'edit:remove-service': {
    requires: 'store',
    summary: 'Remove a service from an asset',
    args: ['did', 'serviceId'],
    run: (ctx, did, serviceId) => removeService(ctx.nautilus, did, serviceId)
  },
  'asset:unlist': {
    summary: 'Hide an asset from listings',
    args: ['did'],
    run: (ctx, did) => unlistAsset(ctx.nautilus, did)
  },
  'asset:revoke': {
    summary: 'Revoke an asset',
    args: ['did'],
    run: (ctx, did) => revokeAsset(ctx.nautilus, did)
  },

  // ─── download ──────────────────────────────────────────────────────────────
  'access:price': {
    role: 'consumer',
    summary: 'What ordering this asset would cost',
    args: ['did'],
    run: (ctx, did) => checkPrice(ctx.consumer, did)
  },
  'access:order': {
    role: 'consumer',
    summary: 'Order an asset and return the download URL',
    args: ['did'],
    run: (ctx, did) => access(ctx.consumer, did)
  },
  'access:download': {
    role: 'consumer',
    summary: 'Order an asset and actually fetch the bytes',
    args: ['did'],
    run: (ctx, did) => download(ctx.consumer, did)
  },
  'access:service': {
    role: 'consumer',
    summary: 'Order one specific service of an asset',
    args: ['did'],
    run: (ctx, did) => accessSpecificService(ctx.consumer, did)
  },
  'access:userdata': {
    role: 'consumer',
    summary:
      'Order an asset, passing its consumer parameters (defaults, or a JSON object)',
    args: ['did', 'userdataJson?'],
    run: (ctx, did, userdata) => accessWithUserdata(ctx.consumer, did, userdata)
  },

  // ─── compute ───────────────────────────────────────────────────────────────
  'compute:envs': {
    summary: 'List the compute environments the node advertises',
    run: (ctx) => listComputeEnvironments(ctx.consumer)
  },
  'compute:free': {
    role: 'consumer',
    summary: 'Start a free compute job — no order, no escrow, no payment token',
    args: ['datasetDid', 'algorithmDid'],
    run: (ctx, dataset, algorithm) =>
      freeCompute(ctx.consumer, dataset, algorithm)
  },
  'compute:paid': {
    role: 'consumer',
    summary: 'Start a paid compute job — orders both inputs and funds escrow',
    args: ['datasetDid', 'algorithmDid', 'computeEnv?'],
    run: (ctx, dataset, algorithm, env) =>
      compute(ctx.consumer, dataset, algorithm, env)
  },
  'compute:multi': {
    role: 'consumer',
    summary: 'Start a job over several datasets',
    args: ['algorithmDid', '...datasetDids'],
    run: (ctx, algorithm, ...datasets) =>
      computeMultipleDatasets(ctx.consumer, datasets, algorithm)
  },
  'compute:status': {
    role: 'consumer',
    summary: 'Job status (finished once dateFinished is set)',
    args: ['jobId'],
    run: (ctx, jobId) => getComputeStatus(ctx.consumer, jobId)
  },
  'compute:wait': {
    role: 'consumer',
    summary: 'Block until a job finishes',
    args: ['jobId'],
    run: (ctx, jobId) => waitForComputeJob(ctx.consumer, jobId)
  },
  'compute:logs': {
    role: 'consumer',
    summary: 'Stream job logs while it runs',
    args: ['jobId'],
    run: (ctx, jobId) => getComputeLogs(ctx.consumer, jobId)
  },
  'compute:result': {
    role: 'consumer',
    summary: 'Fetch a finished job result',
    args: ['jobId'],
    run: (ctx, jobId) => retrieveComputeResult(ctx.consumer, jobId)
  },
  'compute:stream-result': {
    role: 'consumer',
    summary: 'Stream a finished job result (better for large outputs)',
    args: ['jobId'],
    run: (ctx, jobId) => streamComputeResult(ctx.consumer, jobId)
  },
  'compute:stop': {
    role: 'consumer',
    summary: 'Stop a running job',
    args: ['jobId'],
    run: (ctx, jobId) => stopCompute(ctx.consumer, jobId)
  },
  'compute:full': {
    role: 'consumer',
    summary: 'Start, wait and fetch the result in one call',
    args: ['datasetDid', 'algorithmDid'],
    run: (ctx, dataset, algorithm) =>
      runFullComputeFlow(ctx.consumer, dataset, algorithm)
  },

  // ─── identity / credential gating ──────────────────────────────────────────
  // These build their own Nautilus via setupWithIdentity(), because they need a
  // credential provider and (sometimes) a walt.id DID signer. So they skip setup().
  'ssi:connect': {
    summary: 'Print the wallets, keys and DIDs an account holds',
    args: ['publisher|consumer?'],
    requires: 'none',
    identity: true,
    run: (_ctx, role = 'publisher') => {
      if (role !== 'publisher' && role !== 'consumer')
        throw new Error(`Role must be publisher or consumer, not '${role}'.`)

      return connectSsiWallet(role)
    }
  },
  'ssi:publish-gated': {
    usesStore: true,
    summary: 'Publish a credential-gated dataset (access service)',
    args: ['credentialType?'],
    requires: 'none',
    identity: true,
    run: async (_ctx, credentialType = 'VerifiableId') => {
      const identity = await setupWithIdentity({ withRemoteStore: true })

      return publishGatedDataset(
        identity.nautilus,
        identity.networkConfig,
        identity.pricingConfig,
        identity.owner,
        credentialType
      )
    }
  },
  'ssi:publish-gated-compute': {
    usesStore: true,
    summary:
      'Publish a credential-gated compute dataset trusting an algorithm; ssi:compute runs it',
    args: ['algorithmDid', 'credentialType?'],
    requires: 'none',
    identity: true,
    run: async (_ctx, algorithmDid, credentialType = 'VerifiableId') => {
      const identity = await setupWithIdentity({ withRemoteStore: true })

      return publishGatedComputeDataset(
        identity.nautilus,
        identity.networkConfig,
        identity.pricingConfig,
        identity.owner,
        [algorithmDid],
        credentialType
      )
    }
  },
  'ssi:publish-partial': {
    usesStore: true,
    summary: 'Publish an asset with an open preview and a gated full service',
    requires: 'none',
    identity: true,
    run: async () => {
      const identity = await setupWithIdentity({ withRemoteStore: true })

      return publishPartiallyGatedDataset(
        identity.nautilus,
        identity.networkConfig,
        identity.pricingConfig,
        identity.owner
      )
    }
  },
  'ssi:publish-did-issuer': {
    usesStore: true,
    summary: 'Sign the DDO with a walt.id key rather than an Ethereum address',
    requires: 'none',
    identity: true,
    run: async () => {
      const issuer = await setupWithIdentity({
        withDidIssuer: true,
        withRemoteStore: true
      })

      return publishWithDidIssuer(
        issuer.nautilus,
        issuer.networkConfig,
        issuer.pricingConfig,
        issuer.owner
      )
    }
  },
  'ssi:consume': {
    summary: 'Consume a gated asset',
    args: ['did'],
    requires: 'none',
    role: 'consumer',
    identity: true,
    run: async (_ctx, did) => {
      const identity = await setupWithIdentity({ role: 'consumer' })

      return consumeGatedAsset(identity.nautilus, did)
    }
  },
  'ssi:compute': {
    summary: 'Run compute on a gated dataset (see ssi:publish-gated-compute)',
    args: ['datasetDid', 'algorithmDid'],
    requires: 'none',
    role: 'consumer',
    identity: true,
    run: async (_ctx, dataset, algorithm) => {
      const identity = await setupWithIdentity({ role: 'consumer' })

      return computeOnGatedDataset(identity.nautilus, dataset, algorithm)
    }
  },
  'ssi:explain': {
    summary: 'Check a policy-server session, and name the policies that failed',
    args: ['sessionId'],
    role: 'consumer',
    identity: true,
    run: (ctx, sessionId) => explainCredentialFailure(ctx.consumer, sessionId)
  },
  'ssi:round-trip': {
    usesStore: true,
    summary:
      'Publish a gated dataset, then consume it (as the consumer, if configured)',
    args: ['credentialType?'],
    requires: 'none',
    identity: true,
    run: (_ctx, credentialType = 'VerifiableId') =>
      runGatedPublishAndConsume(credentialType)
  }
}

/** The usage line of a command: its name and its arguments. */
export function formatUsage(name: string, command: Command): string {
  return [name, ...(command.args ?? []).map((a) => `<${a}>`)].join(' ')
}

/** Arguments a command cannot run without (not `?`-optional, not `...` rest). */
export function requiredArgs(command: Command): string[] {
  return (command.args ?? []).filter(
    (a) => !a.endsWith('?') && !a.startsWith('...')
  )
}

/** `npm start -- <command> --help` — what one command does and what it needs. Offline. */
export function formatCommandHelp(name: string, command: Command): string {
  const requires =
    command.requires === 'none' && command.usesStore
      ? 'store'
      : (command.requires ?? 'node')
  const needs =
    command.role === 'none'
      ? command.usesStore
        ? 'a DDO store (DDO_STORE); no key, no chain, no ocean-node'
        : 'nothing from setup(); reads its own variables'
      : {
          none: 'nothing from setup(); reads its own variables',
          node: 'NETWORK, PRIVATE_KEY, a reachable RPC and ocean-node',
          store:
            'NETWORK, PRIVATE_KEY, a reachable RPC and ocean-node, and a DDO store (DDO_STORE)'
        }[requires]
  const actsAs = {
    consumer:
      'the consumer (CONSUMER_PRIVATE_KEY, falling back to PRIVATE_KEY)',
    publisher: 'the publisher (PRIVATE_KEY)',
    none: 'no account; reads no key and sends no transaction'
  }[command.role ?? 'publisher']

  return [
    `Usage: npm start -- ${formatUsage(name, command)}`,
    '',
    `  ${command.summary}`,
    '',
    `  Needs:   ${needs}`,
    `  Acts as: ${actsAs}`,
    ''
  ].join('\n')
}

/**
 * Runs one command: builds what it `requires`, then calls it. Used by index.ts and by
 * `publish:resume`, which re-runs a publish command.
 */
export async function runCommand(
  name: string,
  command: Command,
  args: string[],
  options: { verbose?: boolean }
): Promise<unknown> {
  const requires = command.requires ?? 'node'

  // The outermost command, for the resume hint and PUBLISH_LOG. `publish:resume` sets both
  // to the publish command it re-runs before it calls this again.
  if (publishSession.command === undefined) {
    publishSession.command = name
    publishSession.args = args
  }

  if (requires === 'none') return command.run(NO_CONTEXT, ...args)

  // `setup()` reads NETWORK and PRIVATE_KEY from the environment, resolves the chain config,
  // checks the RPC is on that chain, and — for publishing and editing — builds the DDO store.
  const ctx = await setup({
    verbose: options.verbose,
    withRemoteStore: requires === 'store'
  })

  publishSession.chainId = ctx.networkConfig.chainId

  return command.run(ctx, ...args)
}

/** Handed to `requires: 'none'` commands, which must not touch it. */
const NO_CONTEXT = new Proxy({} as Context, {
  get(_target, property) {
    throw new Error(
      `This command runs without setup(), so ctx.${String(property)} is not available. Give it requires: 'node'.`
    )
  }
})

/** `npm start -- help` */
export function formatHelp(): string {
  const groups = new Map<string, string[]>()

  for (const [name, command] of Object.entries(COMMANDS)) {
    const group = name.split(':')[0]
    const usage = formatUsage(name, command)
    const marks = [
      command.requires === 'store' || command.usesStore ? 'S' : ' ',
      command.role === 'consumer' ? 'C' : ' '
    ].join('')

    if (!groups.has(group)) groups.set(group, [])
    groups
      .get(group)
      ?.push(
        usage.length > 56
          ? `  ${marks} ${usage}\n${' '.repeat(62)}${command.summary}`
          : `  ${marks} ${usage.padEnd(56)} ${command.summary}`
      )
  }

  const sections = [...groups].map(
    ([group, lines]) => `${group}\n${lines.join('\n')}`
  )

  return [
    'Usage: npm start -- <command> [args...]',
    '       npm start -- <command> --help     what one command needs',
    '',
    'Set NETWORK and PRIVATE_KEY in .env first; see example.env. NETWORK is one of',
    'PONTUSXDEV, PONTUSXTEST, OASISSAPPHIRE, OPSEPOLIA, LOCAL (the local docker stack,',
    'chain 8996) or CUSTOM (any chain, from CHAIN_ID, RPC_URL and OCEAN_NODE_URI).',
    '',
    '  S  needs a DDO store: DDO_STORE=ipfs or DDO_STORE=s3 (check it with store:check)',
    '  C  acts as the consumer: CONSUMER_PRIVATE_KEY if set, else PRIVATE_KEY',
    '',
    ...sections,
    '',
    'End-to-end scenarios:',
    '  npm run scenario:e2e             publish → order → download → compute → revoke',
    '  npm start -- ssi:round-trip      the credential-gated round trip',
    ''
  ].join('\n')
}
