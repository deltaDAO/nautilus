---
id: "types"
title: "Module: @types"
sidebar_label: "@types"
sidebar_position: 0
custom_edit_url: null
---

## Interfaces

- [AccessConfig](../interfaces/types.AccessConfig.md)
- [AccessDetails](../interfaces/types.AccessDetails.md)
- [AssetWithAccessDetails](../interfaces/types.AssetWithAccessDetails.md)
- [AssetWithAccessDetailsAndPrice](../interfaces/types.AssetWithAccessDetailsAndPrice.md)
- [ComputeAlgorithm](../interfaces/types.ComputeAlgorithm.md)
- [ComputeAsset](../interfaces/types.ComputeAsset.md)
- [ComputeConfig](../interfaces/types.ComputeConfig.md)
- [ComputeResultConfig](../interfaces/types.ComputeResultConfig.md)
- [ComputeStatusConfig](../interfaces/types.ComputeStatusConfig.md)
- [ConsumerParameter](../interfaces/types.ConsumerParameter.md)
- [CreateAssetComfig](../interfaces/types.CreateAssetComfig.md)
- [CreateDatatokenConfig](../interfaces/types.CreateDatatokenConfig.md)
- [CredentialConfig](../interfaces/types.CredentialConfig.md)
- [IAssetBuilder](../interfaces/types.IAssetBuilder.md)
- [IBuilder](../interfaces/types.IBuilder.md)
- [IServiceBuilder](../interfaces/types.IServiceBuilder.md)
- [NautilusOptions](../interfaces/types.NautilusOptions.md)
- [OrderPriceAndFees](../interfaces/types.OrderPriceAndFees.md)
- [PricingConfig](../interfaces/types.PricingConfig.md)
- [PublishDDOConfig](../interfaces/types.PublishDDOConfig.md)
- [TokenInfo](../interfaces/types.TokenInfo.md)
- [TokenParameters](../interfaces/types.TokenParameters.md)

## Type Aliases

### ConsumerParameterSelectOption

Ƭ **ConsumerParameterSelectOption**: `Object`

#### Index signature

▪ [value: `string`]: `string`

#### Defined in

[src/@types/Publish.ts:27](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L27)

___

### ConsumerParameterType

Ƭ **ConsumerParameterType**: ``"text"`` \| ``"number"`` \| ``"boolean"`` \| ``"select"``

#### Defined in

[src/@types/Publish.ts:25](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L25)

___

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[src/@types/Publish.ts:56](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L56)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"`` \| ``"algorithm"``\> & { `algorithm?`: `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  }  }

#### Defined in

[src/@types/Publish.ts:40](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L40)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[src/@types/Publish.ts:61](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L61)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](types.md#serviceconfig)[]  }

#### Defined in

[src/@types/Publish.ts:78](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L78)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"files"`` \| ``"id"`` \| ``"datatokenAddress"``\> & { `consumerParameters?`: [`ConsumerParameter`](../interfaces/types.ConsumerParameter.md)[] ; `datatokenCreateParams`: [`DatatokenCreateParamsWithoutOwner`](types.md#datatokencreateparamswithoutowner) ; `files`: `Files`[``"files"``] ; `pricing`: [`PricingConfigWithoutOwner`](Nautilus.md#pricingconfigwithoutowner)  }

#### Defined in

[src/@types/Publish.ts:68](https://github.com/deltaDAO/nautilus/blob/a004a0b/src/@types/Publish.ts#L68)
