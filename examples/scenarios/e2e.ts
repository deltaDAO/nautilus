/**
 * Every non-SSI example, run in dependency order against one network.
 *
 * The individual commands each need a DID from a previous one, so running them
 * by hand means copying identifiers between invocations. This threads them
 * automatically: publish once, then point the inspect / access / edit / compute
 * examples at what was published.
 *
 * It is a smoke test, not an assertion suite — the nautilus integration suite
 * is where behaviour is pinned down. What this answers is narrower and useful
 * on its own: *does every example still run?*
 *
 *   cd examples && npm run scenario:e2e
 *
 * It needs a funded account, a DDO store (DDO_STORE, see example.env) and, for
 * the compute steps, a node advertising a compute environment. With
 * CONSUMER_PRIVATE_KEY set, the access and compute steps run as that second
 * account, against assets whose allowlist includes it.
 *
 * Every asset it publishes is revoked at the end, so a run leaves nothing listed
 * behind; set E2E_KEEP_ASSETS=true to keep them. Revoking is one-way. Set
 * PUBLISH_LOG to keep a JSON line per publish and edit, with the store pointers
 * to unpin or delete.
 *
 * SSI examples are excluded. The gating path through ocean-node works, but
 * walt.id's wallet endpoints cannot consume the ktor-authnz token its own web3
 * login issues, so nautilus can authenticate and then not read its wallet —
 * run `npm start -- ssi:round-trip` by hand against a verifier you trust.
 */
import * as dotenv from 'dotenv'
import { COMMANDS, type Context } from '../commands'
import { setup } from '../nautilus'
import { publishedResult, publishSession } from '../publish'

dotenv.config()

const CYAN = '[36m'
const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const RESET = '[0m'

type Outcome = {
  command: string
  state: 'ok' | 'failed' | 'skipped' | 'racy'
  detail: string
  ms: number
}

/**
 * Commands whose success depends on catching a job mid-flight.
 *
 * Streamable logs only exist while the container is running, and against a
 * local chain that window is about two seconds — too early and there is no
 * container, too late and the node answers "Job not found". Failing the run on
 * that would make the report meaningless, so it is recorded as its own state
 * rather than quietly passed or counted against the total.
 */
const RACY = new Set(['compute:logs'])

const outcomes: Outcome[] = []

/** Identifiers discovered as we go, so later examples have something to act on. */
const state: Record<string, string> = {}

/** DIDs are 71 characters; a full one per line makes the report unreadable. */
function short(value: string): string {
  return value.startsWith('did:ope:') ? `${value.slice(0, 16)}…` : value
}

const label = (command: string, args: string[]) =>
  args.length ? `${command} ${args.map(short).join(' ')}` : command

async function run(
  ctx: Context,
  command: string,
  ...args: string[]
): Promise<unknown> {
  const entry = COMMANDS[command]
  const started = Date.now()

  if (!entry) {
    outcomes.push({
      command,
      state: 'failed',
      detail: 'no such command',
      ms: 0
    })
    return undefined
  }

  // A step whose input never materialised is skipped, not failed — otherwise
  // one early failure cascades into a wall of red that hides its own cause.
  if (args.some((arg) => !arg)) {
    outcomes.push({
      command,
      state: 'skipped',
      detail: 'needs a value an earlier step did not produce',
      ms: 0
    })
    return undefined
  }

  process.stdout.write(`\n${CYAN}▸ ${label(command, args)}${RESET}\n`)

  // For PUBLISH_LOG and the resume hint: which command published or edited what.
  publishSession.command = command
  publishSession.args = args

  try {
    const result = await entry.run(ctx, ...args)

    outcomes.push({
      command,
      state: 'ok',
      detail: '',
      ms: Date.now() - started
    })

    return result
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    outcomes.push({
      command,
      state: RACY.has(command) ? 'racy' : 'failed',
      detail: detail.split('\n')[0].slice(0, 120),
      ms: Date.now() - started
    })

    // A publish that threw after its metadata transaction was mined (e.g. an IndexingError
    // or an indexer timeout) still created an asset: hand it on, so the revoke at the end
    // cleans it up.
    return publishedResult(error)
  }
}

const didOf = (result: unknown): string =>
  (result as { ddo?: { id?: string } })?.ddo?.id ?? ''

