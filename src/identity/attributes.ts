/**
 * Credential attribute requirements: the JSON Schema behind walt.id's per-credential `schema`
 * policy, built from simple `{ path, equals | oneOf | exists }` requirements, and a small
 * evaluator for that schema, so a consumer can be told before presenting that a credential
 * will be refused.
 *
 * What walt.id (90e568f) validates: `Verifier.runPolicyRequest` hands a
 * `CredentialDataValidatorPolicy` such as `schema` the content of the JWT's `vc` claim when
 * there is one (VCDM 1.1), else the whole payload (VCDM 2.0 `vc+jwt`). Both have
 * `credentialSubject` at the root of what is validated, so one schema shape serves both.
 * Its arguments must be a JSON object: a string or an array makes walt.id fail the policy for
 * every presentation.
 */
import { sanitize } from '../node/messages.js'

/** A value an attribute can be required to have. */
export type CredentialAttributeValue = string | number | boolean

/**
 * One attribute a credential must carry, by its path under `credentialSubject`, e.g.
 * `{ path: ['gx:legalAddress', 'gx:countryCode'], equals: 'DE' }`.
 *
 * At most one of `equals`, `oneOf` and `exists`. With none of them, the attribute must only
 * exist.
 */
export interface CredentialAttributeRequirement {
  /** The keys from `credentialSubject` down to the attribute. */
  path: string[]
  /** The attribute must be exactly this value. */
  equals?: CredentialAttributeValue
  /** The attribute must be one of these values. */
  oneOf?: CredentialAttributeValue[]
  /** The attribute must exist, with any value. */
  exists?: true
}

/** Which request credential `requireCredentialAttributes` and `trustIssuers` change. */
export interface CredentialRequirementOptions {
  /**
   * The request credential's format. Without it: the one request for that type already on
   * the list, or else a new `jwt_vc_json` one.
   */
  format?: string
}

/** The format a new request credential gets when none is given. */
export const DEFAULT_REQUEST_FORMAT = 'jwt_vc_json'

/** Path segments that would reach `Object.prototype` through a plain object. */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

const DID =
  /^did:[a-z0-9]+:(?:(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})*:)*(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})+$/

/** Longer DIDs are refused, so a list cannot be used to bloat the DDO. */
const MAX_DID_LENGTH = 2048

/** Whether `text` has the syntax of a DID (W3C DID Core: `did:<method>:<method-specific-id>`). */
export function isDid(text: unknown): text is string {
  return (
    typeof text === 'string' && text.length <= MAX_DID_LENGTH && DID.test(text)
  )
}

// #region building the schema

/** One node of the requirement tree: an object with children, or a leaf. */
interface RequirementNode {
  children?: Map<string, RequirementNode>
  /** For a leaf: the values allowed, or `undefined` for any. */
  values?: CredentialAttributeValue[]
}

/**
 * The JSON Schema for `requirements`, combined with AND: nested `required` and `properties`
 * from the root `credentialSubject`, with `const` (one value) or `enum` (several) at each
 * leaf, and `{}` for an attribute that must only exist. Throws a `TypeError` for an invalid
 * or contradictory requirement.
 *
 * The form matches the nautilus test harness's reviewed fixture, key order included.
 */
export function credentialAttributeSchema(
  requirements: CredentialAttributeRequirement[]
): Record<string, unknown> {
  if (!Array.isArray(requirements) || !requirements.length)
    throw new TypeError(
      'Credential attribute requirements must be a non-empty list of { path, equals | oneOf | exists }.'
    )

  const root: RequirementNode = { children: new Map() }
  for (const requirement of requirements) addRequirement(root, requirement)

  return {
    type: 'object',
    required: ['credentialSubject'],
    properties: { credentialSubject: nodeSchema(root) }
  }
}

