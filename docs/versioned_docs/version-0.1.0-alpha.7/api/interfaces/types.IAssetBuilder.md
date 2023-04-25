---
id: "types.IAssetBuilder"
title: "Interface: IAssetBuilder"
sidebar_label: "IAssetBuilder"
custom_edit_url: null
---

[@types](../modules/types.md).IAssetBuilder

## Hierarchy

- [`IBuilder`](types.IBuilder.md)<`NautilusAsset`\>

  ↳ **`IAssetBuilder`**

## Implemented by

- [`AssetBuilder`](../classes/nautilus.AssetBuilder.md)

## Properties

### addAdditionalInformation

• **addAdditionalInformation**: (`addtionalInformation`: { `[key: string]`: `any`;  }) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`addtionalInformation`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `addtionalInformation` | `Object` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:34](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L34)

___

### addService

• **addService**: (`service`: [`ServiceConfig`](../modules/types.md#serviceconfig)) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`service`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `service` | [`ServiceConfig`](../modules/types.md#serviceconfig) |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:26](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L26)

___

### build

• **build**: () => `NautilusAsset`

#### Type declaration

▸ (): `NautilusAsset`

##### Returns

`NautilusAsset`

#### Inherited from

[IBuilder](types.IBuilder.md).[build](types.IBuilder.md#build)

#### Defined in

[src/@types/Nautilus.ts:15](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L15)

___

### reset

• **reset**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Inherited from

[IBuilder](types.IBuilder.md).[reset](types.IBuilder.md#reset)

#### Defined in

[src/@types/Nautilus.ts:16](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L16)

___

### setAlgorithm

• **setAlgorithm**: (`algorithm`: `MetadataAlgorithm`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`algorithm`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `MetadataAlgorithm` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:31](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L31)

___

### setAuthor

• **setAuthor**: (`author`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`author`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `author` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:24](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L24)

___

### setDatatokenData

• **setDatatokenData**: (`datatokenCreateData`: [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner)) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`datatokenCreateData`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `datatokenCreateData` | [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner) |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:28](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L28)

___

### setDatatokenNameAndSymbol

• **setDatatokenNameAndSymbol**: (`dtName`: `string`, `dtSymbol`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`dtName`, `dtSymbol`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `dtName` | `string` |
| `dtSymbol` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:33](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L33)

___

### setDescription

• **setDescription**: (`description`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`description`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:22](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L22)

___

### setLicense

• **setLicense**: (`license`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`license`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `license` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:23](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L23)

___

### setName

• **setName**: (`name`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`name`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:21](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L21)

___

### setNftData

• **setNftData**: (`nftCreateData`: [`NftCreateDataWithoutOwner`](../modules/types.md#nftcreatedatawithoutowner)) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`nftCreateData`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `nftCreateData` | [`NftCreateDataWithoutOwner`](../modules/types.md#nftcreatedatawithoutowner) |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:27](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L27)

___

### setOwner

• **setOwner**: (`owner`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`owner`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `owner` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:32](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L32)

___

### setPricing

• **setPricing**: (`pricing`: [`PricingConfig`](types.PricingConfig.md)) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`pricing`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | [`PricingConfig`](types.PricingConfig.md) |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:25](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L25)

___

### setType

• **setType**: (`type`: ``"dataset"`` \| ``"algorithm"``) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`type`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `type` | ``"dataset"`` \| ``"algorithm"`` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:20](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Nautilus.ts#L20)
