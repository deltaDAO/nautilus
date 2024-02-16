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

[src/Nautilus/Nautilus.ts:44](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L44)

## Properties

### config

• `Private` **config**: `Config`

#### Defined in

[src/Nautilus/Nautilus.ts:42](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L42)

___

### signer

• `Private` **signer**: `Signer`

#### Defined in

[src/Nautilus/Nautilus.ts:41](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L41)

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

[src/Nautilus/Nautilus.ts:317](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L317)

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

[src/Nautilus/Nautilus.ts:324](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L324)

___

### edit

▸ **edit**(`asset`): `Promise`<[`PublishResponse`](../interfaces/types.PublishResponse.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `asset` | `NautilusAsset` |

#### Returns

`Promise`<[`PublishResponse`](../interfaces/types.PublishResponse.md)\>

#### Defined in

[src/Nautilus/Nautilus.ts:197](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L197)

___

### getAquariusAsset

▸ **getAquariusAsset**(`did`): `Promise`<`Asset`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `did` | `string` |

#### Returns

`Promise`<`Asset`\>

#### Defined in

[src/Nautilus/Nautilus.ts:280](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L280)

___

### getAquariusAssets

▸ **getAquariusAssets**(`dids`): `Promise`<{ `[did: string]`: `Asset`;  }\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `dids` | `string`[] |

#### Returns

`Promise`<{ `[did: string]`: `Asset`;  }\>

#### Defined in

[src/Nautilus/Nautilus.ts:272](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L272)

___

### getChainConfig

▸ `Private` **getChainConfig**(): `Pick`<[`CreateAssetConfig`](../interfaces/types.CreateAssetConfig.md), ``"signer"`` \| ``"chainConfig"``\>

#### Returns

`Pick`<[`CreateAssetConfig`](../interfaces/types.CreateAssetConfig.md), ``"signer"`` \| ``"chainConfig"``\>

#### Defined in

[src/Nautilus/Nautilus.ts:115](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L115)

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

[src/Nautilus/Nautilus.ts:340](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L340)

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

[src/Nautilus/Nautilus.ts:331](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L331)

___

### getOceanConfig

▸ **getOceanConfig**(): `Config`

#### Returns

`Config`

#### Defined in

[src/Nautilus/Nautilus.ts:127](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L127)

___

### hasValidConfig

▸ `Private` **hasValidConfig**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/Nautilus/Nautilus.ts:102](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L102)

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

[src/Nautilus/Nautilus.ts:75](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L75)

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

[src/Nautilus/Nautilus.ts:79](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L79)

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

[src/Nautilus/Nautilus.ts:131](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L131)

___

### setAssetLifecycleState

▸ **setAssetLifecycleState**(`aquariusAsset`, `state`): `Promise`<`TransactionReceipt`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `aquariusAsset` | `Asset` |
| `state` | [`LifecycleStates`](../enums/types.LifecycleStates.md) |

#### Returns

`Promise`<`TransactionReceipt`\>

#### Defined in

[src/Nautilus/Nautilus.ts:288](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L288)

___

### setServicePrice

▸ **setServicePrice**(`aquaAsset`, `serviceId`, `newPrice`): `Promise`<`TransactionReceipt`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `aquaAsset` | `Asset` |
| `serviceId` | `string` |
| `newPrice` | `string` |

#### Returns

`Promise`<`TransactionReceipt`\>

#### Defined in

[src/Nautilus/Nautilus.ts:254](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L254)

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

[src/Nautilus/Nautilus.ts:51](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L51)

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

[src/Nautilus/Nautilus.ts:70](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Nautilus.ts#L70)
