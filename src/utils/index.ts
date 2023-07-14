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

/**
 * Filters an array to remove any duplicate values
 * @param array the array to filter
 * @returns an array containing only unique entries
 */
export function removeDuplicatesFromArray<T>(array: T[]): T[] {
  return array.filter((value, index, array) => array.indexOf(value) === index)
}

/**
 * Combines two arrays and returns an array containing only unique values
 * @param arrayOne first array
 * @param arrayTwo second array
 * @returns array with combination of only unique entries
 */
export function combineArrays<T>(arrayOne: T[], arrayTwo: T[]): T[] {
  const newArray = [...arrayOne, ...arrayTwo]

  return removeDuplicatesFromArray(newArray)
}
