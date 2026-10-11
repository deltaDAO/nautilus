import { type Config, ConfigHelper, Datatoken } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'

/** Ocean's default config for a chain, or `null` if it ships none. */
export function getOceanConfig(
  chainId: number,
  infuraProjectId?: string
): Config | null {
  return new ConfigHelper().getConfig(chainId, infuraProjectId) || null
}

/**
 * The chain the signer is connected to.
 *
 * ethers v6 removed `Signer.getChainId()` and returns a `bigint` from the network, hence
 * the conversion.
 */
export async function getChainId(signer: Signer): Promise<number> {
  if (!signer.provider)
    throw new Error(
      'The signer has no provider, so its chain cannot be determined.'
    )

  return Number((await signer.provider.getNetwork()).chainId)
}

/**
 * The signer's balance of a datatoken.
 *
 * @param config the chain config, as `Nautilus.getOceanConfig()` returns it. Without it,
 * the chain id is read from the signer (the balance needs no contract address from the
 * config). Either way ocean.js is given the chain, so it does not look a config up for an
 * undefined network, which it reports as an error ("No config found for given network
 * 'undefined'").
 */
export async function getDatatokenBalance(
  signer: Signer,
  datatokenAddress: string,
  config?: Config
): Promise<string> {
  const chainConfig =
    config ?? ({ chainId: await getChainId(signer) } as Config)

  return new Datatoken(signer, chainConfig.chainId, chainConfig).balance(
    datatokenAddress,
    await signer.getAddress()
  )
}

/** Second-precision ISO-8601, the form DDO v5 timestamps use. */
export function dateToStringNoMS(date: Date): string {
  return date.toISOString().replace(/\.[0-9]{3}Z$/, 'Z')
}

export function removeDuplicatesFromArray<T>(array: T[]): T[] {
  return Array.from(new Set(array))
}

export function combineArrays<T>(arrayOne: T[], arrayTwo: T[]): T[] {
  return removeDuplicatesFromArray([...arrayOne, ...arrayTwo])
}

export function getAllPromisesOnArray<E, P>(
  array: E[],
  promise: (element: E) => Promise<P>
): Promise<P[]> {
  return Promise.all(array.map((element) => promise(element)))
}
