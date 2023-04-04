# Nautilus

A typescript library helping to navigate the OCEAN. It enables configurable automated publishing and consumption of assets in any [Ocean Protocol](https://oceanprotocol.com) ecosystem.

- [Automated Publishing](#automated-publishing)

## Configuring a new Nautilus Instance

You can use the `NautilusBuilder` class provided to setup a new `Nautilus` instance to perform automated tasks, like publish & consume.

First make sure to setup the `Web3` instance to use:

```ts
const web3 = new Web3('https://rpc.genx.minimal-gaia-x.eu') // can be replaced with any Ocean Protocol supported network
```

Then you have to add the account you want to use for the automations:

```ts
// This example assumes you have an environment variable named PRIVATE_KEY
// You can use a package like dotenv to load environment variables
const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY)
web3.eth.accounts.wallet.add(account)
web3.defaultAccount = account.address // currently required, will be optional in later versions
```

Now you can use the builder to construct a new `Nautilus` instance:

```ts
const builder = new NautilusBuilder()
const nautilus = builder
  .setWeb3(web3)
  // automatically loads the OceanConfig for chainId = 4 (Rinkeby)
  .setConfig(4)
  .build()
```

This instance can now be used to publish and consume assets on the Rinkeby network.

## Automated Publishing

You can use the `AssetBuilder` class to build an asset and publish it with the `Nautilus` instance that we setup in the previous step.

Let's start by creating the builder and specifying the account that will be the owner/publisher of the new asset:

```ts
const builder = new AssetBuilder()
const owner = web3.defaultAccount
```

With this we can now continue to set a few metadata informations for the asset:

```ts
builder
  .setType('dataset') // 'dataset' or 'algorithm'
  .setName('My New Asset')
  .setDescription('A publish asset building test on GEN-X') // supports markdown
  .setAuthor('testAuthor')
  .setLicense('MIT') // SPDX license identifier
```

Next we need to specify where our asset is actually located. In Ocean we can do this using the `Services` of the [DDO](https://docs.oceanprotocol.com/core-concepts/did-ddo#ddo).

As we can see from the DDO specifications above, a single Service needs the following information:

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
```

In addition to that, we want to also specify the pricing for our asset. The `AssetBuilder` provides a few functions for this that we can make use of:

```ts
builder.addService(accessService).setPricing({
  type: 'fixed', // 'fixed' or 'free'
  // freCreationParams can be ommitted for 'free' pricing schemas
  freCreationParams: {
    fixedRateAddress: fixedRateExchangeAddress,
    baseTokenAddress: oceanTokenAddress,
    baseTokenDecimals: 18,
    datatokenDecimals: 18,
    fixedRate: '1', // PRICE
    marketFee: '0'
  }
})
```

If we want to publish an algorithm instead of a dataset, we have to specify additonal metadata, to make sure the orchestration knows which image to prepare for the algorithm to be able to run correctly:

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
builder.setAlgorithm(algoMetadata)
```

Finally, if all is configured, we are able to build and publish the asset:

```ts
const asset = builder.build()

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

<!-- TODO: Add Compute -->
<!-- TODO: Add Access -->
