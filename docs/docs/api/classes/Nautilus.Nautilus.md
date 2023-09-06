---
id: "Nautilus.Nautilus"
title: "Class: Nautilus"
sidebar_label: "Nautilus"
custom_edit_url: null
---

[Nautilus](../modules/Nautilus.md).Nautilus

## Constructors

### constructor

• `Private` **new Nautilus**(`signer`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `signer` | `Signer` |

#### Defined in

[src/Nautilus/Nautilus.ts:32](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L32)

## Properties

### config

• `Private` **config**: `Config`

#### Defined in

[src/Nautilus/Nautilus.ts:30](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L30)

___

### signer

• `Private` **signer**: `Signer`

#### Defined in

[src/Nautilus/Nautilus.ts:29](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L29)

## Methods

### access

▸ **access**(`accessConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `accessConfig` | `Omit`<[`AccessConfig`](../interfaces/types.AccessConfig.md), ``"signer"`` \| ``"chainConfig"``\> | configuration object |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/Nautilus/Nautilus.ts:192](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L192)

___

### compute

▸ **compute**(`computeConfig`): `Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeConfig` | `Omit`<[`ComputeConfig`](../interfaces/types.ComputeConfig.md), ``"signer"`` \| ``"chainConfig"``\> |

#### Returns

`Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Defined in

[src/Nautilus/Nautilus.ts:199](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L199)

___

### getChainConfig

▸ `Private` **getChainConfig**(): `Pick`<[`CreateAssetConfig`](../interfaces/types.CreateAssetConfig.md), ``"signer"`` \| ``"chainConfig"``\>

#### Returns

`Pick`<[`CreateAssetConfig`](../interfaces/types.CreateAssetConfig.md), ``"signer"`` \| ``"chainConfig"``\>

#### Defined in

[src/Nautilus/Nautilus.ts:103](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L103)

___

### getComputeResult

▸ **getComputeResult**(`computeResultConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeResultConfig` | `Omit`<[`ComputeResultConfig`](../interfaces/types.ComputeResultConfig.md), ``"signer"``\> |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/Nautilus/Nautilus.ts:215](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L215)

___

### getComputeStatus

▸ **getComputeStatus**(`computeStatusConfig`): `Promise`<`ComputeJob`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeStatusConfig` | `Omit`<[`ComputeStatusConfig`](../interfaces/types.ComputeStatusConfig.md), ``"signer"``\> |

#### Returns

`Promise`<`ComputeJob`\>

#### Defined in

[src/Nautilus/Nautilus.ts:206](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L206)

___

### getOceanConfig

▸ **getOceanConfig**(): `Config`

#### Returns

`Config`

#### Defined in

[src/Nautilus/Nautilus.ts:115](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L115)

___

### hasValidConfig

▸ `Private` **hasValidConfig**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/Nautilus/Nautilus.ts:90](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L90)

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

[src/Nautilus/Nautilus.ts:63](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L63)

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

[src/Nautilus/Nautilus.ts:67](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L67)

___

### publish

▸ **publish**(`asset`): `Promise`<[`PublishResponse`](../interfaces/types.PublishResponse.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `asset` | `NautilusAsset` |

#### Returns

`Promise`<[`PublishResponse`](../interfaces/types.PublishResponse.md)\>

#### Defined in

[src/Nautilus/Nautilus.ts:119](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L119)

___

### create

▸ `Static` **create**(`signer`, `config?`): `Promise`<[`Nautilus`](Nautilus.Nautilus.md)\>

Creates a new Nautilus instance

#### Parameters

| Name | Type |
| :------ | :------ |
| `signer` | `Signer` |
| `config?` | `Partial`<`Config`\> |

#### Returns

`Promise`<[`Nautilus`](Nautilus.Nautilus.md)\>

#### Defined in

[src/Nautilus/Nautilus.ts:39](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L39)

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

[src/Nautilus/Nautilus.ts:58](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Nautilus.ts#L58)
