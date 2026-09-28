import { defineConfig } from 'vitest/config'

/**
 * The integration suite talks to a live Ocean node and settles real transactions, so it
 * runs far longer than a unit test and is opt-in via PRIVATE_KEY_TESTS_1/2 and NODE_URL.
 * The timeouts here replace the per-suite `this.timeout()` calls mocha allowed.
 *
 * Deliberately standalone rather than `mergeConfig(base, ...)`: mergeConfig concatenates
 * arrays, so merging would append these globs to the unit ones and run both suites.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    // Live on-chain state is shared across these suites; running them in parallel
    // corrupts it.
    fileParallelism: false
  }
})
