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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:12](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L12)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:72](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L72)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:113](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L113)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:122](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L122)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:96](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L96)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:54](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L54)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:87](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L87)

___

### build

▸ **build**(): `NautilusAsset`

#### Returns

`NautilusAsset`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:147](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L147)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:14](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L14)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:48](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L48)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:42](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L42)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:107](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L107)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:81](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L81)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:30](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L30)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:36](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L36)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:24](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L24)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:60](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L60)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:66](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L66)

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

[nautilus/src/Nautilus/Asset/AssetBuilder.ts:18](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/AssetBuilder.ts#L18)
