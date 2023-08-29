---
id: "types.AssetWithAccessDetailsAndPrice"
title: "Interface: AssetWithAccessDetailsAndPrice"
sidebar_label: "AssetWithAccessDetailsAndPrice"
custom_edit_url: null
---

[@types](../modules/types.md).AssetWithAccessDetailsAndPrice

## Hierarchy

- [`AssetWithAccessDetails`](types.AssetWithAccessDetails.md)

  ↳ **`AssetWithAccessDetailsAndPrice`**

## Properties

### @context

• **@context**: `string`[]

Contexts used for validation.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[@context](types.AssetWithAccessDetails.md#@context)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:11

___

### accessDetails

• **accessDetails**: [`AccessDetails`](types.AccessDetails.md)

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[accessDetails](types.AssetWithAccessDetails.md#accessdetails)

#### Defined in

[src/@types/Compute.ts:65](https://github.com/deltaDAO/nautilus/blob/3e3a03e/src/@types/Compute.ts#L65)

___

### chainId

• **chainId**: `number`

ChainId of the network the DDO was published to.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[chainId](types.AssetWithAccessDetails.md#chainid)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:33

___

### credentials

• `Optional` **credentials**: `Credentials`

Describes the credentials needed to access a dataset
in addition to the services definition.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[credentials](types.AssetWithAccessDetails.md#credentials)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:49

___

### datatokens

• **datatokens**: `AssetDatatoken`[]

Contains information about the ERC20 Datatokens attached to asset services.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[datatokens](types.AssetWithAccessDetails.md#datatokens)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:130

___

### event

• **event**: `AssetLastEvent`

Contains information about the last transaction that created or updated the DDO.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[event](types.AssetWithAccessDetails.md#event)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:135

___

### id

• **id**: `string`

DID, descentralized ID.
Computed as sha256(address of NFT contract + chainId)

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[id](types.AssetWithAccessDetails.md#id)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:17

___

### metadata

• **metadata**: `Metadata`

Stores an object describing the asset.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[metadata](types.AssetWithAccessDetails.md#metadata)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:38

___

### nft

• **nft**: `AssetNft`

Contains information about the ERC721 NFT contract which represents the intellectual property of the publisher.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[nft](types.AssetWithAccessDetails.md#nft)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:125

___

### nftAddress

• **nftAddress**: `string`

NFT contract address

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[nftAddress](types.AssetWithAccessDetails.md#nftaddress)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:28

___

### orderPriceAndFees

• **orderPriceAndFees**: [`OrderPriceAndFees`](types.OrderPriceAndFees.md)

#### Defined in

[src/@types/Compute.ts:69](https://github.com/deltaDAO/nautilus/blob/3e3a03e/src/@types/Compute.ts#L69)

___

### purgatory

• **purgatory**: `Purgatory`

Contains information about an asset's purgatory status defined in
[`list-purgatory`](https://github.com/oceanprotocol/list-purgatory).
Marketplace interfaces are encouraged to prevent certain user actions like downloading on assets in purgatory.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[purgatory](types.AssetWithAccessDetails.md#purgatory)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:147

___

### services

• **services**: `Service`[]

Stores an array of services defining access to the asset.

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[services](types.AssetWithAccessDetails.md#services)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:43

___

### stats

• **stats**: `Stats`

The stats section contains different statistics fields. This section is added by Aquarius

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[stats](types.AssetWithAccessDetails.md#stats)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/Asset.d.ts:140

___

### version

• **version**: `string`

Version information in SemVer notation
referring to the DDO spec version

#### Inherited from

[AssetWithAccessDetails](types.AssetWithAccessDetails.md).[version](types.AssetWithAccessDetails.md#version)

#### Defined in

node_modules/@oceanprotocol/lib/dist/src/@types/DDO/DDO.d.ts:23
