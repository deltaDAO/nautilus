import { JsonRpcProvider, type Signer, Wallet } from 'ethers'

/** Pontus-X devnet, chainId 32456 — the one network ConfigHelper ships for deltaDAO. */
export const PONTUSX_DEVNET_RPC = 'https://rpc.dev.pontus-x.eu'
export const TESTING_NODE_URI = process.env.RPC || PONTUSX_DEVNET_RPC

/**
 * A funded signer for the integration suite.
 *
 * ethers v6: `JsonRpcProvider` is a top-level export (the `providers` namespace is gone),
 * and there is no `_isProvider` marker to log.
 */
export function getSigner(key: 1 | 2 = 1, rpcUrl?: string): Signer {
  const privateKey =
    key === 1
      ? process.env.PRIVATE_KEY_TESTS_1
      : process.env.PRIVATE_KEY_TESTS_2

  if (!privateKey)
    throw new Error(
      `PRIVATE_KEY_TESTS_${key} is not set. Copy example.env to .env and fill in a funded key.`
    )

  /**
   * `cacheTimeout: -1` disables ethers' 250ms cache on eth_getTransactionCount.
   *
   * Without it, two transactions sent less than 250ms apart are both built
   * with the same cached nonce and the second is rejected as "nonce too low".
   * A public chain hides this — 12s blocks and network latency keep
   * consecutive sends well outside the window — but against a local chain
   * every multi-transaction flow (multi-service publish, add-a-service,
   * order-then-reuse) fails intermittently.
   */
  const provider = new JsonRpcProvider(rpcUrl || TESTING_NODE_URI, undefined, {
    cacheTimeout: -1
  })

  return new Wallet(privateKey, provider)
}

/** `true` when the integration suite has what it needs to run. */
export function hasIntegrationEnv(): boolean {
  return Boolean(
    process.env.PRIVATE_KEY_TESTS_1 &&
      process.env.PRIVATE_KEY_TESTS_2 &&
      process.env.NODE_URL
  )
}
