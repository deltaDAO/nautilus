---
id: "types"
title: "Module: @types"
sidebar_label: "@types"
sidebar_position: 0
custom_edit_url: null
---

## Enumerations

- [CredentialListTypes](../enums/types.CredentialListTypes.md)

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
- [CreateAssetConfig](../interfaces/types.CreateAssetConfig.md)
- [CreateDatatokenConfig](../interfaces/types.CreateDatatokenConfig.md)
- [IAssetBuilder](../interfaces/types.IAssetBuilder.md)
- [IBuilder](../interfaces/types.IBuilder.md)
- [IServiceBuilder](../interfaces/types.IServiceBuilder.md)
- [NautilusOptions](../interfaces/types.NautilusOptions.md)
- [OrderPriceAndFees](../interfaces/types.OrderPriceAndFees.md)
- [PricingConfig](../interfaces/types.PricingConfig.md)
- [PublishDDOConfig](../interfaces/types.PublishDDOConfig.md)
- [PublishResponse](../interfaces/types.PublishResponse.md)
- [TokenInfo](../interfaces/types.TokenInfo.md)
- [TokenParameters](../interfaces/types.TokenParameters.md)

## Type Aliases

### ConsumerParameterSelectOption

Ƭ **ConsumerParameterSelectOption**: `Object`

#### Index signature

▪ [value: `string`]: `string`

#### Defined in

[nautilus/src/@types/Publish.ts:23](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L23)

___

### ConsumerParameterType

Ƭ **ConsumerParameterType**: ``"text"`` \| ``"number"`` \| ``"boolean"`` \| ``"select"``

#### Defined in

[nautilus/src/@types/Publish.ts:21](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L21)

___

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[nautilus/src/@types/Publish.ts:52](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L52)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"`` \| ``"algorithm"``\> & { `algorithm?`: `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  }  }

#### Defined in

[nautilus/src/@types/Publish.ts:36](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L36)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[nautilus/src/@types/Publish.ts:57](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L57)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](types.md#serviceconfig)[]  }

#### Defined in

[nautilus/src/@types/Publish.ts:74](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L74)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"files"`` \| ``"id"`` \| ``"datatokenAddress"``\> & { `consumerParameters?`: [`ConsumerParameter`](../interfaces/types.ConsumerParameter.md)[] ; `datatokenCreateParams`: [`DatatokenCreateParamsWithoutOwner`](types.md#datatokencreateparamswithoutowner) ; `files`: `Files`[``"files"``] ; `pricing`: [`PricingConfigWithoutOwner`](Nautilus.md#pricingconfigwithoutowner)  }

#### Defined in

[nautilus/src/@types/Publish.ts:64](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Publish.ts#L64)
