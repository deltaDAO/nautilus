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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:24](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L24)

## Properties

### service

• `Private` **service**: `NautilusService`<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:22](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L22)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:122](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L122)

___

### addConsumerParameter

▸ **addConsumerParameter**(`parameter`): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `parameter` | `ConsumerParameter` |

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[addConsumerParameter](../interfaces/types.IServiceBuilder.md#addconsumerparameter)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:116](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L116)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:84](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L84)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:208](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L208)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:150](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L150)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:141](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L141)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:132](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L132)

___

### build

▸ **build**(): `NautilusService`<`ServiceType`, `FileType`\>

#### Returns

`NautilusService`<`ServiceType`, `FileType`\>

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[build](../interfaces/types.IServiceBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:291](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L291)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:184](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L184)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:233](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L233)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IServiceBuilder](../interfaces/types.IServiceBuilder.md).[reset](../interfaces/types.IServiceBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:287](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L287)

___

### setAllAlgorithmPublishersTrusted

▸ **setAllAlgorithmPublishersTrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:248](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L248)

___

### setAllAlgorithmPublishersUntrusted

▸ **setAllAlgorithmPublishersUntrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:254](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L254)

___

### setAllAlgorithmsTrusted

▸ **setAllAlgorithmsTrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:196](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L196)

___

### setAllAlgorithmsUntrusted

▸ **setAllAlgorithmsUntrusted**(): [`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Returns

[`ServiceBuilder`](Nautilus.ServiceBuilder.md)<`ServiceType`, `FileType`\>

#### Defined in

[src/Nautilus/Asset/Service/ServiceBuilder.ts:202](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L202)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:260](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L260)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:266](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L266)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:110](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L110)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:104](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L104)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:276](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L276)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:97](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L97)

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

[src/Nautilus/Asset/Service/ServiceBuilder.ts:91](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/Service/ServiceBuilder.ts#L91)
