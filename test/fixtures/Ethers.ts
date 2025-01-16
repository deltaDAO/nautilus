import dotenv from 'dotenv'
import { type Signer, Wallet, providers } from 'ethers'
dotenv.config()

const PONTUSX_DEVNET_NODE_URI = 'https://rpc.dev.pontus-x.eu' as const
export const TESTING_NODE_URI = PONTUSX_DEVNET_NODE_URI

export function getSigner(key: 1 | 2 = 1, nodeUri?: string): Signer {
  const providerUrl = nodeUri || PONTUSX_DEVNET_NODE_URI

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
