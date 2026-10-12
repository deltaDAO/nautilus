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
import type { DebugTopic } from '../log/debug.js'
import { sanitize, stripControlCharacters } from '../node/messages.js'

/** A value an attribute can be required to have. */
export type CredentialAttributeValue = string | number | boolean

/**
 * One attribute a credential must carry, by its path under `credentialSubject`, e.g.
 * `{ path: ['gx:legalAddress', 'gx:countryCode'], equals: 'DE' }`.
 *
 * Exactly one of `equals`, `oneOf` and `exists: true`. A key that is present with the value
 * `undefined` (an unset variable, a missing config field) throws instead of weakening the
 * requirement.
 */
export interface CredentialAttributeRequirement {
  /** The keys from `credentialSubject` down to the attribute. */
  path: string[]
  /** The attribute must be exactly this value. */
  equals?: CredentialAttributeValue
  /** The attribute must be one of these values. */
  oneOf?: CredentialAttributeValue[]
  /** The attribute must be present, with any value (`null` included, as walt.id reads it). */
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

/**
 * Request formats walt.id 90e568f opens a session for (`VerifierService.getPresentationFormat`).
 * Every request credential of a session must have one, the same one: a missing, mixed or
 * other format makes it refuse the session, and so every consumer.
 */
export const REQUEST_FORMATS: ReadonlySet<string> = new Set([
  'jwt_vc_json',
  'jwt_vc',
  'jwt',
  'ldp_vc',
  'ldp',
  'mso_mdoc',
  'vc+sd-jwt'
])

/**
 * Types every credential carries. walt.id files a presented credential under the **last**
 * entry of its `type` (`Verifier.getW3CType`), so a credential with a more specific type is
 * never filed under these, and per-credential policies requested for them never run on it.
 * A wallet still presents it, since the request matches any `type` entry.
 */
export const GENERIC_CREDENTIAL_TYPES: ReadonlySet<string> = new Set([
  'VerifiableCredential',
  'VerifiablePresentation'
])

/** The `TypeError` message for per-credential policies on a generic type, or `undefined`. */
export function genericTypeProblem(type: unknown): string | undefined {
  if (typeof type !== 'string' || !GENERIC_CREDENTIAL_TYPES.has(type))
    return undefined
  return `Per-credential policies on '${type}' check nothing: walt.id files a presented credential under the last entry of its type (e.g. 'gx:LegalPerson' for ['VerifiableCredential', 'gx:LegalPerson']), so they never run on a credential with a more specific type, which every wallet still presents for this request. Request the credential's own type, the last entry of its type list.`
}

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
 * leaf, and `{}` for `exists: true`. Throws a `TypeError` for an invalid
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
  const fields = (requirement ?? {}) as Partial<CredentialAttributeRequirement>
  const { path, equals, oneOf, exists } = fields

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

  // An unset variable must not turn a value check into an existence check.
  for (const key of ['equals', 'oneOf', 'exists'] as const)
    if (Object.hasOwn(fields, key) && fields[key] === undefined)
      throw new TypeError(
        `The credential attribute requirement for ${shownPath(path)} has ${key}: undefined (an unset variable?). Pass a value, or leave the key out.`
      )

  const given = [equals, oneOf, exists].filter((value) => value !== undefined)
  if (given.length > 1)
    throw new TypeError(
      `The credential attribute requirement for ${shownPath(path)} sets more than one of equals, oneOf and exists.`
    )
  if (!given.length)
    throw new TypeError(
      `The credential attribute requirement for ${shownPath(path)} sets none of equals, oneOf and exists. Pass exists: true to require only that it is present.`
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
 * What is wrong with a per-credential policy's arguments as the builders take them, or
 * `undefined` when they are fine:
 *
 * - `schema`: a JSON Schema object (a string or an array fails every presentation);
 * - `allowed-issuer`: a non-empty list of DIDs, or one DID. walt.id compares a credential's
 *   `iss` with each entry as written, so a non-DID entry matches only an issuer that writes
 *   exactly that; the builders take DIDs only. A stored asset is linted more leniently.
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
      return `lists ${shownValue(bad)}, which is not a DID (the builders take issuer DIDs only)`
  }

  return undefined
}

/**
 * The JSON Schema dialects walt.id's validator (optimumcode json-schema-validator 0.5.5)
 * supports, by `$schema` (scheme and trailing `#` ignored). Without `$schema` it validates as
 * 2020-12, the library's default, although walt.id's policy description says draft 7.
 */
type SchemaDialect =
  | 'draft-04'
  | 'draft-06'
  | 'draft-07'
  | '2019-09'
  | '2020-12'
const SCHEMA_DIALECTS: Record<string, SchemaDialect> = {
  'json-schema.org/draft-04/schema': 'draft-04',
  'json-schema.org/draft-06/schema': 'draft-06',
  'json-schema.org/draft-07/schema': 'draft-07',
  'json-schema.org/draft/2019-09/schema': '2019-09',
  'json-schema.org/draft/2020-12/schema': '2020-12'
}
const DEFAULT_SCHEMA_DIALECT: SchemaDialect = '2020-12'

