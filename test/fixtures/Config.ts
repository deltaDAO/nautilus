import { type Config, ConfigHelper } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { getChainId } from '../../src/utils/index.js'

/**
 * Chain config for the integration suite.
 *
 * `metadataCacheUri`, `providerUri` and `subgraphUri` no longer exist on ocean.js's
 * `Config` — one `oceanNodeUri` replaces the first two and the subgraph is gone — so this
 * overrides the node URI, and the escrow contract (`ESCROW_ADDRESS`) on chains ocean.js
 * ships none for: paid compute funds only the configured contract.
 */
export async function getTestConfig(signer: Signer): Promise<Partial<Config>> {
  const chainId = await getChainId(signer)
  const defaults = new ConfigHelper().getConfig(chainId)

  return {
    ...(defaults || {}),
    chainId,
    ...(process.env.NODE_URL ? { oceanNodeUri: process.env.NODE_URL } : {}),
    ...(process.env.ESCROW_ADDRESS
      ? { escrow: process.env.ESCROW_ADDRESS }
      : {})
  }
}

/** The ocean-node under test. */
export function getNodeUri(): string {
  const nodeUri = process.env.NODE_URL

  if (!nodeUri)
    throw new Error(
      'NODE_URL is not set; the integration suite needs an ocean-node.'
    )

  return nodeUri
}
