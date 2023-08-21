import { Config } from '@oceanprotocol/lib'
import { Wallet } from 'ethers'
import { getTestConfig } from '../fixtures/Config'
import { getWallet } from '../fixtures/Web3'

describe('NautilusAsset', () => {
  let wallet: Wallet
  let owner: string
  let config: Config

  before(async () => {
    wallet = getWallet(1)
    owner = await wallet.getAddress()
    config = await getTestConfig(wallet)
  })
})
