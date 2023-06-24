import { Config } from '@oceanprotocol/lib'
import Web3 from 'web3'
import { getTestConfig } from '../fixtures/Config'
import { getWeb3 } from '../fixtures/Web3'

describe('NautilusAsset', () => {
  let web3: Web3
  let owner: string
  let config: Config

  before(async () => {
    web3 = getWeb3(1)
    owner = web3.defaultAccount
    config = await getTestConfig(web3)
  })
})
