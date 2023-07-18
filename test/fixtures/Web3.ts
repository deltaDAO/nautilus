import Web3 from 'web3'
import dotenv from 'dotenv'
dotenv.config()

export const MUMBAI_NODE_URI = 'https://rpc-mumbai.maticvigil.com'

export function getWeb3(key: 1 | 2 = 1, nodeUri?: string) {
  const web3 = new Web3(nodeUri || 'http://127.0.0.1:8545')
  const account = web3.eth.accounts.privateKeyToAccount(
    key === 1
      ? process.env.PRIVATE_KEY_TESTS_1
      : process.env.PRIVATE_KEY_TESTS_2
  )
  web3.eth.accounts.wallet.add(account)
  web3.defaultAccount = account.address

  return web3
}
