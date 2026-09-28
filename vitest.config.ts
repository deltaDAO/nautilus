import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // Build output and type-only barrels carry no executable logic worth measuring.
      exclude: [
        'src/_esm/**',
        'src/_types/**',
        'src/@types/**',
        'src/**/index.ts'
      ]
    }
  }
})
