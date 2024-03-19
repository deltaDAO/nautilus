import dotenv from 'dotenv'
import { type Signer, Wallet, providers } from 'ethers'
dotenv.config()

export const MUMBAI_NODE_URI = 'https://rpc-mumbai.maticvigil.com'

export function getSigner(key: 1 | 2 = 1, nodeUri?: string): Signer {
  const providerUrl = nodeUri || MUMBAI_NODE_URI

  console.log(`Using test key ${key} on ${providerUrl} to create wallet.`)

  const privateKey =
    key === 1
      ? process.env.PRIVATE_KEY_TESTS_1
      : process.env.PRIVATE_KEY_TESTS_2

  const provider = new providers.JsonRpcProvider(providerUrl)

  const wallet = new Wallet(privateKey, provider)

  console.log(
    `Wallet created with ${wallet.address} and provider: ${wallet.provider._isProvider}`
  )

  return wallet
}
