import { describe, expect, it } from 'vitest'
import { ConsumerParameterBuilder } from '../../src/Nautilus/Asset/ConsumerParameters/ConsumerParameterBuilder.js'

function base() {
  return new ConsumerParameterBuilder()
    .setName('param')
    .setLabel('A parameter')
    .setDescription('What it does')
}

describe('ConsumerParameterBuilder', () => {
  it('builds a text parameter', () => {
    const parameter = base().setType('text').setDefault('hello').build()

    expect(parameter).to.deep.include({
      name: 'param',
      type: 'text',
      label: 'A parameter',
      required: false,
      default: 'hello'
    })
  })

  it('keeps a number default as a number', () => {
    // v4 required `default` to be a string, so v1 coerced everything with .toString().
    const parameter = base().setType('number').setDefault(42).build()

    expect(parameter.default).to.equal(42)
    expect(parameter.default).to.be.a('number')
  })

  it('keeps a boolean default as a boolean', () => {
    const parameter = base().setType('boolean').setDefault(false).build()

    expect(parameter.default).to.equal(false)
    expect(parameter.default).to.be.a('boolean')
  })

  it('emits select options as an array, not a JSON string', () => {
    // v4 encoded options as a stringified array; v5 stores them structurally.
    const parameter = base()
      .setType('select')
      .setDefault('a')
      .addOption({ a: 'Option A' })
      .addOption({ b: 'Option B' })
      .build()

    expect(parameter.options).to.deep.equal([
      { a: 'Option A' },
      { b: 'Option B' }
    ])
    expect(parameter.options).to.be.an('array')
  })

  it('records required', () => {
    expect(
      base().setType('text').setDefault('x').setRequired(true).build().required
    ).to.equal(true)
  })

  it('rejects options on a non-select parameter', () => {
    expect(() => base().setType('text').addOption({ a: 'A' })).to.throw(
      /only be added to a 'select' parameter/
    )
  })

  it('requires a select parameter to have at least one option', () => {
    expect(() => base().setType('select').setDefault('a').build()).to.throw(
      /at least one option/
    )
  })

  it('requires name, type and label', () => {
    expect(() =>
      new ConsumerParameterBuilder().setType('text').setDefault('x').build()
    ).to.throw(/name, type and label/)
  })

  it('requires a default value', () => {
    expect(() => base().setType('text').build()).to.throw(
      /default value is required/
    )
  })

  it('reset() clears the accumulated state', () => {
    const builder = base().setType('text').setDefault('x')
    builder.reset()

    expect(() => builder.build()).to.throw(/name, type and label/)
  })

  it('returns a copy, so the builder can be reused', () => {
    const builder = base().setType('text').setDefault('x')
    const first = builder.build()

    builder.setName('renamed')

    expect(first.name).to.equal('param')
  })
})
