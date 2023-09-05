---
id: 'access'
title: 'Access Services(Download)'
sidebar_label: 'Access Services(Download)'
sidebar_position: 1
custom_edit_url: null
---

# Access(Download) of data/algorithm service offerings

The following example shows how to retrieve a download-url for a dataset serviced offering which was published for access(download). The same process is also possible to access algorithms which have been published as access assets.

```ts
import * as dotenv from 'dotenv'
import { LogLevel, Nautilus } from '@deltadao/nautilus'
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

const privateKey = process.env.PRIVATE_KEY as string
const provider = new providers.JsonRpcProvider(networkConfig.nodeUri)
const wallet = new Wallet(privateKey, provider)

async function main() {
  Nautilus.setLogLevel(LogLevel.Verbose) // optional to show more nautilus internal logs
  const nautilus = await Nautilus.create(wallet, networkConfig)

  // GET DOWNLOAD URL
  await access(nautilus)
}

async function access(nautilus: Nautilus) {
  const accessUrl = await nautilus.access({
    assetDid:
      'did:op:7c2024f5f09a5837c3ce060531d59348fee296dc643bcb3e6dc89860672c3db8'
  })
  console.log('Download URL: ', accessUrl)
}
```