import type { ConsumerParameter } from '@oceanprotocol/lib'
import type { IBuilder } from '../../../@types/Nautilus'
import type { ConsumerParameterSelectOption } from '../../../@types/Publish'
import { NautilusConsumerParameter } from './NautilusConsumerParameter'

export class ConsumerParameterBuilder implements IBuilder<ConsumerParameter> {
  private consumerParameter = new NautilusConsumerParameter()

  reset() {
    this.consumerParameter = new NautilusConsumerParameter()
  }

  setType(type: ConsumerParameter['type']) {
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

  setDefault(value: string | number | boolean) {
    this.consumerParameter.default = value.toString()

    return this
  }

  addOption(option: ConsumerParameterSelectOption) {
    if (this.consumerParameter.type !== 'select') {
      throw new Error(
        "[ConsumerParameterBuilder] Options can only be added for 'selet' type parameters."
      )
    }

    this.consumerParameter._options.push(option)

    return this
  }

  build() {
    const { _options, ...parameter } = this.consumerParameter

    return this.consumerParameter.options
      ? { ...parameter, options: this.consumerParameter.options }
      : parameter
  }
}
