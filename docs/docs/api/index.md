---
id: "index"
title: "@deltadao/nautilus"
sidebar_label: "Readme"
sidebar_position: 0
custom_edit_url: null
---

# Nautilus

A typescript library helping to navigate the OCEAN. It enables configurable automated publishing and consumption of assets in any [Ocean Protocol](https://oceanprotocol.com) ecosystem.

## Table of Contents

- [Nautilus](#nautilus)
  - [Table of Contents](#table-of-contents)
  - [Configuring a new Nautilus instance](#configuring-a-new-nautilus-instance)
  - [Automated Publishing](#automated-publishing)
    - [Services](#services)
    - [Consumer Parameters](#consumer-parameters)
    - [Pricing](#pricing)
    - [Owner and optional configs](#owner-and-optional-configs)
  - [Automated Compute Jobs](#automated-compute-jobs)
    - [Basic Config](#basic-config)
    - [Optional Settings](#optional-settings)
    - [Start compute job](#start-compute-job)
    - [Get compute job status](#get-compute-job-status)
    - [Get compute job results](#get-compute-job-results)
  - [Automated Access](#automated-access)
  - [API Documentation](#api-documentation)
  - [License](#license)

## Configuring a new Nautilus instance

Setting up a new `Nautilus` instance to perform automated tasks, like publish & consume, is rather simple.

Install Nautilus:

```shell
npm install @deltadao/nautilus
```

Make sure you have [web3](https://www.npmjs.com/package/web3) installed:

```shell
npm install web3
```

Setup the `Web3` instance to use:

```ts
import Web3 from 'web3'

const web3 = new Web3('https://matic-mumbai.chainstacklabs.com') // can be replaced with any Ocean Protocol supported network
```

Next, add the account you want to use for the automations:

```ts
// This example assumes you have an environment variable named PRIVATE_KEY
// You can use a package like dotenv to load environment variables
const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
web3.eth.accounts.wallet.add(account)
web3.defaultAccount = account.address // currently required, will be optional in later versions
```

Now you can use the static `create()` method of the `Nautilus` class to construct a new instance:

```ts
// import the Natilus class
import { Nautilus } from '@deltadao/nautilus'

// create the instance
const nautilus = await Nautilus.create(web3)
```

If want to use a custom configuration, you can set an additional parameter in the `create` call. For guidance on which configurations are needed you can have a look at the [Ocean Library Docs](https://docs.oceanprotocol.com/building-with-ocean/using-ocean-libraries/configuration#create-a-configuration-file).

```ts
// Custom config, e.g.:
// Reference the docs linked above for a complete overview
// The provided values will overwrite the default values loaded via ocean.js (see docs linked above)
const customConfig = {
  metadataCacheUri: 'https://link.to.my/aquarius/instance',
  providerUri: 'https://link.to.my/ocean/provider',
  nodeUri: 'https://rpc.node.uri/'
  // ...
}

// Setting the custom config in addition to the chainId
const customNautilus = await Nautilus.create(web3, customConfig)
```

We now have a `Nautilus` instance that can be used to publish and consume assets on the specified network.

## Automated Publishing

You can use the `AssetBuilder` class to build an asset and publish it with the `Nautilus` instance that we setup in the previous step.

Let's start by creating the builder and specifying the account that will be the owner/publisher of the new asset:

```ts
import { AssetBuilder } from '@deltadao/nautilus'

const assetBuilder = new AssetBuilder()
```

With this we can now continue to setup the metadata information for the asset:

```ts
assetBuilder
  .setType('dataset') // 'dataset' or 'algorithm'
  .setName('My New Asset')
  .setDescription('This is a publish asset building test using Nautilus') // supports markdown
  .setAuthor('testAuthor')
  .setLicense('MIT') // SPDX license identifier
```

If we want to publish an algorithm instead of a dataset, we have to specify [additonal metadata](https://docs.oceanprotocol.com/core-concepts/did-ddo#algorithm-metadata), to make sure the orchestration knows which image to prepare for the algorithm to be able to run correctly:

```ts
const algoMetadata = {
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
```

Now we can set this metadata using the builder:

```ts
assetBuilder.setAlgorithm(algoMetadata)
```

### Services

Next we need to specify where our asset is actually located. In Ocean we can do this using the `Services` array specified in the [DDO](https://docs.oceanprotocol.com/core-concepts/did-ddo#ddo).

A single Service needs to specify information following the [DDO specifications](https://docs.oceanprotocol.com/core-concepts/did-ddo#ddo).

Nautilus provides a `ServiceBuilder` class that can help us creating new services for our asset:

```ts
import { FileTypes, ServiceTypes, ServiceBuilder } from '@deltadao/nautilus'

// Create a new 'access' type service serving 'url' files
const serviceBuilder = new ServiceBuilder(ServiceTypes.ACCESS, FileTypes.URL)

const urlFile = {
  type: 'url', // there are multiple supported types. See the docs above for more info
  url: 'https://link.to/my/asset',
  method: 'GET'
}

const service = serviceBuilder
  .setServiceEndpoint('https://ocean.provider.to/use') // the access controller to be in control of this asset
  .setTimeout(0) // Timeout in seconds (0 means unlimited access after purchase)
  .addFile(urlFile)
  .build()

assetBuilder.addService(service)
```

> **_NOTE:_** If you want to publish an algorithm or dataset for computation make sure to set `ServiceBuilder(ServiceTypes.COMPUTE, ...)`.

The code above will build a new `access` service, serving a `url` type file that is available at `https://link.to/my/asset`. The service will be accessible via the ocean provider hosted at `https://ocean.provider.to/use`.

The supported `ServiceTypes` are `ACCESS` and `COMPUTE`.
<br />The supported `FileTypes` are `URL`, `GRAPHQL`, `ARWEAVE`, `IPFS` and `SMARTCONTRACT`.

For more info on the different types and their available configuration, please refer to the official [Ocean Protocl Documentation](https://docs.oceanprotocol.com/core-concepts/did-ddo#files).

### Consumer Parameters

It is also possible to publish assets with `consumerParameters`. These are parameters that consumers can provide values for during consumption. For examples and the full overview on these parameters you can refer to the [Consumer Parameters section of the Ocean Protocol Docs](https://docs.oceanprotocol.com/core-concepts/did-ddo#consumer-parameters).

We can use the `ServiceBuilder` in combination with the `ConsumerParameterBuilder` to create this with the Nautilus API. The supported types are `'text'`, `'number'`, `'boolean'` and `'select'`.

```ts
const consumerParameterBuilder = new ConsumerParameterBuilder()

const textParam = consumerParameterBuilder
  .setType('text')
  .setName('myParam')
  .setLabel('My Param')
  .setDescription('A description of my param for the enduser.')
  .setDefault('default-value')
  .setRequired(true)
  .build()

serviceBuilder.addConsumerParameter(textParam)
```

For `select` type parameters you have access to an additional function, to add options that the consumer can choose from:

```ts
// Reset helper if the builder was used to built another parameter before
consumerParameterBuilder.reset()

const selectParam = consumerParameterBuilder
  .setType('select')
  .setName('selectParam')
  .setLabel('My Select Param')
  .setDescription('A description of my select param for the enduser.')
  .setRequired(false)
  .addOption({ value: 'label' })
  .addOption({ otherValue: 'Other Label' })
  .addOption({ 'longer-option-value': 'Another Label' })
  .setDefault('otherValue')
  .build()

serviceBuilder.addConsumerParameter(selectParam)
```

### Pricing

We also want to also specify the pricing for our asset. The `AssetBuilder` provides a function for this that we can make use of:

```ts
// Example of a fixed asset
assetBuilder.setPricing({
  type: 'fixed', // 'fixed' or 'free'
  // freCreationParams can be ommitted for 'free' pricing schemas
  freCreationParams: {
    fixedRateAddress: '0x25e1926E3d57eC0651e89C654AB0FA182C6D5CF7', // Fixed Rate Contract address on Mumbai network
    baseTokenAddress: '0xd8992Ed72C445c35Cb4A2be468568Ed1079357c8', // OCEAN token contract address on Mumbai network
    baseTokenDecimals: 18, // adjusted to OCEAN token
    datatokenDecimals: 18, // adjusted to OCEAN token
    fixedRate: '1', // PRICE
    marketFee: '0',
    marketFeeCollector: '0x0000000000000000000000000000000000000000'
  }
})

// Example of a free asset
assetBuilder.setPricing({
  type: 'free'
})
```

### Owner and optional configs

We also have to make sure we specify the owner of the asset, that will be used for the publishing process:

```ts
// Set the owner using the web3 instance we setup in the initial nautilus configuration
const owner = web3.defaultAccount

assetBuilder.setOwner(owner)
```

Optionally, we can specify some information for the access token, like the name and symbol, to be used. This will be displayed in Ocean Markets and also can be used to identify your service in the network (e.g., when visiting block explorers).

```ts
const name = 'My Datatoken Name'
const symbol = 'SYMBOL'

assetBuilder.setDatatokenNameAndSymbol(name, symbol)
```

Finally, if all is configured, we are able to build and publish the asset:

```ts
const asset = assetBuilder.build()

const result = await nautilus.publish(asset)
/*
  The publishing result will look something like this:
  
  {
    erc721Address: '0xC874F7956CBBFd36F8EA7394EafF415A62F1A548',
    datatokenAddress: '0x36176CB161554862a630545665e8769e8649C30B',
    txHash: '0x154932e1b3c52ddbaffda559ed103a5e5b542199bf3b7f85bc393d1488306555',
    DID: 'did:op:941b503aa8303cebd8130e7ddc0e5e82c7536c385059723981a4b1d392dc43e0'
  }
*/
```

If all went well, you should be able to browse the asset on any OceanMarket connected to the network that was published on, by simply using its DID, e.g.:
`https://market.oceanprotocol.com/asset/{did}`

## Automated Compute Jobs

The `Nautilus` instance we created in the setup step provides access to a `compute()` function that we can use to start new compute jobs.
This includes all potentially necessary orders for required datatokens as well as the signed request towards Ocean Provider to start the compute job itself.

### Basic Config

The following values are required to start a new compute job:

```ts
const dataset = {
  did: 'did:op:123abc...' // any 'compute' dataset
}

const algorithm = {
  did: 'did:op:123abc...' // any algorithm allowed to be run on the given dataset
}

const computeConfig = {
  dataset,
  algorithm
}
```

### Optional Settings

In addition to that you can also specify some optional properties if needed.
Both the dataset and algorithm support custom `userdata` that might be passed to the services. For algorithms you can also specify a `algocustomdata` property.

| Property         | Required | Supported for          | Description                                                                                                                                                  |
| ---------------- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `did`            | Required | `dataset \| algorithm` | The DID of the asset to use for computation                                                                                                                  |
| `serviceId`      | Optional | `dataset \| algorithm` | <!-- TODO: Remove alpha note once supported --> Feature in alpha. Not fully supported yet.<br />The specific service of the asset to be used for computation |
| `userdata`       | Optional | `dataset \| algorithm` | Optional userdata to be passed to the service                                                                                                                |
| `algocustomdata` | Optional | `algorithm`            | Optional custom data to be passed to the algorithm at computation                                                                                            |

```ts
// Example of a CtD dataset config
const dataset = {
  did: 'did:op:123abc',
  serviceId: 'specific-serviceId-of-compute-service'
  userdata: {
    myParam: 'myValue',
    booleanParam: false
  }
}

// Example of a CtD algorithm config
const algorithm = {
  did: 'did:op:123abc',
  serviceId: 'specific-serviceId-of-compute-service'
  userdata: {
    myParam: 'myValue',
    booleanParam: false
  },
  algocustomdata: {
    myParam: 'myValue',
    numberParam: 123
  }
}
```

### Start compute job

When you are happy with the configuration you can use the `Nautilus` instance to start the new compute job:

```ts
const computeJob = await nautilus.compute({
  dataset,
  algorithm
})

const jobId = computeJob[0].jobId // make sure to save your jobId to retrieve results later
```

### Get compute job status

Once you have started a compute job it is possible to get status reports via the `.getComputeStatus()` function.
For this you need to have the `jobId` as well as the `providerUri` endpoint that is used for orchestrating and accessing the compute job.

In most cases `providerUri` will be the `serviceEndpoint` of the `compute` service of the dataset that was computed on.

```ts
const computeJob = await nautilus.getComputeStatus({
  jobId, // use your previously saved jobId
  providerUri: 'https://v4.provider.oceanprotocol.com/' // default ocean provider(serviceEndpoint)
})
```

Example compute job status:

```json
{
  "agreementId": "0x1234abcd",
  "jobId": "9876",
  "owner": "0x1234",
  "status": 70,
  "statusText": "Job finished",
  "dateCreated": "1683849268.012345",
  "dateFinished": "1683849268.012345",
  "results": [
    {
      "filename": "results.txt",
      "filesize": 1234,
      "type": "output"
    },
    {
      "filename": "algorithm.log",
      "filesize": 1234,
      "type": "algorithmLog"
    },
    {
      "filename": "configure.log",
      "filesize": 1234,
      "type": "configrationLog"
    },
    {
      "filename": "publish.log",
      "filesize": 0,
      "type": "publishLog"
    }
  ],
  "stopreq": 0,
  "removed": 0,
  "algoDID": "did:op:algo-did",
  "inputDID": ["did:op:dataset-did"]
}
```

### Get compute job results

If a compute job has finished running and there are results available, you can access these utilizing Nautilus.
Once again you will need the `jobId` as well as the `providerUri` as specified in the previous section on compute status.

```ts
const computeResultUrl = await nautilus.getComputeResult({
  jobId, // use your previously saved jobId
  providerUri: 'https://v4.provider.oceanprotocol.com/' // default ocean provider(serviceEndpoint)
})
```

In addition, you can also specify a `resultIndex` to access a specific result file you are interested in. If you do not specify a `resultIndex`, the first result file will be used by default. For example, you could use this to get the algorithm log of a specific compute job:

```ts
const jobStatus = await nautilus.getComputeStatus({
  jobId,
  providerUri
})

if (jobStatus.status === 70) {
  const resultIndexAlgorithmLog = status.results?.findIndex(
    (result) => result.type === 'algorithmLog'
  )
  const computeResultUrl = await nautilus.getComputeResult({
    jobId,
    providerUri,
    resultIndex:
      resultIndexAlgorithmLog > -1 ? resultIndexAlgorithmLog : undefined
  })
}
```

For more information on compute job status and result requests please refer to the [Ocean Provider API documentation](https://docs.oceanprotocol.com/api-references/provider-rest-api#status-and-result).

## Automated Access

To access assets or more specifically their respective services, we can make use of the `access()` function provided by the `Nautilus` instance we created in the setup step.
This includes all potentially necessary orders for required datatokens as well as the signed request towards Ocean Provider needed to grant the access to the service.

In the most basic version, nothing else than the did of the asset to be accessed is needed:

```ts
const accessUrl = await nautilus.access({
  assetDid: 'did:op:123abc'
})
```

In addition to that, just as with Computejobs, you can also provide custom userdata that may be needed to consume the asset:

```ts
const accessConfig = {
  assetDid: 'did:op:123abc',
  userdata: {
    myParam: 'myValue',
    anotherParam: 123,
    booleanParam: false
  }
}

const accessUrl = await nautilus.access(accessConfig)
```

## API Documentation

If you want to learn more about Nautilus, we provide a more detailed documentation of the library, including a typedoc API documentation:
https://deltadao.github.io/nautilus/docs/api/

## License

```
Copyright ((C)) 2023 deltaDAO AG

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
