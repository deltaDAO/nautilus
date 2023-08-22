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

• **addConsumerParameter**: (`parameter`: `NautilusConsumerParameter`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`parameter`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `parameter` | `NautilusConsumerParameter` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[nautilus/src/@types/Nautilus.ts:63](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L63)

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

[nautilus/src/@types/Nautilus.ts:62](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L62)

___

### addTrustedAlgorithm

• **addTrustedAlgorithm**: (`algorithm`: `PublisherTrustedAlgorithm`) => [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`algorithm`): [`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `PublisherTrustedAlgorithm` |

##### Returns

[`IServiceBuilder`](types.IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[nautilus/src/@types/Nautilus.ts:67](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L67)

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

[nautilus/src/@types/Nautilus.ts:66](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L66)

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

[nautilus/src/@types/Nautilus.ts:71](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L71)

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

[nautilus/src/@types/Nautilus.ts:70](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L70)

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

[nautilus/src/@types/Nautilus.ts:21](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L21)

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

[nautilus/src/@types/Nautilus.ts:22](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L22)

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

[nautilus/src/@types/Nautilus.ts:73](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L73)

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

[nautilus/src/@types/Nautilus.ts:76](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L76)

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

[nautilus/src/@types/Nautilus.ts:60](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L60)

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

[nautilus/src/@types/Nautilus.ts:58](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L58)

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

[nautilus/src/@types/Nautilus.ts:72](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L72)

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

[nautilus/src/@types/Nautilus.ts:61](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L61)

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

[nautilus/src/@types/Nautilus.ts:59](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/@types/Nautilus.ts#L59)
