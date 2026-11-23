/**
 * The refusals of wallet-api2's address sign-in and the wallet UI's address gateway, and
 * what nautilus makes of them. Kept out of the package's exports (internal).
 */
import { maskAddressTokens } from '../../log/credentials.js'
import { sanitize } from '../../node/messages.js'

/** How much of a server's text goes into an error. */
const MAX_TEXT_LENGTH = 500

/** Codes are snake_case words, as wallet-api2 and the gateway write them. */
const ERROR_CODE = /^[a-z][a-z0-9_]{1,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * An address sign-in refusal (`{ error, message, hint }`, as wallet-api2's address routes,
 * its presentation guard and the address gateway answer), redacted and bounded, or
 * `undefined` for any other body.
 *
 * @internal
 */
export function addressRefusal(
  body: string
): { code: string; message: string; hint?: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const { error, message, hint } = parsed
  if (typeof error !== 'string' || !ERROR_CODE.test(error)) return undefined
  if (typeof message !== 'string' || typeof hint !== 'string') return undefined
  return {
    code: error,
    message: sanitize(message, MAX_TEXT_LENGTH, null) || error,
    ...(hint.trim() ? { hint: sanitize(hint, MAX_TEXT_LENGTH, null) } : {})
  }
}

/**
 * The `message` (or `error`) string of a JSON object body that is not a coded refusal,
 * e.g. wallet-api2's `{ "error": "Key not found" }`, redacted and bounded; `undefined` when
 * the body is not JSON with a string `error` or `message`.
 *
 * @internal
 */
export function plainJsonError(body: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const text = [parsed.message, parsed.error].find(
    (value): value is string => typeof value === 'string' && !!value.trim()
  )
  return text ? sanitize(text, MAX_TEXT_LENGTH, null) : undefined
}

/** What nautilus adds to a gateway `not_found`. */
export const NOT_FOUND_HINT =
  'This gateway does not serve the route: check the gateway URL (…/api/address-gateway), that the wallet UI runs the address gateway (ADDRESS_GATEWAY_ENABLED) and that this nautilus version matches it.'

/**
 * Codes that mean the address could not sign in, or its token was refused: reason
 * `sign-in`. The last ones are nautilus's own, raised before anything is signed or sent.
 */
const SIGN_IN_CODES = new Set([
  'chain_not_supported',
  'challenge_invalid',
  'challenge_expired',
  'message_mismatch',
  'dpop_invalid',
  'sign_in_failed',
  'nonce_used',
  'address_not_linked',
  'sign_in_not_allowed_for_organization',
  'sign_in_disabled',
  'too_many_sessions',
  'token_invalid',
  'token_expired',
  'hanko_token_not_accepted',
  'not_found',
  'wrong_endpoint',
  'message_unexpected',
  'smart_account_not_deployed',
  'signer_mismatch',
  'signer_without_provider',
  'sign_in_timeout'
])

/** Codes that mean the address may not do this (an admin's setting): `not-permitted`. */
const NOT_PERMITTED_CODES = new Set([
  'verifier_not_allowed',
  'response_mode_not_allowed',
  'did_web_holder_disabled',
  'key_not_allowed',
  'consumer_mismatch',
  'route_not_allowed',
  'scope_not_enabled',
  'not_a_ddo',
  'holder_changed',
  'wallet_mismatch'
])

/**
 * The `CredentialPresentationError` reason of an address sign-in code.
 *
 * @internal
 */
export function addressCodeReason(
  code: string
): 'sign-in' | 'not-permitted' | 'no-matching-credential' | 'wallet-failed' {
  if (
    code === 'credential_not_on_access_list' ||
    code === 'no_presentable_credentials'
  )
    return 'no-matching-credential'
  if (SIGN_IN_CODES.has(code)) return 'sign-in'
  if (NOT_PERMITTED_CODES.has(code)) return 'not-permitted'
  return 'wallet-failed'
}

/** Control characters, line and paragraph separators and bidi controls. */
const UNSAFE_CHARACTERS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping them is the point
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g

/**
 * `text` as a quoted string for an error message: control characters, line separators and
 * bidi controls escaped as `\uXXXX`, at most `max` characters. For server text that must be
 * shown as it is (a sign-in message line, where the path of a URL matters).
 *
 * @internal
 */
export function quoteText(text: string, max = 300): string {
  const masked = maskAddressTokens(text)
  const cut = masked.length > max ? `${masked.slice(0, max)}…` : masked
  return `"${cut
    .replace(/["\\]/g, (c) => `\\${c}`)
    .replace(
      UNSAFE_CHARACTERS,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    )}"`
}
