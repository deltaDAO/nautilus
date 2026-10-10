import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The examples smoke run (`npm run examples:smoke` at the repo root).
 *
 * `@deltadao/nautilus` resolves to the library's source rather than its build, so the
 * module mocks the unit suite uses for the chain apply to the code the examples call.
 * `ethers` is deduplicated so the examples and the library share one copy.
 */
export default defineConfig({
  root,
  resolve: {
    alias: { '@deltadao/nautilus': resolve(root, 'src/index.ts') },
    dedupe: ['ethers']
  },
  test: {
    include: ['examples/smoke/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000
  }
})