function addRequirement(
  root: RequirementNode,
  requirement: CredentialAttributeRequirement
): void {
  const { path, equals, oneOf, exists } = (requirement ??
    {}) as Partial<CredentialAttributeRequirement>

  if (
    !Array.isArray(path) ||
    !path.length ||
    path.some((key) => typeof key !== 'string' || !key)
  )
    throw new TypeError(
      `A credential attribute requirement needs a path of non-empty keys under credentialSubject, e.g. ['gx:legalAddress', 'gx:countryCode'], not ${shownValue(path)}.`
    )

  const unsafe = path.find((key) => FORBIDDEN_SEGMENTS.has(key))
  if (unsafe)
    throw new TypeError(
      `The credential attribute path ${shownPath(path)} contains '${unsafe}', which is not allowed.`
    )

  const given = [equals, oneOf, exists].filter((value) => value !== undefined)
  if (given.length > 1)
    throw new TypeError(
      `The credential attribute requirement for ${shownPath(path)} sets more than one of equals, oneOf and exists.`
    )
  if (exists !== undefined && exists !== true)
    throw new TypeError(
      `The credential attribute requirement for ${shownPath(path)} has exists: ${shownValue(exists)}; it can only be true.`
    )
  if (equals !== undefined && !isAttributeValue(equals))
    throw new TypeError(
      `The credential attribute requirement for ${shownPath(path)} has equals: ${shownValue(equals)}; it must be a string, a finite number or a boolean.`
    )
  if (
    oneOf !== undefined &&
    (!Array.isArray(oneOf) || !oneOf.length || !oneOf.every(isAttributeValue))
  )
    throw new TypeError(
      `The credential attribute requirement for ${shownPath(path)} has oneOf: ${shownValue(oneOf)}; it must be a non-empty list of strings, finite numbers or booleans.`
    )

  const values =
    equals !== undefined ? [equals] : oneOf ? unique(oneOf) : undefined

  let node = root
  path.forEach((key, index) => {
    if (!node.children)
      throw new TypeError(
        `The credential attribute ${shownPath(path.slice(0, index))} is required to have a value and to hold ${shownPath([key])}.`
      )

    const last = index === path.length - 1
    let child = node.children.get(key)

    if (!child) {
      child = last ? {} : { children: new Map() }
      node.children.set(key, child)
    } else if (last && child.children)
      throw new TypeError(
        `The credential attribute ${shownPath(path)} holds other required attributes, so it cannot be required to have a value.`
      )
    else if (!last && !child.children) {
      if (child.values)
        throw new TypeError(
          `The credential attribute ${shownPath(path.slice(0, index + 1))} is required to have a value and to hold ${shownPath(path.slice(index + 1))}.`
        )
      child.children = new Map()
    }

    if (last && values) {
      const allowed = child.values
        ? child.values.filter((value) => values.includes(value))
        : values
      if (!allowed.length)
        throw new TypeError(
          `The credential attribute ${shownPath(path)} cannot be both ${shownValues(child.values ?? [])} and ${shownValues(values)}.`
        )
      child.values = allowed
    }

    node = child
  })
}

function nodeSchema(node: RequirementNode): Record<string, unknown> {
  if (node.children)
    return {
      type: 'object',
      required: [...node.children.keys()],
      properties: Object.fromEntries(
        [...node.children].map(([key, child]) => [key, nodeSchema(child)])
      )
    }

  if (!node.values) return {}
  return node.values.length === 1
    ? { const: node.values[0] }
    : { enum: node.values }
}

/**
 * Combines two attribute schemas with AND. Schemas in the form `credentialAttributeSchema`
 * writes are merged into one such schema; anything else becomes `{ allOf: [a, b] }`, which
 * walt.id evaluates the same way but the consumer's local check does not (it skips it).
 */
export function mergeAttributeSchemas(
  existing: Record<string, unknown>,
  added: Record<string, unknown>
): Record<string, unknown> {
  const before = schemaRequirements(existing)
  const after = schemaRequirements(added)

  return before && after
    ? credentialAttributeSchema([...before, ...after])
    : { allOf: [existing, added] }
}

/**
 * The requirements a schema in `credentialAttributeSchema`'s form was built from, or
 * `undefined` for any other schema.
 */
