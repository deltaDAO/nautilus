---
id: "AssetWithAccessDetailsAndPrice"
title: "Interface: AssetWithAccessDetailsAndPrice"
sidebar_label: "AssetWithAccessDetailsAndPrice"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`AssetWithAccessDetails`](AssetWithAccessDetails.md)

  ↳ **`AssetWithAccessDetailsAndPrice`**

## Properties

### @context

• **@context**: `string`[]

Contexts used for validation.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[@context](AssetWithAccessDetails.md#@context)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:11

___

### accessDetails

• **accessDetails**: [`AccessDetails`](AccessDetails.md)

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[accessDetails](AssetWithAccessDetails.md#accessdetails)

#### Defined in

[src/@types/Compute.ts:65](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Compute.ts#L65)

___

### chainId

• **chainId**: `number`

ChainId of the network the DDO was published to.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[chainId](AssetWithAccessDetails.md#chainid)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:33

___

### credentials

• `Optional` **credentials**: `Credentials`

Describes the credentials needed to access a dataset
in addition to the services definition.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[credentials](AssetWithAccessDetails.md#credentials)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:49

___

### datatokens

• **datatokens**: `AssetDatatoken`[]

Contains information about the ERC20 Datatokens attached to asset services.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[datatokens](AssetWithAccessDetails.md#datatokens)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:130

___

### event

• **event**: `AssetLastEvent`

Contains information about the last transaction that created or updated the DDO.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[event](AssetWithAccessDetails.md#event)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:135

___

### id

• **id**: `string`

DID, descentralized ID.
Computed as sha256(address of NFT contract + chainId)

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[id](AssetWithAccessDetails.md#id)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:17

___

### metadata

• **metadata**: `Metadata`

Stores an object describing the asset.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[metadata](AssetWithAccessDetails.md#metadata)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:38

___

### nft

• **nft**: `AssetNft`

Contains information about the ERC721 NFT contract which represents the intellectual property of the publisher.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[nft](AssetWithAccessDetails.md#nft)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:125

___

### nftAddress

• **nftAddress**: `string`

NFT contract address

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[nftAddress](AssetWithAccessDetails.md#nftaddress)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:28

___

### orderPriceAndFees

• **orderPriceAndFees**: [`OrderPriceAndFees`](OrderPriceAndFees.md)

#### Defined in

[src/@types/Compute.ts:69](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Compute.ts#L69)

___

### purgatory

• **purgatory**: `Purgatory`

Contains information about an asset's purgatory status defined in
[`list-purgatory`](https://github.com/oceanprotocol/list-purgatory).
Marketplace interfaces are encouraged to prevent certain user actions like downloading on assets in purgatory.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[purgatory](AssetWithAccessDetails.md#purgatory)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:147

___

### services

• **services**: `Service`[]

Stores an array of services defining access to the asset.

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[services](AssetWithAccessDetails.md#services)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:43

___

### stats

• **stats**: `Stats`

The stats section contains different statistics fields. This section is added by Aquarius

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[stats](AssetWithAccessDetails.md#stats)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:140

___

### version

• **version**: `string`

Version information in SemVer notation
referring to the DDO spec version

#### Inherited from

[AssetWithAccessDetails](AssetWithAccessDetails.md).[version](AssetWithAccessDetails.md#version)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:23
