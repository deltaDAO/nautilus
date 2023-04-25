---
id: "nautilus.AssetBuilder"
title: "Class: AssetBuilder"
sidebar_label: "AssetBuilder"
custom_edit_url: null
---

[nautilus](../modules/nautilus.md).AssetBuilder

## Implements

- [`IAssetBuilder`](../interfaces/types.IAssetBuilder.md)

## Constructors

### constructor

• **new AssetBuilder**()

## Properties

### asset

• `Private` **asset**: `NautilusAsset`

#### Defined in

[src/nautilus/asset/builder.ts:12](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L12)

## Methods

### addAdditionalInformation

▸ **addAdditionalInformation**(`addtionalInformation`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `addtionalInformation` | `Object` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addAdditionalInformation](../interfaces/types.IAssetBuilder.md#addadditionalinformation)

#### Defined in

[src/nautilus/asset/builder.ts:94](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L94)

___

### addService

▸ **addService**(`service`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `service` | [`ServiceConfig`](../modules/types.md#serviceconfig) |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addService](../interfaces/types.IAssetBuilder.md#addservice)

#### Defined in

[src/nautilus/asset/builder.ts:60](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L60)

___

### build

▸ **build**(): `NautilusAsset`

#### Returns

`NautilusAsset`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[src/nautilus/asset/builder.ts:103](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L103)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[src/nautilus/asset/builder.ts:14](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L14)

___

### setAlgorithm

▸ **setAlgorithm**(`algorithm`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `MetadataAlgorithm` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setAlgorithm](../interfaces/types.IAssetBuilder.md#setalgorithm)

#### Defined in

[src/nautilus/asset/builder.ts:48](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L48)

___

### setAuthor

▸ **setAuthor**(`author`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `author` | `string` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setAuthor](../interfaces/types.IAssetBuilder.md#setauthor)

#### Defined in

[src/nautilus/asset/builder.ts:42](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L42)

___

### setDatatokenData

▸ **setDatatokenData**(`tokenData`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `tokenData` | [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner) |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setDatatokenData](../interfaces/types.IAssetBuilder.md#setdatatokendata)

#### Defined in

[src/nautilus/asset/builder.ts:72](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L72)

___

### setDatatokenNameAndSymbol

▸ **setDatatokenNameAndSymbol**(`dtName`, `dtSymbol`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `dtName` | `string` |
| `dtSymbol` | `string` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setDatatokenNameAndSymbol](../interfaces/types.IAssetBuilder.md#setdatatokennameandsymbol)

#### Defined in

[src/nautilus/asset/builder.ts:78](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L78)

___

### setDescription

▸ **setDescription**(`description`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setDescription](../interfaces/types.IAssetBuilder.md#setdescription)

#### Defined in

[src/nautilus/asset/builder.ts:30](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L30)

___

### setLicense

▸ **setLicense**(`license`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `license` | `string` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setLicense](../interfaces/types.IAssetBuilder.md#setlicense)

#### Defined in

[src/nautilus/asset/builder.ts:36](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L36)

___

### setName

▸ **setName**(`name`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setName](../interfaces/types.IAssetBuilder.md#setname)

#### Defined in

[src/nautilus/asset/builder.ts:24](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L24)

___

### setNftData

▸ **setNftData**(`tokenData`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `tokenData` | [`NftCreateDataWithoutOwner`](../modules/types.md#nftcreatedatawithoutowner) |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setNftData](../interfaces/types.IAssetBuilder.md#setnftdata)

#### Defined in

[src/nautilus/asset/builder.ts:66](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L66)

___

### setOwner

▸ **setOwner**(`owner`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `owner` | `string` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setOwner](../interfaces/types.IAssetBuilder.md#setowner)

#### Defined in

[src/nautilus/asset/builder.ts:88](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L88)

___

### setPricing

▸ **setPricing**(`pricing`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | `PricingConfigWithoutOwner` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setPricing](../interfaces/types.IAssetBuilder.md#setpricing)

#### Defined in

[src/nautilus/asset/builder.ts:54](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L54)

___

### setType

▸ **setType**(`type`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | ``"dataset"`` \| ``"algorithm"`` |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setType](../interfaces/types.IAssetBuilder.md#settype)

#### Defined in

[src/nautilus/asset/builder.ts:18](https://github.com/deltaDAO/nautilus/blob/033f36a/src/nautilus/asset/builder.ts#L18)
