import assert from 'assert'
import { NautilusAsset } from '../../src/nautilus/asset/asset'
import {
  datasetMetadata,
  datasetService,
  fixedPricing
} from '../fixtures/AssetConfig'
import { freParams } from '../fixtures/FixedRateExchangeParams'
import { getWeb3 } from '../fixtures/Web3'

describe('NautilusAsset', () => {
  const web3 = getWeb3()
  const owner = web3.defaultAccount

  it('configures owner correctly', () => {
    const asset = new NautilusAsset()
    asset.metadata = datasetMetadata
    asset.services.push(datasetService)
    asset.pricing = { ...fixedPricing, freCreationParams: freParams as any }
    asset.owner = owner

    const config = asset.getConfig()

    assert.equal(
      config.tokenParamaters.datatokenParams.paymentCollector,
      owner,
      'datatokenParams.paymentCollector != owner'
    )
    assert.equal(
      config.tokenParamaters.datatokenParams.minter,
      owner,
      'datatokenParams.minter != owner'
    )
    assert.equal(
      config.tokenParamaters.nftParams.owner,
      owner,
      'nftParams.owner != owner'
    )
    assert.equal(
      config.pricing.freCreationParams.owner,
      owner,
      'nftParams.owner != owner'
    )
  })
})
