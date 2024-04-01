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

## Overview
nautilus addresses many common pain points faced by developers interacting with the data economy by offering a range of features enhancing productivity and efficiency.
You will find a quick introduction on this page to get you setup with the **Data Economy TypeScript Toolkit**.

Looking for dedicated feature documentations? Follow the links below:
- [Download](https://nautilus.delta-dao.com/docs/guides/download)
- [Compute to Data](https://nautilus.delta-dao.com/docs/guides/compute)
- [Publishing](https://nautilus.delta-dao.com/docs/guides/publish)
- [Editing](https://nautilus.delta-dao.com/docs/guides/edit)


## Quick Start
### 1. Setup your Signer
Firstly, create the signer you want to use with your nautilus instance. nautilus uses the ethers.js `Signer`. You can read more about possible configurations in the [official documentation](https://docs.ethers.org/v5/api/signer/).

```ts twoslash
import { Wallet, providers } from 'ethers'
import { Nautilus } from '@deltadao/nautilus'

const provider = new providers.JsonRpcProvider('https://rpc.dev.pontus-x.eu') 
const signer = new Wallet('0x...', provider) 
```

In this example we create an ethers `Wallet` from a given private key and connect to a RPC provider of our choice.

### 2. Setup the nautilus instance
Now that you have a Signer set up, you can use it to bootstrap your nautilus client instance.

``` ts twoslash
import { Wallet, providers } from 'ethers'
import { Nautilus } from '@deltadao/nautilus'

const provider = new providers.JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)

const nautilus = await Nautilus.create(signer) 
```

Note, that we use the previously created Wallet and pass it to Nautilus to create the instance with this signer.

### 3. Interact with the data economy
With the client instance bootstrapped you can now trigger any transactions or access calls supported by OceanProtocol.

``` ts twoslash
import { Wallet, providers } from 'ethers'
import { Nautilus } from '@deltadao/nautilus'

const provider = new providers.JsonRpcProvider('https://rpc.dev.pontus-x.eu')
const signer = new Wallet('0x...', provider)

const nautilus = await Nautilus.create(signer)

const accessUrl = await nautilus.access({ assetDid: 'did:op:12345'}) 
const data = await fetch(accessUrl) 
```

In this example we construct a one-time `accessUrl` and can then use it to fetch the data associated with the respective data service.

## Next Steps

Find dedicated feature documentation by following one of the links below:
- [Download](https://nautilus.delta-dao.com/docs/guides/download)
- [Compute to Data](https://nautilus.delta-dao.com/docs/guides/compute)
- [Publishing](https://nautilus.delta-dao.com/docs/guides/publish)
- [Editing](https://nautilus.delta-dao.com/docs/guides/edit)

If you want to jump straight into code, feel free to take a look at some of our code examples in the [nautilus-examples repository](https://github.com/deltaDAO/nautilus-examples).

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
