import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = join(__dirname, '../src/package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath).toString())

// NOTE: We explicitly don't want to publish the type field.
// We create a separate package.json for `dist/cjs` and `dist/esm` that has the type field.
delete packageJson.type

writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
