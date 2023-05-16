---
id: "IAssetBuilder"
title: "Interface: IAssetBuilder"
sidebar_label: "IAssetBuilder"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`IBuilder`](IBuilder.md)<`NautilusAsset`\>

  ↳ **`IAssetBuilder`**

## Properties

### addAdditionalInformation

• **addAdditionalInformation**: (`addtionalInformation`: { `[key: string]`: `any`;  }) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`addtionalInformation`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `addtionalInformation` | `Object` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:44](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L44)

___

### addService

• **addService**: (`service`: `NautilusService`<`ServiceTypes`, `FileTypes`\>) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`service`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `service` | `NautilusService`<`ServiceTypes`, `FileTypes`\> |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:34](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L34)

___

### build

• **build**: () => `NautilusAsset`

#### Type declaration

▸ (): `NautilusAsset`

##### Returns

`NautilusAsset`

#### Inherited from

[IBuilder](IBuilder.md).[build](IBuilder.md#build)

#### Defined in

[src/@types/Nautilus.ts:23](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L23)

___

### reset

• **reset**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Inherited from

[IBuilder](IBuilder.md).[reset](IBuilder.md#reset)

#### Defined in

[src/@types/Nautilus.ts:24](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L24)

___

### setAlgorithm

• **setAlgorithm**: (`algorithm`: `MetadataAlgorithm`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`algorithm`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `MetadataAlgorithm` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:41](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L41)

___

### setAuthor

• **setAuthor**: (`author`: `string`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`author`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `author` | `string` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:32](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L32)

___

### setDatatokenData

• **setDatatokenData**: (`datatokenCreateData`: [`DatatokenCreateParamsWithoutOwner`](../modules.md#datatokencreateparamswithoutowner)) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`datatokenCreateData`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `datatokenCreateData` | [`DatatokenCreateParamsWithoutOwner`](../modules.md#datatokencreateparamswithoutowner) |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:38](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L38)

___

### setDatatokenNameAndSymbol

• **setDatatokenNameAndSymbol**: (`dtName`: `string`, `dtSymbol`: `string`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`dtName`, `dtSymbol`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `dtName` | `string` |
| `dtSymbol` | `string` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:43](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L43)

___

### setDescription

• **setDescription**: (`description`: `string`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`description`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:30](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L30)

___

### setLicense

• **setLicense**: (`license`: `string`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`license`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `license` | `string` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:31](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L31)

___

### setName

• **setName**: (`name`: `string`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`name`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:29](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L29)

___

### setNftData

• **setNftData**: (`nftCreateData`: [`NftCreateDataWithoutOwner`](../modules.md#nftcreatedatawithoutowner)) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`nftCreateData`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `nftCreateData` | [`NftCreateDataWithoutOwner`](../modules.md#nftcreatedatawithoutowner) |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:37](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L37)

___

### setOwner

• **setOwner**: (`owner`: `string`) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`owner`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `owner` | `string` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:42](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L42)

___

### setPricing

• **setPricing**: (`pricing`: [`PricingConfig`](PricingConfig.md)) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`pricing`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | [`PricingConfig`](PricingConfig.md) |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:33](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L33)

___

### setType

• **setType**: (`type`: ``"dataset"`` \| ``"algorithm"``) => [`IAssetBuilder`](IAssetBuilder.md)

#### Type declaration

▸ (`type`): [`IAssetBuilder`](IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `type` | ``"dataset"`` \| ``"algorithm"`` |

##### Returns

[`IAssetBuilder`](IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:28](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L28)
