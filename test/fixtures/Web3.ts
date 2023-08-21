import { Wallet, providers } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

export const MUMBAI_NODE_URI = 'https://rpc-mumbai.maticvigil.com'

export function getWallet(key: 1 | 2 = 1, nodeUri?: string): Wallet {
  const privateKey =
    key === 1
      ? process.env.PRIVATE_KEY_TESTS_1
      : process.env.PRIVATE_KEY_TESTS_2

  const wallet = new Wallet(privateKey, new providers.JsonRpcProvider(nodeUri))

  return wallet
}
