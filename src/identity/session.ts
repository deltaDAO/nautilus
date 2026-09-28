/**
 * Verifier session cache.
 *
 * The policy server derives its session ids as
 * `sha256(consumerAddress:documentId:serviceId) + '-' + random`, and rejects any session
 * whose context half does not match the request with `ADDRESS_NOT_ALLOWED`. So a session
 * is only ever valid for exactly one (asset, service, consumer) triple, and the cache key
 * must include all three.
 *
 * This is the bug to avoid: the enterprise-market keys its cache on `(did, serviceId)`
 * only, so switching accounts hands the node a session minted for someone else.
 */
export interface SessionKey {
  did: string
  serviceId: string
  consumerAddress: string
  /**
   * The node that minted the session.
   *
   * Also part of the key: only the policy server behind that node knows the session, so a
   * session cached for one node and replayed to another is rejected the same way a
   * session minted for another account is.
   */
  nodeUri: string
}

interface CacheEntry {
  sessionId: string
  /** `true` when the policy server said no presentation was needed at all. */
  skipped: boolean
}

function keyOf({
  did,
  serviceId,
  consumerAddress,
  nodeUri
}: SessionKey): string {
  return `${nodeUri}|${did}|${serviceId}|${consumerAddress.toLowerCase()}`
}

export interface SessionStore {
  get(key: SessionKey): CacheEntry | undefined
  set(key: SessionKey, entry: CacheEntry): void
  delete(key: SessionKey): void
  clear(): void
}

/** Default in-memory store. Lives for the process; swap in your own to persist. */
export class MemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, CacheEntry>()

  get(key: SessionKey): CacheEntry | undefined {
    return this.entries.get(keyOf(key))
  }

  set(key: SessionKey, entry: CacheEntry): void {
    this.entries.set(keyOf(key), entry)
  }

  delete(key: SessionKey): void {
    this.entries.delete(keyOf(key))
  }

  clear(): void {
    this.entries.clear()
  }
}

export type { CacheEntry as SessionEntry }
