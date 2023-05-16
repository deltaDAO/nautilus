---
id: "nautilus.Nautilus"
title: "Class: Nautilus"
sidebar_label: "Nautilus"
custom_edit_url: null
---

[nautilus](../modules/nautilus.md).Nautilus

## Constructors

### constructor

• `Private` **new Nautilus**(`web3`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `web3` | `default` |

#### Defined in

[src/nautilus/nautilus.ts:19](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L19)

## Properties

### config

• `Private` **config**: `Config`

#### Defined in

[src/nautilus/nautilus.ts:17](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L17)

___

### logger

• **logger**: `Logger` = `LoggerInstance`

#### Defined in

[src/nautilus/nautilus.ts:23](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L23)

___

### web3

• `Private` **web3**: `default`

#### Defined in

[src/nautilus/nautilus.ts:16](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L16)

## Methods

### access

▸ **access**(`accessConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `accessConfig` | `Omit`<[`AccessConfig`](../interfaces/types.AccessConfig.md), ``"web3"`` \| ``"chainConfig"``\> | configuration object |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/nautilus/nautilus.ts:96](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L96)

___

### compute

▸ **compute**(`computeConfig`): `Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeConfig` | `Omit`<[`ComputeConfig`](../interfaces/types.ComputeConfig.md), ``"web3"`` \| ``"chainConfig"``\> |

#### Returns

`Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Defined in

[src/nautilus/nautilus.ts:103](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L103)

___

### getChainConfig

▸ `Private` **getChainConfig**(): `Pick`<[`AssetConfig`](../interfaces/types.AssetConfig.md), ``"web3"`` \| ``"chainConfig"``\>

#### Returns

`Pick`<[`AssetConfig`](../interfaces/types.AssetConfig.md), ``"web3"`` \| ``"chainConfig"``\>

#### Defined in

[src/nautilus/nautilus.ts:74](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L74)

___

### hasValidConfig

▸ `Private` **hasValidConfig**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/nautilus/nautilus.ts:61](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L61)

___

### init

▸ `Private` **init**(`config?`): `Promise`<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `config?` | `Partial`<`Config`\> |

#### Returns

`Promise`<`void`\>

#### Defined in

[src/nautilus/nautilus.ts:37](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L37)

___

### loadOceanConfig

▸ `Private` **loadOceanConfig**(`config?`): `Promise`<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `config?` | `Partial`<`Config`\> |

#### Returns

`Promise`<`void`\>

#### Defined in

[src/nautilus/nautilus.ts:41](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L41)

___

### publish

▸ **publish**(`asset`): `Promise`<{ `DID`: `string` = ddo.id; `datatokenAddress`: `any` ; `erc721Address`: `any` ; `txHash`: `any`  }\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `asset` | [`NautilusAsset`](nautilus.NautilusAsset.md) |

#### Returns

`Promise`<{ `DID`: `string` = ddo.id; `datatokenAddress`: `any` ; `erc721Address`: `any` ; `txHash`: `any`  }\>

#### Defined in

[src/nautilus/nautilus.ts:86](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L86)

___

### create

▸ `Static` **create**(`web3`, `config?`): `Promise`<[`Nautilus`](nautilus.Nautilus.md)\>

Creates a new Nautilus instance

#### Parameters

| Name | Type |
| :------ | :------ |
| `web3` | `default` |
| `config?` | `Partial`<`Config`\> |

#### Returns

`Promise`<[`Nautilus`](nautilus.Nautilus.md)\>

#### Defined in

[src/nautilus/nautilus.ts:28](https://github.com/deltaDAO/nautilus/blob/e68220d/src/nautilus/nautilus.ts#L28)