function schemaRequirements(
  schema: Record<string, unknown>
): CredentialAttributeRequirement[] | undefined {
  if (!hasOnlyKeys(schema, ['type', 'required', 'properties'])) return undefined
  if (
    schema.type !== 'object' ||
    !sameList(schema.required, ['credentialSubject']) ||
    !isPlainObject(schema.properties) ||
    !hasOnlyKeys(schema.properties, ['credentialSubject'])
  )
    return undefined

  const requirements: CredentialAttributeRequirement[] = []
  const walk = (node: unknown, path: string[]): boolean => {
    if (!isPlainObject(node)) return false

    if ('properties' in node) {
      if (!hasOnlyKeys(node, ['type', 'required', 'properties'])) return false
      const { properties } = node
      if (node.type !== 'object' || !isPlainObject(properties)) return false

      const keys = Object.keys(properties)
      if (!keys.length || !sameList(node.required, keys)) return false
      return keys.every((key) => walk(properties[key], [...path, key]))
    }

    if (!path.length) return false
    if (hasOnlyKeys(node, [])) requirements.push({ path, exists: true })
    else if (hasOnlyKeys(node, ['const']) && isAttributeValue(node.const))
      requirements.push({ path, equals: node.const })
    else if (
      hasOnlyKeys(node, ['enum']) &&
      Array.isArray(node.enum) &&
      node.enum.length &&
      node.enum.every(isAttributeValue)
    )
      requirements.push({ path, oneOf: node.enum })
    else return false

    return true
  }

  return walk(schema.properties.credentialSubject, [])
    ? requirements
    : undefined
}

// #endregion

// #region validating per-credential policies

/** walt.id's policy names (waltid-identity 90e568f, `PolicyManager`). */
export const KNOWN_SSI_POLICIES: ReadonlySet<string> = new Set([
  'signature',
  'signature_sd-jwt-vc',
  'schema',
  'expired',
  'not-before',
  'webhook',
  'minimum-credentials',
  'maximum-credentials',
  'holder-binding',
  'allowed-issuer',
  'revoked-status-list',
  'presentation-definition',
  'dynamic',
  'credential-status',
  'vp_required_credentials'
])

/**
 * What is wrong with a per-credential policy's arguments, and what it does, for the policies
 * walt.id cannot run as meant without valid ones, or `undefined` when they are fine:
 *
 * - `schema`: a JSON Schema object (a string or an array fails every presentation);
 * - `allowed-issuer`: a non-empty list of DIDs, or one DID (anything else fails every
 *   presentation, or never matches an issuer).
 */
export function credentialPolicyProblem(
  name: string,
  args: unknown
): string | undefined {
  if (name === 'schema' && !isPlainObject(args))
    return args === undefined
      ? 'has no arguments, so walt.id fails it for every presentation; it needs a JSON Schema object'
      : `has arguments that are ${Array.isArray(args) ? 'an array' : `a ${args === null ? 'null' : typeof args}`}, not a JSON Schema object, so walt.id fails it for every presentation`

  if (name === 'allowed-issuer') {
    if (args === undefined)
      return 'has no arguments, so walt.id fails it for every presentation; it needs a list of issuer DIDs'
    const issuers = Array.isArray(args) ? args : [args]
    if (!issuers.length)
      return 'has an empty issuer list, so no issuer is trusted and every consumer is refused'
    const bad = issuers.find((issuer) => !isDid(issuer))
    if (bad !== undefined)
      return `lists ${shownValue(bad)}, which is not a DID, so no credential's issuer can match it`
  }

  return undefined
}

// #endregion

// #region evaluating the schema locally

/** The outcome of checking a credential against an attribute schema locally. */
export type AttributeSchemaVerdict =
  | { outcome: 'pass' }
  | {
      outcome: 'fail'
      /** Where it failed, from the root of the validated object. */
      path: string[]
      /** `missing`: a required attribute is absent; `mismatch`: another value; `type`: another JSON type. */
      kind: 'missing' | 'mismatch' | 'type'
      /** What the schema wanted there: the values (`const`/`enum`) or the type. */
      expected?: unknown[]
    }
  | {
      /** The schema uses a keyword outside the subset, which the local check does not judge. */
      outcome: 'unsupported'
      keyword: string
    }

/** The keywords the local check evaluates. */
const EVALUATED_KEYWORDS = new Set([
  'type',
  'required',
  'properties',
  'const',
  'enum'
])

/** Keywords that never change a validation result. */
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'examples',
  'default'
])

const JSON_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null'
])

/** Deeper schemas are not judged locally. */
const MAX_SCHEMA_DEPTH = 32

