import * as dotenv from 'dotenv'
import {
  COMMANDS,
  formatCommandHelp,
  formatHelp,
  formatUsage,
  requiredArgs,
  runCommand
} from './commands'

/**
 * Runnable nautilus v2 examples.
 *
 *   npm start -- help
 *   npm start -- publish:access-dataset
 *   npm start -- compute:free did:ope:dataset… did:ope:algorithm…
 *
 * Each command is one example; see commands.ts for the catalogue and the
 * individual modules (publish.ts, access.ts, compute.ts, edit.ts, identity.ts)
 * for the annotated implementations.
 *
 * Note the `did:ope:` prefix on every DID — that is DDO v5. v4 assets used
 * `did:op:`.
 *
 * `NETWORK=LOCAL` is the local docker stack (chain 8996) and reads its contract
 * addresses from the environment; `NETWORK=CUSTOM` is any other chain, from
 * `CHAIN_ID`, `RPC_URL` and `OCEAN_NODE_URI`. `example.env` lists every variable.
 *
 * `npm start -- <command> --help` prints what a command needs without connecting
 * to anything.
 */

// Loads .env if present. Variables already exported into the environment win,
// so a locally sourced env file overrides the file.
dotenv.config()

async function main() {
  const [name, ...args] = process.argv.slice(2)

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    console.log(formatHelp())
    return
  }

  const command = COMMANDS[name]

  if (!command) {
    console.error(`Unknown command: ${name}\n`)
    console.error(formatHelp())
    process.exitCode = 1
    return
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(formatCommandHelp(name, command))
    return
  }

  if (args.length < requiredArgs(command).length) {
    console.error(`Usage: npm start -- ${formatUsage(name, command)}`)
    console.error(`       npm start -- ${name} --help`)
    process.exitCode = 1
    return
  }

  const result = await runCommand(name, command, args, {
    verbose: process.env.VERBOSE === 'true'
  })

  // A publish or edit has printed its own summary; the raw response is the whole DDO, and
  // its store pointer is better not dumped to a terminal.
  const printed =
    typeof result === 'object' &&
    result !== null &&
    'setMetadataTxReceipt' in result

  if (result !== undefined && !printed) console.log(result)
}

main().catch((error) => {
  console.error(
    '\nExample failed:',
    error instanceof Error ? error.message : error
  )

  // nautilus wraps node and store failures; the underlying reason is on `cause`.
  const cause = error instanceof Error ? error.cause : undefined
  const reason =
    cause instanceof Error ? cause.message : cause ? String(cause) : ''

  if (reason && !String(error?.message).includes(reason))
    console.error('  cause:', reason)

  process.exitCode = 1
})
