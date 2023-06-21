---
id: "Nautilus.AssetBuilder"
title: "Class: AssetBuilder"
sidebar_label: "AssetBuilder"
custom_edit_url: null
---

[Nautilus](../modules/Nautilus.md).AssetBuilder

## Implements

- [`IAssetBuilder`](../interfaces/types.IAssetBuilder.md)

## Constructors

### constructor

• **new AssetBuilder**()

## Properties

### asset

• `Private` **asset**: `NautilusAsset`

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:15](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L15)

## Methods

### addAdditionalInformation

▸ **addAdditionalInformation**(`addtionalInformation`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `addtionalInformation` | `Object` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addAdditionalInformation](../interfaces/types.IAssetBuilder.md#addadditionalinformation)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:97](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L97)

___

### addService

▸ **addService**(`service`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `service` | `NautilusService`<[`ServiceTypes`](../enums/Nautilus.ServiceTypes.md), [`FileTypes`](../enums/Nautilus.FileTypes.md)\> |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addService](../interfaces/types.IAssetBuilder.md#addservice)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:63](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L63)

___

### build

▸ **build**(): `NautilusAsset`

#### Returns

`NautilusAsset`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:106](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L106)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:17](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L17)

___

### setAlgorithm

▸ **setAlgorithm**(`algorithm`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  } |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setAlgorithm](../interfaces/types.IAssetBuilder.md#setalgorithm)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:51](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L51)

___

### setAuthor

▸ **setAuthor**(`author`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `author` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setAuthor](../interfaces/types.IAssetBuilder.md#setauthor)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:45](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L45)

___

### setDatatokenData

▸ **setDatatokenData**(`tokenData`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `tokenData` | [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner) |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setDatatokenData](../interfaces/types.IAssetBuilder.md#setdatatokendata)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:75](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L75)

___

### setDatatokenNameAndSymbol

▸ **setDatatokenNameAndSymbol**(`dtName`, `dtSymbol`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `dtName` | `string` |
| `dtSymbol` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setDatatokenNameAndSymbol](../interfaces/types.IAssetBuilder.md#setdatatokennameandsymbol)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:81](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L81)

___

### setDescription

▸ **setDescription**(`description`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setDescription](../interfaces/types.IAssetBuilder.md#setdescription)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:33](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L33)

___

### setLicense

▸ **setLicense**(`license`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `license` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setLicense](../interfaces/types.IAssetBuilder.md#setlicense)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:39](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L39)

___

### setName

▸ **setName**(`name`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setName](../interfaces/types.IAssetBuilder.md#setname)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:27](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L27)

___

### setNftData

▸ **setNftData**(`tokenData`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `tokenData` | [`NftCreateDataWithoutOwner`](../modules/types.md#nftcreatedatawithoutowner) |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setNftData](../interfaces/types.IAssetBuilder.md#setnftdata)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:69](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L69)

___

### setOwner

▸ **setOwner**(`owner`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `owner` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setOwner](../interfaces/types.IAssetBuilder.md#setowner)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:91](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L91)

___

### setPricing

▸ **setPricing**(`pricing`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | [`PricingConfigWithoutOwner`](../modules/Nautilus.md#pricingconfigwithoutowner) |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setPricing](../interfaces/types.IAssetBuilder.md#setpricing)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:57](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L57)

___

### setType

▸ **setType**(`type`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | ``"dataset"`` \| ``"algorithm"`` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setType](../interfaces/types.IAssetBuilder.md#settype)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:21](https://github.com/deltaDAO/nautilus/blob/493dbf5/src/Nautilus/Asset/AssetBuilder.ts#L21)
