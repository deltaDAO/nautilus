import {
  Asset,
  Config,
  ConfigHelper,
  Datatoken,
  Service
} from '@oceanprotocol/lib'
import Web3 from 'web3'

export function getOceanConfig(
  chainId: number,
  infuraProjectId?: string
): Config {
  const config = new ConfigHelper().getConfig(
    chainId,
    infuraProjectId
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

export function removeDuplicatesFromArray<T>(array: T[]): T[] {
  return array.filter((value, index, array) => array.indexOf(value) === index)
}
