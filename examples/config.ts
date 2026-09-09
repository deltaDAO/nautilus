import type { Config, PricingConfigWithoutOwner } from '@deltadao/nautilus'

/**
 * Networks these examples can run against.
 *
 * GENX is gone: it was already marked deprecated in v1, and it never ran an ocean-node.
 */
export enum Network {
  PONTUSXDEV = 'PONTUSXDEV',
  PONTUSXTEST = 'PONTUSXTEST',
  OASISSAPPHIRE = 'OASISSAPPHIRE',
  /**
   * A stack you run yourself — chain 8996 plus an ocean-node. Unlike the other
   * networks, every address here comes from the environment, because a local
   * deployment mints fresh ones each time it comes up. `example.env` lists the
   * variables this network reads.
   */
  LOCAL = 'LOCAL'
}

/** Reads a variable that only the LOCAL network needs, with a pointed error. */
function fromLocalEnv(name: string): string {
  const value = process.env[name]

  if (!value)
    throw new Error(
      `NETWORK=LOCAL needs ${name}. Export the addresses your local deployment ` +
        'produced — see example.env for the full list — or set NETWORK to one of ' +
        'the hosted networks instead.'
    )

  return value
}

/**
 * What nautilus v2 needs per network.
 *
 * Three fields v1 had are gone, because the stack changed:
 *
 *   - `metadataCacheUri` (Aquarius) and `providerUri` (Provider) collapsed into a single
 *     **`oceanNodeUri`** — one ocean-node now serves metadata, provider services and the
 *     indexer.
 *   - `subgraphUri` is gone entirely. Pricing is read from chain and from the DDO's indexed
 *     stats, so no subgraph deployment is involved.
 *
 * `nodeUri` is still here, and still means the **blockchain RPC** — an easy pair to confuse
 * with `oceanNodeUri`.
 *
 * ## About the `oceanNodeUri` defaults below
 *
 * nautilus v2 needs an **ocean-node**. At the time of writing, the public Pontus-X endpoints
 * (`provider.{dev,test}.pontus-x.eu`) still report `Provider 2.1.3` — the legacy standalone
 * Provider — and advertise none of the endpoints ocean-node adds (`PolicyServerPassthrough`,
 * `initializePSVerification`, `freeCompute`, ...). The hostnames below are the expected
 * ocean-node addresses and are **not yet resolvable**.
 *
 * So: set `OCEAN_NODE_URI` in `.env` to whichever ocean-node you actually have — one you run
 * yourself, or one deltaDAO points you at. `checkNode()` in `nautilus.ts` tells you which of
 * the two you are talking to.
 */
export type NetworkConfig = Partial<Config> & {
  chainId: number
  network: string
  nodeUri: string
  oceanNodeUri: string
}

