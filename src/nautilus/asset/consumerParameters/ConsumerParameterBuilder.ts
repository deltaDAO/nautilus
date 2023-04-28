import { LoggerInstance } from '@oceanprotocol/lib'
import { IBuilder } from '../../../@types/Nautilus'
import {
  ConsumerParameterSelectOption,
  ConsumerParameterType
} from '../../../@types/Publish'
import { NautilusConsumerParameter } from './NautilusConsumerParameter'

export class ConsumerParameterBuilder
  implements IBuilder<NautilusConsumerParameter>
{
  private consumerParameter = new NautilusConsumerParameter()

  reset() {
    this.consumerParameter = new NautilusConsumerParameter()
  }

  setType(type: ConsumerParameterType) {
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

  setDefault(value: string) {
    this.consumerParameter.default = value

    return this
  }

  addOption(option: ConsumerParameterSelectOption) {
    if (this.consumerParameter.type !== 'select') {
      throw new Error(
        "[ConsumerParameterBuilder] Options can only be added for 'selet' type parameters."
      )
    }
    if (!this.consumerParameter.options) this.consumerParameter.options = []

    this.consumerParameter.options.push(option)

    return this
  }

  build() {
    return this.consumerParameter
  }
}
