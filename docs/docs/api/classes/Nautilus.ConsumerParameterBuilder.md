---
id: "Nautilus.ConsumerParameterBuilder"
title: "Class: ConsumerParameterBuilder"
sidebar_label: "ConsumerParameterBuilder"
custom_edit_url: null
---

[Nautilus](../modules/Nautilus.md).ConsumerParameterBuilder

## Implements

- [`IBuilder`](../interfaces/types.IBuilder.md)<`ConsumerParameter`\>

## Constructors

### constructor

• **new ConsumerParameterBuilder**()

## Properties

### consumerParameter

• `Private` **consumerParameter**: `NautilusConsumerParameter`

#### Defined in

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:7](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L7)

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

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:49](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L49)

___

### build

▸ **build**(): { `default`: `string` ; `description`: `string` ; `label`: `string` ; `name`: `string` ; `required`: `boolean` = false; `type`: ``"number"`` \| ``"boolean"`` \| ``"text"`` \| ``"select"``  } \| { `default`: `string` ; `description`: `string` ; `label`: `string` ; `name`: `string` ; `options`: `string` ; `required`: `boolean` = false; `type`: ``"number"`` \| ``"boolean"`` \| ``"text"`` \| ``"select"``  }

#### Returns

{ `default`: `string` ; `description`: `string` ; `label`: `string` ; `name`: `string` ; `required`: `boolean` = false; `type`: ``"number"`` \| ``"boolean"`` \| ``"text"`` \| ``"select"``  } \| { `default`: `string` ; `description`: `string` ; `label`: `string` ; `name`: `string` ; `options`: `string` ; `required`: `boolean` = false; `type`: ``"number"`` \| ``"boolean"`` \| ``"text"`` \| ``"select"``  }

#### Implementation of

[IBuilder](../interfaces/types.IBuilder.md).[build](../interfaces/types.IBuilder.md#build)

#### Defined in

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:61](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L61)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Implementation of

[IBuilder](../interfaces/types.IBuilder.md).[reset](../interfaces/types.IBuilder.md#reset)

#### Defined in

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:9](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L9)

___

### setDefault

▸ **setDefault**(`value`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `string` \| `number` \| `boolean` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:43](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L43)

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

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:25](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L25)

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

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:31](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L31)

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

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:19](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L19)

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

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:37](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L37)

___

### setType

▸ **setType**(`type`): [`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | ``"number"`` \| ``"boolean"`` \| ``"text"`` \| ``"select"`` |

#### Returns

[`ConsumerParameterBuilder`](Nautilus.ConsumerParameterBuilder.md)

#### Defined in

[src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts:13](https://github.com/deltaDAO/nautilus/blob/300e017/src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.ts#L13)
