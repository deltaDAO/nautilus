import { IBuilder } from '../../../@types/Nautilus'
import {
  ConsumerParameterSelectOption,
  ConsumerParameterType,
  NautilusConsumerParameter
} from './consumerParameter'

export class ConsumerParameterBuilder<T extends ConsumerParameterType>
  implements IBuilder<NautilusConsumerParameter<T>>
{
  private consumerParameter = new NautilusConsumerParameter<T>()

  constructor(type: T) {
    this.consumerParameter.type = type

    if (type === 'select') this.consumerParameter.options = []
  }

  reset() {
    this.consumerParameter = new NautilusConsumerParameter<T>()
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

  setDefault(value: NautilusConsumerParameter<T>['default']) {
    this.consumerParameter.default = value

    return this
  }

  addOption(option: ConsumerParameterSelectOption) {
    if (this.consumerParameter.type !== 'select') return this
    this.consumerParameter.options.push(option)

    return this
  }

  build() {
    return this.consumerParameter
  }
}
