import {
  IndexingError,
  type IndexingStateQuery,
  type Nautilus,
  OceanNodeError,
  PublishIncompleteError
} from '@deltadao/nautilus'

/**
 * What to do when a publish or an edit does not end in an indexed asset.
 *
 * Three different situations, and they need different answers:
 *
 *   - **`PublishIncompleteError`** — `publish()` failed *after* minting the NFT (a later
 *     datatoken, the store, the node, the RPC). The NFT exists without metadata. Fix the
 *     cause and finish it on the same NFT with `completePublish()`; publishing again would
 *     mint a second NFT.
 *   - **`IndexingError`** — the transactions succeeded, but the node recorded that it could
 *     not index them (a hash mismatch, a store it could not fetch from, a DDO it rejected).
 *     It carries the node's own message. Nothing on chain says so; only the node's indexing
 *     state does.
 *   - **`OceanNodeError` from `waitForIndexer`** — the node did not index the transaction
 *     within the timeout. It may just be behind.
 */

/** Prints what an `IndexingError` or an indexer timeout means. Returns whether it was one. */
export function explainIndexingFailure(error: unknown): boolean {
  if (error instanceof IndexingError) {
    console.error('\nThe node could not index this change.')
    console.error(`  DID:   ${error.did}`)
    if (error.txId) console.error(`  tx:    ${error.txId}`)
    console.error(`  node:  ${error.state.error?.trim() || '(no message)'}`)
    console.error(
      '  The transactions succeeded, so the change is on chain, but the node will not retry it.'
    )
    console.error(
      '  Fix the cause (often the DDO store: the node must be able to fetch what was stored) and edit or republish.'
    )
    if (error.txId)
      console.error(
        `  The node's record: npm start -- asset:indexing-state ${error.txId}`
      )

    return true
  }

  if (error instanceof OceanNodeError && error.operation === 'waitForIndexer') {
    console.error('\nThe node did not index this change in time.')
    console.error(`  ${error.message}`)
    console.error(
      '  The change is on chain; the node may just be behind. Raise INDEXER_TIMEOUT_MS, or check later with'
    )
    console.error(
      '  npm start -- asset:inspect <did>   or   npm start -- asset:indexing-state <txId>'
    )

    return true
  }

  return false
}

/**
 * Prints how to finish a publish that stopped after its NFT was minted. Returns whether
 * the error was a `PublishIncompleteError`.
 *
 * `completePublish(nftAddress, asset)` wants the asset the failed `publish()` was given, so
 * it knows which datatokens already exist. A CLI run has ended by then, so the examples
 * rebuild the same asset with the same command and hand it the datatokens from the error:
 * that is what `publish:resume` does.
 */
export function explainPublishIncomplete(
  error: unknown,
  command?: string
): boolean {
  if (!(error instanceof PublishIncompleteError)) return false

  const cause =
    error.cause instanceof Error ? error.cause.message : String(error.cause)

  console.error('\nPublishing stopped after the NFT was minted.')
  console.error(`  NFT:        ${error.nftAddress}`)
  console.error(`  datatokens: ${error.datatokens.join(', ') || '(none)'}`)
  console.error(`  cause:      ${cause}`)

  // What became of the envelope stored for this attempt, if it got that far.
  const { stored } = error
  if (stored) {
    const where = stored.pointer as {
      hash?: string
      s3Access?: { objectKey?: string }
    }
    const object =
      where.hash ?? where.s3Access?.objectKey ?? stored.pointer.type
    console.error(
      `  envelope:   ${object} — ${
        stored.cleanup === 'removed'
          ? 'removed again, nothing points at it'
          : stored.cleanup === 'kept'
            ? 'kept, the metadata transaction may have been mined'
            : `unused, remove it with store:remove (${stored.removeError})`
      }`
    )
  }

  if (stored?.cleanup === 'kept') {
    console.error(
      '\n  The metadata transaction was sent but not confirmed, so the NFT may get metadata yet.'
    )
    console.error(
      "  Wait until it is mined or dropped (the publisher account's latest transactions), then"
    )
    console.error(
      '  resume: publish:resume refuses an NFT that already has metadata.'
    )
  } else {
    console.error(
      '\n  The NFT has no metadata yet. Fix the cause, then finish the publish on the same NFT'
    )
    console.error('  instead of minting another one:')
  }

  if (command)
    console.error(
      `\n    npm start -- publish:resume ${command} ${error.nftAddress} ${error.datatokens.join(' ')}`.trimEnd()
    )

  console.error(
    '\n  In your own code: `await nautilus.completePublish(error.nftAddress, asset)`, with the'
  )
  console.error(
    '  same asset object you passed to publish(); its services still carry the datatokens.'
  )

  return true
}

/** `did:op:`/`did:ope:` DIDs, NFT addresses and transaction hashes, told apart by shape. */
export function indexingQuery(reference: string): IndexingStateQuery {
  const value = reference.trim()

  if (/^did:/i.test(value)) return { did: value }
  if (/^0x[0-9a-f]{64}$/i.test(value)) return { txId: value }
  if (/^0x[0-9a-f]{40}$/i.test(value)) return { nft: value }

  throw new Error(
    `'${reference}' is neither a DID, an NFT address (0x + 40 hex) nor a transaction hash (0x + 64 hex).`
  )
}

/**
 * `asset:indexing-state` — the node's indexing record for a DID, an NFT or a transaction.
 *
 * The only place the node says why an asset is on chain but not indexed. ocean-node 4.2
 * files the two outcomes differently:
 *
 *   - a **success** under the `did:ope:` DID, with a blank `txId` — query the DID;
 *   - a **failure** under the old `did:op:` id, with the `nft` and the real `txId` — query
 *     the transaction hash. Failure records are never removed, so a lookup by NFT can
 *     return an error from an earlier transaction.
 */
export async function showIndexingState(nautilus: Nautilus, reference: string) {
  const query = indexingQuery(reference)
  const [key, value] = Object.entries(query)[0]

  console.log(`Indexing state for ${key} ${value}`)

  const state = await nautilus.getNodeClient().getIndexingState(query)

  if (!state) {
    console.log('  The node has no record of it.')
    if (key === 'did')
      console.log(
        '  Failures are filed by transaction, not by did:ope: DID. Query the publish or edit tx hash.'
      )
    return undefined
  }

  const error = state.error?.trim()
  const failed = state.valid === false || Boolean(error)

  console.log(`  filed under: ${state.did ?? '—'}`)
  console.log(`  valid:       ${state.valid}`)
  console.log(`  error:       ${error || '—'}`)
  if (state.nft) console.log(`  nft:         ${state.nft}`)
  if (state.txId?.trim()) console.log(`  tx:          ${state.txId}`)
  console.log(`  outcome:     ${failed ? 'NOT indexed' : 'indexed'}`)

  if (failed && key === 'nft')
    console.log(
      '  Failure records are never removed: check that the tx above is the one you care about.'
    )

  return state
}
