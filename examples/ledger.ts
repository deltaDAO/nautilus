import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PublishResponse } from '@deltadao/nautilus'

/**
 * A machine-readable record of everything the examples publish or edit.
 *
 * Set `PUBLISH_LOG` to a file path (example.env sets `published.jsonl`) and every publish,
 * resumed publish and edit appends one JSON line: the DID, the NFT, the datatokens, the
 * transaction and where the DDO envelope was stored. That is what you need to clean up
 * later — revoke the assets (`asset:revoke`), unpin the CIDs, or delete the S3 objects —
 * without copying DIDs from the console.
 *
 * The store pointer is written with only what identifies the object (CID, or endpoint,
 * bucket and key). nautilus already redacts secrets in `PublishResponse.stored`; this keeps
 * the log down to what `store:remove` needs.
 */

export type LedgerAction = 'publish' | 'complete-publish' | 'edit'

/** The parts of a pointer that identify the stored object, and nothing secret. */
function redactPointer(pointer: unknown): Record<string, unknown> | undefined {
  if (!pointer || typeof pointer !== 'object') return undefined

  const record = pointer as Record<string, unknown>
  const s3 = record.s3Access as Record<string, unknown> | undefined

  if (s3)
    return {
      type: record.type,
      endpoint: s3.endpoint,
      bucket: s3.bucket,
      objectKey: s3.objectKey
    }

  const { type, hash, url, transactionId } = record

  return Object.fromEntries(
    Object.entries({ type, hash, url, transactionId }).filter(
      ([, value]) => value !== undefined
    )
  )
}

export function recordPublish(
  action: LedgerAction,
  result: PublishResponse,
  context: { command?: string; chainId?: number }
): void {
  const path = process.env.PUBLISH_LOG?.trim()

  if (!path) return

  const entry = {
    at: new Date().toISOString(),
    action,
    command: context.command,
    network: process.env.NETWORK,
    chainId: context.chainId,
    did: result.ddo.id,
    nftAddress: result.nftAddress,
    datatokens: result.services.map((service) => service.datatokenAddress),
    tx: result.setMetadataTxReceipt.hash,
    stored: result.stored && {
      pointer: redactPointer(result.stored.pointer),
      metadataHash: result.stored.metadataHash
    }
  }

  try {
    appendFileSync(resolve(path), `${JSON.stringify(entry)}\n`)
  } catch (error) {
    // The publish itself succeeded; losing the log line must not turn it into a failure.
    console.warn(
      `Could not append to PUBLISH_LOG ${path}: ${error instanceof Error ? error.message : error}`
    )
  }
}

/** One line of `PUBLISH_LOG`, as `recordPublish` writes it. */
export interface LedgerEntry {
  at: string
  action: LedgerAction
  did: string
  tx: string
  stored?: { pointer?: Record<string, unknown>; metadataHash?: string }
}

/** Every entry of `PUBLISH_LOG`, oldest first; none when it is unset or unreadable. */
export function readLedger(): LedgerEntry[] {
  const path = process.env.PUBLISH_LOG?.trim()
  if (!path || !existsSync(resolve(path))) return []

  try {
    return readFileSync(resolve(path), 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LedgerEntry]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

/**
 * What `PUBLISH_LOG` knows about a stored envelope (a CID or an S3 object key): whether it
 * is the asset's creation envelope (from a publish) and whether it is the latest one logged
 * for that DID. `undefined` when the log does not mention it.
 */
export function describeStoredEnvelope(
  reference: string
): { did: string; creation: boolean; latest: boolean } | undefined {
  const entries = readLedger()
  const matches = (entry: LedgerEntry) => {
    const pointer = entry.stored?.pointer
    return pointer?.hash === reference || pointer?.objectKey === reference
  }

  const entry = entries.find(matches)
  if (!entry) return undefined

  const forDid = entries.filter((other) => other.did === entry.did)

  return {
    did: entry.did,
    creation: entry.action === 'publish' || entry.action === 'complete-publish',
    latest: forDid[forDid.length - 1] === entry
  }
}