/**
 * Checks `data` against `schema` with a small subset of JSON Schema: `type`, `required`,
 * `properties`, `const`, `enum`, and boolean schemas. A schema using any other keyword,
 * anywhere, is `unsupported`: the caller presents and lets the verifier decide.
 */
export function evaluateAttributeSchema(
  schema: unknown,
  data: unknown
): AttributeSchemaVerdict {
  const keyword = unsupportedKeyword(schema, 0)
  if (keyword !== undefined) return { outcome: 'unsupported', keyword }

  return evaluate(schema as Schema, data, []) ?? { outcome: 'pass' }
}

type Schema = boolean | Record<string, unknown>

function unsupportedKeyword(
  schema: unknown,
  depth: number
): string | undefined {
  if (typeof schema === 'boolean') return undefined
  if (!isPlainObject(schema)) return '(not a schema)'
  if (depth > MAX_SCHEMA_DEPTH) return '(nesting depth)'

  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue
    if (!EVALUATED_KEYWORDS.has(key)) return key

    if (
      key === 'type' &&
      !(Array.isArray(value) ? value : [value]).every(
        (type) => typeof type === 'string' && JSON_TYPES.has(type)
      )
    )
      return 'type'
    if (
      key === 'required' &&
      !(Array.isArray(value) && value.every((name) => typeof name === 'string'))
    )
      return 'required'
    if (key === 'enum' && !Array.isArray(value)) return 'enum'
    if (key === 'properties') {
      if (!isPlainObject(value)) return 'properties'
      for (const child of Object.values(value)) {
        const found = unsupportedKeyword(child, depth + 1)
        if (found !== undefined) return found
      }
    }
  }

  return undefined
}

/** The first failure, or `undefined` if `data` passes. */
function evaluate(
  schema: Schema,
  data: unknown,
  path: string[]
): Extract<AttributeSchemaVerdict, { outcome: 'fail' }> | undefined {
  if (schema === true) return undefined
  if (schema === false) return { outcome: 'fail', path, kind: 'mismatch' }

  if (schema.type !== undefined) {
    const types = (
      Array.isArray(schema.type) ? schema.type : [schema.type]
    ) as string[]
    if (!types.some((type) => hasJsonType(data, type)))
      return { outcome: 'fail', path, kind: 'type', expected: types }
  }

  if ('const' in schema && !jsonEqual(schema.const, data))
    return { outcome: 'fail', path, kind: 'mismatch', expected: [schema.const] }

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((value) => jsonEqual(value, data))
  )
    return { outcome: 'fail', path, kind: 'mismatch', expected: schema.enum }

  if (!isPlainObject(data)) return undefined

  for (const key of (schema.required ?? []) as string[])
    if (!Object.hasOwn(data, key))
      return { outcome: 'fail', path: [...path, key], kind: 'missing' }

  const properties = (schema.properties ?? {}) as Record<string, Schema>
  for (const key of Object.keys(properties)) {
    if (!Object.hasOwn(data, key)) continue
    const failure = evaluate(properties[key], data[key], [...path, key])
    if (failure) return failure
  }

  return undefined
}

function hasJsonType(data: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(data)
    case 'array':
      return Array.isArray(data)
    case 'string':
      return typeof data === 'string'
    case 'number':
      return typeof data === 'number' && Number.isFinite(data)
    case 'integer':
      return Number.isInteger(data)
    case 'boolean':
      return typeof data === 'boolean'
    case 'null':
      return data === null
    default:
      return false
  }
}

/** Equality of JSON values: deep, with object keys in any order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => jsonEqual(value, b[index]))
    )
  if (!isPlainObject(a) || !isPlainObject(b)) return false

  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  )
}

// #endregion

function isAttributeValue(value: unknown): value is CredentialAttributeValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

export function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function hasOnlyKeys(object: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(object).every((key) => keys.includes(key))
}

function sameList(raw: unknown, expected: string[]): boolean {
  return (
    Array.isArray(raw) &&
    raw.length === expected.length &&
    raw.every((value, index) => value === expected[index])
  )
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

/** A caller- or publisher-supplied path, made safe to quote. */
export function shownPath(path: unknown[]): string {
  return sanitize(path.map(String).join('.'), 200, null)
}

function shownValues(values: unknown[]): string {
  return values.map(shownValue).join(' or ')
}

function shownValue(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return sanitize(text, 100, null)
}
