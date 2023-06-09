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
- [AssetConfig](../interfaces/types.AssetConfig.md)
- [AssetWithAccessDetails](../interfaces/types.AssetWithAccessDetails.md)
- [AssetWithAccessDetailsAndPrice](../interfaces/types.AssetWithAccessDetailsAndPrice.md)
- [ComputeAlgorithm](../interfaces/types.ComputeAlgorithm.md)
- [ComputeAsset](../interfaces/types.ComputeAsset.md)
- [ComputeConfig](../interfaces/types.ComputeConfig.md)
- [ComputeResultConfig](../interfaces/types.ComputeResultConfig.md)
- [CredentialConfig](../interfaces/types.CredentialConfig.md)
- [IAssetBuilder](../interfaces/types.IAssetBuilder.md)
- [IBuilder](../interfaces/types.IBuilder.md)
- [NautilusOptions](../interfaces/types.NautilusOptions.md)
- [OrderPriceAndFees](../interfaces/types.OrderPriceAndFees.md)
- [PricingConfig](../interfaces/types.PricingConfig.md)
- [TokenInfo](../interfaces/types.TokenInfo.md)
- [TokenParameters](../interfaces/types.TokenParameters.md)

## Type Aliases

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[src/@types/Publish.ts:29](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Publish.ts#L29)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"``\>

#### Defined in

[src/@types/Publish.ts:20](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Publish.ts#L20)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[src/@types/Publish.ts:34](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Publish.ts#L34)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](types.md#serviceconfig)[]  }

#### Defined in

[src/@types/Publish.ts:49](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Publish.ts#L49)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"id"`` \| ``"datatokenAddress"`` \| ``"files"``\> & { `consumerParameters?`: `NautilusConsumerParameter`<`ConsumerParameterType`\>[] ; `files`: `Files`[``"files"``]  }

#### Defined in

[src/@types/Publish.ts:41](https://github.com/deltaDAO/nautilus/blob/033f36a/src/@types/Publish.ts#L41)