export const NETWORK_CONFIGS: { [key in Network]: NetworkConfig } = {
  [Network.PONTUSXDEV]: {
    chainId: 32456,
    network: 'pontusxdev',
    nodeUri: 'https://rpc.dev.pontus-x.eu',
    // Expected ocean-node address; not resolvable yet. Override with OCEAN_NODE_URI.
    oceanNodeUri: 'https://ocean-node.dev.pontus-x.eu',
    oceanTokenAddress: '0xdF171F74a8d3f4e2A789A566Dce9Fa4945196112',
    oceanTokenSymbol: 'OCEAN',
    fixedRateExchangeAddress: '0x8372715D834d286c9aECE1AcD51Da5755B32D505',
    dispenserAddress: '0x5461b629E01f72E0A468931A36e039Eea394f9eA',
    nftFactoryAddress: '0xFdC4a5DEaCDfc6D82F66e894539461a269900E13',
    providerAddress: '0x68C24FA5b2319C81b34f248d1f928601D2E5246B'
  },
  [Network.PONTUSXTEST]: {
    chainId: 32457,
    network: 'pontusxtest',
    nodeUri: 'https://rpc.test.pontus-x.eu',
    // Expected ocean-node address; not resolvable yet. Override with OCEAN_NODE_URI.
    oceanNodeUri: 'https://ocean-node.test.pontus-x.eu',
    oceanTokenAddress: '0x5B190F9E2E721f8c811E4d584383E3d57b865C69',
    oceanTokenSymbol: 'OCEAN',
    fixedRateExchangeAddress: '0xcE0F39abB6DA2aE4d072DA78FA0A711cBB62764E',
    dispenserAddress: '0xaB5B68F88Bc881CAA427007559E9bbF8818026dE',
    nftFactoryAddress: '0x2C4d542ff791890D9290Eec89C9348A4891A6Fd2',
    providerAddress: '0x9546d39CE3E48BC942f0be4AA9652cBe0Aff3592'
  },
  [Network.OASISSAPPHIRE]: {
    chainId: 23294,
    network: 'oasis_sapphire',
    nodeUri: 'https://rpc.main.pontus-x.eu/0953a56072a9a7ca46f57498453d2b3d',
    // Expected ocean-node address; not resolvable yet. Override with OCEAN_NODE_URI.
    oceanNodeUri: 'https://ocean-node.main.pontus-x.eu',
    oceanTokenAddress: '0x39d22B78A7651A76Ffbde2aaAB5FD92666Aca520',
    oceanTokenSymbol: 'OCEAN',
    fixedRateExchangeAddress: '0xE0a3fd09646dDA15f119b6Ad9Fcd1A110c432e1E',
    dispenserAddress: '0x9B7d696023Cf6f7Fbc8B7F4a9cEaACC46d7E9A24',
    nftFactoryAddress: '0x2b4E0fA953Ac6f762cb0cC6736d257a0509C9f9B',
    providerAddress: '0x566c1Bd445392Fd3bCd7D7D8D63dd0d8f3B14571',
    // Oasis Sapphire is a confidential EVM. ocean.js wraps the signer with the Sapphire
    // paratime and uses datatoken template 4 when this is set.
    sdk: 'oasis'
  },
  // Populated lazily by resolveNetwork(), so that merely importing this module
  // does not require a local stack to be running.
  [Network.LOCAL]: {
    chainId: 8996,
    network: 'development',
    nodeUri: 'http://127.0.0.1:8545',
    oceanNodeUri: 'http://127.0.0.1:8001',
    oceanTokenSymbol: 'OCEAN',
    sdk: 'evm'
  }
}

/**
 * Fills the LOCAL entry from the environment.
 *
 * Kept separate from NETWORK_CONFIGS so importing this file never throws for
 * someone using a remote network.
 */
function localNetworkConfig(): NetworkConfig {
  return {
    ...NETWORK_CONFIGS[Network.LOCAL],
    chainId: Number(process.env.CHAIN_ID || 8996),
    nodeUri: fromLocalEnv('RPC_URL'),
    oceanNodeUri: fromLocalEnv('OCEAN_NODE_URI'),
    oceanTokenAddress: fromLocalEnv('OCEAN_TOKEN_ADDRESS'),
    fixedRateExchangeAddress: fromLocalEnv('FIXED_RATE_EXCHANGE_ADDRESS'),
    dispenserAddress: fromLocalEnv('DISPENSER_ADDRESS'),
    nftFactoryAddress: fromLocalEnv('NFT_FACTORY_ADDRESS')
  }
}

/**
 * Ready-made pricing configs, with the payment-token addresses filled in per network.
 *
 * To change a price, edit `fixedRate` — it is a decimal string, e.g. `'2.95'`.
 */
