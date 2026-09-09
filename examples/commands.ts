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
  consumeWithExistingSession,
  explainCredentialFailure,
  publishGatedDataset,
  publishPartiallyGatedDataset,
  publishWithDidIssuer,
  runGatedPublishAndConsume,
  setupWithIdentity
} from './identity'
import { checkNode } from './nautilus'
import {
  publishAccessAlgorithm,
  publishAccessDataset,
  publishComputeAlgorithm,
  publishComputeDataset,
  publishMultiServiceDataset,
  publishSaaSOffer,
  validateBeforePublishing
} from './publish'

/** Whatever `setup()` produced, handed to every command. */
export type Context = {
  nautilus: Nautilus
  networkConfig: NetworkConfig
  pricingConfig: { [key: string]: PricingConfigWithoutOwner }
  owner: string
}

export type Command = {
  /** One line, shown by `npm start -- help`. */
  summary: string
  /** Positional argument names, for the usage line. Suffix `?` if optional. */
  args?: string[]
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

  // ─── publish ───────────────────────────────────────────────────────────────
  'publish:access-dataset': {
    summary: 'Publish a dataset with an access service',
    run: publishes(publishAccessDataset)
  },
  'publish:compute-dataset': {
    summary: 'Publish a dataset with a compute service',
    run: publishes(publishComputeDataset)
  },
  'publish:access-algorithm': {
    summary: 'Publish an algorithm with an access service',
    run: publishes(publishAccessAlgorithm)
  },
  'publish:compute-algorithm': {
    summary: 'Publish an algorithm that can run as a C2D job',
    run: publishes(publishComputeAlgorithm)
  },
  'publish:saas': {
    summary: 'Publish a SaaS offer',
    run: publishes(publishSaaSOffer)
  },
  'publish:multi-service': {
    summary: 'Publish one NFT carrying two services',
    run: publishes(publishMultiServiceDataset)
  },
  'publish:validate': {
    summary: 'Build and validate a DDO without publishing it',
    run: publishes(validateBeforePublishing)
  },

  // ─── inspect and edit ──────────────────────────────────────────────────────
  'asset:inspect': {
    summary: 'Print an asset as the node has indexed it',
    args: ['did'],
    run: (ctx, did) => inspectAsset(ctx.nautilus, did)
  },
  'edit:metadata': {
    summary: 'Change an asset name',
    args: ['did', 'name'],
    run: (ctx, did, name) => editMetadata(ctx.nautilus, did, name)
  },
  'edit:description': {
    summary: 'Change an asset description',
    args: ['did', 'description', 'language?'],
    run: (ctx, did, description, language = 'en') =>
      editDescription(ctx.nautilus, did, description, language)
  },
  'edit:price': {
    summary: 'Reprice an existing fixed-rate exchange',
    args: ['did', 'price'],
    run: (ctx, did, price) => editServicePrice(ctx.nautilus, did, price)
  },
  'edit:saas': {
    summary: 'Convert a service to a SaaS offer',
    args: ['did', 'redirectUrl', 'paymentMode?'],
    run: (ctx, did, url, mode = 'payperuse') =>
      editToSaas(ctx.nautilus, did, url, mode as never)
  },
  'edit:trusted-algorithms': {
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
    summary: 'Update an algorithm container tag and checksum',
    args: ['did', 'tag', 'checksum'],
    run: (ctx, did, tag, checksum) =>
      editAlgoMetadata(ctx.nautilus, did, tag, checksum)
  },
  'edit:add-compute-service': {
    summary: 'Add a compute service to an existing asset',
    args: ['did'],
    run: (ctx, did) =>
      addComputeService(ctx.nautilus, did, ctx.networkConfig.oceanNodeUri)
  },
  'edit:remove-service': {
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
    summary: 'What ordering this asset would cost',
    args: ['did'],
    run: (ctx, did) => checkPrice(ctx.nautilus, did)
  },
  'access:order': {
    summary: 'Order an asset and return the download URL',
    args: ['did'],
    run: (ctx, did) => access(ctx.nautilus, did)
  },
  'access:download': {
    summary: 'Order an asset and actually fetch the bytes',
    args: ['did'],
    run: (ctx, did) => download(ctx.nautilus, did)
  },
  'access:service': {
    summary: 'Order one specific service of an asset',
    args: ['did'],
    run: (ctx, did) => accessSpecificService(ctx.nautilus, did)
  },
  'access:userdata': {
    summary: 'Order an asset, passing consumer parameters',
    args: ['did'],
    run: (ctx, did) => accessWithUserdata(ctx.nautilus, did)
  },

  // ─── compute ───────────────────────────────────────────────────────────────
  'compute:envs': {
    summary: 'List the compute environments the node advertises',
    run: (ctx) => listComputeEnvironments(ctx.nautilus)
  },
  'compute:free': {
    summary: 'Start a free compute job — no order, no escrow, no payment token',
    args: ['datasetDid', 'algorithmDid'],
    run: (ctx, dataset, algorithm) =>
      freeCompute(ctx.nautilus, dataset, algorithm)
  },
  'compute:paid': {
    summary: 'Start a paid compute job — orders both inputs and funds escrow',
    args: ['datasetDid', 'algorithmDid', 'computeEnv?'],
    run: (ctx, dataset, algorithm, env) =>
      compute(ctx.nautilus, dataset, algorithm, env)
  },
  'compute:multi': {
    summary: 'Start a job over several datasets',
    args: ['algorithmDid', '...datasetDids'],
    run: (ctx, algorithm, ...datasets) =>
      computeMultipleDatasets(ctx.nautilus, datasets, algorithm)
  },
  'compute:status': {
    summary: 'Job status (70 means finished)',
    args: ['jobId'],
    run: (ctx, jobId) => getComputeStatus(ctx.nautilus, jobId)
  },
  'compute:wait': {
    summary: 'Block until a job finishes',
    args: ['jobId'],
    run: (ctx, jobId) => waitForComputeJob(ctx.nautilus, jobId)
  },
  'compute:logs': {
    summary: 'Stream job logs while it runs',
    args: ['jobId'],
    run: (ctx, jobId) => getComputeLogs(ctx.nautilus, jobId)
  },
  'compute:result': {
    summary: 'Fetch a finished job result',
    args: ['jobId'],
    run: (ctx, jobId) => retrieveComputeResult(ctx.nautilus, jobId)
  },
  'compute:stream-result': {
    summary: 'Stream a finished job result (better for large outputs)',
    args: ['jobId'],
    run: (ctx, jobId) => streamComputeResult(ctx.nautilus, jobId)
  },
  'compute:stop': {
    summary: 'Stop a running job',
    args: ['jobId'],
    run: (ctx, jobId) => stopCompute(ctx.nautilus, jobId)
  },
  'compute:full': {
    summary: 'Start, wait and fetch the result in one call',
    args: ['datasetDid', 'algorithmDid'],
    run: (ctx, dataset, algorithm) =>
      runFullComputeFlow(ctx.nautilus, dataset, algorithm)
  },

  // ─── identity / credential gating ──────────────────────────────────────────
  // These build their own Nautilus via setupWithIdentity(), because they need a
  // credential provider and (sometimes) a walt.id DID signer.
  'ssi:connect': {
    summary: 'Print the wallets, keys and DIDs your account holds',
    identity: true,
    run: () => connectSsiWallet()
  },
  'ssi:publish-gated': {
    summary: 'Publish a credential-gated dataset',
    args: ['credentialType?'],
    identity: true,
    run: async (_ctx, credentialType = 'VerifiableId') => {
      const identity = await setupWithIdentity()

      return publishGatedDataset(
        identity.nautilus,
        identity.networkConfig,
        identity.pricingConfig,
        identity.owner,
        credentialType
      )
    }
  },
  'ssi:publish-partial': {
    summary: 'Publish an asset with an open preview and a gated full service',
    identity: true,
    run: async () => {
      const identity = await setupWithIdentity()

      return publishPartiallyGatedDataset(
        identity.nautilus,
        identity.networkConfig,
        identity.pricingConfig,
        identity.owner
      )
    }
  },
  'ssi:publish-did-issuer': {
    summary: 'Sign the DDO with a walt.id key rather than an Ethereum address',
    identity: true,
    run: async () => {
      const issuer = await setupWithIdentity({ withDidIssuer: true })

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
    identity: true,
    run: async (_ctx, did) => {
      const identity = await setupWithIdentity()

      return consumeGatedAsset(identity.nautilus, did)
    }
  },
  'ssi:compute': {
    summary: 'Run compute on a gated dataset',
    args: ['datasetDid', 'algorithmDid'],
    identity: true,
    run: async (_ctx, dataset, algorithm) => {
      const identity = await setupWithIdentity()

      return computeOnGatedDataset(identity.nautilus, dataset, algorithm)
    }
  },
  'ssi:consume-session': {
    summary: 'Replay a session established elsewhere, e.g. in a browser',
    args: ['sessionId', 'did'],
    identity: true,
    run: (ctx, sessionId, did) =>
      consumeWithExistingSession(ctx.networkConfig, sessionId, did)
  },
  'ssi:explain': {
    summary: 'Explain why a presentation was refused',
    args: ['sessionId'],
    identity: true,
    run: (ctx, sessionId) => explainCredentialFailure(ctx.nautilus, sessionId)
  },
  'ssi:round-trip': {
    summary: 'Publish a gated dataset and then consume it, end to end',
    args: ['credentialType?'],
    identity: true,
    run: (_ctx, credentialType = 'VerifiableId') =>
      runGatedPublishAndConsume(credentialType)
  }
}

/** `npm start -- help` */
export function formatHelp(): string {
  const groups = new Map<string, string[]>()

  for (const [name, command] of Object.entries(COMMANDS)) {
    const group = name.split(':')[0]
    const usage = [name, ...(command.args ?? []).map((a) => `<${a}>`)].join(' ')

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)?.push(`  ${usage.padEnd(52)} ${command.summary}`)
  }

  const sections = [...groups].map(
    ([group, lines]) => `${group}\n${lines.join('\n')}`
  )

  return [
    'Usage: npm start -- <command> [args...]',
    '',
    'Set NETWORK and PRIVATE_KEY in .env first. For the local dev stack:',
    '  set -a; . ../dev-stack/.generated/local.env; set +a',
    '',
    ...sections,
    '',
    'End-to-end scenarios:',
    '  npm run scenario:e2e             publish → order → download → compute',
    '  npm start -- ssi:round-trip      the credential-gated round trip',
    ''
  ].join('\n')
}
