---
id: "Nautilus.ConsumerParameterBuilder"
title: "Class: ConsumerParameterBuilder"
sidebar_label: "ConsumerParameterBuilder"
custom_edit_url: null
---

[Nautilus](../modules/Nautilus.md).ConsumerParameterBuilder

## Implements

- [`IBuilder`](../interfaces/types.IBuilder.md)<`NautilusConsumerParameter`\>

## Constructors

### constructor

• **new ConsumerParameterBuilder**()

## Properties

### consumerParameter

• `Private` **consumerParameter**: `NautilusConsumerParameter`

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:11](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L11)

## Methods

### addOption

▸ **addOption**(`option`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `option` | [`ConsumerParameterSelectOption`](../modules/types.md#consumerparameterselectoption) |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:53](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L53)

___

### build

▸ **build**(): `NautilusConsumerParameter`

#### Returns

`NautilusConsumerParameter`

#### Implementation of

[IBuilder](../interfaces/types.IBuilder.md).[build](../interfaces/types.IBuilder.md#build)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:66](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L66)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IBuilder](../interfaces/types.IBuilder.md).[reset](../interfaces/types.IBuilder.md#reset)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:13](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L13)

___

### setDefault

▸ **setDefault**(`value`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `string` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:47](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L47)

___

### setDescription

▸ **setDescription**(`description`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `description` | `string` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:29](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L29)

___

### setLabel

▸ **setLabel**(`label`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `label` | `string` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:35](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L35)

___

### setName

▸ **setName**(`name`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:23](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L23)

___

### setRequired

▸ **setRequired**(`required`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `required` | `boolean` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:41](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L41)

___

### setType

▸ **setType**(`type`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | [`ConsumerParameterType`](../modules/types.md#consumerparametertype) |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[nautilus/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:17](https://github.com/deltaDAO/nautilus/blob/75cfaa6/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L17)
