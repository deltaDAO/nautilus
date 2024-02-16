---
id: "types.IServiceBuilder"
title: "Interface: IServiceBuilder<S, F>"
sidebar_label: "IServiceBuilder"
custom_edit_url: null
---

[@types](../modules/types.md).IServiceBuilder

## Type parameters

| Name | Type |
| :------ | :------ |
| `S` | extends [`ServiceTypes`](../enums/Nautilus.ServiceTypes.md) |
| `F` | extends [`FileTypes`](../enums/Nautilus.FileTypes.md) |

## Hierarchy

- [`IBuilder`](types.IBuilder.md)<`NautilusService`<`S`, `F`\>\>

  ↳ **`IServiceBuilder`**

## Implemented by

- [`ServiceBuilder`](../classes/Nautilus.ServiceBuilder.md)

## Properties

### addConsumerParameter

• **addConsumerParameter**: (`parameter`: `ConsumerParameter`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`parameter`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `parameter` | `ConsumerParameter` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:86](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L86)

___

### addFile

• **addFile**: (`file`: [`ServiceFileType`](../modules/Nautilus.md#servicefiletype)<`F`\>) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`file`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `file` | [`ServiceFileType`](../modules/Nautilus.md#servicefiletype)<`F`\> |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:85](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L85)

___

### addTrustedAlgorithmPublisher

• **addTrustedAlgorithmPublisher**: (`publisher`: `string`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`publisher`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `publisher` | `string` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:87](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L87)

___

### addTrustedAlgorithms

• **addTrustedAlgorithms**: (`algorithms`: `PublisherTrustedAlgorithm`[]) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`algorithms`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `algorithms` | `PublisherTrustedAlgorithm`[] |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:88](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L88)

___

### allowAlgorithmNetworkAccess

• **allowAlgorithmNetworkAccess**: (`allow?`: `boolean`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`allow?`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `allow?` | `boolean` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:92](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L92)

___

### allowRawAlgorithms

• **allowRawAlgorithms**: (`allow?`: `boolean`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`allow?`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `allow?` | `boolean` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:91](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L91)

___

### build

• **build**: () => `NautilusService`<`S`, `F`\>

#### Type declaration

▸ (): `NautilusService`<`S`, `F`\>

##### Returns

`NautilusService`<`S`, `F`\>

#### Inherited from

[IBuilder](types.IBuilder.md).[build](types.IBuilder.md#build)

#### Defined in

[src/@types/Nautilus.ts:35](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L35)

___

### reset

• **reset**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Inherited from

[IBuilder](types.IBuilder.md).[reset](types.IBuilder.md#reset)

#### Defined in

[src/@types/Nautilus.ts:36](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L36)

___

### setDatatokenData

• **setDatatokenData**: (`datatokenCreateData`: [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner)) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`datatokenCreateData`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `datatokenCreateData` | [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner) |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:94](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L94)

___

### setDatatokenNameAndSymbol

• **setDatatokenNameAndSymbol**: (`dtName`: `string`, `dtSymbol`: `string`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`dtName`, `dtSymbol`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `dtName` | `string` |
| `dtSymbol` | `string` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:97](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L97)

___

### setDescription

• **setDescription**: (`description`: `string`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`description`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:83](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L83)

___

### setName

• **setName**: (`name`: `string`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`name`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:81](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L81)

___

### setPricing

• **setPricing**: (`pricing`: [`PricingConfig`](types.PricingConfig.md)) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`pricing`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | [`PricingConfig`](types.PricingConfig.md) |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:93](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L93)

___

### setServiceEndpoint

• **setServiceEndpoint**: (`endpoint`: `string`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`endpoint`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `endpoint` | `string` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:84](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L84)

___

### setTimeout

• **setTimeout**: (`timeout`: `number`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`timeout`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `timeout` | `number` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:82](https://github.com/deltaDAO/nautilus/blob/300e017/src/@types/Nautilus.ts#L82)
