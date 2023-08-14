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

- [`AssetBuilder`](../classes/Nautilus.AssetBuilder.md)

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

[src/@types/Nautilus.ts:47](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L47)

___

### addCategories

• **addCategories**: (`categories`: `string`[]) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`categories`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `categories` | `string`[] |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:54](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L54)

___

### addCredentialAddresses

• **addCredentialAddresses**: (`list`: [`CredentialListTypes`](../enums/types.CredentialListTypes.md), `addresses`: `string`[]) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`list`, `addresses`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `list` | [`CredentialListTypes`](../enums/types.CredentialListTypes.md) |
| `addresses` | `string`[] |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:55](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L55)

___

### addLinks

• **addLinks**: (`links`: `string`[]) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`links`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `links` | `string`[] |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:52](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L52)

___

### addService

• **addService**: (`service`: `NautilusService`<[`ServiceTypes`](../enums/Nautilus.ServiceTypes.md), [`FileTypes`](../enums/Nautilus.FileTypes.md)\>) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`service`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `service` | `NautilusService`<[`ServiceTypes`](../enums/Nautilus.ServiceTypes.md), [`FileTypes`](../enums/Nautilus.FileTypes.md)\> |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:37](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L37)

___

### addTags

• **addTags**: (`tags`: `string`[]) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`tags`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `tags` | `string`[] |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:51](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L51)

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

[src/@types/Nautilus.ts:21](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L21)

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

[src/@types/Nautilus.ts:22](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L22)

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

[src/@types/Nautilus.ts:44](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L44)

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

[src/@types/Nautilus.ts:35](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L35)

___

### setContentLanguage

• **setContentLanguage**: (`language`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`language`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `language` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:53](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L53)

___

### setCopyrightHolder

• **setCopyrightHolder**: (`copyrightHolder`: `string`) => [`IAssetBuilder`](types.IAssetBuilder.md)

#### Type declaration

▸ (`copyrightHolder`): [`IAssetBuilder`](types.IAssetBuilder.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `copyrightHolder` | `string` |

##### Returns

[`IAssetBuilder`](types.IAssetBuilder.md)

#### Defined in

[src/@types/Nautilus.ts:50](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L50)

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

[src/@types/Nautilus.ts:41](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L41)

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

[src/@types/Nautilus.ts:46](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L46)

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

[src/@types/Nautilus.ts:33](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L33)

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

[src/@types/Nautilus.ts:34](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L34)

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

[src/@types/Nautilus.ts:32](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L32)

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

[src/@types/Nautilus.ts:40](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L40)

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

[src/@types/Nautilus.ts:45](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L45)

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

[src/@types/Nautilus.ts:36](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L36)

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

[src/@types/Nautilus.ts:31](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Nautilus.ts#L31)
