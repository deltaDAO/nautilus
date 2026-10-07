/**
 * Reading a stored envelope back the way ocean-node 4.2 does, before the metadata goes on
 * chain. Kept out of the package's exports.
 *
 * The node `JSON.parse`s the fetched body and compares `"0x" + sha256(JSON.stringify(obj))`
 * with the on-chain hash (`BaseProcessor.decryptDDO`). Checking this before the
 * transaction catches a store that alters bytes, or a key the node cannot read with, while
 * nothing is on chain yet.
 */

/** `"0x" + sha256(JSON.stringify(JSON.parse(body)))`, or throws when the body is not JSON. */
export async function hashStoredBody(body: string): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(
      'the stored object is not JSON, so the node cannot parse it'
    )
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(parsed))
  )

  return `0x${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

/** Throws unless `body` hashes, as the node hashes it, to `expectedHash`. */
export async function assertStoredHash(
  where: string,
  body: string,
  expectedHash: string
): Promise<void> {
  let actual: string
  try {
    actual = await hashStoredBody(body)
  } catch (error) {
    throw new Error(
      `Verifying ${where} failed: ${(error as Error).message}. The node would not index it.`
    )
  }

  if (actual !== expectedHash.toLowerCase())
    throw new Error(
      `Verifying ${where} failed: it hashes to ${actual}, not ${expectedHash}. The store changed the envelope, so the node's hash check would fail; nothing was written on chain.`
    )
}
