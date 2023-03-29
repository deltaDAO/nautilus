import { Config, LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import * as dotenv from 'dotenv'
import fs from 'fs'

import Web3 from 'web3'
import { compute, getStatus, retrieveResult } from '../src'
dotenv.config()

describe('Compute', () => {
  let web3: Web3
  let config: Config
  const jobId = 'cda858f7df4244799713896986a93a84'

  before(() => {
    web3 = new Web3(process.env.RPC_URI)
    const account = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    )
    web3.eth.accounts.wallet.add(account)
    web3.defaultAccount = account.address

    config = JSON.parse(
      fs.readFileSync(process.env.CHAIN_CONFIG_FILEPATH).toString()
    )

    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should start a compute job', async () => {
    await compute({
      datasetDid:
        'did:op:79a44e065fc82683adab8906036cf501f5cc47ad0ed38ad481baa41715a0df7c',
      algorithmDid:
        'did:op:b4be1f60c197890bfebc041e66731a2c6f98f520169a9f38173c19e29353b4d0',
      web3,
      config
    })
  })

  it('should get compute status', async () => {
    const response = await getStatus({
      jobId,
      web3,
      config
    })

    response.forEach((job) => {
      LoggerInstance.log('Got results', job.results)
    })
  })

  it('should get retrieve results', async () => {
    const response = await retrieveResult({
      jobId,
      web3,
      config
    })

    LoggerInstance.log('Got compute result:', response)
  })
})
