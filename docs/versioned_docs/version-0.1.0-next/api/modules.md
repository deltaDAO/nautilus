---
id: "modules"
title: "@deltadao/nautilus"
sidebar_label: "Table of Contents"
sidebar_position: 0.5
hide_table_of_contents: true
custom_edit_url: null
---

## Interfaces

- [AccessConfig](interfaces/AccessConfig.md)
- [AccessDetails](interfaces/AccessDetails.md)
- [AssetConfig](interfaces/AssetConfig.md)
- [AssetWithAccessDetails](interfaces/AssetWithAccessDetails.md)
- [AssetWithAccessDetailsAndPrice](interfaces/AssetWithAccessDetailsAndPrice.md)
- [ComputeAlgorithm](interfaces/ComputeAlgorithm.md)
- [ComputeAsset](interfaces/ComputeAsset.md)
- [ComputeConfig](interfaces/ComputeConfig.md)
- [ComputeResultConfig](interfaces/ComputeResultConfig.md)
- [ComputeStatusConfig](interfaces/ComputeStatusConfig.md)
- [ConsumerParameter](interfaces/ConsumerParameter.md)
- [CredentialConfig](interfaces/CredentialConfig.md)
- [IAssetBuilder](interfaces/IAssetBuilder.md)
- [IBuilder](interfaces/IBuilder.md)
- [IServiceBuilder](interfaces/IServiceBuilder.md)
- [NautilusOptions](interfaces/NautilusOptions.md)
- [OrderPriceAndFees](interfaces/OrderPriceAndFees.md)
- [PricingConfig](interfaces/PricingConfig.md)
- [TokenInfo](interfaces/TokenInfo.md)
- [TokenParameters](interfaces/TokenParameters.md)

## Type Aliases

### ConsumerParameterSelectOption

Ƭ **ConsumerParameterSelectOption**: `Object`

#### Index signature

▪ [value: `string`]: `string`

#### Defined in

[src/@types/Publish.ts:20](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L20)

___

### ConsumerParameterType

Ƭ **ConsumerParameterType**: ``"text"`` \| ``"number"`` \| ``"boolean"`` \| ``"select"``

#### Defined in

[src/@types/Publish.ts:18](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L18)

___

### DatatokenCreateParamsWithoutOwner

Ƭ **DatatokenCreateParamsWithoutOwner**: `Omit`<`DatatokenCreateParams`, ``"paymentCollector"`` \| ``"minter"``\>

#### Defined in

[src/@types/Publish.ts:49](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L49)

___

### MetadataConfig

Ƭ **MetadataConfig**: `Omit`<`Metadata`, ``"created"`` \| ``"updated"`` \| ``"algorithm"``\> & { `algorithm?`: `MetadataAlgorithm` & { `consumerParameters?`: `NautilusConsumerParameter`[]  }  }

#### Defined in

[src/@types/Publish.ts:33](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L33)

___

### NftCreateDataWithoutOwner

Ƭ **NftCreateDataWithoutOwner**: `Omit`<`NftCreateData`, ``"owner"``\>

#### Defined in

[src/@types/Publish.ts:54](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L54)

___

### PrePublishDDO

Ƭ **PrePublishDDO**: `Omit`<`DDO`, ``"services"``\> & { `services`: [`ServiceConfig`](modules.md#serviceconfig)[]  }

#### Defined in

[src/@types/Publish.ts:69](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L69)

___

### ServiceConfig

Ƭ **ServiceConfig**: `Omit`<`Service`, ``"id"`` \| ``"datatokenAddress"`` \| ``"files"``\> & { `consumerParameters?`: [`ConsumerParameter`](interfaces/ConsumerParameter.md)[] ; `files`: `Files`[``"files"``]  }

#### Defined in

[src/@types/Publish.ts:61](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Publish.ts#L61)
