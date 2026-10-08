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
 *     `true` or `false`. `select`: a string that is one of the option keys. A `select`
 *     without a single usable option is a broken declaration, and any value for it is
 *     refused.
 *   - Any other declared type: a string, a finite number or a boolean. An object or an
 *     array would reach a download URL as `[object Object]`.
 *
 * Keys the asset does not declare are refused when it declares at least one parameter, so a
 * typo does not reach the endpoint unnoticed. An asset that declares none takes any keys,
 * each with a string, a finite number or a boolean.
 *
 * Messages never repeat a value, only its type and length, so a secret typed into the wrong
 * field does not end up in a log. Parameter names and option keys are the publisher's text:
 * they are shown without control characters, cut to a bounded length, and lists of them are
 * capped.
 *
 * What is forwarded is the values without their absent entries: a key set to `undefined`
 * or `null` is dropped, so it never reaches the node as `null` (or as `?key=null` in a
 * download URL).
 */
import { getMetadata } from '../ddo/read.js'
import type { ConsumerParameterV5 } from '../ddo/types.js'

/** Longest parameter name or option key a message shows. */
const MAX_NAME_LENGTH = 40
/** Longest DID or service id a message shows: a hash-based one is 64 to 72 characters. */
const MAX_ID_LENGTH = 100
/** Most names, options or issues a message lists. */
const MAX_LISTED = 10

/** What a value of any other type has to be: it may end up in a URL. */
const SCALAR = 'a string, a finite number or a boolean'

/** Why a consumer-parameter value was refused. */
export type ConsumerParameterRefusal =
  /** The values are not a plain object. */
  | 'not-object'
  /** A required parameter has no value. */
  | 'missing'
  /**
   * The value does not have the declared type, or, for a parameter of another type or a key
   * of an asset that declares none, is not a string, a finite number or a boolean.
   */
  | 'wrong-type'
  /** A `select` value is not one of its options. */
  | 'not-an-option'
  /**
   * The asset's own declaration cannot be satisfied: a `select` whose options are missing,
   * empty or malformed, so no value can be checked against them.
   */
  | 'invalid-declaration'
  /** The key is not a declared parameter. */
  | 'unknown'

/** One refused value. */
export interface ConsumerParameterIssue {
  /** The parameter, or the undeclared key, as given. Empty for `'not-object'`. */
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
    const listed = issues.slice(0, MAX_LISTED).map((issue) => issue.message)
    if (issues.length > MAX_LISTED)
      listed.push(`${issues.length - MAX_LISTED} more in error.issues`)

    super(
      `Refusing ${target.field} for service ${clean(target.serviceId, MAX_ID_LENGTH)} of ${clean(target.did, MAX_ID_LENGTH)}: ${listed.join(
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
          message: `${quote(parameter.name)} is required`
        })
      continue
    }

    const issue = checkValue(parameter, value)
    if (issue) issues.push(issue)
  }

  const names = parameters.map((parameter) => parameter.name)
  const declaredNames = new Set(names)

  for (const [key, value] of Object.entries(given)) {
    if (declaredNames.has(key)) continue

    if (names.length)
      issues.push({
        parameter: key,
        reason: 'unknown',
        message: `${quote(key)} is not a declared parameter (declared: ${quoteAll(names)})`
      })
    else if (value !== undefined && value !== null && !isScalar(value))
      issues.push(wrongTypeIssue(key, value, SCALAR))
  }

  return issues
}

/**
 * Throws a `ConsumerParameterError` listing every problem `checkConsumerParameters` finds.
 * Otherwise returns the values to forward: a copy without the keys set to `undefined` or
 * `null`, or `undefined` when no values were given.
 */
export function assertConsumerParameters(
  declared: readonly ConsumerParameterV5[] | undefined,
  values: unknown,
  target: ConsumerParameterTarget
): Record<string, unknown> | undefined {
  const issues = checkConsumerParameters(declared, values)

  if (issues.length) throw new ConsumerParameterError(target, issues)
  if (values === undefined || values === null) return undefined

  return Object.fromEntries(
    Object.entries(values as Record<string, unknown>).filter(
      ([, value]) => value !== undefined && value !== null
    )
  )
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
  const wrongType = (expected: string) => wrongTypeIssue(name, value, expected)

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

      // Without options there is nothing a value could be one of: the declaration is
      // broken, and taking any string would forward whatever was typed.
      if (!options.length)
        return {
          parameter: name,
          reason: 'invalid-declaration',
          message: `${quote(name)} is declared as a select without any usable options, so no value can be accepted until the asset's declaration is fixed`
        }

      if (typeof value !== 'string')
        return wrongType(`one of ${quoteAll(options)}`)

      if (!options.includes(value))
        return {
          parameter: name,
          reason: 'not-an-option',
          message: `${quote(name)} must be one of ${quoteAll(options)}, got ${describe(value)}`
        }

      return undefined
    }
    default:
      return isScalar(value) ? undefined : wrongType(SCALAR)
  }
}

function wrongTypeIssue(
  parameter: string,
  value: unknown,
  expected: string
): ConsumerParameterIssue {
  return {
    parameter,
    reason: 'wrong-type',
    message: `${quote(parameter)} must be ${expected}, got ${describe(value)}`
  }
}

/** What every parameter value has to be, whatever its type: it may end up in a URL. */
function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
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

/** An object literal (or `Object.create(null)`): not an array, `Date`, `Map` or class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Publisher or caller text made safe for a message: without control or format characters
 * (line breaks, ANSI escapes, bidirectional overrides), and cut to `max` characters.
 */
function clean(text: string, max: number): string {
  const stripped = text.replace(/[\p{Cc}\p{Cf}]/gu, '')
  if (stripped.length <= max) return stripped

  // Do not leave half of a surrogate pair at the cut.
  return `${stripped.slice(0, max).replace(/[\uD800-\uDBFF]$/, '')}…`
}

function quote(name: string): string {
  return `'${clean(name, MAX_NAME_LENGTH)}'`
}

function quoteAll(names: readonly string[]): string {
  const listed = names.slice(0, MAX_LISTED).map(quote)
  if (names.length > MAX_LISTED)
    listed.push(`and ${names.length - MAX_LISTED} more`)

  return listed.join(', ')
}

/** The type of a refused value, and a string's length: never the value itself. */
function describe(value: unknown): string {
  if (typeof value === 'string')
    return `a string of ${value.length} character${value.length === 1 ? '' : 's'}`
  if (typeof value === 'number')
    return Number.isFinite(value) ? 'a number' : 'a non-finite number'
  if (typeof value === 'boolean') return 'a boolean'
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  if (typeof value === 'object') {
    const name = Object.getPrototypeOf(value)?.constructor?.name
    return typeof name === 'string' && name !== '' && name !== 'Object'
      ? `an instance of ${clean(name, MAX_NAME_LENGTH)}`
      : 'an object'
  }

  return `a value of type ${typeof value}`
}
