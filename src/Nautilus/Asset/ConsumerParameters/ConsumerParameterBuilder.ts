import type { IBuilder } from '../../../@types/Nautilus.js'
import type {
  ConsumerParameterOption,
  ConsumerParameterV5
} from '../../../ddo/types.js'
import { NautilusConsumerParameter } from './NautilusConsumerParameter.js'

/** Parameter types the node understands. */
export type ConsumerParameterType = 'text' | 'number' | 'boolean' | 'select'

export class ConsumerParameterBuilder implements IBuilder<ConsumerParameterV5> {
  private consumerParameter = new NautilusConsumerParameter()

  reset() {
    this.consumerParameter = new NautilusConsumerParameter()
  }

  setType(type: ConsumerParameterType | string) {
    this.consumerParameter.type = type
    return this
  }

  setName(name: string) {
    this.consumerParameter.name = name
    return this
  }

  setDescription(description: string) {
    this.consumerParameter.description = description
    return this
  }

  setLabel(label: string) {
    this.consumerParameter.label = label
    return this
  }

  setRequired(required: boolean) {
    this.consumerParameter.required = required
    return this
  }

  /** The value keeps its type — v5 accepts `string | number | boolean`. */
  setDefault(value: string | number | boolean) {
    this.consumerParameter.default = value
    return this
  }

  /** Only meaningful for `select` parameters. */
  addOption(option: ConsumerParameterOption) {
    if (this.consumerParameter.type !== 'select')
      throw new Error(
        "[ConsumerParameterBuilder] Options can only be added to a 'select' parameter."
      )

    this.consumerParameter.options = [
      ...(this.consumerParameter.options || []),
      option
    ]

    return this
  }

  build(): ConsumerParameterV5 {
    const { name, type, label, default: defaultValue } = this.consumerParameter

    if (!name || !type || !label)
      throw new Error(
        '[ConsumerParameterBuilder] name, type and label are all required.'
      )

    if (defaultValue === undefined)
      throw new Error('[ConsumerParameterBuilder] a default value is required.')

    if (type === 'select' && !this.consumerParameter.options?.length)
      throw new Error(
        "[ConsumerParameterBuilder] a 'select' parameter needs at least one option."
      )

    return { ...this.consumerParameter }
  }
}
