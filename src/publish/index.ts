import { createHash } from 'node:crypto'
/**
 * Publishing: NFT and datatoken creation, DDO signing, and writing metadata on chain.
 *
 * Two notable changes from v1:
 *
 *   - **One transaction per service instead of three.** ocean.js's
 *     `NftFactory.createNftWithDatatoken{,WithFixedRate,WithDispenser}` bundles NFT,
 *     datatoken and pricing together. v1 called `createNFT`, then `createDatatoken`, then
 *     `createFixedRate`/`createDispenser` separately.
 *   - **The DDO is signed and stored off chain.** Only a `{remote}` pointer goes on chain,
 *     following the enterprise-market model, so the asset carries a real issuer.
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
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import {
  parseUnits,
  type Signer,
  type TransactionReceipt,
  toBeHex
} from 'ethers'
import type {
  FileTypes,
  NautilusService,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import type { RemoteStore } from '../remote/RemoteStore.js'
import { toRemotePointer } from '../remote/RemoteStore.js'
import type { DdoSigner } from '../signing/vc.js'
import { confirmTransaction } from '../utils/order.js'

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
 */
export async function createDatatokenForService(params: {
  signer: Signer
  chainConfig: Config
  nftAddress: string
  service: NautilusService<ServiceTypes, FileTypes>
  owner: string
}): Promise<{ datatokenAddress: string; tx: TransactionReceipt }> {
  const { signer, chainConfig, nftAddress, service, owner } = params
  const pricing = service.pricing

  if (!pricing)
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

  const tx = await confirmTransaction('createPricing', response)

  return { datatokenAddress, tx }
}

export interface WrittenMetadata {
  /** The encrypted (or hexlified) pointer written on chain. */
  metadata: string
  metadataHash: string
  flags: number
  credential: { jwt: string; issuer: string }
  pointer: ReturnType<typeof toRemotePointer>
}

/**
 * The claims segment of a compact JWS, decoded to the exact string a consumer
 * gets when it unwraps the credential. Used for the on-chain metadata hash, so
 * both sides hash identical bytes.
 */
function decodeCredentialClaims(jwt: string): string {
  const segments = jwt.split('.')

  if (segments.length !== 3)
    throw new Error(
      `Expected a compact JWS with 3 segments, got ${segments.length}.`
    )

  return Buffer.from(segments[1], 'base64url').toString()
}

/**
 * Signs the DDO, stores it, and prepares the on-chain pointer.
 *
 * The hash is computed over the stored payload client-side. Note the trade-off: the
 * ocean-cli path writes the whole DDO and takes the hash from the node's own
 * `Aquarius.validate`, which is node-authoritative. Here the node never sees the document
 * before it is written, which is exactly why `publish()` runs ddo-js's local SHACL
 * validation first.
 */
export async function prepareMetadata(params: {
  node: OceanNodeClient
  ddo: Record<string, unknown>
  signer: DdoSigner
  remoteStore: RemoteStore
  did: string
  encrypt?: boolean
}): Promise<WrittenMetadata> {
  const { node, ddo, signer, remoteStore, did } = params
  const encrypt = params.encrypt !== false

  const credential = await signer.sign(ddo)

  const stored = await remoteStore.put(credential.jwt, { did })
  const pointer = toRemotePointer(stored)

  const payload = JSON.stringify(pointer)

  const metadata = encrypt ? await node.encrypt(pointer) : hexlify(payload)
  const flags = encrypt ? 2 : 0

  /**
   * The on-chain hash covers the *document*, not the pointer.
   *
   * The node resolves the pointer, unwraps the credential and hashes what it
   * got, then compares that to this value. Hashing `payload` (the pointer)
   * here instead meant the two could never agree, and every remote publish
   * failed to index with "Hash check failed".
   *
   * So hash exactly the bytes the node ends up with: the decoded JWS claims
   * segment, which is the DDO document itself.
   */
  const metadataHash = `0x${createHash('sha256')
    .update(decodeCredentialClaims(credential.jwt))
    .digest('hex')}`

  return { metadata, metadataHash, flags, credential, pointer }
}

/** Writes the metadata pointer onto the NFT. */
export async function writeMetadata(params: {
  signer: Signer
  chainConfig: Config
  nftAddress: string
  nodeUri: string
  lifecycleState: number
  prepared: WrittenMetadata
}): Promise<TransactionReceipt> {
  const { signer, chainConfig, nftAddress, nodeUri, lifecycleState, prepared } =
    params
  const publisher = await signer.getAddress()

  const nft = new Nft(signer, chainConfig.chainId, chainConfig)

  LoggerInstance.debug('[publish] writing metadata', {
    nftAddress,
    lifecycleState,
    flags: prepared.flags
  })

  const response = await nft.setMetadata(
    nftAddress,
    publisher,
    lifecycleState,
    nodeUri,
    '',
    toBeHex(prepared.flags),
    prepared.metadata,
    prepared.metadataHash
  )

  return confirmTransaction('setMetadata', response)
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

function hexlify(value: string): string {
  return `0x${Buffer.from(value, 'utf8').toString('hex')}`
}