const DRAFT4_KEYWORDS = [
  '$schema',
  'id',
  '$ref',
  'title',
  'description',
  'default',
  'definitions',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'additionalItems',
  'items',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxProperties',
  'minProperties',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'dependencies',
  'enum',
  'type',
  'format',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  // Not in draft 4 itself, but walt.id's validator applies them there too.
  'const',
  'contains',
  'propertyNames'
]
const DRAFT6_KEYWORDS = [
  ...DRAFT4_KEYWORDS.filter((key) => key !== 'id'),
  '$id',
  'examples'
]
const DRAFT7_KEYWORDS = [
  ...DRAFT6_KEYWORDS,
  '$comment',
  'if',
  'then',
  'else',
  'readOnly',
  'writeOnly',
  'contentMediaType',
  'contentEncoding'
]
// `definitions` stays: 2019-09 and later resolve a `$ref` into it like any JSON pointer.
const DRAFT2019_KEYWORDS = [
  ...DRAFT7_KEYWORDS.filter((key) => key !== 'dependencies'),
  '$anchor',
  '$vocabulary',
  '$defs',
  '$recursiveRef',
  '$recursiveAnchor',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedProperties',
  'unevaluatedItems',
  'maxContains',
  'minContains',
  'deprecated',
  'contentSchema'
]
const DRAFT2020_KEYWORDS = [
  ...DRAFT2019_KEYWORDS.filter(
    (key) =>
      key !== 'additionalItems' &&
      key !== '$recursiveRef' &&
      key !== '$recursiveAnchor'
  ),
  'prefixItems',
  '$dynamicRef',
  '$dynamicAnchor'
]
/** Each dialect's keywords: walt.id's validator ignores any other key. */
const DIALECT_KEYWORDS: Record<SchemaDialect, Set<string>> = {
  'draft-04': new Set(DRAFT4_KEYWORDS),
  'draft-06': new Set(DRAFT6_KEYWORDS),
  'draft-07': new Set(DRAFT7_KEYWORDS),
  '2019-09': new Set(DRAFT2019_KEYWORDS),
  '2020-12': new Set(DRAFT2020_KEYWORDS)
}

/** Keywords that hold subschemas, or nothing to check, rather than a check of their own. */
const NON_CONSTRAINING_KEYWORDS = new Set([
  '$schema',
  'id',
  '$id',
  '$comment',
  '$anchor',
  '$vocabulary',
  '$recursiveAnchor',
  '$dynamicAnchor',
  'title',
  'description',
  'default',
  'readOnly',
  'writeOnly',
  'deprecated',
  'examples',
  'definitions',
  '$defs',
  'contentMediaType',
  'contentEncoding',
  'contentSchema',
  'properties',
  'patternProperties',
  'additionalProperties',
  'unevaluatedProperties',
  'additionalItems',
  'unevaluatedItems',
  'items',
  'prefixItems',
  'dependencies',
  'dependentSchemas',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'allOf',
  'anyOf',
  'oneOf'
])

/** Keys next to a `$ref` that warn nothing when draft 4-7 ignore them: they check nothing. */
const REF_SIBLINGS_KEPT = new Set([
  '$ref',
  '$schema',
  'id',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'definitions',
  'readOnly',
  'writeOnly'
])

/** Keywords whose value is an object of subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = [
  'patternProperties',
  'definitions',
  '$defs',
  'dependencies',
  'dependentSchemas'
]
/** Keywords whose value is one subschema. */
const SUBSCHEMA_KEYWORDS = [
  'additionalProperties',
  'unevaluatedProperties',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'not'
]
/** Keywords whose value is a list of subschemas (or, for `items` before 2020-12, either). */
const SUBSCHEMA_LIST_KEYWORDS = [
  'items',
  'prefixItems',
  'allOf',
  'anyOf',
  'oneOf'
]

/**
 * Why a per-credential `schema` written by hand may check less than it seems, for a warning.
 * It follows the dialect walt.id's validator uses: the one `$schema` names, or 2020-12 without
 * one. Reported: keys that dialect does not define (walt.id ignores them, e.g. the
 * credential's own shape pasted as a schema, a misspelled `required`, or draft 7's
 * `dependencies` without a draft-7 `$schema`), keys next to `$ref` before 2019-09 (ignored
 * there), a schema that constrains nothing, an attribute under `properties` missing from that
 * level's `required` (a credential without it passes), and a `$schema` walt.id does not
 * support or an `items` list under 2020-12 (either fails every presentation). Schemas from
 * `credentialAttributeSchema` give none.
 */
