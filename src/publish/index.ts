/**
 * Publishing: NFT and datatoken creation, DDO signing, and writing metadata on chain.
 *
 * Two notable changes from v1:
 *
 *   - **One transaction per service instead of three.** ocean.js's
 *     `NftFactory.createNftWithDatatoken{,WithFixedRate,WithDispenser}` bundles NFT,
 *     datatoken and pricing together. v1 called `createNFT`, then `createDatatoken`, then
 *     `createFixedRate`/`createDispenser` separately.
 *   - **The DDO is signed and stored off chain.** The store holds a node-encrypted
 *     envelope and only an encrypted `{remote}` pointer goes on chain, following the
 *     enterprise-market model, so the asset carries a real issuer.
 */
import {
  type Config,
  Datatoken,
  type DatatokenCreateParams,
  type DispenserCreationParams,
  type FreCreationParams,
  getEventFromTx,
  LoggerInstance,
  Nft,
  type NftCreateData,
  NftFactory,
  type StorageObject,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import {
  isError,
  parseUnits,
  type Signer,
  type TransactionReceipt,
  type TransactionResponse,
  toBeHex
} from 'ethers'
import type { PublishResponse, StoredBeforeFailure } from '../@types/Publish.js'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import type { RemoteStore, toRemotePointer } from '../remote/RemoteStore.js'
import { redactPointer } from '../remote/redact.js'
import type { DdoSigner } from '../signing/vc.js'
import { errorMessage } from '../utils/http.js'
import { confirmTransaction } from '../utils/order.js'
import {
  assertCiphertextOf,
  assertEncryptedMetadata,
  assertEncryptOption,
  assertSameNode,
  assertSignedDdo,
  assertWritableState,
  buildEnvelope,
  ENCRYPTED_METADATA_FLAGS,
  hashEnvelope,
  pointerPlaintext,
  readMetadataState
} from './envelope.js'

/** Created NFT plus the datatoken minted for one service. */
export interface CreatedTokens {
  nftAddress: string
  datatokenAddress: string
  tx: TransactionReceipt
}

/**
 * Creates the NFT, its datatoken and its pricing in one transaction.
 *
 * Which factory method is used follows the service's pricing config: no fixed rate and no
 * dispenser means the datatoken cannot be ordered, so `'free'` and `'fixed'` are the only
 * two supported schemes.
 */
export async function createNftWithService(params: {
  signer: Signer
  chainConfig: Config
  nftParams: NftCreateData
  service: NautilusService<ServiceTypes, FileTypes>
  owner: string
}): Promise<CreatedTokens> {
  const { signer, chainConfig, nftParams, service, owner } = params

  const factory = new NftFactory(
    chainConfig.nftFactoryAddress as string,
    signer,
    chainConfig.chainId,
    chainConfig
  )

  const datatokenParams: DatatokenCreateParams = {
    ...service.datatokenCreateParams,
    minter: owner,
    paymentCollector: owner
  }

  const pricing = service.pricing

  if (!pricing)
    throw new Error(
      `Service ${service.name || service.id} has no pricing config, so no datatoken can be created for it.`
    )

  let response: unknown

  if (pricing.type === 'fixed') {
    if (!pricing.freCreationParams)
      throw new Error(
        "Fixed pricing needs freCreationParams. Pass them to setPricing({ type: 'fixed', freCreationParams })."
      )

    const freParams: FreCreationParams = {
      ...pricing.freCreationParams,
      owner
    }

    response = await factory.createNftWithDatatokenWithFixedRate(
      nftParams,
      datatokenParams,
      freParams
    )
  } else {
    const dispenserParams: DispenserCreationParams = {
      dispenserAddress: chainConfig.dispenserAddress as string,
      maxTokens: '1',
      maxBalance: '100000000',
      withMint: true,
      allowedSwapper: ZERO_ADDRESS,
      ...pricing.dispenserParams
    }

    response = await factory.createNftWithDatatokenWithDispenser(
      nftParams,
      datatokenParams,
      dispenserParams
    )
  }

  const tx = await confirmTransaction('createNftWithDatatoken', response)

  const nftCreated = getEventFromTx(tx, 'NFTCreated')
  const tokenCreated = getEventFromTx(tx, 'TokenCreated')

  const nftAddress = nftCreated?.args?.newTokenAddress
  const datatokenAddress = tokenCreated?.args?.newTokenAddress

  if (!nftAddress || !datatokenAddress)
    throw new Error(
      'The bundle transaction confirmed but emitted no NFTCreated/TokenCreated events. Check that nftFactoryAddress points at a current ERC721Factory.'
    )

  LoggerInstance.debug('[publish] created NFT and datatoken', {
    nftAddress,
    datatokenAddress
  })

  return { nftAddress, datatokenAddress, tx }
}

/**
 * Creates a datatoken and its pricing on an NFT that already exists — the path for adding
 * a second service to a published asset.
 *
 * Sets `service.datatokenAddress` as soon as the datatoken exists, before its pricing is
 * created, so a pricing failure still leaves the datatoken on record
 * (`PublishIncompleteError.datatokens`) and `completePublish()` reuses it instead of minting
 * another.
 */
export async function createDatatokenForService(params: {
  signer: Signer
  chainConfig: Config
  nftAddress: string
  service: NautilusService<ServiceTypes, FileTypes>
  owner: string
}): Promise<{ datatokenAddress: string; tx: TransactionReceipt }> {
  const { signer, chainConfig, nftAddress, service, owner } = params

  if (!service.pricing)
    throw new Error(
      `Service ${service.name || service.id} has no pricing config, so no datatoken can be created for it.`
    )

  const nft = new Nft(signer, chainConfig.chainId, chainConfig)
  const datatokenParams = service.datatokenCreateParams

  const datatokenAddress = await nft.createDatatoken(
    nftAddress,
    owner,
    owner,
    owner,
    datatokenParams.mpFeeAddress,
    datatokenParams.feeToken,
    datatokenParams.feeAmount,
    datatokenParams.cap,
    datatokenParams.name,
    datatokenParams.symbol,
    datatokenParams.templateIndex
  )

  if (typeof datatokenAddress !== 'string')
    throw new Error('createDatatoken did not return a datatoken address.')

  service.datatokenAddress = datatokenAddress

  const tx = await createPricingForDatatoken({
    signer,
    chainConfig,
    datatokenAddress,
    service,
    owner
  })

  return { datatokenAddress, tx }
}

/**
 * Creates the fixed-rate exchange or dispenser for an existing datatoken, from the
 * service's pricing config. Used for new datatokens and by `completePublish()` for one
 * whose pricing failed. Not exported from the package.
 */
export async function createPricingForDatatoken(params: {
  signer: Signer
  chainConfig: Config
  datatokenAddress: string
  service: NautilusService<ServiceTypes, FileTypes>
  owner: string
}): Promise<TransactionReceipt> {
  const { signer, chainConfig, datatokenAddress, service, owner } = params
  const pricing = service.pricing

  if (!pricing)
    throw new Error(
      `Service ${service.name || service.id} has no pricing config, so datatoken ${datatokenAddress} cannot be priced.`
    )

  const datatoken = new Datatoken(signer, chainConfig.chainId, chainConfig)

  let response: unknown

  if (pricing.type === 'fixed') {
    if (!pricing.freCreationParams)
      throw new Error('Fixed pricing needs freCreationParams.')

    const freParams = { ...pricing.freCreationParams, owner }

    // ocean.js's `Datatoken.createFixedRate` forwards fixedRate/marketFee raw to the
    // contract, while the first-service path (`NftFactory.getFreCreationParams`) converts
    // both with the datatoken's decimals. Convert here the same way, so both publish paths
    // create identical exchanges — without this, a rate of '10' became 1e-17 tokens.
    response = await datatoken.createFixedRate(datatokenAddress, owner, {
      ...freParams,
      fixedRate: parseUnits(
        freParams.fixedRate,
        freParams.datatokenDecimals
      ).toString(),
      marketFee: parseUnits(
        freParams.marketFee,
        freParams.datatokenDecimals
      ).toString()
    })
  } else {
    // Defaults and any user-supplied overrides are in human units, matching the
    // first-service path.
    const dispenserParams = {
      maxTokens: '1',
      maxBalance: '100000000',
      withMint: true,
      allowedSwapper: ZERO_ADDRESS,
      ...pricing.dispenserParams
    }

    // Same raw-forwarding gap as above: `Datatoken.createDispenser` passes
    // maxTokens/maxBalance straight through, while the first-service path
    // (`NftFactory.createNftWithDatatokenWithDispenserTx`) converts both to 18-decimal
    // units. Convert at the call boundary so overrides stay human-readable.
    response = await datatoken.createDispenser(
      datatokenAddress,
      owner,
      chainConfig.dispenserAddress as string,
      {
        ...dispenserParams,
        maxTokens: parseUnits(dispenserParams.maxTokens, 18).toString(),
        maxBalance: parseUnits(dispenserParams.maxBalance, 18).toString()
      }
    )
  }

  return confirmTransaction('createPricing', response)
}

/**
 * Thrown by `publish()` when it fails after the NFT was minted, so the NFT exists without
 * metadata. Pass `nftAddress` and the same asset to `Nautilus.completePublish()` to finish
 * the publish on that NFT instead of minting a new one.
 */
export class PublishIncompleteError extends Error {
  readonly nftAddress: string
  /**
   * The datatokens created before the failure, including one whose pricing then failed.
   * `completePublish()` finds them on the NFT and reuses them.
   */
  readonly datatokens: string[]
  /**
   * Set when the envelope had been stored: what became of it. With `cleanup: 'kept'` the
   * metadata transaction was sent and may have been mined, so the NFT may have metadata
   * after all.
   */
  readonly stored?: StoredBeforeFailure

  constructor(nftAddress: string, datatokens: string[], cause?: unknown) {
    const stored = storedOf(cause)
    const reason = cause instanceof Error ? cause.message : String(cause)

    super(
      stored?.cleanup === 'kept'
        ? `Publishing NFT ${nftAddress} failed after its metadata transaction was sent: ${reason}. The transaction may still be mined. Check the NFT before calling completePublish() with this nftAddress and the same asset: it refuses an NFT that already has metadata.`
        : `Publishing stopped after NFT ${nftAddress} was created, so it has no metadata yet: ${reason}. Call completePublish() with this nftAddress and the same asset to finish it.`,
      { cause }
    )
    this.name = 'PublishIncompleteError'
    this.nftAddress = nftAddress
    this.datatokens = datatokens
    if (stored) this.stored = stored
  }
}

/** The `stored` record a write failure carries, if any. */
function storedOf(error: unknown): StoredBeforeFailure | undefined {
  const stored = (error as { stored?: unknown } | null | undefined)?.stored

  return stored && typeof stored === 'object' && 'cleanup' in stored
    ? (stored as StoredBeforeFailure)
    : undefined
}

/**
 * Decides what happens to an envelope that was stored for a write that then failed, and
 * records it on the error as `error.stored`. Not exported from the package.
 *
 * - `sent: false`: no metadata transaction can point at the object: it was never broadcast,
 *   or it was mined and reverted. It is removed with `RemoteStore.remove()`, best effort: a
 *   failing or missing `remove()` is reported in `stored`, never instead of the original
 *   error.
 * - `sent: true`: the transaction may have been mined and the object may be what the NFT
 *   now points at. It is kept.
 *
 * Never throws: `remove()` is attempted even when the pointer cannot be copied for the
 * report. Returns the error to throw: the original one (with `stored` and a note in its
 * message), or an `Error` wrapping a thrown non-object.
 */
export async function settleStoredEnvelope(
  error: unknown,
  params: {
    remoteStore: RemoteStore
    storedPointer: StorageObject
    metadataHash: string
    sent: boolean
  }
): Promise<unknown> {
  const { remoteStore, storedPointer, metadataHash, sent } = params

  const target: Error =
    error instanceof Error
      ? error
      : new Error(errorMessage(error), { cause: error })

  const stored: StoredBeforeFailure = {
    pointer: reportablePointer(storedPointer),
    metadataHash,
    cleanup: 'kept'
  }
  let note: string

  if (sent) {
    note =
      'The metadata transaction was sent but not confirmed, so it may have been mined: the stored envelope was kept (error.stored). Check the NFT before removing it.'
  } else if (!remoteStore.remove) {
    stored.cleanup = 'not-removed'
    stored.removeError = 'the remote store has no remove()'
    note =
      'No transaction points at the envelope it had stored, but the store has no remove(): delete it yourself (error.stored.pointer).'
  } else {
    try {
      await remoteStore.remove(storedPointer)
      stored.cleanup = 'removed'
      note =
        'The envelope it had stored was removed again, since no transaction points at it (error.stored).'
    } catch (removeError) {
      stored.cleanup = 'not-removed'
      stored.removeError = errorMessage(removeError).slice(0, 300)
      note = `No transaction points at the envelope it had stored, but removing it failed (${stored.removeError}): delete it yourself (error.stored.pointer).`
    }
  }

  try {
    Object.assign(target, { stored })
    target.message = `${target.message} ${note}`
  } catch {
    // A frozen error keeps its message; `stored` is best effort too.
  }

  return target
}

/**
 * The stored pointer, redacted, for `error.stored`. A pointer `redactPointer` cannot copy
 * (a BigInt or a cycle from a custom store) is reported by its type alone, so the report
 * never leaks a secret and never stops the cleanup.
 */
function reportablePointer(pointer: StorageObject): StorageObject {
  try {
    return redactPointer(pointer)
  } catch {
    const type = (pointer as { type?: unknown } | null | undefined)?.type

    return {
      type: typeof type === 'string' ? type : 'unknown'
    } as unknown as StorageObject
  }
}

/**
 * Thrown by `publish()`, `completePublish()` and `edit()` when another `MetadataCreated` or
 * `MetadataUpdated` for the same NFT landed in the same block as this one.
 *
 * ocean-node indexes only the first metadata event of an asset per block and ignores the
 * rest, so the chain and the index now disagree. The transaction was mined: `published`
 * carries the full result. Write again (`edit()`) to resolve it.
 */
export class MetadataConflictError extends Error {
  readonly published: PublishResponse
  /** The other metadata transactions for the NFT in that block. */
  readonly conflictingTxIds: string[]
  /** Whether this transaction came first in the block, so it is the one the node keeps. */
  readonly indexedFirst: boolean

  constructor(
    published: PublishResponse,
    conflictingTxIds: string[],
    indexedFirst: boolean
  ) {
    const { setMetadataTxReceipt: receipt, nftAddress } = published

    super(
      `Metadata transaction ${receipt.hash} for NFT ${nftAddress} landed in block ${receipt.blockNumber} together with ${conflictingTxIds.join(', ')}. ocean-node indexes only the first metadata event of an asset per block, so ${indexedFirst ? 'it keeps this one and ignores the other, and the chain now shows metadata the index does not have' : 'it ignores this one and keeps the earlier one'}. Write the metadata again with edit(); the result is on error.published.`
    )
    this.name = 'MetadataConflictError'
    this.published = published
    this.conflictingTxIds = conflictingTxIds
    this.indexedFirst = indexedFirst
  }
}

export interface WrittenMetadata {
  /** The node-encrypted `{ remote }` pointer written on chain. */
  metadata: string
  /** `0x` + sha256 of the stored envelope, as the node recomputes it. */
  metadataHash: string
  /** Always `0x02`: nautilus never writes plaintext metadata. */
  flags: number
  credential: { jwt: string; issuer: string }
  /**
   * The `{ remote }` pointer the node decrypts, **redacted**: an S3 `secretAccessKey`,
   * `url` header values, and a URL's user name, password, query values and fragment read
   * `'<redacted>'`.
   */
  pointer: ReturnType<typeof toRemotePointer>
  /**
   * What the remote store holds: the pointer it returned (for IPFS, `{ type, hash }`
   * with the CID), redacted like `pointer`, and the hash of the envelope behind it. Enough
   * to verify, unpin or `remove()`.
   */
  stored: { pointer: StorageObject; metadataHash: string }
  /** The node that encrypted the envelope and the pointer; it must be the one on chain. */
  encryptedBy: string
}

/**
 * What `writeMetadata()` needs: the result to hand back, plus what must never be handed
 * back. Not exported from the package.
 */
export interface PreparedWrite {
  /** Redacted, safe to return. */
  written: WrittenMetadata
  /** The pointer exactly as stored and encrypted, secrets included. */
  storedPointer: StorageObject
  /** The JSON the node encrypted into `written.metadata`. */
  pointerPlaintext: string
}

/**
 * Signs the DDO, stores it as an encrypted envelope, and prepares the encrypted pointer.
 *
 * Two node encryptions: one for the envelope's content and one for the `{ remote }`
 * pointer. Nothing readable goes to the store or on chain: each ciphertext is checked
 * against the plaintext nautilus sent.
 *
 * The hash is computed client-side over the stored envelope. Note the trade-off: the
 * ocean-cli path writes the whole DDO and takes the hash from the node's own
 * `Aquarius.validate`, which is node-authoritative. Here the node never sees the document
 * before it is written, which is exactly why `publish()` runs ddo-js's local SHACL
 * validation first, and why it reads the stored object back (`RemoteStore.verify`) before
 * the transaction.
 *
 * The pointers in the result are redacted. Writing it on chain is internal to
 * `Nautilus.publish()`/`completePublish()`/`edit()`.
 */
export async function prepareMetadata(params: {
  node: OceanNodeClient
  ddo: Record<string, unknown>
  signer: DdoSigner
  remoteStore: RemoteStore
  did: string
}): Promise<WrittenMetadata> {
  return (await prepareMetadataForWrite(params)).written
}

/** `prepareMetadata()`, keeping what `writeMetadata()` needs. Not exported from the package. */
export async function prepareMetadataForWrite(params: {
  node: OceanNodeClient
  ddo: Record<string, unknown>
  signer: DdoSigner
  remoteStore: RemoteStore
  did: string
}): Promise<PreparedWrite> {
  const { node, ddo, signer, remoteStore, did } = params

  assertEncryptOption(params)

  const credential = await signer.sign(ddo)
  assertSignedDdo(credential.jwt, ddo)

  const envelope = await buildEnvelope(node, credential.jwt)
  const metadataHash = hashEnvelope(envelope)

  const stored = await remoteStore.put(envelope, { did })

  let pointer: ReturnType<typeof pointerPlaintext>
  let plaintext: string
  let metadata: string
  try {
    pointer = pointerPlaintext(stored)
    plaintext = JSON.stringify(pointer)
    metadata = assertCiphertextOf(
      'pointer',
      await node.encrypt(pointer),
      plaintext
    )
  } catch (error) {
    // Stored, but no transaction can point at it yet.
    throw await settleStoredEnvelope(error, {
      remoteStore,
      storedPointer: stored,
      metadataHash,
      sent: false
    })
  }

  return {
    written: {
      metadata,
      metadataHash,
      flags: ENCRYPTED_METADATA_FLAGS,
      credential,
      pointer: { remote: redactPointer(pointer.remote) },
      stored: { pointer: redactPointer(pointer.remote), metadataHash },
      encryptedBy: node.nodeUri
    },
    // The snapshot that was validated and encrypted, not the store's live object.
    storedPointer: pointer.remote,
    pointerPlaintext: plaintext
  }
}

/**
 * Where the metadata transaction got to, for the caller's cleanup of the stored envelope:
 *
 * - `'sent'`: it may have reached the chain, so the NFT may point at the envelope.
 * - `'reverted'`: it was mined and reverted, or another transaction with the same nonce
 *   took its place, so it changed no metadata and nothing points at the envelope.
 */
export type MetadataWriteProgress = 'sent' | 'reverted'

/**
 * ethers error codes that mean the transaction was never broadcast: the wallet refused to
 * sign it, or the signer or the RPC refused it before accepting it. Any other failure of
 * the send (a timeout, a network or server error, a custom signer's own error) may come
 * after the broadcast, so it counts as sent.
 */
const NOT_BROADCAST_CODES = [
  'ACTION_REJECTED',
  'INSUFFICIENT_FUNDS',
  'REPLACEMENT_UNDERPRICED',
  'INVALID_ARGUMENT',
  'UNSUPPORTED_OPERATION'
] as const

function neverBroadcast(error: unknown): boolean {
  return NOT_BROADCAST_CODES.some((code) => isError(error, code))
}

/**
 * Writes the metadata pointer onto the NFT. Not exported from the package: it only takes
 * what `prepareMetadataForWrite()` produced.
 *
 * `onProgress('sent')` runs once the transaction may have reached the chain, and
 * `onProgress('reverted')` once it is known to have changed nothing. A failure before
 * `'sent'`, or after `'reverted'`, means no transaction points at the envelope, which is
 * what lets the caller remove it safely.
 *
 * The transaction is built with ocean.js (`Nft.setMetadataTx`: permission read, gas
 * estimate) and sent with `signer.sendTransaction`, so a wallet rejection, a mined revert
 * and a lost receipt can be told apart. ocean.js's own `setMetadata` returns `null` for all
 * three. On a confidential chain (`config.sdk === 'oasis'`), ocean.js wraps the signer so
 * the transaction is encrypted; that wrapper is internal to ocean.js, so there the send
 * stays with `Nft.setMetadata`, and the transaction counts as sent once it returns.
 */
export async function writeMetadata(params: {
  signer: Signer
  chainConfig: Config
  nftAddress: string
  nodeUri: string
  lifecycleState: number
  prepared: PreparedWrite
  onProgress?: (progress: MetadataWriteProgress) => void
}): Promise<TransactionReceipt> {
  const { signer, chainConfig, nftAddress, nodeUri, lifecycleState } = params
  const prepared = params.prepared.written

  // The last line of defence: whatever produced `prepared`, nothing readable goes on
  // chain, and the indexer can follow what does.
  assertEncryptedMetadata(prepared, params.prepared.pointerPlaintext)
  assertSameNode(nodeUri, prepared.encryptedBy)
  assertWritableState(lifecycleState, 'the requested state')

  const publisher = await signer.getAddress()

  const nft = new Nft(signer, chainConfig.chainId, chainConfig)

  assertWritableState(
    await readMetadataState(nft, nftAddress),
    `NFT ${nftAddress}`
  )

  LoggerInstance.debug('[publish] writing metadata', {
    nftAddress,
    lifecycleState,
    flags: prepared.flags
  })

  const args = [
    nftAddress,
    publisher,
    lifecycleState,
    nodeUri,
    '',
    toBeHex(prepared.flags),
    prepared.metadata,
    prepared.metadataHash
  ] as const

  if (chainConfig.sdk === 'oasis') {
    // ocean.js builds the transaction first, which throws on failure (nothing sent), then
    // sends it through its confidential signer and waits, returning `null` for any failure
    // after that: a rejection, a revert or a lost receipt alike. So once it returns, the
    // transaction may have been mined.
    const response = await nft.setMetadata(...args)
    params.onProgress?.('sent')

    return confirmTransaction('setMetadata', response)
  }

  // Throws before anything is sent: the permission read or the gas estimate failed.
  const request = await nft.setMetadataTx(...args)

  let response: TransactionResponse
  try {
    response = await signer.sendTransaction(request)
  } catch (error) {
    if (!neverBroadcast(error)) params.onProgress?.('sent')
    throw error
  }
  params.onProgress?.('sent')

  let receipt: TransactionReceipt | null
  try {
    receipt = await response.wait()
  } catch (error) {
    const unchanged = unchangedBy(error)
    if (!unchanged) throw error

    params.onProgress?.('reverted')
    throw new Error(
      `setMetadata transaction ${response.hash} ${unchanged}, so it did not change the metadata of NFT ${nftAddress}.`,
      { cause: error }
    )
  }

  if (!receipt)
    throw new Error(
      `setMetadata transaction ${response.hash} was submitted but never confirmed.`
    )

  // A custom signer's `wait()` may hand back a reverted receipt instead of throwing.
  if (receipt.status === 0) {
    params.onProgress?.('reverted')
    throw new Error(
      `setMetadata transaction ${receipt.hash} was mined in block ${receipt.blockNumber} but reverted, so it did not change the metadata of NFT ${nftAddress}.`
    )
  }

  return receipt
}

/**
 * How a transaction left the metadata unchanged, from the error ethers' `wait()` threw: it
 * was mined and reverted, or another transaction with the same nonce and different data
 * took its place (`cancelled`). `undefined` when it may have changed it.
 */
function unchangedBy(error: unknown): string | undefined {
  if (isError(error, 'CALL_EXCEPTION') && error.receipt?.status === 0)
    return `was mined in block ${error.receipt.blockNumber} but reverted`

  if (isError(error, 'TRANSACTION_REPLACED') && error.cancelled)
    return `was replaced by ${error.hash}`

  return undefined
}

/**
 * Refuses, before any transaction, a signer without the NFT permissions a write needs:
 * `updateMetadata` for the metadata transaction, and `deployERC20` when datatokens or their
 * pricing will be created. Not exported from the package.
 */
export async function assertNftPermissions(params: {
  signer: Signer
  chainConfig: Config
  nftAddress: string
  deployDatatokens: boolean
  operation: string
}): Promise<void> {
  const { signer, chainConfig, nftAddress, deployDatatokens, operation } =
    params

  const address = await signer.getAddress()
  const permissions = await new Nft(
    signer,
    chainConfig.chainId,
    chainConfig
  ).getNftPermissions(nftAddress, address)

  const missing = [
    ...(permissions?.updateMetadata ? [] : ['updateMetadata']),
    ...(deployDatatokens && !permissions?.deployERC20 ? ['deployERC20'] : [])
  ]

  if (missing.length)
    throw new Error(
      `${operation}: ${address} lacks the ${missing.join(' and ')} permission on NFT ${nftAddress}, so the write would revert. Nothing was sent. The NFT's owner can grant it (addToMetadataList, addToCreateERC20List).`
    )
}

/**
 * Waits for the publisher to hold `updateMetadata` permission on a freshly created NFT.
 *
 * The factory grants it in the creation transaction, but on several chains the read lags
 * the write by a block or two, and `setMetadata` reverts in the gap.
 */
export async function waitForMetadataPermission(params: {
  signer: Signer
  chainConfig: Config
  nftAddress: string
  attempts?: number
  intervalMs?: number
}): Promise<void> {
  const { signer, chainConfig, nftAddress } = params
  const attempts = params.attempts ?? 30
  const intervalMs = params.intervalMs ?? 1000

  const nft = new Nft(signer, chainConfig.chainId, chainConfig)
  const address = await signer.getAddress()

  for (let attempt = 0; attempt < attempts; attempt++) {
    const permissions = await nft.getNftPermissions(nftAddress, address)

    if (permissions?.updateMetadata) return

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `${address} still has no updateMetadata permission on ${nftAddress} after ${attempts} attempts. The NFT may not have been created by this account.`
  )
}
