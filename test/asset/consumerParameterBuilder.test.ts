import assert from 'assert'
import {
  ConsumerParameterBuilder,
  NautilusConsumerParameter
} from '../../src/nautilus/asset/consumerParameters'

describe('ConsumerParameterBuilder', () => {
  it('builds text consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder('text')

    const myParam: NautilusConsumerParameter<'text'> = {
      type: 'text',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 'defaultValue',
      required: true
    }

    const textParam = builder
      .setName(myParam.name)
      .setLabel(myParam.label)
      .setDescription(myParam.description)
      .setDefault(myParam.default)
      .setRequired(myParam.required)
      .build()

    assert.deepEqual(textParam, myParam)
  })

  it('builds number consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder('number')

    const myParam: NautilusConsumerParameter<'number'> = {
      type: 'number',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: 123,
      required: false
    }

    const numberParam = builder
      .setName(myParam.name)
      .setLabel(myParam.label)
      .setDescription(myParam.description)
      .setDefault(myParam.default)
      .setRequired(myParam.required)
      .build()

    assert.deepEqual(numberParam, myParam)
  })

  it('builds boolean consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder('boolean')

    const myParam: NautilusConsumerParameter<'boolean'> = {
      type: 'boolean',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: false,
      required: true
    }

    const booleanParam = builder
      .setName(myParam.name)
      .setLabel(myParam.label)
      .setDescription(myParam.description)
      .setDefault(myParam.default)
      .setRequired(myParam.required)
      .build()

    assert.deepEqual(booleanParam, myParam)
  })

  it('builds select consumerParameter correctly', () => {
    const builder = new ConsumerParameterBuilder('select')

    const myParam: NautilusConsumerParameter<'select'> = {
      type: 'select',
      name: 'my-param',
      label: 'My Param',
      description: 'A description of my param for the enduser.',
      default: [{ key: 'value' }],
      required: false,
      options: [{ key: 'value' }, { key1: 'value1' }]
    }

    builder
      .setName(myParam.name)
      .setLabel(myParam.label)
      .setDescription(myParam.description)
      .setDefault(myParam.default)
      .setRequired(myParam.required)

    myParam.options.forEach((opt) => {
      builder.addOption(opt)
    })

    const selectParam = builder.build()

    assert.deepEqual(selectParam, myParam)
  })

  it('ignores options for non-select type param', () => {
    const builder = new ConsumerParameterBuilder('text')

    const param = builder.addOption({ key: 'value' }).build()

    assert.ok(param.options === undefined)
  })
})
