import type { Signer } from 'ethers'
import type {
  MetadataConfig,
  PricingConfig,
  ServiceConfig
} from '../../src/@types/Publish'
import type { PricingConfigWithoutOwner } from '../../src/Nautilus'
import { getTestConfig } from './Config'
import { datatokenParams } from './DatatokenParams'
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
    },
    consumerParameters: [
      {
        name: 'hometown',
        type: 'text',
        label: 'Hometown',
        required: true,
        description: 'What is your hometown?',
        default: 'Nowhere'
      },
      {
        name: 'age',
        type: 'number',
        label: 'Age',
        required: false,
        description: 'Please fill your age',
        default: '0'
      },
      {
        name: 'developer',
        type: 'boolean',
        label: 'Developer',
        required: false,
        description: 'Are you a developer?',
        default: 'false'
      },
      {
        name: 'languagePreference',
        type: 'select',
        label: 'Language',
        required: false,
        description: 'Do you like NodeJs or Python',
        default: 'nodejs',
        options: '[{"nodejs": "I love NodeJs"},{"python": "I love Python"}]'
      }
    ]
  }
}

export const datasetService: Omit<
  ServiceConfig,
  'serviceEndpoint' | 'pricing'
> = {
  type: 'access',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
      method: 'GET'
    }
  ],
  timeout: 0,
  datatokenCreateParams: datatokenParams
}

export const algorithmService: Omit<
  ServiceConfig,
  'serviceEndpoint' | 'pricing'
> = {
  type: 'compute',
  files: [
    {
      type: 'url',
      url: 'https://raw.githubusercontent.com/deltaDAO/files/main/main.js',
      method: 'GET'
    }
  ],
  timeout: 600,
  datatokenCreateParams: datatokenParams
}

export const freePricing: PricingConfig = { type: 'free' }
export const fixedPricing: PricingConfig = {
  type: 'fixed'
}

export async function getPricing(
  signer: Signer,
  type?: PricingConfig['type']
): Promise<PricingConfigWithoutOwner> {
  const config = await getTestConfig(signer)

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
