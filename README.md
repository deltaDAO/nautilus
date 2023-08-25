# Nautilus

A typescript library helping to navigate the OCEAN. It enables configurable automated publishing and consumption of assets in any [Ocean Protocol](https://oceanprotocol.com) ecosystem.

## Table of Contents

- [Nautilus](#nautilus)
  - [Table of Contents](#table-of-contents)
  - [Configuring a new Nautilus instance](#configuring-a-new-nautilus-instance)
  - [Automated Publishing](#automated-publishing)
    - [Services](#services)
      - [Pricing](#pricing)
      - [Consumer Parameters](#consumer-parameters)
      - [Compute Services](#compute-services)
      - [Datatoken](#datatoken)
      - [Service name and description](#service-name-and-description)
    - [Asset Owner](#asset-owner)
    - [Optional Configurations](#optional-configurations)
      - [Credentials](#credentials)
      - [Tags and Categories](#tags-and-categories)
    - [Building the Asset](#building-the-asset)
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

Make sure you have [ethers](https://www.npmjs.com/package/ethers) installed:

> Currently [oceanjs](https://github.com/oceanprotocol/ocean.js/tree/main) does support [Ethers v5](https://docs.ethers.org/v5/). Version 6 is not yet supported and may cause problems.

```shell
npm install ethers@^5.7.2
```

Next, create the ethers `Signer` you want to use for the automations. In this example we create a `Wallet` from a given private key.

```ts
import { Wallet, providers } from 'ethers'
// This example assumes you have an environment variable named PRIVATE_KEY
// You can use a package like dotenv to load environment variables

// Setup the ethers provider to use
const provider = new providers.JsonRpcProvider(
  'https://matic-mumbai.chainstacklabs.com' // can be replaced with any Ocean Protocol supported network
)

const wallet = new Wallet(process.env.PRIVATE_KEY, provider)
```

Now you can use the static `create()` method of the `Nautilus` class to construct a new instance:

```ts
// import the Natilus class
import { Nautilus } from '@deltadao/nautilus'

// create the instance
const nautilus = await Nautilus.create(wallet)
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
const customNautilus = await Nautilus.create(wallet, customConfig)
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

serviceBuilder
  .setServiceEndpoint('https://v4.provider.oceanprotocol.com') // v4 ocean provider, maintained by the Ocean Protocol Foundation
  .setTimeout(0) // Timeout in seconds (0 means unlimited access after purchase)
  .addFile(urlFile)
```

> **_NOTE:_** If you want to publish an algorithm or dataset for computation make sure to set `ServiceBuilder(ServiceTypes.COMPUTE, ...)`.

The code above will build a new `access` service, serving a `url` type file that is available at `https://link.to/my/asset`. The service will be accessible via the ocean provider hosted at `https://v4.provider.oceanprotocol.com`.

> **_NOTE:_** You should specify the provider instance to use, as this is the access controlling component in the stack. You can be fully self-sovereign by using a self-deployed instance or use a trusted third party instance of your choice.

The supported `ServiceTypes` are `ACCESS` and `COMPUTE`.
<br />The supported `FileTypes` are `URL`, `GRAPHQL`, `ARWEAVE`, `IPFS` and `SMARTCONTRACT`.

For more info on the different types and their available configuration, please refer to the official [Ocean Protocl Documentation](https://docs.oceanprotocol.com/core-concepts/did-ddo#files).

#### Pricing

We also want to also specify the pricing for our asset. The `ServiceBuilder` provides a function for this that we can make use of:

```ts
// Example of a fixed asset
serviceBuilder.setPricing({
  type: 'fixed', // 'fixed' or 'free'
  // freCreationParams can be ommitted for 'free' pricing schemas
  freCreationParams: {
    fixedRateAddress: '0x25e1926E3d57eC0651e89C654AB0FA182C6D5CF7', // Fixed Rate Contract address on Mumbai network
    baseTokenAddress: '0xd8992Ed72C445c35Cb4A2be468568Ed1079357c8', // OCEAN token contract address on Mumbai network
    baseTokenDecimals: 18, // adjusted to OCEAN token
    datatokenDecimals: 18,
    fixedRate: '1', // PRICE
    marketFee: '0',
    marketFeeCollector: '0x0000000000000000000000000000000000000000'
  }
})

// Example of a free asset
serviceBuilder.setPricing({
  type: 'free'
})
```

#### Consumer Parameters

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

#### Compute Services

To publish a service to be allowed for computation utilizing [Compute-to-Data](https://docs.oceanprotocol.com/developers/compute-to-data), we are able to set some additional information in case we need to.
The so called `compute` object of a service allows us to specify the following attributes:

- `allowRawAlgorithm`
- `allowNetworkAccess`
- `publisherTrustedAlgorithmPublishers`
- `publisherTrustedAlgorithms`

You can find out more about the specifications at the [official documentation](https://docs.oceanprotocol.com/developers/compute-to-data/compute-options).

Without any custom configuration, the `ServiceBuilder` adheres to the principle of least privilige, by setting the following values:

```ts
service.compute = {
  allowNetworkAccess: false,
  allowRawAlgorithm: false,
  publisherTrustedAlgorithmPublishers: [],
  publisherTrustedAlgorithms: []
}
```

> **_NOTE:_** This means, that by default **no algorithm will be allowed** to run computations on our dataset, without updating the metadata at a later point in time.

However, the `ServiceBuilder` class also supports setting these attributes to the desired values before publishing:

```ts
// Allow raw algorithms on this service
serviceBuilder.allowRawAlgorithms()

// Prevent raw algorithms on this service
serviceBuilder.allowRawAlgorithms(false)

// Allow network access during computation
serviceBuilder.allowAlgorithmNetworkAccess()

// Prevent network access during computation
serviceBuilder.allowAlgorithmNetworkAccess(false)

// Add a trusted algorithm to be allowed to run computations
const trustedAlgorithm = {
  did: '0x1234...',
  filesChecksum: '...', // can be calculated using the ocean-provider of the algorithm service
  containerSectionChecksum: '...' //Hash of algorithm’s metadata.algorithm.container section
}
serviceBuilder.addTrustedAlgorithm(trustedAlgorithm)

// Add any algorithm published by a given address to be allowed to run computations
const publisherAddress = '0x1234addressOfPublisher'
serviceBuilder.addTrustedAlgorithmPublisher(publisherAddress)
```

> **_NOTE:_** Make sure to set the `ServiceType` of your service to `ServiceType.COMPUTE`, as the `compute` object is ignored for access type services.

_We aim to support automated calculations for trusted algorithm checksums in the future._

#### Datatoken

Optionally, we can specify some information for the access token, like the name and symbol, to be used. This will be displayed in Ocean Markets and also can be used to identify your service in the network (e.g., when visiting block explorers).

```ts
const name = 'My Datatoken Name'
const symbol = 'SYMBOL'

serviceBuilder.setDatatokenNameAndSymbol(name, symbol)
```

#### Service name and description

If we want to provide some human readable metadata for our service, we can utilize the `name` and `description` properties respectively. The `ServiceBuilder` class supports setting these:

```ts
const name = 'Service Name'
const description = 'A descriptive text about my service.'

serviceBuilder.setName(name)
serviceBuilder.setDescription(description)
```

#### Adding services via the AssetBuilder

Once our service is correctly configured, we can simply call the `build()` function of our builder and add it to the asset using our `AssetBuilder` instance:

```ts
const service = serviceBuilder.build()

assetBuilder.addService(service)
```

### Asset Owner

We also have to make sure we specify the owner of the asset, that will be used for the publishing process:

```ts
// Set the owner using the Wallet instance we setup in the initial nautilus configuration
const owner = wallet.address

assetBuilder.setOwner(owner)
```

### Optional Configurations

There are also quite some optional configurations we can make utilizing the AssetBuilder. For a detailed look on what is supported, please refer to our API documentation: https://deltadao.github.io/nautilus/docs/api/classes/Nautilus.AssetBuilder

#### Credentials

If needed, we can set credentials to restrict access of our assets easily via the AssetBuilder. Currently only `address` type credentials are supported.

```ts
const whitelistedAddresses = [
  '0x12341234testaddress',
  '0xanother1234testaddress'
]

// whitelisting addresses to be allowed to access our service
assetBuilder.addCredentialAddresses(
  CredentialListTypes.ALLOW,
  whitelistedAddresses
)
```

We can either provide a whitelist of addresses that should be allowed to consume our service (`CredentialListTypes.ALLOW`) or we can specifically blacklist certain addresses restricting the access on our service (simply change the list type to `CredentialListTypes.DENY`).

#### Tags and Categories

We can set tags or categories for our asset using the respective functions. In the current implementation it is encouraged to prefer tags over categories, as they have better support throughout the stack, e.g., in various frontend applications.

```ts
const categories = ['Category 1', 'Category 2']
assetBuilder.addCategories(categories)

const tags = ['my-awesome-tag', 'another tag']
assetBuilder.addTags(tags)
```

### Building the Asset

Finally, if all is configured, we are able to build and publish the asset:

```ts
const asset = assetBuilder.build()

const result = await nautilus.publish(asset)
/*
  The publishing result will look something like this:
  
  {
    nftAddress: '0xC874F7956CBBFd36F8EA7394EafF415A62F1A548',
    services: [{
      service: {
        type: 'access',
        files: [...],
        ...
      },
      datatokenAddress: '0x36176CB161554862a630545665e8769e8649C30B',
      pricingTransactionReceipt: {
        hash: '0x154932e1b3c52ddbaffda559ed103a5e5b542199bf3b7f85bc393d1488306555',
        ...
      }
    }],
    ddo: {
      id: 'did:op:941b503aa8303cebd8130e7ddc0e5e82c7536c385059723981a4b1d392dc43e0',
      ...
    },
    setMetadataTxReceipt: {
      hash: '0x154932e1b3c52ddbaffda559ed103a5e5b542199bf3b7f85bc393d1488306555',
      ...
    }
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

The `providerUri`, meaning the used access controller, will be the `serviceEndpoint` of the `compute` service of the dataset that was computed on.

```ts
const computeJob = await nautilus.getComputeStatus({
  jobId, // use your previously saved jobId
  providerUri: 'https://v4.provider.oceanprotocol.com/' // replace with the respective ocean provider (serviceEndpoint) of the compute dataset service
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
  providerUri: 'https://v4.provider.oceanprotocol.com/' // replace with the respective ocean provider (serviceEndpoint) of the compute dataset service
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
