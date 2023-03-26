import {
  Asset,
  Config,
  ConfigHelper,
  Datatoken,
  Service
} from '@oceanprotocol/lib'
import fs from 'fs'
import Web3 from 'web3'

export function getOceanConfig(chainId: number): Config {
  try {
    const chainConfig = JSON.parse(
      fs.readFileSync(process.env.CHAIN_CONFIG_FILEPATH).toString()
    )
    if (chainConfig.chainId === chainId) return chainConfig
  } catch {}

  const config = new ConfigHelper().getConfig(
    chainId,
    process.env.INFURA_PROJECT_ID
  ) as Config

  return config as Config
}

export function getServiceById(asset: Asset, serviceId: string): Service {
  if (!asset) return

  return asset.services?.find((s) => s.id === serviceId)
}

export function getServiceByName(asset: Asset, serviceName: string): Service {
  if (!asset) return

  return asset.services?.find((s) => s.type === serviceName)
}

export async function getDatatokenBalance(web3: Web3, datatokenAddress) {
  return Number(
    await new Datatoken(web3).balance(datatokenAddress, web3.defaultAccount)
  )
}
