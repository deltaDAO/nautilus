<br />

<p align="center">
  <a href="https://nautilus.delta-dao.com">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://github.com/deltaDAO/nautilus/raw/main/docs/public/logo-dark.svg">
        <img alt="nautilus logo" src="https://github.com/deltaDAO/nautilus/raw/main/docs/public/logo-light.svg" width="auto" height="60">
      </picture>
</a>
</p>

<p align="center">
   The Data Economy TypeScript Toolkit
<p>

<p align="center">
  <a href="https://www.npmjs.com/package/deltadao/nautilus">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/v/@deltadao/nautilus?colorA=21262d&colorB=21262d&style=for-the-badge">
      <img src="https://img.shields.io/npm/v/@deltadao/nautilus?colorA=f6f8fa&colorB=f6f8fa&style=for-the-badge" alt="Version">
    </picture>
  </a>
  <a href="https://github.com/deltaDAO/nautilus/blob/main/LICENSE">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/l/@deltadao/nautilus?colorA=21262d&colorB=21262d&style=for-the-badge">
      <img src="https://img.shields.io/npm/l/@deltadao/nautilus?colorA=f6f8fa&colorB=f6f8fa&style=for-the-badge" alt="Apache-2.0 License">
    </picture>
  </a>
  <a href="https://www.npmjs.com/package/deltadao/nautilus">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/github/actions/workflow/status/deltaDAO/nautilus/changeset.yml?colorA=21262d&colorB=21262d&style=for-the-badge">
      <img src="https://img.shields.io/github/actions/workflow/status/deltaDAO/nautilus/changeset.yml?colorA=f6f8fa&colorB=f6f8fa&style=for-the-badge" alt="GitHub Actions Workflow Status">
    </picture>
  </a>
</p>


A TypeScript library enabling you to explore the Data Economy. It is built on top of [ocean.js](https://github.com/oceanprotocol/ocean.js) and offers feature complete, automated interactions with any [Ocean Protocol](https://oceanprotocol.com) ecosystem.

> **Beta** — nautilus 2.0.0 is a pre-release. The API can still change between betas and you should expect bugs. Install it with `npm install @deltadao/nautilus@beta`, and please report anything you hit at [github.com/deltaDAO/nautilus/issues](https://github.com/deltaDAO/nautilus/issues).

## Overview

nautilus addresses many common pain points faced by developers interacting with the data economy by offering a range of features enhancing productivity and efficiency.
You will find a quick introduction on this page to get you setup with the **Data Economy TypeScript Toolkit**.

Looking for dedicated feature documentations? Follow the links below:
- [Download](https://nautilus.delta-dao.com/docs/guides/download)
- [Compute to Data](https://nautilus.delta-dao.com/docs/guides/compute)
- [Publishing](https://nautilus.delta-dao.com/docs/guides/publish)
- [Editing](https://nautilus.delta-dao.com/docs/guides/edit)
- [Credential-gated assets](https://nautilus.delta-dao.com/docs/guides/identity)

Coming from nautilus v1? See [MIGRATION.md](https://github.com/deltaDAO/nautilus/blob/main/MIGRATION.md) for a call-by-call map.

## Quick Start

### 1. Set up your Signer

nautilus uses the ethers.js `Signer`. Note that v2 requires **ethers v6**, where
`JsonRpcProvider` is a top-level export and the `providers` namespace no longer exists.

```ts twoslash
import { JsonRpcProvider, Wallet } from 'ethers'

const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)
```

### 2. Set up the nautilus instance

One **ocean-node** now serves metadata, provider services and the indexer, so a single
`oceanNodeUri` replaces v1's `metadataCacheUri` and `providerUri`.

```ts twoslash
import { JsonRpcProvider, Wallet } from 'ethers'
import { Nautilus } from '@deltadao/nautilus'

const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)

const nautilus = await Nautilus.create(signer, {
  config: { oceanNodeUri: 'https://node.example.org' }
})
```

`ConfigHelper` ships defaults for Pontus-X devnet (chain 32456). On other networks, pass the
contract addresses in `config` as well.

### 3. Download an asset

```ts twoslash
import { JsonRpcProvider, Wallet } from 'ethers'
import { Nautilus } from '@deltadao/nautilus'

const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)
const nautilus = await Nautilus.create(signer, {
  config: { oceanNodeUri: 'https://node.example.org' }
})
// ---cut---
const { url } = await nautilus.access({ assetDid: 'did:ope:12345' })
const data = await fetch(url)
```

nautilus orders the service if you do not already hold a valid order, and reuses the
existing one if you do.

### 4. Publish an asset

nautilus signs the DDO as a verifiable credential and stores it off chain, writing only a
`{ remote }` pointer on chain — so publishing needs a **remote store**. The node's own
persistent storage works, and needs no external service:

```ts twoslash
import { JsonRpcProvider, Wallet } from 'ethers'
import {
  AssetBuilder,
  FileTypes,
  Nautilus,
  NodePersistentRemoteStore,
  ServiceBuilder,
  ServiceTypes
} from '@deltadao/nautilus'

const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)
const config = { oceanNodeUri: 'https://node.example.org' }

// The store needs a node client, so build the instance in two steps.
const bootstrap = await Nautilus.create(signer, { config })
const nautilus = await Nautilus.create(signer, {
  config,
  remoteStore: new NodePersistentRemoteStore(bootstrap.getNodeClient())
})

const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
  serviceType: ServiceTypes.ACCESS
})
  .setServiceEndpoint('https://node.example.org')
  .setName('Access Service')
  .setTimeout(86400)
  .addFile({ type: 'url', url: 'https://data.example/set.csv', method: 'GET' })
  .setPricing({ type: 'free' })
  .build()

const asset = new AssetBuilder()
  .setType('dataset')
  .setName('My Dataset')
  .setDescription('What it contains')
  .setAuthor('Me')
  .setProvidedBy('My Organisation') // required by DDO v5
  .setLicense('https://example.org/terms')
  .addService(service)
  .build()

const { ddo } = await nautilus.publish(asset, { waitForIndexer: true })
```

The DDO is validated locally before anything is written, so a missing field costs no gas.

### 5. Credential-gated assets

If an asset requires a verifiable credential, configure a credential provider once and
nautilus drives the whole presentation exchange — nothing changes at the call site.

```ts twoslash
import { JsonRpcProvider, Wallet } from 'ethers'
import { Nautilus, WaltIdCredentialProvider } from '@deltadao/nautilus'

const provider = new JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)
const config = { oceanNodeUri: 'https://node.example.org' }

const bootstrap = await Nautilus.create(signer, { config })
const nautilus = await Nautilus.create(signer, {
  config,
  credentials: new WaltIdCredentialProvider(bootstrap.getNodeClient(), {
    walletApi: 'https://wallet.example.org'
  })
})

const { url } = await nautilus.access({ assetDid: 'did:ope:12345' })
```

## Next Steps

Find dedicated feature documentation by following one of the links below:
- [Download](https://nautilus.delta-dao.com/docs/guides/download)
- [Compute to Data](https://nautilus.delta-dao.com/docs/guides/compute)
- [Publishing](https://nautilus.delta-dao.com/docs/guides/publish)
- [Editing](https://nautilus.delta-dao.com/docs/guides/edit)
- [Credential-gated assets](https://nautilus.delta-dao.com/docs/guides/identity)

If you want to jump straight into code, feel free to take a look at the runnable [examples](https://github.com/deltaDAO/nautilus/tree/main/examples) in this repository — a small CLI covering publishing, editing, downloading, Compute-to-Data and credential-gated access.

## License

```
Copyright ((C)) 2026 deltaDAO AG

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