export type PricingConfigs = {
  [key in Network]: { [key: string]: PricingConfigWithoutOwner }
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const PRICING_CONFIGS: PricingConfigs = {
  [Network.PONTUSXDEV]: {
    FREE: { type: 'free' },
    FIXED_OCEAN: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0x8372715D834d286c9aECE1AcD51Da5755B32D505',
        baseTokenAddress: '0xdF171F74a8d3f4e2A789A566Dce9Fa4945196112',
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    },
    FIXED_EUROE: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0x8372715D834d286c9aECE1AcD51Da5755B32D505',
        baseTokenAddress: '0x8A4826071983655805bF4f29828577Cd6b1aC0cB',
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    },
    FIXED_EURAU: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0x8372715D834d286c9aECE1AcD51Da5755B32D505',
        baseTokenAddress: '0x852381bB887d3Cf4AEB9e1E9De3eB033AF82fBeE',
        baseTokenDecimals: 6, // EURAU uses 6 decimals
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    }
  },
  [Network.PONTUSXTEST]: {
    FREE: { type: 'free' },
    FIXED_OCEAN: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0xcE0F39abB6DA2aE4d072DA78FA0A711cBB62764E',
        baseTokenAddress: '0x5B190F9E2E721f8c811E4d584383E3d57b865C69',
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    },
    FIXED_EUROE: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0xcE0F39abB6DA2aE4d072DA78FA0A711cBB62764E',
        baseTokenAddress: '0xdd0a0278f6BAF167999ccd8Aa6C11A9e2fA37F0a',
        baseTokenDecimals: 6,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    },
    FIXED_EURAU: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0xcE0F39abB6DA2aE4d072DA78FA0A711cBB62764E',
        baseTokenAddress: '0xE158265FD2be5BCc208621f2c0f8AfCF11aC8408',
        baseTokenDecimals: 6,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    },
    FIXED_LOGGING: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0xcE0F39abB6DA2aE4d072DA78FA0A711cBB62764E',
        baseTokenAddress: '0x300Dad6baD13ab3d4d44Ac7102a4f25c14cc1e82',
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    }
  },
  // Filled in by resolveNetwork() — see localPricingConfig().
  [Network.LOCAL]: {
    FREE: { type: 'free' }
  },
  [Network.OASISSAPPHIRE]: {
    FREE: { type: 'free' },
    FIXED_LOGGING: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: '0xE0a3fd09646dDA15f119b6Ad9Fcd1A110c432e1E',
        baseTokenAddress: '0x431aE822B6D59cc96dA181dB632396f58932dA9d',
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        // The price in the PTX logging token. Change only this to reprice.
        fixedRate: '2.95',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    }
  }
}

/**
 * Pricing for the local stack.
 *
 * deploy-contracts.js deploys an Ocean token and MockDAI/MockUSDC on chain
 * 8996; Ocean is the one every dev account already holds (100k each for
 * accounts 1-9, 1M for account 0), so it is the only sensible payment token
 * here. EUROe/EURAU/PTX simply do not exist locally.
 */
function localPricingConfig(config: NetworkConfig): {
  [key: string]: PricingConfigWithoutOwner
} {
  return {
    FREE: { type: 'free' },
    FIXED_OCEAN: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: config.fixedRateExchangeAddress as string,
        baseTokenAddress: config.oceanTokenAddress as string,
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    }
  }
}

/** Reads NETWORK from the environment and returns its configs. */
export function resolveNetwork(): {
  name: Network
  networkConfig: NetworkConfig
  pricingConfig: { [key: string]: PricingConfigWithoutOwner }
} {
  const supported = Object.values(Network).join(', ')

  if (!process.env.NETWORK)
    throw new Error(`Set NETWORK in your .env file. Supported: ${supported}.`)

  const selected = process.env.NETWORK.toUpperCase()

  if (!(selected in Network))
    throw new Error(
      `Unsupported NETWORK '${selected}'. Supported: ${supported}.`
    )

  const name = Network[selected as keyof typeof Network]

  if (name === Network.LOCAL) {
    const networkConfig = localNetworkConfig()

    return {
      name,
      networkConfig,
      pricingConfig: localPricingConfig(networkConfig)
    }
  }

  const networkConfig = { ...NETWORK_CONFIGS[name] }

  // The usual case for now, since the public endpoints are still legacy Provider.
  if (process.env.OCEAN_NODE_URI)
    networkConfig.oceanNodeUri = process.env.OCEAN_NODE_URI

  return { name, networkConfig, pricingConfig: PRICING_CONFIGS[name] }
}
