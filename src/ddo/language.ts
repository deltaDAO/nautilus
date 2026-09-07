import type { LanguageValue } from './types.js'

export const DEFAULT_LANGUAGE = 'en'
export const DEFAULT_DIRECTION = 'ltr'

export interface LanguageOptions {
  language?: string
  direction?: string
}

/**
 * Wraps a plain string into the language-tagged object v5 metadata expects.
 * Passing a `LanguageValue` through is a no-op, so callers can accept either.
 */
export function toLanguageValue(
  value: string | LanguageValue,
  options: LanguageOptions = {}
): LanguageValue {
  if (typeof value !== 'string') return value

  return {
    '@value': value,
    '@language': options.language || DEFAULT_LANGUAGE,
    '@direction': options.direction || DEFAULT_DIRECTION
  }
}

/**
 * Reads a language-tagged value back out as a plain string.
 *
 * Tolerates the un-prefixed `{value, language, direction}` form as well: ocean-node's
 * Elasticsearch mapping indexes these without the `@`, so values round-tripped through a
 * search response can arrive in either shape.
 */
export function fromLanguageValue(
  value: string | LanguageValue | undefined
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value

  const record = value as unknown as Record<string, unknown>
  const raw = record['@value'] ?? record.value

  return typeof raw === 'string' ? raw : undefined
}
