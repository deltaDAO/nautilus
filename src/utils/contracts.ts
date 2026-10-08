/**
 * Direct contract operations that sit outside the publish/access/compute flows.
 */
import {
  type Config,
  FixedRateExchange,
  LoggerInstance,
  Nft
} from '@oceanprotocol/lib'
import {
  Contract,
  getAddress,
  id,
  type Signer,
  type TransactionReceipt
} from 'ethers'
import { getDatatokenForService, getService } from '../ddo/read.js'
import { confirmTransaction } from './order.js'
import { getPricingInfo } from './pricing.js'

/**
 * Changes the price of a fixed-rate service.
 *
 * The exchange id is read from chain rather than the subgraph. Only fixed-rate services can
 * be repriced — a dispenser has no rate to set.
 */
export async function editPrice(params: {
  asset: unknown
  serviceId: string
  newPrice: string
  chainConfig: Config
  signer: Signer
}): Promise<TransactionReceipt> {
  const { asset, serviceId, newPrice, chainConfig, signer } = params

  if (!getService(asset, serviceId))
    throw new Error(`The asset has no service with id ${serviceId}.`)

  const datatokenAddress = getDatatokenForService(asset, serviceId)

  if (!datatokenAddress)
    throw new Error(
      `Could not determine the datatoken for service ${serviceId}.`
    )

  const pricing = await getPricingInfo(signer, datatokenAddress, chainConfig)

  if (pricing.schema !== 'fixed' || !pricing.exchangeId)
    throw new Error(
      `Service ${serviceId} is not priced by a fixed-rate exchange (it is '${pricing.schema}'), so its rate cannot be set.`
    )

  LoggerInstance.debug('[editPrice] setting rate', {
    exchangeId: pricing.exchangeId,
    newPrice
  })

  const exchange = new FixedRateExchange(
    chainConfig.fixedRateExchangeAddress as string,
    signer
  )

  return confirmTransaction(
    'setRate',
    await exchange.setRate(pricing.exchangeId, newPrice)
  )
}

/**
 * Sets the NFT's metadata state, which is what marks an asset retired or unlisted.
 *
 * Resolves with the receipt once the transaction is mined, and throws if it was not
 * submitted or reverted. A read straight after can still show the old state on an RPC
 * behind a load balancer whose nodes lag each other by a block.
 */
export async function setMetadataState(params: {
  nftAddress: string
  state: number
  chainConfig: Config
  signer: Signer
}): Promise<TransactionReceipt> {
  const { nftAddress, state, chainConfig, signer } = params

  const nft = new Nft(signer, chainConfig.chainId, chainConfig)

  return confirmTransaction(
    'setMetadataState',
    await nft.setMetadataState(nftAddress, await signer.getAddress(), state)
  )
}

const TOKENS_LIST_ABI = [
  'function getTokensList() view returns (address[])'
] as const

/**
 * Every datatoken deployed on the NFT, in creation order (`ERC721Template.getTokensList`):
 * the one bundled at mint first. Not exported from the package.
 */
export async function getNftDatatokens(
  signer: Signer,
  nftAddress: string
): Promise<string[]> {
  const nft = new Contract(nftAddress, TOKENS_LIST_ABI, signer)
  const tokens = (await nft.getFunction('getTokensList')()) as string[]

  return [...tokens].map((token) => getAddress(token))
}

/**
 * The `MetadataCreated` / `MetadataUpdated` topics, as the ERC721 template emits them and
 * ocean-node 4.2 subscribes to them (`EVENT_HASHES`).
 */
export const METADATA_EVENT_TOPICS = [
  id(
    'MetadataCreated(address,uint8,string,bytes,bytes,bytes32,uint256,uint256)'
  ),
  id(
    'MetadataUpdated(address,uint8,string,bytes,bytes,bytes32,uint256,uint256)'
  )
]

/**
 * The NFT's metadata events in one block, in log order. The node keeps only the first of
 * them (`MetadataEventProcessor.isUpdateable` refuses a second event in the same block).
 * Not exported from the package.
 */
export async function getMetadataEventsInBlock(
  signer: Signer,
  nftAddress: string,
  blockNumber: number
): Promise<{ transactionHash: string; index: number }[]> {
  const provider = signer.provider

  if (!provider?.getLogs)
    throw new Error('the signer has no provider that can read logs')

  const logs = await provider.getLogs({
    address: nftAddress,
    fromBlock: blockNumber,
    toBlock: blockNumber,
    topics: [METADATA_EVENT_TOPICS]
  })

  return logs
    .map((log) => ({ transactionHash: log.transactionHash, index: log.index }))
    .sort((a, b) => a.index - b.index)
}
