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

[src/Nautilus/Nautilus.ts:31](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L31)

## Properties

### config

• `Private` **config**: `Config`

#### Defined in

[src/Nautilus/Nautilus.ts:29](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L29)

___

### web3

• `Private` **web3**: `default`

#### Defined in

[src/Nautilus/Nautilus.ts:28](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L28)

## Methods

### access

▸ **access**(`accessConfig`): `Promise`<`string`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `accessConfig` | `Omit`<[`AccessConfig`](../interfaces/types.AccessConfig.md), ``"chainConfig"`` \| ``"web3"``\> | configuration object |

#### Returns

`Promise`<`string`\>

#### Defined in

[src/Nautilus/Nautilus.ts:181](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L181)

___

### compute

▸ **compute**(`computeConfig`): `Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `computeConfig` | `Omit`<[`ComputeConfig`](../interfaces/types.ComputeConfig.md), ``"chainConfig"`` \| ``"web3"``\> |

#### Returns

`Promise`<`ComputeJob` \| `ComputeJob`[]\>

#### Defined in

[src/Nautilus/Nautilus.ts:188](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L188)

___

### getChainConfig

▸ `Private` **getChainConfig**(): `Pick`<[`CreateAssetComfig`](../interfaces/types.CreateAssetComfig.md), ``"chainConfig"`` \| ``"web3"``\>

#### Returns

`Pick`<[`CreateAssetComfig`](../interfaces/types.CreateAssetComfig.md), ``"chainConfig"`` \| ``"web3"``\>

#### Defined in

[src/Nautilus/Nautilus.ts:95](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L95)

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

[src/Nautilus/Nautilus.ts:204](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L204)

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

[src/Nautilus/Nautilus.ts:195](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L195)

___

### getOceanConfig

▸ **getOceanConfig**(): `Config`

#### Returns

`Config`

#### Defined in

[src/Nautilus/Nautilus.ts:107](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L107)

___

### hasValidConfig

▸ `Private` **hasValidConfig**(): `boolean`

#### Returns

`boolean`

#### Defined in

[src/Nautilus/Nautilus.ts:82](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L82)

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

[src/Nautilus/Nautilus.ts:55](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L55)

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

[src/Nautilus/Nautilus.ts:59](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L59)

___

### publish

▸ **publish**(`asset`): `Promise`<{ `ddo`: `DDO` ; `nftAddress`: `string` ; `services`: { `datatokenAddress`: `string` ; `pricingTransactionReceipt`: `TransactionReceipt` ; `service`: `NautilusService`<[`ServiceTypes`](../enums/Nautilus.ServiceTypes.md), [`FileTypes`](../enums/Nautilus.FileTypes.md)\>  }[] ; `setMetadataTxReceipt`: { `transactionReceipt`: `TransactionReceipt`  }  }\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `asset` | `NautilusAsset` |

#### Returns

`Promise`<{ `ddo`: `DDO` ; `nftAddress`: `string` ; `services`: { `datatokenAddress`: `string` ; `pricingTransactionReceipt`: `TransactionReceipt` ; `service`: `NautilusService`<[`ServiceTypes`](../enums/Nautilus.ServiceTypes.md), [`FileTypes`](../enums/Nautilus.FileTypes.md)\>  }[] ; `setMetadataTxReceipt`: { `transactionReceipt`: `TransactionReceipt`  }  }\>

#### Defined in

[src/Nautilus/Nautilus.ts:111](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L111)

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

[src/Nautilus/Nautilus.ts:38](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L38)

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

[src/Nautilus/Nautilus.ts:50](https://github.com/deltaDAO/nautilus/blob/89168de/src/Nautilus/Nautilus.ts#L50)
