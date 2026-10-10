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
