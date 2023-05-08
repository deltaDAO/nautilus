import Web3 from 'web3'
import chainConfig from './chainConfig.json'
import dotenv from 'dotenv'
dotenv.config()

export function getWeb3(nodeUri?: string) {
  const web3 = new Web3(nodeUri || chainConfig.nodeUri)
  const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
  web3.eth.accounts.wallet.add(account)
  web3.defaultAccount = account.address

  return web3
}
