/**
 * Consumer-parameter values checked against what the asset declares, before anything is
 * sent.
 *
 * The node forwards these values as they are: a download appends every `userdata` key to
 * the file's URL as a query parameter, and a compute job hands `userdata` and
 * `algocustomdata` to the algorithm. A value of the wrong type or a misspelt key would only
 * surface at the publisher's endpoint or inside the job, after the order was paid for.
 *
 * Rules, per declared parameter:
 *
 *   - `required` and absent (`undefined` or `null`): refused. An absent optional parameter
 *     is left absent; its `default` is not filled in.
 *   - `text`: a string. `number`: a finite number (not a numeric string). `boolean`:
 *     `true` or `false`. `select`: a string that is one of the option keys.
 *   - Any other declared type is only checked for presence.
 *
 * Keys the asset does not declare are refused when it declares at least one parameter, so a
 * typo does not reach the endpoint unnoticed. An asset that declares none takes the values
 * as they are: there is nothing to check them against.
 */
import { getMetadata } from '../ddo/read.js'
import type { ConsumerParameterV5 } from '../ddo/types.js'

/** Why a consumer-parameter value was refused. */
export type ConsumerParameterRefusal =
  /** The values are not a plain object. */
  | 'not-object'
  /** A required parameter has no value. */
  | 'missing'
  /** The value does not have the declared type. */
  | 'wrong-type'
  /** A `select` value is not one of its options. */
  | 'not-an-option'
  /** The key is not a declared parameter. */
  | 'unknown'

/** One refused value. */
export interface ConsumerParameterIssue {
  /** The parameter, or the undeclared key. Empty for `'not-object'`. */
  parameter: string
  reason: ConsumerParameterRefusal
  message: string
}

/** Where the values were going: the input field, and the asset and service it belongs to. */
export interface ConsumerParameterTarget {
  did: string
  serviceId: string
  field: 'userdata' | 'algocustomdata'
}

/**
 * Thrown when `userdata` or `algocustomdata` does not fit the consumer parameters the asset
 * declares, before the node is asked for a fee and before any transaction.
 */
export class ConsumerParameterError extends Error {
  readonly did: string
  readonly serviceId: string
  readonly field: ConsumerParameterTarget['field']
  /** Every refused value, in declaration order, then the undeclared keys. */
  readonly issues: ConsumerParameterIssue[]

  constructor(
    target: ConsumerParameterTarget,
    issues: ConsumerParameterIssue[]
  ) {
    super(
      `Refusing ${target.field} for service ${target.serviceId} of ${target.did}: ${issues
        .map((issue) => issue.message)
        .join(
          '; '
        )}. Nothing was sent: consumer parameters are checked before the node is asked for a fee or any order is placed.`
    )
    this.name = 'ConsumerParameterError'
    this.did = target.did
    this.serviceId = target.serviceId
    this.field = target.field
    this.issues = issues
  }
}

/**
 * Checks `values` against the declared consumer parameters and returns every problem, or
 * an empty array when they fit. Useful to validate a form before calling `access()` or
 * `compute()`, which run the same check and throw a `ConsumerParameterError`.
 */
export function checkConsumerParameters(
  declared: readonly ConsumerParameterV5[] | undefined,
  values: unknown
): ConsumerParameterIssue[] {
  const parameters = (Array.isArray(declared) ? declared : []).filter(
    (parameter): parameter is ConsumerParameterV5 =>
      typeof parameter?.name === 'string' && parameter.name !== ''
  )

  if (values !== undefined && values !== null && !isPlainObject(values))
    return [
      {
        parameter: '',
        reason: 'not-object',
        message: `expected an object of parameter values, got ${describe(values)}`
      }
    ]

  const given = (values ?? {}) as Record<string, unknown>
  const issues: ConsumerParameterIssue[] = []

  for (const parameter of parameters) {
    const value = Object.hasOwn(given, parameter.name)
      ? given[parameter.name]
      : undefined

    if (value === undefined || value === null) {
      if (parameter.required === true)
        issues.push({
          parameter: parameter.name,
          reason: 'missing',
          message: `'${parameter.name}' is required`
        })
      continue
    }

    const issue = checkValue(parameter, value)
    if (issue) issues.push(issue)
  }

  if (parameters.length) {
    const names = parameters.map((parameter) => parameter.name)

    for (const key of Object.keys(given))
      if (!names.includes(key))
        issues.push({
          parameter: key,
          reason: 'unknown',
          message: `'${key}' is not a declared parameter (declared: ${quoteAll(names)})`
        })
  }

  return issues
}

/** Throws a `ConsumerParameterError` listing every problem `checkConsumerParameters` finds. */
export function assertConsumerParameters(
  declared: readonly ConsumerParameterV5[] | undefined,
  values: unknown,
  target: ConsumerParameterTarget
): void {
  const issues = checkConsumerParameters(declared, values)

  if (issues.length) throw new ConsumerParameterError(target, issues)
}

/**
 * The parameters an algorithm declares for `algocustomdata`: `algorithm.consumerParameters`,
 * else the nested `algorithm.container.consumerParameters` some DDOs carry.
 */
export function getAlgorithmConsumerParameters(
  ddo: unknown
): ConsumerParameterV5[] | undefined {
  const algorithm = getMetadata(ddo)?.algorithm as
    | {
        consumerParameters?: ConsumerParameterV5[]
        container?: { consumerParameters?: ConsumerParameterV5[] }
      }
    | undefined

  return (
    algorithm?.consumerParameters ?? algorithm?.container?.consumerParameters
  )
}

function checkValue(
  parameter: ConsumerParameterV5,
  value: unknown
): ConsumerParameterIssue | undefined {
  const { name, type } = parameter
  const wrongType = (expected: string): ConsumerParameterIssue => ({
    parameter: name,
    reason: 'wrong-type',
    message: `'${name}' must be ${expected}, got ${describe(value)}`
  })

  switch (type) {
    case 'text':
      return typeof value === 'string' ? undefined : wrongType('a string')
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : wrongType('a finite number')
    case 'boolean':
      return typeof value === 'boolean' ? undefined : wrongType('a boolean')
    case 'select': {
      const options = optionKeys(parameter.options)

      if (typeof value !== 'string')
        return wrongType(
          options.length ? `one of ${quoteAll(options)}` : 'a string'
        )

      if (options.length && !options.includes(value))
        return {
          parameter: name,
          reason: 'not-an-option',
          message: `'${name}' must be one of ${quoteAll(options)}, got ${describe(value)}`
        }

      return undefined
    }
    default:
      return undefined
  }
}

/** The keys of a `select` parameter's options; v4 DDOs stored them as a JSON string. */
function optionKeys(options: unknown): string[] {
  let list = options

  if (typeof list === 'string')
    try {
      list = JSON.parse(list)
    } catch {
      return []
    }

  return Array.isArray(list)
    ? list.flatMap((option) =>
        isPlainObject(option) ? Object.keys(option) : []
      )
    : []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function quoteAll(names: string[]): string {
  return names.map((name) => `'${name}'`).join(', ')
}

function describe(value: unknown): string {
  if (typeof value === 'string')
    return `the string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${typeof value} ${String(value)}`
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'

  return `a value of type ${typeof value}`
}
