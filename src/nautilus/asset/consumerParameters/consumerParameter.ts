export type ConsumerParameterType = 'text' | 'number' | 'boolean' | 'select'

export type ConsumerParameterSelectOption = {
  [value: string]: string
}

export class NautilusConsumerParameter<T extends ConsumerParameterType> {
  name: string
  type: T
  label: string
  required: boolean = false
  description: string
  default: T extends 'number'
    ? number
    : T extends 'boolean'
    ? boolean
    : T extends 'select'
    ? ConsumerParameterSelectOption[]
    : string

  options?: ConsumerParameterSelectOption[]
}
