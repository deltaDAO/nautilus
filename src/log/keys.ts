/**
 * Which keys name a credential, shared by the redaction of log fields (`redact.ts`) and of
 * free text (`src/node/messages.ts`), so both redact the same keys. Kept out of the
 * package's exports.
 *
 * Keys are compared lower-cased and without `-`, `_`, whitespace and invisible characters
 * (so `session_id`, `Session-Id` and `sessionId` are one key). A key is secret when it is
 *
 * - exactly `nonce`, `sid`, `auth`, `bearer`, `seed`, `pk`, `privkey`, `otp`, `pin`,
 *   `hmac` or `requestUri` (an openid4vp request by reference; as a suffix they would hide
 *   readable fields: `decryptNonce`, `nodeUri`);
 * - or ends in a credential name: `secret`, `secretKey`, `password`, `passphrase`,
 *   `mnemonic`, `seedPhrase`, `apiKey`, `privateKey`, `privKey`, `sessionId`, `signature`,
 *   `cookie`,
 *   `jwt`, `authorization`, `basicAuth`, `accessToken`, `refreshToken`, `sessionToken`,
 *   `securityToken`, `csrfToken`, `apiToken`, `authorizationCode`, `preAuthorizedCode`,
 *   `authCode`, `credentials`, `presentation`, `signedTx`, `rawTx`, …;
 * - or ends in `token`: secret unless its value is an EVM address, so `paymentToken` and
 *   `datatoken` stay readable;
 * - or ends in `code`: secret unless its value reads as an error code (`SERVER_ERROR`,
 *   `ECONNREFUSED`, `-32005`), or, for a `statusCode`, an HTTP status (100-599).
 */

import type { KeyRule } from './keyValues.js'

/** Normalised keys secret only when they match exactly. */
const EXACT_SECRET_KEYS = new Set([
  'nonce',
  'sid',
  'auth',
  'bearer',
  'seed',
  'pk',
  'privkey',
  'otp',
  'pin',
  'hmac',
  'requesturi'
])

/** Normalised keys ending in a credential name, whatever their value. */
const SECRET_SUFFIX =
  /(?:secret|secretkey|secretaccesskey|password|passwd|passphrase|mnemonic|seedphrase|apikey|privatekey|privkey|sessionid|signature|cookie|jwt|authorization|basicauth|(?:access|refresh|auth|id|vp|bearer|session|security|csrf|api|secret)token|authorizationcode|preauthorizedcode|authcode|credentials?|presentation|signedtx|rawtx)$/

/** An EVM address: what a `…token` key holds when it names a token contract. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * An error code: an upper-case constant with an underscore (`SERVER_ERROR`,
 * `UND_ERR_CONNECT_TIMEOUT`), a Node system error (`ECONNREFUSED`), a negative JSON-RPC
 * code (`-32005`), or one of the single-word codes of ethers' `ErrorCode` (`TIMEOUT`,
 * `CANCELLED`; every other one has an underscore). Nautilus throws no single-word code of
 * its own. Any other upper-case word (a base32 one-time code) is not one.
 */
const ERROR_CODE =
  /^(?:[A-Z]+(?:_[A-Z0-9]+)+|E[A-Z]{2,15}|-\d{1,6}|TIMEOUT|CANCELLED)$/

/** What `normalizeKey` drops: `-`, `_`, whitespace and invisible characters. */
const KEY_NOISE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  /[-_\s\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** `key` lower-cased, without `-`, `_`, whitespace and invisible characters. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(KEY_NOISE, '')
}

/**
 * Whether the value of `key` may be a credential, a session secret or a one-time value.
 * For `…token` and `…code` keys the value decides: see `redactsValue`.
 */
export function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return (
    EXACT_SECRET_KEYS.has(normalized) ||
    SECRET_SUFFIX.test(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('code')
  )
}

/** Whether `value`, under `key`, is redacted. */
export function redactsValue(key: string, value: unknown): boolean {
  if (!isSecretKey(key)) return false
  const normalized = normalizeKey(key)
  if (EXACT_SECRET_KEYS.has(normalized) || SECRET_SUFFIX.test(normalized))
    return true

  if (normalized.endsWith('token'))
    return !(typeof value === 'string' && EVM_ADDRESS.test(value))

  // `…code`
  if (typeof value !== 'string' && typeof value !== 'number') return true
  const text = String(value)
  if (isErrorCode(text)) return false
  return !(normalized.endsWith('statuscode') && /^[1-5]\d\d$/.test(text))
}

/** Whether `value` reads as an error code (`SERVER_ERROR`, `ECONNREFUSED`, `-32005`). */
export function isErrorCode(value: string): boolean {
  return ERROR_CODE.test(value)
}

// #region rules for free text and the debug tiers

/** Normalised keys whose unquoted value runs to the end of its line in free text. */
const LINE_VALUE_KEY = /(?:cookie|mnemonic|seedphrase|passphrase)$/

/** The rule of log text: the keys `redactsValue` redacts, as for log fields. */
export const SECRET_KEYS: KeyRule = {
  candidate: isSecretKey,
  redacts: redactsValue,
  toLineEnd: (key) => LINE_VALUE_KEY.test(normalizeKey(key))
}

