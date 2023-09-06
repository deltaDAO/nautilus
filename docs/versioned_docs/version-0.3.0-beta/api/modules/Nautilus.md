---
id: "Nautilus"
title: "Module: Nautilus"
sidebar_label: "Nautilus"
sidebar_position: 0
custom_edit_url: null
---

## Enumerations

- [FileTypes](../enums/Nautilus.FileTypes.md)
- [LogLevel](../enums/Nautilus.LogLevel.md)
- [ServiceTypes](../enums/Nautilus.ServiceTypes.md)

## Classes

- [AssetBuilder](../classes/Nautilus.AssetBuilder.md)
- [ConsumerParameterBuilder](../classes/Nautilus.ConsumerParameterBuilder.md)
- [Nautilus](../classes/Nautilus.Nautilus.md)
- [ServiceBuilder](../classes/Nautilus.ServiceBuilder.md)

## Interfaces

- [Arweave](../interfaces/Nautilus.Arweave.md)
- [GraphqlQuery](../interfaces/Nautilus.GraphqlQuery.md)
- [Ipfs](../interfaces/Nautilus.Ipfs.md)
- [Smartcontract](../interfaces/Nautilus.Smartcontract.md)
- [UrlFile](../interfaces/Nautilus.UrlFile.md)

## Type Aliases

### PricingConfigWithoutOwner

Ƭ **PricingConfigWithoutOwner**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `freCreationParams?` | `Omit`<[`PricingConfig`](../interfaces/types.PricingConfig.md)[``"freCreationParams"``], ``"owner"``\> |
| `type` | [`PricingConfig`](../interfaces/types.PricingConfig.md)[``"type"``] |

#### Defined in

[src/Nautilus/Asset/NautilusAsset.ts:6](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/NautilusAsset.ts#L6)

___

### ServiceFileType

Ƭ **ServiceFileType**<`FileType`\>: `FileType` extends [`GRAPHQL`](../enums/Nautilus.FileTypes.md#graphql) ? [`GraphqlQuery`](../interfaces/Nautilus.GraphqlQuery.md) : `FileType` extends [`ARWEAVE`](../enums/Nautilus.FileTypes.md#arweave) ? [`Arweave`](../interfaces/Nautilus.Arweave.md) : `FileType` extends [`SMARTCONTRACT`](../enums/Nautilus.FileTypes.md#smartcontract) ? [`Smartcontract`](../interfaces/Nautilus.Smartcontract.md) : `FileType` extends [`IPFS`](../enums/Nautilus.FileTypes.md#ipfs) ? [`Ipfs`](../interfaces/Nautilus.Ipfs.md) : [`UrlFile`](../interfaces/Nautilus.UrlFile.md)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `FileType` | extends [`FileTypes`](../enums/Nautilus.FileTypes.md) |

#### Defined in

[src/Nautilus/Asset/Service/NautilusService.ts:42](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/NautilusService.ts#L42)
