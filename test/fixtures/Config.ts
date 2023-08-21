import { Config, ConfigHelper } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import fs from 'fs'
import { homedir } from 'os'

// Get Config and Addresses for barge test environment

export const getTestConfig = async (wallet: Wallet): Promise<Config> => {
  const config = new ConfigHelper().getConfig(await wallet.getChainId())

  const addresses = getAddresses()

  const isDevelopment = config.network === 'development'

  return isDevelopment
    ? {
        ...config,
        metadataCacheUri: 'http://127.0.0.1:5000', // if running on macOS
        // metadataCacheUri: 'http://172.15.0.5:5000',
        providerUri: 'http://127.0.0.1:8030', // if running on macOS
        // providerUri: 'http://172.15.0.4:8030',
        providerAddress: '0xe08A1dAe983BC701D05E492DB80e0144f8f4b909', // barge
        subgraphUri: 'http://127.0.0.1:9000', // if running on macOS
        // subgraphUri: 'https://172.15.0.15:8000',
        oceanTokenAddress: addresses.Ocean,
        nftFactoryAddress: addresses.ERC721Factory,
        dispenserAddress: addresses.Dispenser,
        opfCommunityFeeCollector: addresses.OPFCommunityFeeCollector,
        fixedRateExchangeAddress: addresses.FixedPrice
      }
    : {
        ...config,
        providerUri: process.env.PROVIDER_URI_TEST || config.providerUri,
        metadataCacheUri:
          process.env.METADATA_CACHE_URI_TEST || config.metadataCacheUri
      }
}

export const getAddresses = (): {
  chainId: number
  Ocean: string
  MockDAI: string
  MockUSDC: string
  OPFCommunityFeeCollector: string
  startBlock: number
  Router: string
  FixedPrice: string
  ERC20Template: {
    '1': string
    '2': string
  }
  ERC721Template: { '1': string }
  Dispenser: string
  ERC721Factory: string
} => {
  const data = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.readFileSync(
      process.env.ADDRESS_FILE ||
        `${homedir}/.ocean/ocean-contracts/artifacts/address.json`,
      'utf8'
    )
  )
  return data.development
}
