import {
  ConsumerParameter,
  ConsumerParameterSelectOption,
  ConsumerParameterType
} from '../../../@types/Publish'

export class NautilusConsumerParameter implements ConsumerParameter {
  name: string
  type: ConsumerParameterType
  label: string
  required: boolean = false
  description: string
  default: string

  options?: ConsumerParameterSelectOption[]

  getConfig() {
    return {
      ...this,
      options: this.options ? JSON.stringify(this.options) : undefined
    }
  }
}
