import { LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import * as dotenv from 'dotenv'

import Web3 from 'web3'
import { compute } from '../src'
dotenv.config()

describe('Compute', () => {
  it('should start a compute job', async () => {
    LoggerInstance.setLevel(LogLevel.Verbose)

    const web3 = new Web3(process.env.RPC_URI)
    const account = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    )
    web3.eth.accounts.wallet.add(account)
    web3.defaultAccount = account.address

    await compute({
      datasetDid:
        'did:op:79a44e065fc82683adab8906036cf501f5cc47ad0ed38ad481baa41715a0df7c',
      algorithmDid:
        'did:op:b4be1f60c197890bfebc041e66731a2c6f98f520169a9f38173c19e29353b4d0',
      web3
    })
  })
})
