---
id: "Nautilus.ServiceBuilder"
title: "Class: ServiceBuilder<ServiceType, FileType>"
sidebar_label: "ServiceBuilder"
custom_edit_url: null
---

[Nautilus](../modules/Nautilus.md).ServiceBuilder

## Type parameters

| Name | Type |
| :------ | :------ |
| `ServiceType` | extends [`ServiceTypes`](../enums/Nautilus.ServiceTypes.md) |
| `FileType` | extends [`FileTypes`](../enums/Nautilus.FileTypes.md) |

## Implements

- [`IServiceBuilder`](../interfaces/types.IServiceBuilder.md)<`ServiceType`, `FileType`\>

## Constructors

### constructor

• **new ServiceBuilder**<`ServiceType`, `FileType`\>(`serviceType`, `fileType?`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `ServiceType` | extends [`ServiceTypes`](../enums/Nautilus.ServiceTypes.md) |
| `FileType` | extends [`FileTypes`](../enums/Nautilus.FileTypes.md) |

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `serviceType` | `ServiceType` | `undefined` |
| `fileType` | [`FileTypes`](../enums/Nautilus.FileTypes.md) | `FileTypes.URL` |

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:18](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L18)

## Properties

### service

• `Private` **service**: `NautilusService`<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:16](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L16)

## Methods

### addConsumerParameter

▸ **addConsumerParameter**(`parameter`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `parameter` | `NautilusConsumerParameter` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addConsumerParameter](../interfaces/types.IServiceBuilder.md#addconsumerparameter)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:61](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L61)

___

### addFile

▸ **addFile**(`file`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `file` | [`ServiceFileType`](../modules/Nautilus.md#servicefiletype)<`FileType`\> |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addFile](../interfaces/types.IServiceBuilder.md#addfile)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:31](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L31)

___

### addTrustedAlgorithm

▸ **addTrustedAlgorithm**(`algorithm`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `algorithm` | `PublisherTrustedAlgorithm` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addTrustedAlgorithm](../interfaces/types.IServiceBuilder.md#addtrustedalgorithm)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:84](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L84)

___

### addTrustedAlgorithmPublisher

▸ **addTrustedAlgorithmPublisher**(`publisher`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `publisher` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addTrustedAlgorithmPublisher](../interfaces/types.IServiceBuilder.md#addtrustedalgorithmpublisher)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:92](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L92)

___

### allowAlgorithmNetworkAccess

▸ **allowAlgorithmNetworkAccess**(`allow?`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `allow` | `boolean` | `true` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[allowAlgorithmNetworkAccess](../interfaces/types.IServiceBuilder.md#allowalgorithmnetworkaccess)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:76](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L76)

___

### allowRawAlgorithms

▸ **allowRawAlgorithms**(`allow?`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `allow` | `boolean` | `true` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[allowRawAlgorithms](../interfaces/types.IServiceBuilder.md#allowrawalgorithms)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:68](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L68)

___

### build

▸ **build**(): `NautilusService`<`ServiceType`, `FileType`\>

#### Returns

`NautilusService`<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[build](../interfaces/types.IServiceBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:105](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L105)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[reset](../interfaces/types.IServiceBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:101](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L101)

___

### setDescription

▸ **setDescription**(`description`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setDescription](../interfaces/types.IServiceBuilder.md#setdescription)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:55](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L55)

___

### setName

▸ **setName**(`name`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setName](../interfaces/types.IServiceBuilder.md#setname)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:49](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L49)

___

### setServiceEndpoint

▸ **setServiceEndpoint**(`endpoint`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `endpoint` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setServiceEndpoint](../interfaces/types.IServiceBuilder.md#setserviceendpoint)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:43](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L43)

___

### setTimeout

▸ **setTimeout**(`timeout`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `timeout` | `number` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setTimeout](../interfaces/types.IServiceBuilder.md#settimeout)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:37](https://github.com/deltaDAO/nautilus/blob/e517813/src/Nautilus/Asset/Service/ServiceBuilder.ts#L37)
