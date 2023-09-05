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

[nautilus/src/Nautilus/Nautilus.ts:23](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L23)

## Properties

### config

• `Private` **config**: `Config`

#### Defined in

[nautilus/src/Nautilus/Nautilus.ts:21](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L21)

___

### signer

• `Private` **signer**: `Signer`

#### Defined in

[nautilus/src/Nautilus/Nautilus.ts:20](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L20)

## Methods

### getChainConfig

▸ `Private` **getChainConfig**(): `Pick`<[`CreateAssetConfig`](../interfaces/types.CreateAssetConfig.md), ``"signer"`` \| ``"chainConfig"``\>

#### Returns

`Pick`<[`CreateAssetConfig`](../interfaces/types.CreateAssetConfig.md), ``"signer"`` \| ``"chainConfig"``\>

#### Defined in

[nautilus/src/Nautilus/Nautilus.ts:94](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L94)

___

### getOceanConfig

▸ **getOceanConfig**(): `Config`

#### Returns

`Config`

#### Defined in

[nautilus/src/Nautilus/Nautilus.ts:106](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L106)

___

### hasValidConfig

▸ `Private` **hasValidConfig**(): `boolean`

#### Returns

`boolean`

#### Defined in

[nautilus/src/Nautilus/Nautilus.ts:81](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L81)

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

[nautilus/src/Nautilus/Nautilus.ts:54](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L54)

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

[nautilus/src/Nautilus/Nautilus.ts:58](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L58)

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

[nautilus/src/Nautilus/Nautilus.ts:110](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L110)

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

[nautilus/src/Nautilus/Nautilus.ts:30](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L30)

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

[nautilus/src/Nautilus/Nautilus.ts:49](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Nautilus.ts#L49)
