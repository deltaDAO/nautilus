import type {
  ConsumerParameterOption,
  ConsumerParameterV5
} from '../../../ddo/types.js'

/**
 * A consumer parameter under construction.
 *
 * @internal
 *
 * Two v1 workarounds are gone here, because DDO v5 fixed what forced them:
 *
 *   - `options` is now an array. v4 encoded it as a JSON string, so v1 carried a private
 *     `_options` array and a getter that stringified it.
 *   - `default` now keeps its type. v4 required a string, so v1 coerced everything with
 *     `.toString()` and a `false` default became `"false"`.
 */
export class NautilusConsumerParameter implements ConsumerParameterV5 {
  name!: string
  type!: string
  label!: string
  required = false
  description = ''
  default!: string | number | boolean
  options?: ConsumerParameterOption[]
}
