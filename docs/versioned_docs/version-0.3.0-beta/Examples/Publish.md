---
id: 'publish'
title: 'Publish Services'
sidebar_label: 'Publish Services'
sidebar_position: 0
custom_edit_url: null
---

# Publication of service offerings

The following example shows the publication process for 2 datasets(one for access and one for compute) and one algorithm for the purpose of computation. 

```ts
import * as dotenv from 'dotenv'
import {
  LogLevel,
  Nautilus,
  AssetBuilder,
  FileTypes,
  ServiceTypes,
  ServiceBuilder,
  UrlFile,
  ConsumerParameterBuilder,
} from '@deltadao/nautilus'
import { Wallet, providers } from 'ethers'
dotenv.config()

const networkConfig = {
  chainId: 80001,
  network: 'mumbai',
  metadataCacheUri: 'https://v4.aquarius.oceanprotocol.com',
  nodeUri: 'https://rpc-mumbai.maticvigil.com',
  providerUri: 'https://v4.provider.oceanprotocol.com',
  subgraphUri: 'https://v4.subgraph.mumbai.oceanprotocol.com',
  explorerUri: 'https://mumbai.polygonscan.com',
  oceanTokenAddress: '0xd8992Ed72C445c35Cb4A2be468568Ed1079357c8',
  oceanTokenSymbol: 'OCEAN',
  fixedRateExchangeAddress: '0x25e1926E3d57eC0651e89C654AB0FA182C6D5CF7',
  dispenserAddress: '0x21bc18b92F7551e715B490E2C2875E8532317F8d',
  startBlock: 26354458,
  transactionBlockTimeout: 50,
  transactionConfirmationBlocks: 1,
  transactionPollingTimeout: 750,
  gasFeeMultiplier: 1.1,
  nftFactoryAddress: '0x7d46d74023507D30ccc2d3868129fbE4e400e40B',
  opfCommunityFeeCollector: '0xd8839c98ca8CE07dDa4e460a71B634A4A82f8BD6',
  veAllocate: '0x3fa1d5AC45ab1Ff9CFAe227c5583Ec0484b54Ef9',
  veOCEAN: '0x061955B6980A34fce74b235f90DBe20d76f087b1',
  veDelegation: '0x96E3aE4247a01C3d40a261df1F8ead70E32E7C0c',
  veFeeDistributor: '0x35F1e6765750E874EB9d0675393A1A394A4749b4',
  veDelegationProxy: '0x51B1b14b8bfb43a2fB0b49843787Ca440200F6b7',
  DFRewards: '0x4259c164eedA7483dda2b4b622D761A88674D31f',
  DFStrategyV1: '0x1be9C72500B41c286C797D4FE727747Ae9C4E195',
  veFeeEstimate: '0xCFeF55c6ae4d250586e293f29832967a04A9087d'
}
const pricingConfig = {
  FREE: {
    type: 'free'
  } as PricingConfigWithoutOwner,
  FIXED_OCEAN: {
    type: 'fixed',
    freCreationParams: {
      fixedRateAddress: '0x25e1926E3d57eC0651e89C654AB0FA182C6D5CF7',
      baseTokenAddress: '0xd8992Ed72C445c35Cb4A2be468568Ed1079357c8',
      baseTokenDecimals: 18,
      datatokenDecimals: 18,
      fixedRate: '1',
      marketFee: '0',
      marketFeeCollector: '0x0000000000000000000000000000000000000000'
    }
  } as PricingConfigWithoutOwner,
  FIXED_EUROE: {
    type: 'fixed',
    freCreationParams: {
      fixedRateAddress: '0x25e1926E3d57eC0651e89C654AB0FA182C6D5CF7',
      baseTokenAddress: '0xA089a21902914C3f3325dBE2334E9B466071E5f1',
      baseTokenDecimals: 6,
      datatokenDecimals: 18,
      fixedRate: '1',
      marketFee: '0',
      marketFeeCollector: '0x0000000000000000000000000000000000000000'
    }
  } as PricingConfigWithoutOwner
}

const privateKey = process.env.PRIVATE_KEY as string
const provider = new providers.JsonRpcProvider(networkConfig.nodeUri)
const wallet = new Wallet(privateKey, provider)

async function main() {
  Nautilus.setLogLevel(LogLevel.Verbose) // optional to show more nautilus internal logs
  const nautilus = await Nautilus.create(wallet, networkConfig)

  // PUBLISH FUNCTIONS
  await publishAccessDataset(nautilus)
  await publishComputeDataset(nautilus)
  await publishComputeAlgorithm(nautilus)
}

async function publishAccessDataset(nautilus: Nautilus) {
  const owner = await wallet.getAddress()
  console.log(`Your address is ${owner}`)

  const serviceBuilder = new ServiceBuilder(ServiceTypes.ACCESS, FileTypes.URL) // access type dataset with URL data source

  const urlFile: UrlFile = {
    type: 'url', // there are multiple supported data source types, see https://docs.oceanprotocol.com/developers/storage
    url: 'https://www.delta-dao.com/.well-known/did.json', // link to your file or api
    method: 'GET', // HTTP request method
    // headers: {
    //     Authorization: 'Basic XXX' // optional headers field e.g. for basic access control
    // }
  }

  const service = serviceBuilder
    .setServiceEndpoint(networkConfig.providerUri)
    .setTimeout(86400)
    .addFile(urlFile)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('My Datatoken Name', 'SYMBOL') // important for following access token transactions in the explorer
    .build()

  const assetBuilder = new AssetBuilder()
  const asset = assetBuilder
    .setType('dataset')
    .setName('Access Dataset Name')
    .setDescription('Access Dataset Description (supports Markdown)')
    .setAuthor('Company Name')
    .setLicense('MIT')
    .addService(service)
    .setOwner(owner)
    .build()

  const result = await nautilus.publish(asset)
  console.log(result)
}

async function publishComputeDataset(nautilus: Nautilus) {
  const owner = await wallet.getAddress()
  console.log(`Your address is ${owner}`)

  const consumerParameterBuilder = new ConsumerParameterBuilder() // optional

  const cunsumerParameter = consumerParameterBuilder // optional
    .setType('number')
    .setName('myNumberParam')
    .setLabel('My Param Label')
    .setDescription('A description of my param for the enduser.')
    .setDefault('5')
    .setRequired(false)
    .build()

  const serviceBuilder = new ServiceBuilder(ServiceTypes.COMPUTE, FileTypes.URL) // compute type dataset with URL data source

  const urlFile: UrlFile = {
    type: 'url',
    url: 'https://www.delta-dao.com/.well-known/did.json', // link to your file or api
    method: 'GET',
    // headers: {
    //     Authorization: 'Basic XXX' // optional headers field e.g. for basic access control
    // }
  }

  const service = serviceBuilder
    .setServiceEndpoint(networkConfig.providerUri)
    .setTimeout(86400)
    .addFile(urlFile)
    .setPricing(pricingConfig.FREE)
    .setDatatokenNameAndSymbol('My Datatoken Name', 'SYMBOL') // important for following access token transactions in the explorer
    .addConsumerParameter(cunsumerParameter) // optional
    .build()

  const assetBuilder = new AssetBuilder()
  const asset = assetBuilder
    .setType('dataset')
    .setName('Compute Dataset Name')
    .setDescription('Compute Dataset Description (supports Markdown)')
    .setAuthor('Company Name')
    .setLicense('MIT')
    .addService(service)
    .setOwner(owner)
    .build()

  const result = await nautilus.publish(asset)
  console.log(result)
}

async function publishComputeAlgorithm(nautilus: Nautilus) {
  const owner = await wallet.getAddress()
  console.log(`Your address is ${owner}`)

  const serviceBuilder = new ServiceBuilder(ServiceTypes.COMPUTE, FileTypes.URL)

  const urlFile: UrlFile = {
    type: 'url',
    url: 'https://raw.githubusercontent.com/deltaDAO/files/main/demo.js', // link to your algorithm logic, will be run using the defined conatainer
    method: 'GET',
  }

  const service = serviceBuilder
    .setServiceEndpoint(networkConfig.providerUri)
    .setTimeout(86400)
    .addFile(urlFile)
    .setPricing(pricingConfig.FIXED_OCEAN)
    .setDatatokenNameAndSymbol('My Datatoken Name', 'SYMBOL')
    .build()

  const algoMetadata = {
    language: 'Node.js',
    version: '1.0.0',
    container: {
      // https://hub.docker.com/layers/library/node/18.17.1/images/sha256-91e37377b960d0b15d3c15d15321084163bc8d950e14f77bbc84ab23cf3d6da7?context=explore
      entrypoint: 'node $ALGO',
      image: 'node',
      tag: '18.17.1',
      checksum:
        'sha256:91e37377b960d0b15d3c15d15321084163bc8d950e14f77bbc84ab23cf3d6da7',
    },
  }

  const assetBuilder = new AssetBuilder()

  const asset = assetBuilder
    .setType('algorithm')
    .setName('Compute Algorithm Name')
    .setDescription('Compute Algorithm description (supports Markdown)') // supports markdown
    .setAuthor('Your Company Name')
    .setLicense('MIT')
    .setAlgorithm(algoMetadata)
    .addService(service)
    .setOwner(owner)
    .build()

  const result = await nautilus.publish(asset)
  console.log(result)
}
```
