---
id: "types"
title: "Module: @types"
sidebar_label: "@types"
sidebar_position: 0
custom_edit_url: null
---

## Enumerations

- [CredentialListTypes](../enums/types.CredentialListTypes.md)
- [LifecycleStates](../enums/types.LifecycleStates.md)

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

[src/@types/Publish.ts:24](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L24)

___

### ConsumerParameterType

Ƭ **ConsumerParameterType**: ``"text"`` \| ``"number"`` \| ``"boolean"`` \| ``"select"``

#### Defined in

[src/@types/Publish.ts:22](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L22)

___

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[src/@types/Publish.ts:53](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L53)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"`` \| ``"algorithm"``\> & { `algorithm?`: `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  }  }

#### Defined in

[src/@types/Publish.ts:37](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L37)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[src/@types/Publish.ts:58](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L58)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](types.md#serviceconfig)[]  }

#### Defined in

[src/@types/Publish.ts:75](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L75)

___

### ServiceBuilderConfig

Ƭ **ServiceBuilderConfig**: { `fileType`: [`FileTypes`](../enums/Nautilus.FileTypes.md) ; `serviceType`: [`ServiceTypes`](../enums/Nautilus.ServiceTypes.md)  } \| { `aquariusAsset`: `Asset` ; `serviceId`: `string`  }

#### Defined in

[src/@types/Nautilus.ts:20](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Nautilus.ts#L20)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"files"`` \| ``"id"`` \| ``"datatokenAddress"``\> & { `consumerParameters?`: [`ConsumerParameter`](../interfaces/types.ConsumerParameter.md)[] ; `datatokenCreateParams`: [`DatatokenCreateParamsWithoutOwner`](types.md#datatokencreateparamswithoutowner) ; `files`: `Files`[``"files"``] ; `pricing`: [`PricingConfigWithoutOwner`](Nautilus.md#pricingconfigwithoutowner)  }

#### Defined in

[src/@types/Publish.ts:65](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L65)

___

### TrustedAlgorithmAsset

Ƭ **TrustedAlgorithmAsset**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `did` | `string` |
| `serviceIds?` | `string`[] |

#### Defined in

[src/@types/Publish.ts:111](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/@types/Publish.ts#L111)
