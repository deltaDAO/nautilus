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
- [AssetConfig](../interfaces/types.AssetConfig.md)
- [AssetWithAccessDetails](../interfaces/types.AssetWithAccessDetails.md)
- [AssetWithAccessDetailsAndPrice](../interfaces/types.AssetWithAccessDetailsAndPrice.md)
- [ComputeAlgorithm](../interfaces/types.ComputeAlgorithm.md)
- [ComputeAsset](../interfaces/types.ComputeAsset.md)
- [ComputeConfig](../interfaces/types.ComputeConfig.md)
- [ComputeResultConfig](../interfaces/types.ComputeResultConfig.md)
- [ComputeStatusConfig](../interfaces/types.ComputeStatusConfig.md)
- [ConsumerParameter](../interfaces/types.ConsumerParameter.md)
- [IAssetBuilder](../interfaces/types.IAssetBuilder.md)
- [IBuilder](../interfaces/types.IBuilder.md)
- [IServiceBuilder](../interfaces/types.IServiceBuilder.md)
- [NautilusOptions](../interfaces/types.NautilusOptions.md)
- [OrderPriceAndFees](../interfaces/types.OrderPriceAndFees.md)
- [PricingConfig](../interfaces/types.PricingConfig.md)
- [TokenInfo](../interfaces/types.TokenInfo.md)
- [TokenParameters](../interfaces/types.TokenParameters.md)

## Type Aliases

### ConsumerParameterSelectOption

Ƭ **ConsumerParameterSelectOption**: `Object`

#### Index signature

▪ [value: `string`]: `string`

#### Defined in

[src/@types/Publish.ts:18](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L18)

___

### ConsumerParameterType

Ƭ **ConsumerParameterType**: ``"text"`` \| ``"number"`` \| ``"boolean"`` \| ``"select"``

#### Defined in

[src/@types/Publish.ts:16](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L16)

___

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[src/@types/Publish.ts:47](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L47)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"`` \| ``"algorithm"``\> & { `algorithm?`: `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  }  }

#### Defined in

[src/@types/Publish.ts:31](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L31)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[src/@types/Publish.ts:52](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L52)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](types.md#serviceconfig)[]  }

#### Defined in

[src/@types/Publish.ts:67](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L67)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"id"`` \| ``"datatokenAddress"`` \| ``"files"``\> & { `consumerParameters?`: [`ConsumerParameter`](../interfaces/types.ConsumerParameter.md)[] ; `files`: `Files`[``"files"``]  }

#### Defined in

[src/@types/Publish.ts:59](https://github.com/deltaDAO/nautilus/blob/f251a23/src/@types/Publish.ts#L59)
