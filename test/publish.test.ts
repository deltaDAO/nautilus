import * as dotenv from 'dotenv'
import {
  DatatokenCreateParams,
  FreCreationParams,
  LoggerInstance,
  LogLevel,
  NftCreateData
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { publishAsset } from '../src'
import { AssetConfig } from '../src/@types/Publish'
import * as chainConfig from '../chainConfig.json'
dotenv.config()

describe('Publishing tests', () => {
  LoggerInstance.setLevel(LogLevel.Verbose)

  const web3 = new Web3(process.env.RPC_URI)
  const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
  web3.eth.accounts.wallet.add(account)
  web3.defaultAccount = account.address
  const publisherAccount = web3.defaultAccount // TODO refactor put outside to reuse in every test

  const nftParams: NftCreateData = {
    name: 'TEST_FRE_NFT_NAME',
    symbol: 'TEST_FRE_NFT_SYMBOL',
    templateIndex: 1,
    tokenURI: '',
    transferable: false,
    owner: publisherAccount
  }

  // datatoken parameters: name, symbol, templateIndex, etc.
  const datatokenParams: DatatokenCreateParams = {
    name: 'TEST_FRE_DT_NAME',
    symbol: 'TEST_FRE_DT_SYMBOL',
    templateIndex: 1, // TODO market uses 2, docs say 1
    cap: '115792089237316195423570985008687907853269984665640564039457',
    feeAmount: '0',
    paymentCollector: publisherAccount,
    feeToken: chainConfig.oceanTokenAddress,
    minter: publisherAccount,
    mpFeeAddress: publisherAccount // replace with market fee address
  }

  const freParams: FreCreationParams = {
    fixedRateAddress: chainConfig.fixedRateExchangeAddress,
    baseTokenAddress: chainConfig.oceanTokenAddress,
    owner: publisherAccount,
    marketFeeCollector: publisherAccount, // optional
    baseTokenDecimals: 18, // should come from a token config
    datatokenDecimals: 18, // should come from a token config
    fixedRate: '1', // PRICE
    marketFee: '0',
    // Optional parameters
    // allowedConsumer: '0x0000000000000000000000000000000000000000', //  only account that consume the exhchange
    withMint: false // add FixedPriced contract as minter if withMint == true // TODO find out why oyu would do this
  }

  it.skip('publish a fixed rate dataset for download', async () => {
    const assetConfig: AssetConfig = {
      chainConfig,
      metadata: {
        type: 'dataset',
        name: 'Test Dataset fixed rate',
        description: 'This is a super cool description',
        author: 'publish-script-test',
        license: 'MIT'
      },
      services: [
        {
          id: '1',
          type: 'access',
          description: 'Download service',
          files: 'PLACEHOLDER FOR ENCRYPTED FILES', // TODO adjust interface
          datatokenAddress: 'PLACEHOLDER', // TODO adjust interface
          serviceEndpoint: chainConfig.providerUri,
          timeout: 0
        }
      ],
      web3,
      pricing: { type: 'fixed', freCreationParams: freParams },
      tokenParamaters: {
        datatokenParams,
        nftParams
      },
      servicesFiles: [
        {
          type: 'url',
          url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
          method: 'GET'
        }
      ]
    }

    const result = await publishAsset(assetConfig)
    LoggerInstance.log(result)
  })
  it.skip('publish a free dataset for download', async () => {
    const assetConfig: AssetConfig = {
      chainConfig,
      metadata: {
        type: 'dataset',
        name: 'Test Dataset free',
        description: 'This is a super cool description',
        author: 'publish-script-test',
        license: 'MIT'
      },
      services: [
        {
          id: '1',
          type: 'access',
          description: 'Download service',
          files: 'PLACEHOLDER FOR ENCRYPTED FILES', // TODO adjust interface
          datatokenAddress: 'PLACEHOLDER', // TODO adjust interface
          serviceEndpoint: chainConfig.providerUri,
          timeout: 600
        }
      ],
      web3,
      pricing: { type: 'free' },
      tokenParamaters: {
        datatokenParams,
        nftParams
      },
      servicesFiles: [
        {
          type: 'url',
          url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
          method: 'GET'
        }
      ]
    }

    const result = await publishAsset(assetConfig)

    LoggerInstance.log(result)
  })
  it('publish a free dataset for compute', async () => {
    // TODO to implement
    // TODO add compute property to services

    const assetConfig: AssetConfig = {
      chainConfig,
      metadata: {
        type: 'dataset',
        name: 'Test Dataset free compute',
        description: 'This is a super cool description',
        author: 'publish-script-test',
        license: 'MIT'
      },
      services: [
        {
          id: '1',
          type: 'compute',
          description: 'Download service',
          files: 'PLACEHOLDER FOR ENCRYPTED FILES', // TODO adjust interface
          datatokenAddress: 'PLACEHOLDER', // TODO adjust interface
          serviceEndpoint: chainConfig.providerUri,
          timeout: 600,
          compute: {
            allowRawAlgorithm: false, // should be false by deafault
            allowNetworkAccess: false, //   should be false by deafault
            publisherTrustedAlgorithmPublishers: [publisherAccount], // should be empty array by default
            /* To produce filesChecksum, call the Provider FileInfoEndpoint with 
            parameter withChecksum = True. If algorithm has multiple files, filesChecksum 
            is a concatenated string of all files checksums (ie: checksumFile1+checksumFile2 , etc) */
            publisherTrustedAlgorithms: [
              {
                did: 'did:op:8ac3384f56f2b7cd49c75ca0af2e780a731b10134a882160c50178381a5d1a19',
                filesChecksum: '', // TODO incomplete
                containerSectionChecksum:
                  '026026d98942438e4df232b3e8cd7ca32416b385918977ce5ec0c6333618c423'
              }
            ] // should be empty array by default
          }
        }
      ],
      web3,
      pricing: { type: 'free' },
      tokenParamaters: {
        datatokenParams,
        nftParams
      },
      servicesFiles: [
        {
          type: 'url',
          url: 'https://raw.githubusercontent.com/oceanprotocol/testdatasets/main/shs_dataset_test.txt',
          method: 'GET'
        }
      ]
    }

    const result = await publishAsset(assetConfig)
    LoggerInstance.log(result)
  })
  it.skip('publish a fixed rate dataset for compute', async () => {
    // TODO to implement
    // TODO add compute property to services
  })
  it.skip('publish a fixed rate algorithm', async () => {
    // TODO to implement
    // add algorithm to metadata
    // "type": "algorithm"
  })
  it.skip('publish a free algorithm', async () => {
    // TODO to implement
    const assetConfig: AssetConfig = {
      chainConfig,
      metadata: {
        type: 'algorithm',
        name: 'Test Algo free',
        description: 'This is a super cool description',
        author: 'publish-script-test',
        license: 'Copyright deltaDAO',
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
      },
      services: [
        {
          id: '1',
          type: 'compute',
          description: 'Algo service',
          files: 'PLACEHOLDER FOR ENCRYPTED FILES', // TODO adjust interface
          datatokenAddress: 'PLACEHOLDER', // TODO adjust interface
          serviceEndpoint: chainConfig.providerUri,
          timeout: 600
        }
      ],
      web3,
      pricing: { type: 'free' },
      tokenParamaters: {
        datatokenParams,
        nftParams
      },
      servicesFiles: [
        {
          type: 'url',
          url: 'https://github.com/deltaDAO/files/blob/main/product_quantity_computation.js',
          method: 'GET'
        }
      ]
    }

    const result = await publishAsset(assetConfig)
    LoggerInstance.log(result)
  })
})
