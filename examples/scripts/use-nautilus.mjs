#!/usr/bin/env node
/**
 * Switch the examples between the nautilus in this checkout and the published one.
 *
 *   npm run nautilus:which           -> report which is in effect
 *   npm run use:local                -> "@deltadao/nautilus": "file:../src"
 *   npm run use:npm                  -> "@deltadao/nautilus": "^<version in src/>"
 *   npm run use:npm -- --spec 1.1.0  -> "@deltadao/nautilus": "1.1.0"
 *
 * A dependency rewrite, deliberately — not `npm link`, which writes into the host's
 * global npm prefix. Everything here stays inside this repository.
 *
 * `file:../src` is the committed default, so the examples work straight after a clone
 * with no registry round-trip. Switching modes rewrites both package.json and
 * package-lock.json; that churn is not meant to be committed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const examples = resolve(here, '..')
const nautilus = resolve(examples, '..')
const manifestPath = resolve(examples, 'package.json')

const LOCAL = 'file:../src'
const PACKAGE = '@deltadao/nautilus'

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const current = manifest.dependencies?.[PACKAGE]

const argv = process.argv.slice(2)
const specIndex = argv.indexOf('--spec')
const spec = specIndex === -1 ? undefined : argv[specIndex + 1]
const mode = argv.find((arg) => !arg.startsWith('--') && arg !== spec)

if (specIndex !== -1 && !spec)
  throw new Error('--spec needs a value, e.g. `--spec 2.0.0-beta.0`.')

if (!mode) {
  console.log(`${PACKAGE} is currently: ${current}`)
  console.log(current === LOCAL ? '  -> local build' : '  -> published package')
  process.exit(0)
}

if (!['local', 'npm'].includes(mode))
  throw new Error(`Unknown mode "${mode}". Use "local" or "npm".`)

/**
 * The version the local package declares, so `npm` mode tracks it by default. A caret
 * range over a prerelease — `^2.0.0-beta.0` — also matches later betas of the same
 * release, which is what you want while 2.0.0 is unstable.
 */
const localVersion = JSON.parse(
  readFileSync(resolve(nautilus, 'src/package.json'), 'utf8')
).version

const target = mode === 'local' ? LOCAL : (spec ?? `^${localVersion}`)

if (mode === 'npm' && !spec && Number.parseInt(localVersion, 10) < 2)
  console.warn(
    `Warning: src/package.json is still ${localVersion}, so this resolves to ` +
      `^${localVersion} — a v1 range. These examples target v2. Either run ` +
      '`changeset version` first, or pass an explicit `--spec`.'
  )

if (current === target) {
  console.log(`Already on ${mode} (${target}).`)
  process.exit(0)
}

/**
 * Local mode resolves through src/package.json's `exports` map, which points at
 * `_esm` and `_types`. Neither exists until the library is built, so build first
 * rather than leaving the user with an unresolvable import.
 */
if (mode === 'local') {
  console.log('Building nautilus…')
  execFileSync('npm', ['--prefix', nautilus, 'run', 'build'], {
    stdio: 'inherit'
  })
}

console.log(`${PACKAGE}: ${current} -> ${target}`)
console.log('Installing…')

if (mode === 'local') {
  manifest.dependencies[PACKAGE] = target
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync('npm', ['install'], { cwd: examples, stdio: 'inherit' })

  if (!existsSync(resolve(nautilus, 'src/_esm/index.js')))
    console.warn(
      'Note: src/_esm/index.js is still missing — did the build fail?'
    )
} else {
  /**
   * Going the other way needs more than a manifest rewrite. A plain `npm install`
   * keeps the existing `file:../src` symlink whenever the local version happens to
   * satisfy the new range — which is exactly what happens once `changeset version`
   * has bumped src to the very version we are asking npm for. The switch would
   * silently do nothing.
   *
   * So drop the linked copy and name the spec explicitly, which forces npm to
   * resolve it against the registry.
   */
  rmSync(resolve(examples, 'node_modules', PACKAGE), {
    recursive: true,
    force: true
  })

  // Without an operator the target is an exact version or a dist-tag; pin whatever
  // it resolves to rather than letting npm widen it to a caret range behind our back.
  const exact = /^[\^~><=]/.test(target) ? [] : ['--save-exact']

  execFileSync('npm', ['install', `${PACKAGE}@${target}`, ...exact], {
    cwd: examples,
    stdio: 'inherit'
  })
}
