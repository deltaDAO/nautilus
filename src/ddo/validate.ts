/**
 * Local DDO validation.
 *
 * `@oceanprotocol/ddo-js` validates entirely in-process (JSON-LD -> RDF -> SHACL against
 * the bundled `schemas/*.ttl`), so this is a free pre-flight check before spending gas.
 * Nautilus v1 had a hand-rolled `hasAllRequiredOceanDDOAttributes()` instead; this
 * replaces it and reports which field failed.
 */
import { DDOManager, validateDDO } from '@oceanprotocol/ddo-js'

/** Field-keyed errors, exactly as ddo-js reports them. */
export type ValidationErrors = Record<string, string[]>

export interface ValidationResult {
  valid: boolean
  errors: ValidationErrors
}

/**
 * ddo-js always attaches the full N-Quads validation report under `fullReport`. It is
 * useful for debugging but far too noisy for an error message, so it is separated out.
 */
const REPORT_KEY = 'fullReport'

export async function validate(ddo: unknown): Promise<ValidationResult> {
  const [valid, errors] = await validateDDO(ddo as Record<string, unknown>)
  const merged: ValidationErrors = { ...(errors || {}) }

  // ddo-js computes a DID-derivation check but discards it whenever the SHACL shape
  // conforms (`validate()` returns `[true, {}]` and drops its own field errors). The v5
  // shape only constrains the DID's prefix and length, so any 72-character `did:ope:…`
  // string passes — including one that does not derive from this asset's nftAddress and
  // chainId. The indexer would then reject the published asset, so the check is redone here.
  const didError = checkDid(ddo as Record<string, unknown>)
  if (didError) merged.id = [...(merged.id || []), didError]

  return { valid: valid && !didError, errors: merged }
}

/** Recomputes the DID from `(nftAddress, chainId)` and compares it to the document's id. */
function checkDid(ddo: Record<string, unknown>): string | undefined {
  try {
    const manager = DDOManager.getDDOClass(ddo)
    const { chainId, nftAddress } = manager.getDDOFields()

    if (!chainId || !nftAddress) return undefined

    const expected = manager.makeDid(nftAddress as string, String(chainId))

    if (expected !== ddo.id)
      return `did does not derive from nftAddress and chainId; expected ${expected}`
  } catch {
    // A malformed document fails the checks ddo-js already reports; nothing to add.
  }

  return undefined
}

/** Human-readable one-liner, e.g. `name: Less than 1 values; chainId: is missing`. */
export function formatValidationErrors(errors: ValidationErrors): string {
  return Object.entries(errors)
    .filter(([field]) => field !== REPORT_KEY)
    .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
    .join('; ')
}

/** The raw SHACL report, when you need to debug why a shape did not conform. */
export function getValidationReport(
  errors: ValidationErrors
): string | undefined {
  return errors[REPORT_KEY]?.[0]
}

export class DdoValidationError extends Error {
  readonly errors: ValidationErrors

  constructor(errors: ValidationErrors) {
    super(`DDO validation failed — ${formatValidationErrors(errors)}`)
    this.name = 'DdoValidationError'
    this.errors = errors
  }
}

/** Throws a `DdoValidationError` carrying the field errors if the DDO does not conform. */
export async function assertValid(ddo: unknown): Promise<void> {
  const { valid, errors } = await validate(ddo)

  if (!valid) throw new DdoValidationError(errors)
}
