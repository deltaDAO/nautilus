---
id: "nautilus.NautilusAsset"
title: "Class: NautilusAsset"
sidebar_label: "NautilusAsset"
custom_edit_url: null
---

[nautilus](../modules/nautilus.md).NautilusAsset

## Constructors

### constructor

• **new NautilusAsset**()

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:32](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L32)

## Properties

### datatokenCreateParams

• **datatokenCreateParams**: [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner)

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:29](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L29)

___

### metadata

• **metadata**: [`MetadataConfig`](../modules/types.md#metadataconfig)

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:25](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L25)

___

### nftCreateData

• **nftCreateData**: [`NftCreateDataWithoutOwner`](../modules/types.md#nftcreatedatawithoutowner)

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:28](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L28)

___

### owner

• **owner**: `string`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:30](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L30)

___

### pricing

• **pricing**: [`PricingConfigWithoutOwner`](../modules/nautilus.md#pricingconfigwithoutowner)

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:27](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L27)

___

### services

• **services**: `NautilusService`<`ServiceTypes`, `FileTypes`\>[] = `[]`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:26](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L26)

## Methods

### getConfig

▸ **getConfig**(): `Omit`<[`AssetConfig`](../interfaces/types.AssetConfig.md), ``"web3"`` \| ``"chainConfig"``\>

#### Returns

`Omit`<[`AssetConfig`](../interfaces/types.AssetConfig.md), ``"web3"`` \| ``"chainConfig"``\>

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:63](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L63)

___

### hasValidMetadata

▸ `Private` **hasValidMetadata**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:114](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L114)

___

### hasValidPricing

▸ `Private` **hasValidPricing**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:130](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L130)

___

### initDatatokenData

▸ `Private` **initDatatokenData**(): `void`

#### Returns

`void`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:59](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L59)

___

### initMetadata

▸ `Private` **initMetadata**(): `void`

#### Returns

`void`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:39](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L39)

___

### initNftData

▸ `Private` **initNftData**(): `void`

#### Returns

`void`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:55](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L55)

___

### initPricing

▸ `Private` **initPricing**(): `void`

#### Returns

`void`

#### Defined in

[src/nautilus/asset/NautilusAsset.ts:49](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/asset/NautilusAsset.ts#L49)
