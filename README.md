# Nautilus

A typescript library helping to navigate the OCEAN. It enables configurable automated publishing and consumption of assets in any [Ocean Protocol](https://oceanprotocol.com) ecosystem.

- [Automated Publishing](#automated-publishing)
- [Automated Compute Jobs](#automated-compute-jobs)

## Configuring a new Nautilus Instance

Setting up a new `Nautilus` instance to perform automated tasks, like publish & consume, is rather simple.

First make sure to setup the `Web3` instance to use:

```ts
const web3 = new Web3('https://rpc.genx.minimal-gaia-x.eu') // can be replaced with any Ocean Protocol supported network
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
import { AssetBuilder } from '@delta-dao/nautilus'

const assetBuilder = new AssetBuilder()
```

With this we can now continue to setup the metadata information for the asset:

```ts
assetBuilder
  .setType('dataset') // 'dataset' or 'algorithm'
  .setName('My New Asset')
  .setDescription('A publish asset building test on GEN-X') // supports markdown
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
    checksum: '026026d98942438e4df232b3e8cd7ca32416b385918977ce5ec0c6333618c423'
  }
}
```

Now we can set this metadata using the builder:

```ts
assetBuilder.setAlgorithm(algoMetadata)
```

Next we need to specify where our asset is actually located. In Ocean we can do this using the `Services` array specified in the [DDO](https://docs.oceanprotocol.com/core-concepts/did-ddo#ddo).

As we can see in the [DDO specifications](https://docs.oceanprotocol.com/core-concepts/did-ddo#ddo), a single Service needs to specify the following information:

```ts
const accessService = {
  type: 'access', // 'access' or 'compute'
  files: [
    {
      type: 'url', // there are multiple supported types. See the docs above for more info
      url: 'https://link.to/my/asset',
      method: 'GET'
    }
  ],
  serviceEndpoint: 'https://ocean-provider.to/use', // the access controller to be in control of this asset
  timeout: 0 // in seconds, 0 = infinite
}

assetBuilder.addService(accessService)
```

In addition to that, we want to also specify the pricing for our asset. The `AssetBuilder` provides a function for this that we can make use of:

```ts
// Example of a fixed asset
assetBuilder.setPricing({
  type: 'fixed', // 'fixed' or 'free'
  // freCreationParams can be ommitted for 'free' pricing schemas
  freCreationParams: {
    fixedRateAddress: '0x...',
    baseTokenAddress: '0x...',
    baseTokenDecimals: 18,
    datatokenDecimals: 18,
    fixedRate: '1', // PRICE
    marketFee: '0'
  }
})

// Example of a free asset
assetBuilder.setPricing({
  type: 'free'
})
```

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

To start the new compute job simply call the compute function:

```ts
const computeJob = await nautilus.compute(computeConfig)
```

In addition to that you can also specify some optional properties if needed.
Both the dataset and algorithm support custom `userdata` that might be passed to the services. For algorithms you can also specify a `algocustomdata` property.

| Property         | Required | Supported for          | Description                                                                                                                                                 |
| ---------------- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `did`            | Required | `dataset \| algorithm` | The DID of the asset to use for computation                                                                                                                 |
| `serviceId`      | Optional | `dataset \| algorithm` | <!-- TODO: Remove alpha note once supported --> Feature in alpha. Not fully supported yet.<br/>The specific service of the asset to be used for computation |
| `userdata`       | Optional | `dataset \| algorithm` | Optional userdata to be passed to the service                                                                                                               |
| `algocustomdata` | Optional | `algorithm`            | Optional custom data to be passed to the algorithm at computation                                                                                           |

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

When you are happy with the configuration you can use the `Nautilus` instance just as before to start the new compute job:

```ts
const computeJob = await nautilus.compute({
  dataset: datasetOrAlgorithm,
  algorithm
})
```

## Access

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
