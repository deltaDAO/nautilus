/**
 * Policy-server session cache, used by `PolicySessionResolver`.
 *
 * The policy server derives its session ids as
 * `sha256(consumerAddress:documentId:serviceId) + '-' + random`, and rejects any session
 * whose context half does not match the request with `ADDRESS_NOT_ALLOWED`. So a session
 * is only ever valid for exactly one (asset, service, consumer) triple, and the cache key
 * must include all three.
 *
 * Only sessions the policy server opened, and the verifier accepted where a presentation
 * was asked for, are stored: a refusal is asked again on the next call. Each entry carries
 * the time it was opened, and `PolicySessionResolver` never hands out one older than its
 * `sessionTtlMs`, whatever the store.
 *
 * This is the bug to avoid: the enterprise-market keys its cache on `(did, serviceId)`
 * only, so switching accounts hands the node a session minted for someone else.
 */
export interface SessionKey {
  did: string
  serviceId: string
  /**
   * The exact string sent to `initiate` and to the download or compute call.
   *
   * Compared as it is, never case-folded: the policy server hashes this string into the
   * session id, so a session opened for the checksummed address is refused for the
   * lower-cased one, and the two must not share an entry.
   */
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

export interface SessionEntry {
  sessionId: string
  /**
   * When the session was opened, in milliseconds since the epoch (`Date.now()`, taken
   * just before `initiate`). The resolver drops an entry once it is `sessionTtlMs` old, or
   * when this is missing or in the future.
   */
  createdAt: number
  /**
   * Whether the verifier accepted a presentation for this session (the service's
   * `SSIpolicy` asks for credentials). Such a session lives in the verifier, which can
   * forget it, so the resolver asks the policy server again (`checkSessionId`) before it
   * reuses it.
   */
  presented: boolean
}

/**
 * The string `MemorySessionStore` keys an entry on, for a store of your own: every field
 * as it is, the consumer address included.
 */
export function sessionKeyString({
  nodeUri,
  did,
  serviceId,
  consumerAddress
}: SessionKey): string {
  return JSON.stringify([nodeUri, did, serviceId, consumerAddress])
}

/**
 * Where `PolicySessionResolver` keeps its sessions.
 *
 * A store only keeps entries: the resolver checks their age and, for a presented session,
 * asks the policy server again before reusing one, and deletes an entry it finds stale.
 */
export interface SessionStore {
  get(key: SessionKey): SessionEntry | undefined
  set(key: SessionKey, entry: SessionEntry): void
  delete(key: SessionKey): void
  clear(): void
}

/** Default in-memory store. Lives for the process; swap in your own to persist. */
export class MemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, SessionEntry>()

  get(key: SessionKey): SessionEntry | undefined {
    return this.entries.get(sessionKeyString(key))
  }

  set(key: SessionKey, entry: SessionEntry): void {
    this.entries.set(sessionKeyString(key), entry)
  }

  delete(key: SessionKey): void {
    this.entries.delete(sessionKeyString(key))
  }

  clear(): void {
    this.entries.clear()
  }
}
