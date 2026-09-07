/**
 * Workaround for an upstream packaging bug in `@oceanprotocol/ddo-js` (as of 0.4.1).
 *
 * The package ships declarations at `dist/types/index.d.ts` and points the top-level
 * `types` field at them, but its `exports` map has no `types` condition:
 *
 *   "exports": { ".": { "require": "./dist/ddo.cjs", "import": "./dist/ddo.js" } }
 *
 * Once a package defines `exports`, TypeScript ignores the top-level `types` field. Under
 * both `nodenext` and `bundler` resolution the declarations therefore become unreachable
 * and every `@oceanprotocol/ddo-js` import silently degrades to `any` (TS7016 under
 * `strict`). Only the legacy `moduleResolution: "node"` ignored `exports` — and that mode
 * cannot resolve `@oceanprotocol/lib` 9.x at all, since lib 9 dropped its `main` field.
 *
 * This adds the missing `types` condition to the installed copy. It is idempotent and
 * fails soft, so a missing or already-patched dependency never breaks `npm install`.
 *
 * Remove this script (and its `postinstall` hook) once ddo.js publishes a release whose
 * exports map includes a `types` condition.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const PKG = '@oceanprotocol/ddo-js'
const TYPES = './dist/types/index.d.ts'

/**
 * Walk up from the current directory looking for the installed copy. `require.resolve`
 * is not usable here: the same broken exports map also hides `./package.json`, so asking
 * Node to resolve the manifest throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
function findManifest() {
  let dir = resolve(process.cwd())
  for (;;) {
    const candidate = join(
      dir,
      'node_modules',
      ...PKG.split('/'),
      'package.json'
    )
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

try {
  const manifestPath = findManifest()
  if (!manifestPath) {
    console.log(`[patch-ddo-js-types] ${PKG} is not installed — skipping.`)
    process.exit(0)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const root = manifest.exports?.['.']

  if (!root || typeof root !== 'object') {
    console.log(
      `[patch-ddo-js-types] ${PKG} has no exports map to patch — skipping.`
    )
  } else if (root.types) {
    console.log(
      `[patch-ddo-js-types] ${PKG} already exposes types — nothing to do.`
    )
  } else {
    // `types` must be declared before `import`/`require`: resolution picks the first match.
    manifest.exports['.'] = { types: TYPES, ...root }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(
      `[patch-ddo-js-types] added "types": "${TYPES}" to ${PKG} exports.`
    )
  }
} catch (error) {
  console.log(`[patch-ddo-js-types] skipped: ${error.message}`)
}
