import {
  type Config,
  getOceanConfig,
  type PricingConfigWithoutOwner
} from '@deltadao/nautilus'
import { isAddress } from 'ethers'

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
   * OP Sepolia (11155420), a public testnet. The contract addresses come from ocean.js's
   * `ConfigHelper`, which ships this chain; only the ocean-node has to come from the
   * environment. No payment token is assumed: set `PRICING_TOKEN_*` for fixed prices.
   */
  OPSEPOLIA = 'OPSEPOLIA',
  /**
   * The local docker stack — chain 8996 plus an ocean-node, both on this machine. Every
   * contract address comes from the environment, because a local deployment mints fresh
   * ones each time it comes up. Only for chain 8996: use CUSTOM for anything else.
   */
  LOCAL = 'LOCAL',
  /**
   * Any other chain, entirely from the environment: `CHAIN_ID`, `RPC_URL` and
   * `OCEAN_NODE_URI`, plus the contract addresses wherever ocean.js's `ConfigHelper` does
   * not ship them for that chain.
   */
  CUSTOM = 'CUSTOM'
}

/** Reads a variable the selected network cannot do without, with a pointed error. */
function requireEnv(network: Network, name: string, why = ''): string {
  const value = process.env[name]?.trim()

  if (!value)
    throw new Error(
      `NETWORK=${network} needs ${name}${why ? ` (${why})` : ''}. See example.env for every variable this network reads.`
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

/** The networks whose addresses are fixed, so they can be listed here. */
type HostedNetwork =
  | Network.PONTUSXDEV
  | Network.PONTUSXTEST
  | Network.OASISSAPPHIRE

export const NETWORK_CONFIGS: { [key in HostedNetwork]: NetworkConfig } = {
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
  }
}

/**
 * Ready-made pricing configs, with the payment-token addresses filled in per network.
 *
 * To change a price, edit `fixedRate` — it is a decimal string, e.g. `'2.95'`.
 */
export type PricingConfigs = {
  [key in HostedNetwork]: { [key: string]: PricingConfigWithoutOwner }
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

type Pricing = { [key: string]: PricingConfigWithoutOwner }

const CONTRACT_ENV = {
  nftFactoryAddress: 'NFT_FACTORY_ADDRESS',
  fixedRateExchangeAddress: 'FIXED_RATE_EXCHANGE_ADDRESS',
  dispenserAddress: 'DISPENSER_ADDRESS'
} as const

/**
 * The contract addresses for a chain configured from the environment: each one from its
 * variable if set, otherwise from ocean.js's `ConfigHelper` defaults for that chain. Throws,
 * naming every missing variable, when neither has it.
 */
function contractAddresses(
  network: Network,
  chainId: number,
  options: { defaults: Config | null | false }
): Pick<NetworkConfig, keyof typeof CONTRACT_ENV> {
  const defaults = options.defaults || null
  const resolved: Partial<Record<keyof typeof CONTRACT_ENV, string>> = {}
  const missing: string[] = []

  for (const [field, variable] of Object.entries(CONTRACT_ENV) as [
    keyof typeof CONTRACT_ENV,
    string
  ][]) {
    const value = process.env[variable]?.trim() || defaults?.[field]

    if (value) resolved[field] = value
    else missing.push(variable)
  }

  if (missing.length)
    throw new Error(
      `NETWORK=${network} needs ${missing.join(', ')}${
        options.defaults !== false
          ? `: ocean.js ships no contract addresses for chain ${chainId}`
          : ': export the addresses your local deployment produced'
      }. See example.env.`
    )

  return resolved
}

/**
 * OP Sepolia: ocean.js's `ConfigHelper` defaults, which `Nautilus.create` merges in by chain
 * id, plus the ocean-node you use.
 *
 * Deliberately **no** payment token. `ConfigHelper` lists an OCEAN `oceanTokenAddress` for
 * this chain; nautilus does not read it, and nothing here prices in it. Fixed prices use the
 * token you name in `PRICING_TOKEN_ADDRESS`.
 */
function opSepoliaConfig(): NetworkConfig {
  const chainId = 11155420
  const defaults = getOceanConfig(chainId)

  return {
    chainId,
    network: defaults?.network ?? 'optimism_sepolia',
    nodeUri: process.env.RPC_URL?.trim() || 'https://sepolia.optimism.io',
    // ConfigHelper's default here is 127.0.0.1:8001, which is never what you want.
    oceanNodeUri: requireEnv(
      Network.OPSEPOLIA,
      'OCEAN_NODE_URI',
      'the ocean-node you publish to and consume from'
    ),
    ...contractAddresses(Network.OPSEPOLIA, chainId, { defaults })
  }
}

/** The local docker stack: chain 8996, fresh contract addresses from the environment. */
function localNetworkConfig(): NetworkConfig {
  const chainId = Number(process.env.CHAIN_ID || 8996)

  if (chainId !== 8996)
    throw new Error(
      `NETWORK=LOCAL is the local docker stack on chain 8996, but CHAIN_ID is ${chainId}. For another chain use NETWORK=CUSTOM (or NETWORK=OPSEPOLIA for 11155420).`
    )

  const oceanTokenAddress = process.env.OCEAN_TOKEN_ADDRESS?.trim()

  return {
    chainId,
    network: 'development',
    nodeUri: process.env.RPC_URL?.trim() || 'http://127.0.0.1:8545',
    oceanNodeUri: process.env.OCEAN_NODE_URI?.trim() || 'http://127.0.0.1:8001',
    ...(oceanTokenAddress
      ? { oceanTokenAddress, oceanTokenSymbol: 'OCEAN' }
      : {}),
    sdk: 'evm',
    ...contractAddresses(Network.LOCAL, chainId, { defaults: false })
  }
}

/** Any chain, from the environment. */
function customNetworkConfig(): NetworkConfig {
  const chainId = Number(
    requireEnv(Network.CUSTOM, 'CHAIN_ID', 'the chain id of your RPC')
  )

  if (!Number.isInteger(chainId) || chainId <= 0)
    throw new Error(`CHAIN_ID must be a positive integer, not '${chainId}'.`)

  const nodeUri = requireEnv(Network.CUSTOM, 'RPC_URL', 'the chain RPC')
  const oceanNodeUri = requireEnv(Network.CUSTOM, 'OCEAN_NODE_URI')
  const defaults = getOceanConfig(chainId)

  return {
    chainId,
    network: defaults?.network ?? `custom-${chainId}`,
    nodeUri,
    oceanNodeUri,
    ...contractAddresses(Network.CUSTOM, chainId, { defaults })
  }
}

/**
 * A fixed price in a token you choose, on any network: `PRICING_TOKEN_ADDRESS` and
 * `PRICING_TOKEN_DECIMALS` (both required together), optionally `PRICING_FIXED_RATE`
 * (default `'1'`). Added to the pricing configs as `FIXED`, which the paid examples
 * prefer — see `paidPricing()`.
 *
 * The decimals are not read from chain on purpose: getting them wrong misprices by orders
 * of magnitude, so they have to be stated. EURAU, for example, has 6.
 */
function pricingTokenOverride(fixedRateAddress: string | undefined): Pricing {
  const address = process.env.PRICING_TOKEN_ADDRESS?.trim()

  if (!address) return {}

  const decimals = Number(process.env.PRICING_TOKEN_DECIMALS)

  if (
    !process.env.PRICING_TOKEN_DECIMALS ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  )
    throw new Error(
      'PRICING_TOKEN_ADDRESS is set, so PRICING_TOKEN_DECIMALS must be too (an integer, e.g. 6 for EURAU, 18 for most ERC-20s).'
    )

  if (!fixedRateAddress)
    throw new Error(
      'PRICING_TOKEN_ADDRESS is set, but this network has no fixed-rate exchange address. Set FIXED_RATE_EXCHANGE_ADDRESS.'
    )

  return {
    FIXED: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress,
        baseTokenAddress: address,
        baseTokenDecimals: decimals,
        datatokenDecimals: 18,
        fixedRate: process.env.PRICING_FIXED_RATE?.trim() || '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    }
  }
}

/** Fixed pricing in OCEAN on the local stack, where every dev account holds OCEAN. */
function localOceanPricing(config: NetworkConfig): Pricing {
  if (!config.oceanTokenAddress || !config.fixedRateExchangeAddress) return {}

  return {
    FIXED_OCEAN: {
      type: 'fixed',
      freCreationParams: {
        fixedRateAddress: config.fixedRateExchangeAddress,
        baseTokenAddress: config.oceanTokenAddress,
        baseTokenDecimals: 18,
        datatokenDecimals: 18,
        fixedRate: '1',
        marketFee: '0',
        marketFeeCollector: ZERO_ADDRESS
      }
    }
  }
}

/**
 * The pricing the paid examples use: your `PRICING_TOKEN_*` token if set, otherwise the
 * network's ready-made EURAU or OCEAN config, otherwise free (with a note, so a "paid"
 * example that publishes for free does not go unnoticed).
 */
export function paidPricing(pricingConfig: Pricing): PricingConfigWithoutOwner {
  const paid =
    pricingConfig.FIXED ??
    pricingConfig.FIXED_EURAU ??
    pricingConfig.FIXED_OCEAN

  if (paid) return paid

  console.log(
    'No fixed pricing on this network; publishing for free. Set PRICING_TOKEN_ADDRESS and PRICING_TOKEN_DECIMALS for a fixed price.'
  )

  return pricingConfig.FREE
}

/** Reads NETWORK from the environment and returns its configs. */
export function resolveNetwork(): {
  name: Network
  networkConfig: NetworkConfig
  pricingConfig: Pricing
} {
  const supported = Object.values(Network).join(', ')

  if (!process.env.NETWORK)
    throw new Error(`Set NETWORK in your .env file. Supported: ${supported}.`)

  const selected = process.env.NETWORK.trim().toUpperCase()

  if (!(selected in Network))
    throw new Error(
      `Unsupported NETWORK '${selected}'. Supported: ${supported}.`
    )

  const name = Network[selected as keyof typeof Network]

  let networkConfig: NetworkConfig
  let pricingConfig: Pricing

  switch (name) {
    case Network.OPSEPOLIA:
      networkConfig = opSepoliaConfig()
      pricingConfig = { FREE: { type: 'free' } }
      break
    case Network.LOCAL:
      networkConfig = localNetworkConfig()
      pricingConfig = {
        FREE: { type: 'free' },
        ...localOceanPricing(networkConfig)
      }
      break
    case Network.CUSTOM:
      networkConfig = customNetworkConfig()
      pricingConfig = { FREE: { type: 'free' } }
      break
    default:
      networkConfig = { ...NETWORK_CONFIGS[name] }
      pricingConfig = { ...PRICING_CONFIGS[name] }

      // The usual case for now, since the public endpoints are still legacy Provider.
      if (process.env.OCEAN_NODE_URI)
        networkConfig.oceanNodeUri = process.env.OCEAN_NODE_URI
      if (process.env.RPC_URL) networkConfig.nodeUri = process.env.RPC_URL
  }

  // Paid compute funds exactly one escrow contract, whatever the node names. By default the
  // chain's EnterpriseEscrow in Ocean's address data (its Escrow where the data lists no
  // EnterpriseEscrow; ocean.js ships the data for OP Sepolia, and reads ADDRESS_FILE when
  // set). ESCROW_ADDRESS, the chain's EnterpriseEscrow contract, pins that one instead:
  // set it where the address data has no escrow, Pontus-X devnet among them.
  const escrow = process.env.ESCROW_ADDRESS?.trim()

  if (escrow) {
    if (!isAddress(escrow))
      throw new Error(`ESCROW_ADDRESS must be an address, not '${escrow}'.`)
    networkConfig.escrow = escrow
  }

  return {
    name,
    networkConfig,
    pricingConfig: {
      ...pricingConfig,
      ...pricingTokenOverride(networkConfig.fixedRateExchangeAddress)
    }
  }
}