export function schemaWeaknesses(schema: Record<string, unknown>): string[] {
  const rootDraft = schema.$schema
  const dialect =
    rootDraft === undefined ? DEFAULT_SCHEMA_DIALECT : schemaDialect(rootDraft)
  const keywords = dialect && DIALECT_KEYWORDS[dialect]
  const refSiblingsIgnored =
    dialect === 'draft-04' || dialect === 'draft-06' || dialect === 'draft-07'
  const unknownKeys = new Set<string>()
  const optional: string[] = []
  const drafts = new Set<string>()
  let refSiblings = false
  let itemsList = false
  let constrains = false

  const visit = (node: unknown, path: string[], depth: number) => {
    if (node === false || depth > MAX_SCHEMA_DEPTH) {
      constrains = true
      return
    }
    if (!isPlainObject(node)) return
    const known = (key: string) => !keywords || keywords.has(key)
    if (refSiblingsIgnored && Object.hasOwn(node, '$ref')) {
      // Before 2019-09 a `$ref` replaces its whole schema object.
      if (Object.keys(node).some((key) => !REF_SIBLINGS_KEPT.has(key)))
        refSiblings = true
      if (
        Object.hasOwn(node, '$schema') &&
        schemaDialect(node.$schema) === undefined
      )
        drafts.add(shownValue(node.$schema))
      constrains = true
      return
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema' && schemaDialect(value) === undefined)
        drafts.add(shownValue(value))
      if (!known(key)) {
        unknownKeys.add(key)
        continue
      }
      // The checked credential is always an object: `type: 'object'` at the root checks nothing.
      if (
        !NON_CONSTRAINING_KEYWORDS.has(key) &&
        !(key === 'type' && depth === 0 && value === 'object') &&
        !(key === 'required' && Array.isArray(value) && !value.length)
      )
        constrains = true
    }
    if (dialect === '2020-12' && Array.isArray(node.items)) itemsList = true

    if (isPlainObject(node.properties)) {
      const required = Array.isArray(node.required) ? node.required : []
      for (const [key, child] of Object.entries(node.properties)) {
        if (!required.includes(key)) optional.push(shownPath([...path, key]))
        visit(child, [...path, key], depth + 1)
      }
    }
    for (const key of SUBSCHEMA_MAP_KEYWORDS)
      if (known(key) && isPlainObject(node[key]))
        for (const child of Object.values(node[key] as object))
          visit(child, path, depth + 1)
    for (const key of SUBSCHEMA_KEYWORDS)
      if (known(key) && (isPlainObject(node[key]) || node[key] === false))
        visit(node[key], path, depth + 1)
    for (const key of SUBSCHEMA_LIST_KEYWORDS)
      if (known(key))
        for (const child of Array.isArray(node[key])
          ? (node[key] as unknown[])
          : [node[key]])
          visit(child, path, depth + 1)
  }
  visit(schema, [], 0)

  const weaknesses: string[] = []
  if (drafts.size)
    weaknesses.push(
      `declares $schema ${[...drafts].join(', ')}, which walt.id's validator does not support, so it fails every presentation`
    )
  if (itemsList)
    weaknesses.push(
      "gives 'items' as a list, which JSON Schema 2020-12 does not accept (use 'prefixItems', or declare an earlier $schema), so it fails every presentation"
    )
  if (unknownKeys.size) {
    const names = [...unknownKeys]
      .slice(0, 10)
      .map((key) => `'${sanitize(key, 100, null)}'`)
      .join(', ')
    const dialectName =
      rootDraft === undefined
        ? `JSON Schema ${dialect} (what walt.id's validator uses without $schema)`
        : `JSON Schema ${dialect} (its $schema)`
    const hint = unknownKeys.has('dependencies')
      ? "; in place of draft 7's 'dependencies', use 'dependentRequired' or 'dependentSchemas', or declare a draft-07 $schema"
      : ''
    weaknesses.push(
      `uses ${names}, which ${dialectName} does not define, so walt.id ignores ${unknownKeys.size === 1 ? 'it' : 'them'}${hint}`
    )
  }
  if (refSiblings)
    weaknesses.push(
      `puts keys next to '$ref', which JSON Schema ${dialect} (its $schema) ignores; wrap them with the $ref in 'allOf'`
    )
  if (!constrains)
    weaknesses.push('constrains nothing, so every credential passes it')
  else if (optional.length)
    weaknesses.push(
      `does not list ${optional.slice(0, 10).join(', ')} in 'required', so a credential without ${optional.length === 1 ? 'it' : 'them'} passes`
    )
  return weaknesses
}

/** The dialect a `$schema` value names, or `undefined` when walt.id does not support it. */
function schemaDialect(uri: unknown): SchemaDialect | undefined {
  return typeof uri === 'string'
    ? SCHEMA_DIALECTS[uri.replace(/^https?:\/\//, '').replace(/#$/, '')]
    : undefined
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
  return values.map((value) => shownValue(value)).join(' or ')
}

/**
 * A value quoted in a message: its JSON form, sanitised and bounded. With a `topic`, a value
 * that changes goes to the debug channel under it (`sanitize`).
 */
export function shownValue(
  value: unknown,
  topic: DebugTopic | null = null
): string {
  let text: string
  try {
    // Control characters go before quoting: JSON's escapes for them would hide a token
    // that follows from the redaction.
    text =
      JSON.stringify(value, (_key, item) =>
        typeof item === 'string' ? stripControlCharacters(item) : item
      ) ?? String(value)
  } catch {
    text = String(value)
  }
  return sanitize(text, 100, topic)
}
