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

• `Private` **asset**: [`NautilusAsset`](nautilus.NautilusAsset.md)

#### Defined in

[src/nautilus/asset/AssetBuilder.ts:17](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L17)

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

[src/nautilus/asset/AssetBuilder.ts:99](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L99)

___

### addService

▸ **addService**(`service`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `service` | `NautilusService`<`ServiceTypes`, `FileTypes`\> |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addService](../interfaces/types.IAssetBuilder.md#addservice)

#### Defined in

[src/nautilus/asset/AssetBuilder.ts:65](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L65)

___

### build

▸ **build**(): [`NautilusAsset`](nautilus.NautilusAsset.md)

#### Returns

[`NautilusAsset`](nautilus.NautilusAsset.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[src/nautilus/asset/AssetBuilder.ts:108](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L108)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[src/nautilus/asset/AssetBuilder.ts:19](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L19)

___

### setAlgorithm

▸ **setAlgorithm**(`algorithm`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  } |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setAlgorithm](../interfaces/types.IAssetBuilder.md#setalgorithm)

#### Defined in

[src/nautilus/asset/AssetBuilder.ts:53](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L53)

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

[src/nautilus/asset/AssetBuilder.ts:47](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L47)

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

[src/nautilus/asset/AssetBuilder.ts:77](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L77)

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

[src/nautilus/asset/AssetBuilder.ts:83](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L83)

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

[src/nautilus/asset/AssetBuilder.ts:35](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L35)

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

[src/nautilus/asset/AssetBuilder.ts:41](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L41)

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

[src/nautilus/asset/AssetBuilder.ts:29](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L29)

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

[src/nautilus/asset/AssetBuilder.ts:71](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L71)

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

[src/nautilus/asset/AssetBuilder.ts:93](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L93)

___

### setPricing

▸ **setPricing**(`pricing`): [`AssetBuilder`](nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | [`PricingConfigWithoutOwner`](../modules/nautilus.md#pricingconfigwithoutowner) |

#### Returns

[`AssetBuilder`](nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setPricing](../interfaces/types.IAssetBuilder.md#setpricing)

#### Defined in

[src/nautilus/asset/AssetBuilder.ts:59](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L59)

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

[src/nautilus/asset/AssetBuilder.ts:23](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/AssetBuilder.ts#L23)
