---
id: "index"
title: "Module: index"
sidebar_label: "index"
sidebar_position: 0
custom_edit_url: null
---

## Enumerations

- [FileTypes](../enums/.FileTypes)
- [LogLevel](../enums/.LogLevel)
- [ServiceTypes](../enums/.ServiceTypes)

## Classes

- [AssetBuilder](../classes/.AssetBuilder)
- [ConsumerParameterBuilder](../classes/.ConsumerParameterBuilder)
- [Nautilus](../classes/.Nautilus)
- [ServiceBuilder](../classes/.ServiceBuilder)

## Interfaces

- [Arweave](../interfaces/.Arweave)
- [GraphqlQuery](../interfaces/.GraphqlQuery)
- [Ipfs](../interfaces/.Ipfs)
- [Smartcontract](../interfaces/.Smartcontract)
- [UrlFile](../interfaces/.UrlFile)

## Type Aliases

### ConsumerParameterSelectOption

Ƭ **ConsumerParameterSelectOption**: `Object`

#### Index signature

▪ [value: `string`]: `string`

#### Defined in

[src/Nautilus/Asset/Service/NautilusService.ts:46](https://github.com/deltaDAO/nautilus/blob/a089200/src/Nautilus/Asset/Service/NautilusService.ts#L46)

___

### PricingConfigWithoutOwner

Ƭ **PricingConfigWithoutOwner**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `freCreationParams?` | `Omit`<[`PricingConfig`](../interfaces/types.PricingConfig.md)[``"freCreationParams"``], ``"owner"``\> |
| `type` | [`PricingConfig`](../interfaces/types.PricingConfig.md)[``"type"``] |

#### Defined in

[src/Nautilus/Asset/NautilusAsset.ts:14](https://github.com/deltaDAO/nautilus/blob/a089200/src/Nautilus/Asset/NautilusAsset.ts#L14)

___

### ServiceFileType

Ƭ **ServiceFileType**<`FileType`\>: `FileType` extends [`GRAPHQL`](../enums/.FileTypes#graphql) ? [`GraphqlQuery`](../interfaces/.GraphqlQuery) : `FileType` extends [`ARWEAVE`](../enums/.FileTypes#arweave) ? [`Arweave`](../interfaces/.Arweave) : `FileType` extends [`SMARTCONTRACT`](../enums/.FileTypes#smartcontract) ? [`Smartcontract`](../interfaces/.Smartcontract) : `FileType` extends [`IPFS`](../enums/.FileTypes#ipfs) ? [`Ipfs`](../interfaces/.Ipfs) : [`UrlFile`](../interfaces/.UrlFile)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `FileType` | extends [`FileTypes`](../enums/.FileTypes) |

#### Defined in

[src/Nautilus/Asset/Service/NautilusService.ts:35](https://github.com/deltaDAO/nautilus/blob/a089200/src/Nautilus/Asset/Service/NautilusService.ts#L35)

## Functions

### access

▸ **access**(`accessConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `accessConfig` | [`AccessConfig`](../interfaces/types.AccessConfig.md) | Configuration of the access request |

#### Returns

`Promise`<`string`\>

url of the downloadable file

#### Defined in

[src/access/index.ts:25](https://github.com/deltaDAO/nautilus/blob/a089200/src/access/index.ts#L25)

___

### compute

▸ **compute**(`computeConfig`): `Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeConfig` | [`ComputeConfig`](../interfaces/types.ComputeConfig.md) |

#### Returns

`Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Defined in

[src/compute/index.ts:31](https://github.com/deltaDAO/nautilus/blob/a089200/src/compute/index.ts#L31)

___

### getComputeEnviroment

▸ **getComputeEnviroment**(`asset`): `Promise`<`ComputeEnvironment`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `asset` | `Asset` |

#### Returns

`Promise`<`ComputeEnvironment`\>

#### Defined in

[src/compute/index.ts:290](https://github.com/deltaDAO/nautilus/blob/a089200/src/compute/index.ts#L290)

___

### getStatus

▸ **getStatus**(`computeStatusConfig`): `Promise`<`ComputeJob`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeStatusConfig` | [`ComputeStatusConfig`](../interfaces/types.ComputeStatusConfig.md) |

#### Returns

`Promise`<`ComputeJob`\>

#### Defined in

[src/compute/index.ts:227](https://github.com/deltaDAO/nautilus/blob/a089200/src/compute/index.ts#L227)

___

### handleComputeOrder

▸ **handleComputeOrder**(`web3`, `asset`, `orderPriceAndFees`, `accountId`, `initializeData`, `config`, `computeConsumerAddress?`): `Promise`<`string`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `web3` | `default` |
| `asset` | [`AssetWithAccessDetails`](../interfaces/types.AssetWithAccessDetails.md) |
| `orderPriceAndFees` | [`OrderPriceAndFees`](../interfaces/types.OrderPriceAndFees.md) |
| `accountId` | `string` |
| `initializeData` | `ProviderComputeInitialize` |
| `config` | `Config` |
| `computeConsumerAddress?` | `string` |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/compute/index.ts:311](https://github.com/deltaDAO/nautilus/blob/a089200/src/compute/index.ts#L311)

___

### publishAsset

▸ **publishAsset**(`assetConfig`): `Promise`<{ `DID`: `string` = ddo.id; `datatokenAddress`: `any` ; `erc721Address`: `any` ; `txHash`: `any`  }\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `assetConfig` | [`AssetConfig`](../interfaces/types.AssetConfig.md) |

#### Returns

`Promise`<{ `DID`: `string` = ddo.id; `datatokenAddress`: `any` ; `erc721Address`: `any` ; `txHash`: `any`  }\>

#### Defined in

[src/publish/index.ts:16](https://github.com/deltaDAO/nautilus/blob/a089200/src/publish/index.ts#L16)

___

### retrieveResult

▸ **retrieveResult**(`computeResultConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeResultConfig` | [`ComputeResultConfig`](../interfaces/types.ComputeResultConfig.md) |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/compute/index.ts:250](https://github.com/deltaDAO/nautilus/blob/a089200/src/compute/index.ts#L250)
