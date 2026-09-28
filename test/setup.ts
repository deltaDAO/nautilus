/**
 * Loads `.env` for the integration suite, which needs PRIVATE_KEY_TESTS_1/2, NODE_URL
 * and optionally RPC. Uses Node's built-in env-file loader rather than `dotenv`.
 *
 * Missing or unreadable `.env` is not an error: the unit suite needs none of these, and
 * the integration suite already skips itself when the variables are absent.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // no .env present — fine
}
