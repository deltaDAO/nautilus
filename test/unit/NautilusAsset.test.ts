import { Config } from '@oceanprotocol/lib'
import assert from 'assert'
import Web3 from 'web3'
import { NautilusAsset } from '../../src/Nautilus/Asset/NautilusAsset'
import {
  FileTypes,
  ServiceBuilder,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service'
import { datasetService, fixedPricing } from '../fixtures/AssetConfig'
import { getTestConfig } from '../fixtures/Config'
import { freParams } from '../fixtures/FixedRateExchangeParams'
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

  it('configures owner correctly', async () => {
    const asset = new NautilusAsset()

    const service = new ServiceBuilder(ServiceTypes.ACCESS, FileTypes.URL)
      .addFile(datasetService.files[0])
      .setServiceEndpoint(config.providerUri)
      .build()

    asset.services.push(service)

    asset.pricing = {
      ...fixedPricing,
      freCreationParams: {
        ...freParams,
        baseTokenAddress: config.oceanTokenAddress,
        fixedRateAddress: config.fixedRateExchangeAddress
      }
    }
    asset.owner = owner

    const assetConfig = await asset.getConfig()

    assert.equal(
      assetConfig.tokenParamaters.datatokenParams.paymentCollector,
      owner,
      'datatokenParams.paymentCollector != owner'
    )
    assert.equal(
      assetConfig.tokenParamaters.datatokenParams.minter,
      owner,
      'datatokenParams.minter != owner'
    )
    assert.equal(
      assetConfig.tokenParamaters.nftParams.owner,
      owner,
      'nftParams.owner != owner'
    )
    assert.equal(
      assetConfig.pricing.freCreationParams.owner,
      owner,
      'nftParams.owner != owner'
    )
  })
})
