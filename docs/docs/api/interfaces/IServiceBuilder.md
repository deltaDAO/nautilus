---
id: "IServiceBuilder"
title: "Interface: IServiceBuilder<S, F>"
sidebar_label: "IServiceBuilder"
sidebar_position: 0
custom_edit_url: null
---

## Type parameters

| Name | Type |
| :------ | :------ |
| `S` | extends `ServiceTypes` |
| `F` | extends `FileTypes` |

## Hierarchy

- [`IBuilder`](IBuilder.md)<`NautilusService`<`S`, `F`\>\>

  ↳ **`IServiceBuilder`**

## Properties

### addConsumerParameter

• **addConsumerParameter**: (`parameter`: `NautilusConsumerParameter`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`parameter`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `parameter` | `NautilusConsumerParameter` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:56](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L56)

___

### addFile

• **addFile**: (`file`: `ServiceFileType`<`F`\>) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`file`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `file` | `ServiceFileType`<`F`\> |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:55](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L55)

___

### addTrustedAlgorithm

• **addTrustedAlgorithm**: (`algorithm`: `PublisherTrustedAlgorithm`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`algorithm`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `PublisherTrustedAlgorithm` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:60](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L60)

___

### addTrustedAlgorithmPublisher

• **addTrustedAlgorithmPublisher**: (`publisher`: `string`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`publisher`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `publisher` | `string` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:59](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L59)

___

### allowAlgorithmNetworkAccess

• **allowAlgorithmNetworkAccess**: (`allow?`: `boolean`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`allow?`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `allow?` | `boolean` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:64](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L64)

___

### allowRawAlgorithms

• **allowRawAlgorithms**: (`allow?`: `boolean`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`allow?`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `allow?` | `boolean` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:63](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L63)

___

### build

• **build**: () => `NautilusService`<`S`, `F`\>

#### Type declaration

▸ (): `NautilusService`<`S`, `F`\>

##### Returns

`NautilusService`<`S`, `F`\>

#### Inherited from

[IBuilder](IBuilder.md).[build](IBuilder.md#build)

#### Defined in

[src/@types/Nautilus.ts:23](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L23)

___

### reset

• **reset**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Inherited from

[IBuilder](IBuilder.md).[reset](IBuilder.md#reset)

#### Defined in

[src/@types/Nautilus.ts:24](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L24)

___

### setDescription

• **setDescription**: (`description`: `string`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`description`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:53](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L53)

___

### setName

• **setName**: (`name`: `string`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`name`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:51](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L51)

___

### setServiceEndpoint

• **setServiceEndpoint**: (`endpoint`: `string`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`endpoint`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `endpoint` | `string` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:54](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L54)

___

### setTimeout

• **setTimeout**: (`timeout`: `number`) => [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Type declaration

▸ (`timeout`): [`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `timeout` | `number` |

##### Returns

[`IServiceBuilder`](IServiceBuilder.md)<`S`, `F`\>

#### Defined in

[src/@types/Nautilus.ts:52](https://github.com/deltaDAO/nautilus/blob/ef5e766/src/@types/Nautilus.ts#L52)
