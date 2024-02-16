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

• **new AssetBuilder**(`aquariusAsset?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `aquariusAsset?` | `Asset` |

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:20](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L20)

## Properties

### asset

• `Private` **asset**: `NautilusAsset`

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:18](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L18)

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

[src/Nautilus/Asset/AssetBuilder.ts:101](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L101)

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

[src/Nautilus/Asset/AssetBuilder.ts:142](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L142)

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

[src/Nautilus/Asset/AssetBuilder.ts:151](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L151)

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

[src/Nautilus/Asset/AssetBuilder.ts:125](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L125)

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

[src/Nautilus/Asset/AssetBuilder.ts:71](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L71)

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

[src/Nautilus/Asset/AssetBuilder.ts:116](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L116)

___

### build

▸ **build**(): `NautilusAsset`

#### Returns

`NautilusAsset`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[build](../interfaces/types.IAssetBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:203](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L203)

___

### removeCredentialAddresses

▸ **removeCredentialAddresses**(`list`, `addresses`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `list` | [`CredentialListTypes`](../enums/types.CredentialListTypes.md) |
| `addresses` | `string`[] |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:177](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L177)

___

### removeService

▸ **removeService**(`serviceId`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `serviceId` | `string` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:77](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L77)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[reset](../interfaces/types.IAssetBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:31](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L31)

___

### setAlgorithm

▸ **setAlgorithm**(`algorithm`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `MetadataAlgorithm` & { `consumerParameters?`: `ConsumerParameter`[]  } |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setAlgorithm](../interfaces/types.IAssetBuilder.md#setalgorithm)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:65](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L65)

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

[src/Nautilus/Asset/AssetBuilder.ts:59](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L59)

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

[src/Nautilus/Asset/AssetBuilder.ts:136](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L136)

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

[src/Nautilus/Asset/AssetBuilder.ts:110](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L110)

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

[src/Nautilus/Asset/AssetBuilder.ts:47](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L47)

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

[src/Nautilus/Asset/AssetBuilder.ts:53](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L53)

___

### setLifecycleState

▸ **setLifecycleState**(`state`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `state` | [`LifecycleStates`](../enums/types.LifecycleStates.md) |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:89](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L89)

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

[src/Nautilus/Asset/AssetBuilder.ts:41](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L41)

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

[src/Nautilus/Asset/AssetBuilder.ts:83](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L83)

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

[src/Nautilus/Asset/AssetBuilder.ts:95](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L95)

___

### setType

▸ **setType**(`type`): [`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | ``"algorithm"`` \| ``"dataset"`` |

#### Returns

[`AssetBuilder`](Nautilus.AssetBuilder.md)

#### Implementation of

[IAssetBuilder](../interfaces/types.IAssetBuilder.md).[setType](../interfaces/types.IAssetBuilder.md#settype)

#### Defined in

[src/Nautilus/Asset/AssetBuilder.ts:35](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/AssetBuilder.ts#L35)
