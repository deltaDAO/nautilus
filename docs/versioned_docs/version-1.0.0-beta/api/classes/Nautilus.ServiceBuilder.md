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

• **new ServiceBuilder**<`ServiceType`, `FileType`\>(`config`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `ServiceType` | extends [`ServiceTypes`](../enums/Nautilus.ServiceTypes.md) |
| `FileType` | extends [`FileTypes`](../enums/Nautilus.FileTypes.md) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `config` | [`ServiceBuilderConfig`](../modules/types.md#servicebuilderconfig) |

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:27](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L27)

## Properties

### service

• `Private` **service**: `NautilusService`<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:25](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L25)

## Methods

### addAdditionalInformation

▸ **addAdditionalInformation**(`additionalInformation`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `additionalInformation` | `Object` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:148](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L148)

___

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:142](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L142)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:110](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L110)

___

### addTrustedAlgorithmPublisher

▸ **addTrustedAlgorithmPublisher**(`publisherAddress`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `publisherAddress` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addTrustedAlgorithmPublisher](../interfaces/types.IServiceBuilder.md#addtrustedalgorithmpublisher)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:234](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L234)

___

### addTrustedAlgorithms

▸ **addTrustedAlgorithms**(`trustedAlgorithmAssets`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `trustedAlgorithmAssets` | [`TrustedAlgorithmAsset`](../modules/types.md#trustedalgorithmasset)[] |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addTrustedAlgorithms](../interfaces/types.IServiceBuilder.md#addtrustedalgorithms)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:176](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L176)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:167](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L167)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:158](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L158)

___

### build

▸ **build**(): `NautilusService`<`ServiceType`, `FileType`\>

#### Returns

`NautilusService`<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[build](../interfaces/types.IServiceBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:317](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L317)

___

### removeTrustedAlgorithm

▸ **removeTrustedAlgorithm**(`did`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `did` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:210](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L210)

___

### removeTrustedAlgorithmPublisher

▸ **removeTrustedAlgorithmPublisher**(`publisherAddress`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `publisherAddress` | `string` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:259](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L259)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[reset](../interfaces/types.IServiceBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:313](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L313)

___

### setAllAlgorithmPublishersTrusted

▸ **setAllAlgorithmPublishersTrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:274](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L274)

___

### setAllAlgorithmPublishersUntrusted

▸ **setAllAlgorithmPublishersUntrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:280](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L280)

___

### setAllAlgorithmsTrusted

▸ **setAllAlgorithmsTrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:222](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L222)

___

### setAllAlgorithmsUntrusted

▸ **setAllAlgorithmsUntrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:228](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L228)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:286](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L286)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:292](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L292)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:136](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L136)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:130](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L130)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:302](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L302)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:123](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L123)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:117](https://github.com/deltaDAO/nautilus/blob/e44ffd7/src/Nautilus/Asset/Service/ServiceBuilder.ts#L117)
