import Web3 from 'web3'
import { PricingConfigWithoutOwner } from '../../src'
import {
  MetadataConfig,
  PricingConfig,
  ServiceConfig
} from '../../src/@types/Publish'
import { getTestConfig } from './Config'
import { freParams } from './FixedRateExchangeParams'

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
        'sha256:026026d98942438e4df232b3e8cd7ca32416b385918977ce5ec0c6333618c423'
    }
  }
}

export const datasetService: Omit<ServiceConfig, 'serviceEndpoint'> = {
  type: 'access',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
      method: 'GET'
    }
  ],
  timeout: 0
}

export const algorithmService: Omit<ServiceConfig, 'serviceEndpoint'> = {
  type: 'compute',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/deltaDAO/files/main/main.js',
      method: 'GET'
    }
  ],
  timeout: 600
}

export const freePricing: PricingConfig = { type: 'free' }
export const fixedPricing: PricingConfig = {
  type: 'fixed'
}

export async function getPricing(
  web3: Web3,
  type?: PricingConfig['type']
): Promise<PricingConfigWithoutOwner> {
  const config = await getTestConfig(web3)

  switch (type) {
    case 'fixed':
      return {
        type: 'fixed',
        freCreationParams: {
          ...freParams,
          baseTokenAddress: config.oceanTokenAddress,
          fixedRateAddress: config.fixedRateExchangeAddress
        }
      }
    case 'free':
    default:
      return { type: 'free' }
  }
}
