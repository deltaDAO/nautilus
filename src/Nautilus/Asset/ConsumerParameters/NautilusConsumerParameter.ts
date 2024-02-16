import { ConsumerParameter } from '@oceanprotocol/lib'
import { ConsumerParameterSelectOption } from '../../../@types/Publish'

/**
 * @internal
 */
export class NautilusConsumerParameter implements ConsumerParameter {
  name: string
  type: ConsumerParameter['type']
  label: string
  required: boolean = false
  description: string
  default: string
  _options?: ConsumerParameterSelectOption[] = []

  get options(): string {
    return this._options.length > 0 ? JSON.stringify(this._options) : undefined
  }
}
