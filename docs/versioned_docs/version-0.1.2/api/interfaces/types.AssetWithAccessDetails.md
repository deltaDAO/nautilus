---
id: "types.AssetWithAccessDetails"
title: "Interface: AssetWithAccessDetails"
sidebar_label: "AssetWithAccessDetails"
custom_edit_url: null
---

[@types](../modules/types.md).AssetWithAccessDetails

## Hierarchy

- `Asset`

  ↳ **`AssetWithAccessDetails`**

  ↳↳ [`AssetWithAccessDetailsAndPrice`](types.AssetWithAccessDetailsAndPrice.md)

## Properties

### @context

• **@context**: `string`[]

Contexts used for validation.

#### Inherited from

Asset.@context

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:11

___

### accessDetails

• **accessDetails**: [`AccessDetails`](types.AccessDetails.md)

#### Defined in

[src/@types/Compute.ts:65](https://github.com/deltaDAO/nautilus/blob/e517813/src/@types/Compute.ts#L65)

___

### chainId

• **chainId**: `number`

ChainId of the network the DDO was published to.

#### Inherited from

Asset.chainId

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:33

___

### credentials

• `Optional` **credentials**: `Credentials`

Describes the credentials needed to access a dataset
in addition to the services definition.

#### Inherited from

Asset.credentials

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:49

___

### datatokens

• **datatokens**: `AssetDatatoken`[]

Contains information about the ERC20 Datatokens attached to asset services.

#### Inherited from

Asset.datatokens

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:130

___

### event

• **event**: `AssetLastEvent`

Contains information about the last transaction that created or updated the DDO.

#### Inherited from

Asset.event

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:135

___

### id

• **id**: `string`

DID, descentralized ID.
Computed as sha256(address of NFT contract + chainId)

#### Inherited from

Asset.id

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:17

___

### metadata

• **metadata**: `Metadata`

Stores an object describing the asset.

#### Inherited from

Asset.metadata

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:38

___

### nft

• **nft**: `AssetNft`

Contains information about the ERC721 NFT contract which represents the intellectual property of the publisher.

#### Inherited from

Asset.nft

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:125

___

### nftAddress

• **nftAddress**: `string`

NFT contract address

#### Inherited from

Asset.nftAddress

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:28

___

### purgatory

• **purgatory**: `Purgatory`

Contains information about an asset's purgatory status defined in
[`list-purgatory`](https://github.com/oceanprotocol/list-purgatory).
Marketplace interfaces are encouraged to prevent certain user actions like downloading on assets in purgatory.

#### Inherited from

Asset.purgatory

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:147

___

### services

• **services**: `Service`[]

Stores an array of services defining access to the asset.

#### Inherited from

Asset.services

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:43

___

### stats

• **stats**: `Stats`

The stats section contains different statistics fields. This section is added by Aquarius

#### Inherited from

Asset.stats

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:140

___

### version

• **version**: `string`

Version information in SemVer notation
referring to the DDO spec version

#### Inherited from

Asset.version

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:23
