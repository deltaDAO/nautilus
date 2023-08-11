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

[src/Nautilus/Asset/AssetBuilder.ts:11](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L11)

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

[src/Nautilus/Asset/AssetBuilder.ts:71](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L71)

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

[src/Nautilus/Asset/AssetBuilder.ts:53](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L53)

___

### build

▸ **build**(): `NautilusAsset`

#### Returns

`NautilusAsset`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:80](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L80)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:13](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L13)

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

[src/Nautilus/Asset/AssetBuilder.ts:47](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L47)

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

[src/Nautilus/Asset/AssetBuilder.ts:41](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L41)

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

[src/Nautilus/Asset/AssetBuilder.ts:29](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L29)

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

[src/Nautilus/Asset/AssetBuilder.ts:35](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L35)

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

[src/Nautilus/Asset/AssetBuilder.ts:23](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L23)

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

[src/Nautilus/Asset/AssetBuilder.ts:59](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L59)

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

[src/Nautilus/Asset/AssetBuilder.ts:65](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L65)

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

[src/Nautilus/Asset/AssetBuilder.ts:17](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/Nautilus/Asset/AssetBuilder.ts#L17)
