---
id: "Nautilus.Nautilus"
title: "Class: Nautilus"
sidebar_label: "Nautilus"
custom_edit_url: null
---

[Nautilus](../modules/Nautilus.md).Nautilus

## Constructors

### constructor

• `Private` **new Nautilus**(`web3`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `web3` | `default` |

#### Defined in

[src/Nautilus/Nautilus.ts:30](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L30)

## Properties

### config

• `Private` **config**: `Config`

#### Defined in

[src/Nautilus/Nautilus.ts:28](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L28)

___

### web3

• `Private` **web3**: `default`

#### Defined in

[src/Nautilus/Nautilus.ts:27](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L27)

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

[src/Nautilus/Nautilus.ts:120](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L120)

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

[src/Nautilus/Nautilus.ts:127](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L127)

___

### getChainConfig

▸ `Private` **getChainConfig**(): `Pick`<[`AssetConfig`](../interfaces/types.AssetConfig.md), ``"web3"`` \| ``"chainConfig"``\>

#### Returns

`Pick`<[`AssetConfig`](../interfaces/types.AssetConfig.md), ``"web3"`` \| ``"chainConfig"``\>

#### Defined in

[src/Nautilus/Nautilus.ts:94](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L94)

___

### getComputeResult

▸ **getComputeResult**(`computeResultConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeResultConfig` | `Omit`<[`ComputeResultConfig`](../interfaces/types.ComputeResultConfig.md), ``"web3"``\> |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/Nautilus/Nautilus.ts:143](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L143)

___

### getComputeStatus

▸ **getComputeStatus**(`computeStatusConfig`): `Promise`<`ComputeJob`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeStatusConfig` | `Omit`<[`ComputeStatusConfig`](../interfaces/types.ComputeStatusConfig.md), ``"web3"``\> |

#### Returns

`Promise`<`ComputeJob`\>

#### Defined in

[src/Nautilus/Nautilus.ts:134](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L134)

___

### getOceanConfig

▸ **getOceanConfig**(): `Config`

#### Returns

`Config`

#### Defined in

[src/Nautilus/Nautilus.ts:106](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L106)

___

### hasValidConfig

▸ `Private` **hasValidConfig**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/Nautilus/Nautilus.ts:81](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L81)

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

[src/Nautilus/Nautilus.ts:54](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L54)

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

[src/Nautilus/Nautilus.ts:58](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L58)

___

### publish

▸ **publish**(`asset`): `Promise`<{ `DID`: `string` = ddo.id; `datatokenAddress`: `any` ; `erc721Address`: `any` ; `txHash`: `any`  }\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `asset` | `NautilusAsset` |

#### Returns

`Promise`<{ `DID`: `string` = ddo.id; `datatokenAddress`: `any` ; `erc721Address`: `any` ; `txHash`: `any`  }\>

#### Defined in

[src/Nautilus/Nautilus.ts:110](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L110)

___

### create

▸ `Static` **create**(`web3`, `config?`): `Promise`<[`Nautilus`](Nautilus.Nautilus.md)\>

Creates a new Nautilus instance

#### Parameters

| Name | Type |
| :------ | :------ |
| `web3` | `default` |
| `config?` | `Partial`<`Config`\> |

#### Returns

`Promise`<[`Nautilus`](Nautilus.Nautilus.md)\>

#### Defined in

[src/Nautilus/Nautilus.ts:37](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L37)

___

### setLogLevel

▸ `Static` **setLogLevel**(`level`): `void`

Set the log level for Nautilus
ocean.js LoggerInstance is used for logging

#### Parameters

| Name | Type |
| :------ | :------ |
| `level` | [`LogLevel`](../enums/Nautilus.LogLevel.md) |

#### Returns

`void`

#### Defined in

[src/Nautilus/Nautilus.ts:49](https://github.com/deltaDAO/nautilus/blob/9e325d7/src/Nautilus/Nautilus.ts#L49)
