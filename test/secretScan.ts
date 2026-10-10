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
  nonce: '1760090000123',
  /** A drpc key, as drpc puts it in the query (`dkey=`). */
  drpcKey: 'drpc-dkey-Q7m2Lx9pVt4sRw8nYc3b',
  /** A Pinata gateway access token (`pinataGatewayToken=`). */
  pinataGatewayToken: 'pinata-gw-token-H4k9Zq2Wm7Xr5Tn8',
  /** A Pinata API JWT, other than `jwt` above. */
  pinataJwt:
    'eyJhbGciOiJIUzI1NiJ9.eyJwaW5hdGEiOiJmYWtlIn0.cGluYXRhLWZha2Utc2lnbmF0dXJl',
  /** A secret key from an environment file (`S3_SECRET_KEY=`). */
  envSecretKey: 'minio-secret-key-Fk29Lq7Xw3Rt',
  /** A session cookie, not the first cookie of its header. */
  cookie: 'cookie-session-Vb81Nc5Qe2Hy',
  /** An API token inside a JSON body quoted inside JSON. */
  nestedApiToken: 'nested-api-token-Ju64Pz0Ko9Ls'
} as const

/**
 * The long-lived fixture credentials in the shapes the `sensitive` tier must still hide:
 * a drpc URL, a Pinata gateway token as a query parameter and as a key, `PINATA_JWT=` and
 * `S3_SECRET_KEY=` in an environment dump, a second cookie, and a credential in JSON inside
 * a JSON string (with a JSON-escaped URL).
 */
export const CREDENTIAL_SHAPES = [
  `https://lb.drpc.org/ogrpc?network=optimism-sepolia&dkey=${FAKE.drpcKey}`,
  `https://gw.mypinata.cloud/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG?pinataGatewayToken=${FAKE.pinataGatewayToken}`,
  `{"pinataGatewayToken":"${FAKE.pinataGatewayToken}"}`,
  `PINATA_JWT=${FAKE.pinataJwt}\nS3_SECRET_KEY=${FAKE.envSecretKey}`,
  `Cookie: theme=dark; session=${FAKE.cookie}`,
  JSON.stringify({
    body: JSON.stringify({
      apiToken: FAKE.nestedApiToken,
      rpc: FAKE.rpcUrl.replace(/\//g, '\\/')
    })
  })
].join('\n')

/** Fixture secrets the unit suite itself uses, which no log line may contain either. */
const SUITE_SECRETS = [
  FAKE.rpcPathToken,
  FAKE.rpcQueryToken,
  FAKE.sessionId,
  FAKE.jwt,
  FAKE.s3Secret,
  'read-secret',
  'session-token',
  FAKE.drpcKey,
  FAKE.pinataGatewayToken,
  FAKE.pinataJwt,
  FAKE.envSecretKey,
  FAKE.cookie,
  FAKE.nestedApiToken
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

/**
 * Long-lived credentials among the fixtures: never in a `sensitive` debug event either, only
 * at `secrets`.
 */
const CREDENTIALS: [string, string][] = [
  ['RPC URL path token', FAKE.rpcPathToken],
  ['RPC URL query token', FAKE.rpcQueryToken],
  ['S3 secret key', FAKE.s3Secret],
  ['S3 secret key', 'read-secret'],
  ['drpc key', FAKE.drpcKey],
  ['Pinata gateway token', FAKE.pinataGatewayToken],
  ['Pinata JWT', FAKE.pinataJwt],
  ['secret key from an environment file', FAKE.envSecretKey],
  ['session cookie', FAKE.cookie],
  ['API token in nested JSON', FAKE.nestedApiToken]
]

/** The long-lived fixture credentials `text` holds; empty when it has none. */
export function findCredentials(text: string): string[] {
  return CREDENTIALS.filter(([, secret]) => text.includes(secret)).map(
    ([name]) => name
  )
}

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

/**
 * Whether the tap of `test/setup.ts` checks each event's fields against the catalogue. Set
 * back to `true` before each test.
 */
export const catalogueCheck = { fields: true }

/**
 * For the rest of the current test, events may carry fields the catalogue does not list:
 * for tests of the redaction itself, which feed catalogued events made-up fields.
 */
export function allowMadeUpFields(): void {
  catalogueCheck.fields = false
}
