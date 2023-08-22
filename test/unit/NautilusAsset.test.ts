import { Config } from '@oceanprotocol/lib'
import { Signer } from 'ethers'
import { getTestConfig } from '../fixtures/Config'
import { getSigner } from '../fixtures/Web3'

describe('NautilusAsset', () => {
  let signer: Signer
  let owner: string
  let config: Config

  before(async () => {
    signer = getSigner(1)
    owner = await signer.getAddress()
    config = await getTestConfig(signer)
  })
})
