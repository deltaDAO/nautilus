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

[src/@types/Publish.ts:22](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L22)

___

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[src/@types/Publish.ts:42](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L42)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"`` \| ``"algorithm"``\> & { `algorithm?`: `MetadataAlgorithm` & { `consumerParameters?`: `ConsumerParameter`[]  }  }

#### Defined in

[src/@types/Publish.ts:26](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L26)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[src/@types/Publish.ts:47](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L47)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](types.md#serviceconfig)[]  }

#### Defined in

[src/@types/Publish.ts:64](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L64)

___

### ServiceBuilderConfig

Ƭ **ServiceBuilderConfig**: { `fileType`: [`FileTypes`](../enums/Nautilus.FileTypes.md) ; `serviceType`: [`ServiceTypes`](../enums/Nautilus.ServiceTypes.md)  } \| { `aquariusAsset`: `Asset` ; `serviceId`: `string`  }

#### Defined in

[src/@types/Nautilus.ts:24](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L24)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"files"`` \| ``"id"`` \| ``"datatokenAddress"``\> & { `consumerParameters?`: `ConsumerParameter`[] ; `datatokenCreateParams`: [`DatatokenCreateParamsWithoutOwner`](types.md#datatokencreateparamswithoutowner) ; `files`: `Files`[``"files"``] ; `pricing`: [`PricingConfigWithoutOwner`](Nautilus.md#pricingconfigwithoutowner)  }

#### Defined in

[src/@types/Publish.ts:54](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L54)

___

### TrustedAlgorithmAsset

Ƭ **TrustedAlgorithmAsset**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `did` | `string` |
| `serviceIds?` | `string`[] |

#### Defined in

[src/@types/Publish.ts:100](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Publish.ts#L100)
