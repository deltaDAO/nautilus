import assert from 'assert'
import { ConsumerParameter } from '../../src/@types/Publish'
import { ConsumerParameterBuilder } from '../../src/Nautilus/Asset/ConsumerParameters'

describe('ConsumerParameterBuilder', () => {
  it('builds text consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder()

    const myParam: ConsumerParameter = {
      type: 'text',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 'defaultValue',
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

    assert.deepEqual(textParam, myParam)
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
      .setDefault(myNumberParam.default.toString())
      .setRequired(myNumberParam.required)
      .build()

    assert.deepEqual(numberParam, myNumberParam)
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
      .setDefault(myBooleanParam.default.toString())
      .setRequired(myBooleanParam.required)
      .build()

    assert.deepEqual(booleanParam, myBooleanParam)
  })

  it('builds select consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder()

    const mySelectParam: ConsumerParameter = {
      type: 'select',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 'key',
      required: false,
      options: [{ key: 'value' }, { key1: 'value1' }]
    }

    builder
      .setType(mySelectParam.type)
      .setName(mySelectParam.name)
      .setLabel(mySelectParam.label)
      .setDescription(mySelectParam.description)
      .setDefault(mySelectParam.default)
      .setRequired(mySelectParam.required)

    mySelectParam.options.forEach((opt) => {
      builder.addOption(opt)
    })

    const selectParam = builder.build()

    assert.deepEqual(selectParam, mySelectParam)
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
