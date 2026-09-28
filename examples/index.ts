import * as dotenv from 'dotenv'
import { COMMANDS, type Context, formatHelp } from './commands'
import { setup } from './nautilus'

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
 * To run against a local deployment rather than a public network, set
 * `NETWORK=LOCAL` and export the addresses it produced — `example.env` lists
 * every variable that network reads.
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

  const required = (command.args ?? []).filter(
    (a) => !a.endsWith('?') && !a.startsWith('...')
  )

  if (args.length < required.length) {
    const usage = [name, ...(command.args ?? []).map((a) => `<${a}>`)].join(' ')

    console.error(`Usage: npm start -- ${usage}`)
    process.exitCode = 1
    return
  }

  // `setup()` reads NETWORK and PRIVATE_KEY from the environment, resolves the
  // chain config and wires up a remote store for the signed DDO. Identity
  // commands build their own instance on top of this one.
  const ctx = (await setup({
    verbose: process.env.VERBOSE === 'true'
  })) as Context

  const result = await command.run(ctx, ...args)

  if (result !== undefined) console.log(result)
}

main().catch((error) => {
  console.error(
    '\nExample failed:',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
})
