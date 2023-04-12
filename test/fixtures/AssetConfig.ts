import chainConfig, { providerUri } from './chainConfig.json'
import {
  AssetConfig,
  MetadataConfig,
  PricingConfig,
  ServiceConfig
} from '../../src/@types/Publish'
import { datatokenParams } from './DatatokenParams'
import { freParams } from './FixedRateExchangeParams'
import { nftParams } from './NftCreateData'
import { getWeb3 } from './Web3'

export const datasetMetadata: MetadataConfig = {
  type: 'dataset',
  name: 'Test Dataset',
  description: 'Automated Publishing Test on GEN-X',
  author: 'publish-script-test',
  license: 'MIT'
}

export const algorithmMetadata: MetadataConfig = {
  type: 'algorithm',
  name: 'Test Algo',
  description: 'Automated Publishing Test on GEN-X',
  author: 'publish-script-test',
  license: 'MIT',
  algorithm: {
    language: 'Node.js',
    version: '1.0.0',
    container: {
      entrypoint: 'node $ALGO',
      image: 'node',
      tag: 'latest',
      checksum:
        '026026d98942438e4df232b3e8cd7ca32416b385918977ce5ec0c6333618c423'
    }
  }
}

export const datasetService: ServiceConfig = {
  type: 'access',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
      method: 'GET'
    }
  ],
  serviceEndpoint: providerUri,
  timeout: 0
}

export const algorithmService: ServiceConfig = {
  type: 'compute',
  files: [
    {
      type: 'url',
      url: 'https://github.com/deltaDAO/files/blob/main/product_quantity_computation.js',
      method: 'GET'
    }
  ],
  serviceEndpoint: providerUri,
  timeout: 600
}

export const freePricing: PricingConfig = { type: 'free' }
export const fixedPricing: PricingConfig = {
  type: 'fixed'
}

export function getAssetConfig(
  type: 'dataset' | 'algorithm',
  price: 'free' | 'fixed',
  serviceType: 'access' | 'compute'
): AssetConfig {
  const web3 = getWeb3()
  const owner = web3.defaultAccount

  const service = type === 'dataset' ? datasetService : algorithmService
  if (serviceType === 'compute')
    service.compute = {
      allowRawAlgorithm: false,
      allowNetworkAccess: false,
      publisherTrustedAlgorithmPublishers: [],
      publisherTrustedAlgorithms: []
    }
  const services = [{ ...service, type: serviceType }]

  const config: AssetConfig = {
    chainConfig,
    metadata: type === 'dataset' ? datasetMetadata : algorithmMetadata,
    services,
    web3,
    pricing:
      price === 'free'
        ? freePricing
        : { ...fixedPricing, freCreationParams: { ...freParams, owner } },
    tokenParamaters: {
      datatokenParams: {
        ...datatokenParams,
        paymentCollector: owner,
        minter: owner
      },
      nftParams: {
        ...nftParams,
        owner
      }
    }
  }

  return config
}
