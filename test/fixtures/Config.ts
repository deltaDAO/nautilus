import type { Config } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import { getChainId } from '../../src/utils/index.js'

/**
 * Chain config for the integration suite.
 *
 * `metadataCacheUri`, `providerUri` and `subgraphUri` no longer exist on ocean.js's
 * `Config` — one `oceanNodeUri` replaces the first two and the subgraph is gone — so this
 * overrides the node URI. `Nautilus.create` merges ocean.js's defaults for the chain in
 * itself; they are not spread here, because their `escrow` (the address data's `Escrow`)
 * would then count as an explicit choice. Paid compute uses the SDK default: the chain's
 * `EnterpriseEscrow` in Ocean's address data, else its `Escrow`. `ESCROW_ADDRESS`, when
 * set, is the chain's EnterpriseEscrow, for chains with no escrow in the address data
 * (Pontus-X devnet among them).
 */
export async function getTestConfig(signer: Signer): Promise<Partial<Config>> {
  const chainId = await getChainId(signer)

  return {
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
