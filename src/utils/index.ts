import {
  type Asset,
  type Config,
  ConfigHelper,
  Datatoken,
  type Service
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'

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

export async function getDatatokenBalance(signer: Signer, datatokenAddress) {
  return Number(
    await new Datatoken(signer).balance(
      datatokenAddress,
      await signer.getAddress()
    )
  )
}

export function dateToStringNoMS(date: Date): string {
  return date.toISOString().replace(/\.[0-9]{3}Z/, 'Z')
}

export function getAllPromisesOnArray<E, P>(
  array: E[],
  promise: (element: E) => Promise<P>
) {
  return Promise.all(array.map((e) => promise(e)))
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
  const newArray = arrayOne.concat(arrayTwo)

  return removeDuplicatesFromArray(newArray)
}

/**
 * Combines two arrays and replaces items in the base array with new items based on a customizable function.
 * @param array the base array for the combination
 * @param newItems the new items to replace existing ones, or be added to the base array
 * @param replace the function to replace a given item with any of the new items
 * @returns a combination of the base array, containing all base items, or their respective replacements, and any leftover new items of the newItems array
 */
export function combineArraysAndReplaceItems<T>(
  array: T[],
  newItems: T[],
  replace: (existingItem: T, newItems: T[]) => T
) {
  const arrayWithReplacedItems: T[] = []

  // loop through all existing items and replace based on the replace() function of user
  for (const existingItem of array) {
    const replacedItem = replace(existingItem, newItems)

    // if the replacement was taken from newItems...
    const replaceItemIndexInNewItems = newItems.indexOf(replacedItem)

    // ... we want to remove it, to avoid having duplicate entries in final array combination
    if (replaceItemIndexInNewItems > -1) {
      newItems.splice(replaceItemIndexInNewItems, 1)
    }

    // add the replacement to the return array
    arrayWithReplacedItems.push(replacedItem)
  }

  // return a combination of all replacements and "non-duplicate" newItems
  return combineArrays(arrayWithReplacedItems, newItems)
}
