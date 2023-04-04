import Web3 from 'web3'
import { nodeUri } from './chainConfig.json'
import dotenv from 'dotenv'
dotenv.config()

export function getWeb3() {
  const web3 = new Web3(nodeUri)
  const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
  web3.eth.accounts.wallet.add(account)
  web3.defaultAccount = account.address

  return web3
}