async function main() {
  const ctx = (await setup({
    verbose: false,
    withRemoteStore: true
  })) as Context

  publishSession.chainId = ctx.networkConfig.chainId

  // ── the node and the store ────────────────────────────────────────────────
  await run(ctx, 'check:node')
  await run(ctx, 'store:check')
  await run(ctx, 'compute:envs')

  // ── publish ────────────────────────────────────────────────────────────────
  await run(ctx, 'publish:validate')

  state.access = didOf(await run(ctx, 'publish:access-dataset'))
  state.compute = didOf(await run(ctx, 'publish:compute-dataset'))
  state.algorithm = didOf(await run(ctx, 'publish:compute-algorithm'))
  state.paidAlgorithm = didOf(await run(ctx, 'publish:access-algorithm'))
  state.saas = didOf(await run(ctx, 'publish:saas'))
  state.multi = didOf(await run(ctx, 'publish:multi-service'))

  // ── read back ──────────────────────────────────────────────────────────────
  await run(ctx, 'asset:inspect', state.access)
  await run(ctx, 'asset:indexing-state', state.access)
  await run(ctx, 'access:price', state.access)

  // ── consume (as the consumer, when CONSUMER_PRIVATE_KEY is set) ────────────
  await run(ctx, 'access:order', state.access)
  await run(ctx, 'access:download', state.access)
  await run(ctx, 'access:service', state.multi)
  await run(ctx, 'access:userdata', state.access, '{"rows":5}')

  // ── edit ───────────────────────────────────────────────────────────────────
  await run(ctx, 'edit:metadata', state.access, 'Renamed by scenario:e2e')
  await run(
    ctx,
    'edit:description',
    state.access,
    'Edited by scenario:e2e',
    'en'
  )
  await run(
    ctx,
    'edit:service',
    state.access,
    'first',
    'Data Access Service (edited)',
    'Edited by scenario:e2e',
    '900'
  )

  // Only a fixed-rate service has an exchange to reprice. Without a fixed pricing config
  // (PRICING_TOKEN_*, or the network's EURAU/OCEAN one) the algorithm was published free.
  const hasFixedPricing = ['FIXED', 'FIXED_EURAU', 'FIXED_OCEAN'].some(
    (key) => key in ctx.pricingConfig
  )
  await run(ctx, 'edit:price', hasFixedPricing ? state.paidAlgorithm : '', '2')
  await run(ctx, 'edit:trusted-algorithms', state.compute, state.algorithm)
  await run(
    ctx,
    'edit:algo-metadata',
    state.algorithm,
    process.env.ALGO_IMAGE_TAG ?? '18.17.1',
    process.env.ALGO_IMAGE_CHECKSUM ?? ''
  )
  await run(ctx, 'edit:add-compute-service', state.access)

  // ── compute ────────────────────────────────────────────────────────────────
  const free = await run(ctx, 'compute:free', state.compute, state.algorithm)

  // freeCompute() hands back the job itself; compute() hands back { jobs }.
  const started = free as { jobId?: string; jobs?: { jobId?: string }[] }

  state.job = started?.jobId ?? started?.jobs?.[0]?.jobId ?? ''

  await run(ctx, 'compute:status', state.job)
  await run(ctx, 'compute:logs', state.job)
  await run(ctx, 'compute:wait', state.job)
  await run(ctx, 'compute:result', state.job)

  // ── lifecycle, last: these take the assets out of circulation ──────────────
  await run(ctx, 'asset:unlist', state.saas)

  if (process.env.E2E_KEEP_ASSETS === 'true') {
    console.log(
      '\nE2E_KEEP_ASSETS=true: leaving the published assets as they are.'
    )
  } else {
    // Every asset this run published, not just one: revoking is the on-chain cleanup.
    for (const key of [
      'saas',
      'access',
      'compute',
      'algorithm',
      'paidAlgorithm',
      'multi'
    ])
      await run(ctx, 'asset:revoke', state[key])
  }

  report()
}

function report() {
  if (!outcomes.length) return

  const width = Math.max(...outcomes.map((outcome) => outcome.command.length))
  const rule = '─'.repeat(width + 34)
  const mark = {
    ok: `${GREEN}✓${RESET}`,
    failed: `${RED}✗${RESET}`,
    skipped: `${YELLOW}–${RESET}`,
    racy: `${YELLOW}~${RESET}`
  }

  console.log(`\n${rule}\nscenario:e2e\n${rule}`)

  for (const outcome of outcomes) {
    const seconds = outcome.ms ? `${(outcome.ms / 1000).toFixed(1)}s` : ''

    console.log(
      `${mark[outcome.state]} ${outcome.command.padEnd(width)}  ` +
        `${seconds.padStart(6)}  ${outcome.detail}`
    )
  }

  const failed = outcomes.filter((outcome) => outcome.state === 'failed')
  const skipped = outcomes.filter((outcome) => outcome.state === 'skipped')
  const racy = outcomes.filter((outcome) => outcome.state === 'racy')
  const ok = outcomes.filter((outcome) => outcome.state === 'ok')

  console.log(rule)
  console.log(
    `${ok.length} ran, ${failed.length} failed, ${skipped.length} skipped, ` +
      `${racy.length} timing-dependent (of ${outcomes.length})`
  )

  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error('\nscenario:e2e could not start:', error)
  report()
  process.exitCode = 1
})
