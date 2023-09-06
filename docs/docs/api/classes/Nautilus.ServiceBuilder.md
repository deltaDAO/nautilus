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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:20](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L20)

## Properties

### service

• `Private` **service**: `NautilusService`<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:18](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L18)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:63](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L63)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:33](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L33)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:86](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L86)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:94](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L94)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:78](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L78)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:70](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L70)

___

### build

▸ **build**(): `NautilusService`<`ServiceType`, `FileType`\>

#### Returns

`NautilusService`<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[build](../interfaces/types.IServiceBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:129](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L129)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[reset](../interfaces/types.IServiceBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:125](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L125)

___

### setDatatokenData

▸ **setDatatokenData**(`tokenData`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `tokenData` | [`DatatokenCreateParamsWithoutOwner`](../modules/types.md#datatokencreateparamswithoutowner) |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setDatatokenData](../interfaces/types.IServiceBuilder.md#setdatatokendata)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:102](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L102)

___

### setDatatokenNameAndSymbol

▸ **setDatatokenNameAndSymbol**(`dtName`, `dtSymbol`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `dtName` | `string` |
| `dtSymbol` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setDatatokenNameAndSymbol](../interfaces/types.IServiceBuilder.md#setdatatokennameandsymbol)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:108](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L108)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:57](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L57)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:51](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L51)

___

### setPricing

▸ **setPricing**(`pricing`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `pricing` | [`PricingConfigWithoutOwner`](../modules/Nautilus.md#pricingconfigwithoutowner) |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[setPricing](../interfaces/types.IServiceBuilder.md#setpricing)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:118](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L118)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:45](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L45)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:39](https://github.com/deltaDAO/nautilus/blob/40edf26/src/Nautilus/Asset/Service/ServiceBuilder.ts#L39)
