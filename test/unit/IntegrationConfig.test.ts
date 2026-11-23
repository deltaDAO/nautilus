import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Signer } from 'ethers'
import { expect, it, vi } from 'vitest'
import { getTestConfig } from '../fixtures/Config.js'

it('overrides only the addresses supplied for the matching chain', async () => {
  const chainId = 32456
  const signer = {
    provider: { getNetwork: async () => ({ chainId: BigInt(chainId) }) }
  } as unknown as Signer
  const dir = mkdtempSync(join(tmpdir(), 'nautilus-config-'))
  const file = join(dir, 'addresses.json')
  const token = '0x1111111111111111111111111111111111111111'

  try {
    writeFileSync(file, JSON.stringify({ custom: { chainId, Ocean: token } }))
    vi.stubEnv('ADDRESS_FILE', file)
    vi.stubEnv('NODE_URL', undefined)
    vi.stubEnv('ESCROW_ADDRESS', undefined)

    expect(await getTestConfig(signer)).toStrictEqual({
      chainId,
      oceanTokenAddress: token
    })
  } finally {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})
