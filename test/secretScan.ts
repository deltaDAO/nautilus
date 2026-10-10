/**
 * The secret scan of the logger's output: what must never appear in a log line, at any
 * level (the sensitive debug channel aside). Used by `test/setup.ts` on every event the
 * unit suite builds, and by `test/unit/Logging.test.ts` on fixtures.
 *
 * Fake secrets of the right shape. None is real.
 */
export const FAKE = {
  /** An RPC URL with an API key in the path and in the query. */
  rpcUrl:
    'https://rpc.example.org/v3/rpc-path-token-5f2b9c71e0d34a8b?apikey=rpc-query-token-9a7c',
  rpcPathToken: 'rpc-path-token-5f2b9c71e0d34a8b',
  rpcQueryToken: 'rpc-query-token-9a7c',
  /** A policy-server session id. */
  sessionId: 'ps-session-3f9d2c1b-7a4e-4b8f-9c2d-1e0f5a6b7c8d',
  /** A 65-byte ECDSA signature. */
  signature: `0x${'ab'.repeat(65)}`,
  /** A JWT (header `{"alg":"ES256K"}`, a payload and a signature). */
  jwt: 'eyJhbGciOiJFUzI1NksifQ.eyJzdWIiOiJkaWQ6ZXhhbXBsZTpob2xkZXIifQ.c2lnbmF0dXJlLW9mLXRoZS1qd3Q',
  /** An S3 secret access key (AWS's documented example key). */
  s3Secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  /** A signed-request nonce. */
  nonce: '1760090000123'
} as const

/** Fixture secrets the unit suite itself uses, which no log line may contain either. */
const SUITE_SECRETS = [
  FAKE.rpcPathToken,
  FAKE.rpcQueryToken,
  FAKE.sessionId,
  FAKE.jwt,
  FAKE.s3Secret,
  'read-secret',
  'session-token'
]

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]*/gi
const SECRET_KEYS =
  'signature|consumerSignature|nonce|sessionId|session_id|token|access_token|id_token|vp_token|jwt|authorization|secretAccessKey|apiKey|api_key|password'

const PATTERNS: [string, (text: string) => boolean][] = [
  ['JWT', (text) => /\beyJ[\w-]*\.[\w-]+\.[\w-]*/.test(text)],
  ['65-byte hex signature', (text) => /\b0x[0-9a-f]{130}\b/i.test(text)],
  ['URL with more than its origin', (text) => urlsBeyondOrigin(text)],
  [
    'credential as key=value',
    (text) =>
      new RegExp(`\\b(?:${SECRET_KEYS})=(?!<redacted>)[^\\s&)]`, 'i').test(text)
  ],
  [
    'credential as a JSON field',
    (text) =>
      new RegExp(`"(?:${SECRET_KEYS})":(?!"<redacted>")`, 'i').test(text)
  ],
  ['bearer credential', (text) => /Bearer\s+(?!<redacted>)\S/i.test(text)],
  [
    'a fixture secret',
    (text) => SUITE_SECRETS.some((secret) => text.includes(secret))
  ]
]

/** The names of the patterns `text` matches; empty when it is clean. */
export function findSecrets(text: string): string[] {
  return PATTERNS.filter(([, test]) => test(text)).map(([name]) => name)
}

/** Whether a URL in `text` has user info, a path, a query or a fragment. */
function urlsBeyondOrigin(text: string): boolean {
  for (const [url] of text.matchAll(URL_PATTERN)) {
    const rest = /^[^:]+:\/\/([^/?#]*)(.*)$/.exec(url)
    if (!rest) continue
    const [, authority, tail] = rest
    if (authority.includes('@')) return true
    if (tail.replace(/[.,;:!?)\]}]*$/, '').replace(/^\/$/, '')) return true
  }
  return false
}