/** Normalised keys whose value is never shown, at any debug tier. */
const NEVER_SHOWN = /(?:privatekey|mnemonic|seedphrase)$/

/**
 * Normalised keys the `sensitive` debug tier shows although `isSecretKey` (or a credential
 * ending) names them: session-scoped values (the presented `vp_token`, the openid4vp
 * `state`, session ids, nonces, one-time codes, signatures, the presentation and its
 * submission, a raw signed transaction, an openid4vp `request_uri`) and public ones (a public
 * key, an S3 object key, `key` itself as an object key, a key id).
 */
const SHOWN_AT_SENSITIVE =
  /^(?:nonce|sid|otp|pin|state|id|key|keyid|publickey|objectkey|vptoken)$|(?:sessionid|signature|presentation|presentationsubmission|signedtx|rawtx|requesturi|code)$/

/** Normalised keys that are a long-lived credential exactly, besides `isSecretKey`'s. */
const LONG_LIVED_EXACT = new Set(['dkey', 'sig'])

/**
 * Normalised key endings of a long-lived credential, besides `isSecretKey`'s: any `…key`,
 * `…secret`, `…password`, `…auth` (`accessKey`, `S3_SECRET_KEY`, `apiSecret`, `DB_PASSWORD`,
 * `basicAuth`, …).
 */
const LONG_LIVED_SUFFIX = /(?:key|secret|password|passwd|auth)$/

/** Endings of a credential only when the value is a string (an object is walked into). */
const STRING_CREDENTIAL_SUFFIX = /(?:credentials?|auth)$/

/** Signed-URL parameters of AWS and Google (`X-Amz-Signature`, `X-Goog-Credential`, …). */
const SIGNED_URL_PARAMETER =
  /^x(?:amz|goog)(?:signature|credential|securitytoken)$/

/** An EVM signature or other `0x` hex value: session-scoped, not a URL signature. */
const HEX_VALUE = /^0x[0-9a-f]+$/i

/**
 * Whether the value of `key` is a long-lived credential, hidden at the `sensitive` debug
 * tier (shown at `secrets`): best effort, by name. The log redaction's rule
 * (`isSecretKey`, so a key added there is hidden here too), widened to any key ending in
 * `key`, `secret`, `password` or `auth`, `dkey`, `sig` and the AWS and Google signed-URL
 * parameters, minus the session-scoped and public keys of `SHOWN_AT_SENSITIVE`. As in the
 * log redaction, a `…token` holding an EVM address is no credential; a `…credential(s)` or
 * `…auth` key holding an object is walked into. `where` is `query` for a URL's query
 * parameter, where `key`, `sig` and `signature` (unless `0x` hex) are credentials too (a
 * Google API key, an Azure SAS or CloudFront signature).
 */
export function isLongLivedCredential(
  key: string,
  value: unknown,
  where: 'field' | 'query' = 'field'
): boolean {
  const normalized = normalizeKey(key)
  if (where === 'query') {
    if (normalized === 'key') return true
    if (normalized === 'sig' || normalized === 'signature')
      return !(typeof value === 'string' && HEX_VALUE.test(value))
  }
  if (
    NEVER_SHOWN.test(normalized) ||
    SIGNED_URL_PARAMETER.test(normalized) ||
    LONG_LIVED_EXACT.has(normalized)
  )
    return true
  if (SHOWN_AT_SENSITIVE.test(normalized)) return false
  if (STRING_CREDENTIAL_SUFFIX.test(normalized))
    return typeof value === 'string' || where === 'query'
  if (normalized.endsWith('token'))
    return !(typeof value === 'string' && EVM_ADDRESS.test(value))
  return isSecretKey(normalized) || LONG_LIVED_SUFFIX.test(normalized)
}

/** Whether the value of `key` is never shown, at any debug tier. */
export function isNeverShownKey(key: string): boolean {
  return NEVER_SHOWN.test(normalizeKey(key))
}

/** The rule of the `sensitive` debug tier in free text: long-lived credentials. */
export const LONG_LIVED_CREDENTIALS: KeyRule = {
  candidate: (key) => isLongLivedCredential(key, ''),
  // An object or a list under `credentials` or `auth` is walked into, not hidden whole.
  redacts: (key, value) =>
    /^[{[]/.test(value) && STRING_CREDENTIAL_SUFFIX.test(normalizeKey(key))
      ? false
      : isLongLivedCredential(key, value),
  // An `Authorization` header to its end: `AWS4-HMAC-SHA256 Credential=…, Signature=…`.
  toLineEnd: (key) =>
    LINE_VALUE_KEY.test(normalizeKey(key)) ||
    normalizeKey(key).endsWith('authorization')
}

/** The rule of the `secrets` debug tier in free text: only the never-shown keys. */
export const NEVER_SHOWN_KEYS: KeyRule = {
  candidate: isNeverShownKey,
  redacts: () => true,
  toLineEnd: isNeverShownKey
}

// #endregion
