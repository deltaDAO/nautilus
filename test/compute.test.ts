import { Config, LoggerInstance, LogLevel } from '@oceanprotocol/lib'
import * as dotenv from 'dotenv'
import fs from 'fs'
import assert from 'assert'

import Web3 from 'web3'
import { compute, getStatus, retrieveResult } from '../src'
dotenv.config()

describe('Compute', () => {
  let web3: Web3
  let config: Config
  const jobId = 'cda858f7df4244799713896986a93a84'

  before(() => {
    config = JSON.parse(
      fs.readFileSync(process.env.CHAIN_CONFIG_FILEPATH).toString()
    )

    web3 = new Web3(config.nodeUri)
    const account = web3.eth.accounts.privateKeyToAccount(
      process.env.PRIVATE_KEY
    )
    web3.eth.accounts.wallet.add(account)
    web3.defaultAccount = account.address

    LoggerInstance.setLevel(LogLevel.Verbose)
  })

  it('should start a compute job', async () => {
    const computeJob = await compute({
      datasetDid:
        'did:op:bd2d41775c5041361d899f30734920af6383c3ca5838d06fa4649cba9c94192e',
      algorithmDid:
        'did:op:ca69686d534777405c8cb0a4437bca408a3f8bd1e479d429beed64b9f932b69f',
      web3,
      config
    })

    console.log(computeJob)
  })

  it('should get compute status', async () => {
    const jobStatus = await getStatus({
      jobId,
      web3,
      config
    })

    assert.ok(jobStatus.status > 0, 'Received unsupported status for job')
  })

  it('should retrieve results', async () => {
    const resultIndex = 0
    const resultUrl = await retrieveResult({
      jobId,
      web3,
      config,
      resultIndex
    })

    // regex to check that returned url is valid
    // 1. endpoint is /computeResult
    // 2. all necessary parameters are set and match input
    // TODO: test if signature is valid
    // TODO: could get computeResult endpoiunt dynamically via provider.getEndpoints
    const paramGroupRegex = `((consumerAddress=${web3.defaultAccount}|jobId=${jobId}|index=${resultIndex}|nonce=\\d+|signature=0x(\\d|[a-zA-Z])+)&?){5}`

    // remove trailing slash
    const cleanedProviderUri = config.providerUri.replace(/\/$/, '')

    // eslint-disable-next-line security/detect-non-literal-regexp
    const regex = new RegExp(
      `${cleanedProviderUri}\\/api\\/services\\/computeResult\\?${paramGroupRegex}`
    )

    assert.match(resultUrl, regex, 'Invalid result received')
  })
})
