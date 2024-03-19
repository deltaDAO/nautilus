import assert from 'node:assert'
import type { ConsumerParameter } from '@oceanprotocol/lib'
import { ConsumerParameterBuilder } from '../../src/Nautilus/Asset/ConsumerParameters'

describe('ConsumerParameterBuilder', () => {
  it('builds text consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder()

    const myParam: ConsumerParameter = {
      type: 'select',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 'value',
      required: true
    }

    const textParam = builder
      .setType(myParam.type)
      .setName(myParam.name)
      .setLabel(myParam.label)
      .setDescription(myParam.description)
      .setDefault(myParam.default)
      .setRequired(myParam.required)
      .build()

    assert.deepStrictEqual(textParam, myParam)
  })

  it('builds number consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder()

    const myNumberParam: ConsumerParameter = {
      type: 'number',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: '123',
      required: false
    }

    const numberParam = builder
      .setType(myNumberParam.type)
      .setName(myNumberParam.name)
      .setLabel(myNumberParam.label)
      .setDescription(myNumberParam.description)
      .setDefault(myNumberParam.default)
      .setRequired(myNumberParam.required)
      .build()

    assert.deepStrictEqual(numberParam, myNumberParam)
  })

  it('builds boolean consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder()

    const myBooleanParam: ConsumerParameter = {
      type: 'boolean',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 'false',
      required: true
    }

    const booleanParam = builder
      .setType(myBooleanParam.type)
      .setName(myBooleanParam.name)
      .setLabel(myBooleanParam.label)
      .setDescription(myBooleanParam.description)
      .setDefault(myBooleanParam.default)
      .setRequired(myBooleanParam.required)
      .build()

    assert.deepStrictEqual(booleanParam, myBooleanParam)
  })

  it('builds select consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder()

    const options = [{ value: 'Label' }, { 'another-value': 'Another label' }]

    const mySelectParam: ConsumerParameter = {
      type: 'select',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 'key',
      required: false,
      options: JSON.stringify(options)
    }

    builder
      .setType(mySelectParam.type)
      .setName(mySelectParam.name)
      .setLabel(mySelectParam.label)
      .setDescription(mySelectParam.description)
      .setDefault(mySelectParam.default)
      .setRequired(mySelectParam.required)

    for (const option of options) builder.addOption(option)

    const selectParam = builder.build()

    assert.deepStrictEqual(selectParam, mySelectParam)
  })

  it('does not allow options for non-select type param', () => {
    const builder = new ConsumerParameterBuilder()
    const option = { key: 'value' }

    assert.throws(
      () => {
        builder.addOption(option).build()
      },
      Error,
      'Should throw error for options being set on undefined "type"'
    )

    assert.throws(
      () => {
        builder.setType('text').addOption(option).build()
      },
      Error,
      'Should throw error for options being set on "type" = "text"'
    )

    assert.throws(
      () => {
        builder.setType('number').addOption(option).build()
      },
      Error,
      'Should throw error for options being set on "type" = "number"'
    )

    assert.throws(
      () => {
        builder.setType('boolean').addOption(option).build()
      },
      Error,
      'Should throw error for options being set on "type" = "boolean"'
    )
  })
})
