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

[src/Nautilus/Asset/AssetBuilder.ts:16](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L16)

## Methods

### addAdditionalInformation

▸ **addAdditionalInformation**(`additionalInformation`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `additionalInformation` | `Object` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addAdditionalInformation](../interfaces/types.IAssetBuilder.md#addadditionalinformation)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:98](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L98)

___

### addCategories

▸ **addCategories**(`categories`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `categories` | `string`[] |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addCategories](../interfaces/types.IAssetBuilder.md#addcategories)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:139](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L139)

___

### addCredentialAddresses

▸ **addCredentialAddresses**(`list`, `addresses`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `list` | [`CredentialListTypes`](../enums/types.CredentialListTypes.md) |
| `addresses` | `string`[] |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addCredentialAddresses](../interfaces/types.IAssetBuilder.md#addcredentialaddresses)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:148](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L148)

___

### addLinks

▸ **addLinks**(`links`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `links` | `string`[] |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addLinks](../interfaces/types.IAssetBuilder.md#addlinks)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:122](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L122)

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

[src/Nautilus/Asset/AssetBuilder.ts:64](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L64)

___

### addTags

▸ **addTags**(`tags`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `tags` | `string`[] |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[addTags](../interfaces/types.IAssetBuilder.md#addtags)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:113](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L113)

___

### build

▸ **build**(): `NautilusAsset`

#### Returns

`NautilusAsset`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:173](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L173)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:18](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L18)

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

[src/Nautilus/Asset/AssetBuilder.ts:52](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L52)

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

[src/Nautilus/Asset/AssetBuilder.ts:46](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L46)

___

### setContentLanguage

▸ **setContentLanguage**(`language`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `language` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setContentLanguage](../interfaces/types.IAssetBuilder.md#setcontentlanguage)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:133](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L133)

___

### setCopyrightHolder

▸ **setCopyrightHolder**(`copyrightHolder`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `copyrightHolder` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setCopyrightHolder](../interfaces/types.IAssetBuilder.md#setcopyrightholder)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:107](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L107)

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

[src/Nautilus/Asset/AssetBuilder.ts:76](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L76)

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

[src/Nautilus/Asset/AssetBuilder.ts:82](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L82)

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

[src/Nautilus/Asset/AssetBuilder.ts:34](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L34)

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

[src/Nautilus/Asset/AssetBuilder.ts:40](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L40)

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

[src/Nautilus/Asset/AssetBuilder.ts:28](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L28)

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

[src/Nautilus/Asset/AssetBuilder.ts:70](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L70)

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

[src/Nautilus/Asset/AssetBuilder.ts:92](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L92)

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

[src/Nautilus/Asset/AssetBuilder.ts:58](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L58)

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

[src/Nautilus/Asset/AssetBuilder.ts:22](https://github.com/deltaDAO/nautilus/blob/1d9c796/src/Nautilus/Asset/AssetBuilder.ts#L22)
