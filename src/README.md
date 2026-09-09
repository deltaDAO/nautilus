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

Prefer running code to reading it? Every flow above is a command in [`examples/`](https://github.com/deltaDAO/nautilus/tree/main/examples) — see [Examples](#examples) below.

## What's new in 2.0.0

nautilus v1 targeted `@oceanprotocol/lib` 3.4.6, ethers v5, Aquarius, Provider and DDO v4.1.0 — none of which a current Ocean deployment runs. v2 targets `@oceanprotocol/lib` 9.x, ethers v6, ocean-node and DDO v5, and adds first-class support for the policy server and the walt.id identity stack.

The builder pattern is unchanged as the primary API: `AssetBuilder`, `ServiceBuilder` and `ConsumerParameterBuilder` keep their fluent shape, and every v1 capability still has a method. This is a breaking major because the DDO model, the transport and the signer library all changed underneath.

- **ocean-node replaces Aquarius and Provider.** One `OceanNodeClient` wraps both, and `Config.oceanNodeUri` replaces `metadataCacheUri` and `providerUri`.
- **The subgraph is gone.** Pricing comes from chain reads and the DDO's indexed stats, so `urql`, `graphql` and graphql-codegen are no longer dependencies.
- **DDO v5.** Assets are W3C Verifiable Credentials: everything moved under `credentialSubject`, DIDs use the `did:ope:` prefix, `description` and `displayTitle` are language-tagged, `license` is structured, and `providedBy` is required.
- **DDOs are signed and stored off chain.** Only a `{remote}` pointer is written on chain. The remote backend is configurable — IPFS, or ocean-node's own persistent storage.
- **Credential-gated access.** nautilus resolves policy-server challenges through the walt.id wallet and verifier, headless by default with optional selection callbacks.
- **Compute is C2D v2.** Explicit resource requests, escrow payment, free compute, streamable logs and results.
- **Local DDO validation** via ddo-js SHACL, before any gas is spent.
- **`strict` TypeScript** is enabled, and ethers v6 is required.

Because this is a beta, the surface above can still move. [MIGRATION.md](https://github.com/deltaDAO/nautilus/blob/main/MIGRATION.md) has the call-by-call mapping from v1, and the [changelog](https://github.com/deltaDAO/nautilus/blob/main/src/CHANGELOG.md) tracks what lands in each beta.

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

## Examples

Everything above, wired up and runnable, lives in [`examples/`](https://github.com/deltaDAO/nautilus/tree/main/examples) in this repository: a small CLI covering publishing, editing, downloading, Compute-to-Data and credential-gated access.

```sh
git clone https://github.com/deltaDAO/nautilus.git
cd nautilus
npm install && npm run build

cd examples
npm install
cp example.env .env
```

Set `NETWORK` and `PRIVATE_KEY` in `.env`, then check that your ocean-node is reachable before anything else:

```sh
npm start -- check:node
```

Every example is a named command, and `help` lists all of them:

```sh
npm start -- help
npm start -- publish:access-dataset
npm start -- access:download did:ope:...
```

The commands are grouped by prefix: `check:`, `publish:`, `asset:`, `edit:`, `access:`, `compute:` and `ssi:` for the credential-gated flows.

### Local build or published package

The examples ship pointing at the nautilus in the same checkout, so they exercise your working copy by default. Three scripts switch between that and the released package:

```sh
npm run nautilus:which   # report which is active
npm run use:local        # build ../src and link it   (the default)
npm run use:npm          # switch to the published package
```

`npm run use:npm -- --spec 2.0.0-beta.0` pins a specific version or dist-tag. Switching rewrites `package.json` and `package-lock.json`, so run `use:local` again before committing.

Full details, including the environment variables and the credential-gated setup, are in the [examples README](https://github.com/deltaDAO/nautilus/blob/main/examples/README.md) and on the [Examples](https://nautilus.delta-dao.com/docs/examples) docs page.

## Next Steps

Find dedicated feature documentation by following one of the links below:
- [Download](https://nautilus.delta-dao.com/docs/guides/download)
- [Compute to Data](https://nautilus.delta-dao.com/docs/guides/compute)
- [Publishing](https://nautilus.delta-dao.com/docs/guides/publish)
- [Editing](https://nautilus.delta-dao.com/docs/guides/edit)
- [Credential-gated assets](https://nautilus.delta-dao.com/docs/guides/identity)

And if you would rather run code than read it, start with the [examples](#examples).

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
