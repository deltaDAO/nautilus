import assert from 'assert'
import { NautilusAsset } from '../../src/Nautilus/Asset/NautilusAsset'
import {
  datasetMetadata,
  datasetService,
  fixedPricing
} from '../fixtures/AssetConfig'
import { freParams } from '../fixtures/FixedRateExchangeParams'
import { getWeb3 } from '../fixtures/Web3'
import {
  FileTypes,
  NautilusService,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service'

describe('NautilusAsset', () => {
  const web3 = getWeb3()
  const owner = web3.defaultAccount

  it('configures owner correctly', async () => {
    const asset = new NautilusAsset()
    asset.metadata = datasetMetadata
    asset.services.push(
      datasetService as NautilusService<ServiceTypes.ACCESS, FileTypes.URL>
    )
    asset.pricing = { ...fixedPricing, freCreationParams: freParams as any }
    asset.owner = owner

    const config = await asset.getConfig()

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
