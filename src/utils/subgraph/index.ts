import { LoggerInstance } from '@oceanprotocol/lib'
import {
  type Client,
  type OperationContext,
  type OperationResult,
  type TypedDocumentNode,
  createClient,
  dedupExchange,
  fetchExchange
} from 'urql'
import type { AccessDetails } from '../../@types/Compute'
import type { ITokenPriceQuery } from './TokenPriceQuery.gql.generated'

let client: Client

export function getQueryContext(subgraphUri: string): OperationContext {
  try {
    const queryContext: OperationContext = {
      url: `${subgraphUri}/subgraphs/name/oceanprotocol/ocean-subgraph`,
      requestPolicy: 'network-only'
    }
    return queryContext
  } catch (error) {
    LoggerInstance.error('Get query context error: ', error.message)
  }
}

export function geturqlClient(subgraphUri) {
  if (!client)
    client = createClient({
      url: `${subgraphUri}/subgraphs/name/oceanprotocol/ocean-subgraph`,
      exchanges: [dedupExchange, fetchExchange]
    })

  return client
}

export async function fetchData<T, V>(
  subgraphUri: string,
  query: TypedDocumentNode,
  // biome-ignore lint/suspicious/noExplicitAny: client.query variables has an any type
  variables: any,
  context: OperationContext
): Promise<OperationResult<T, V>> {
  try {
    const client = geturqlClient(subgraphUri)

    const response = await client
      .query<T, V>(query, variables, context)
      .toPromise()
    return response
  } catch (error) {
    LoggerInstance.error('Error fetchData: ', error.message)
  }
  return null
}

export function getAccessDetailsFromTokenPrice(
  tokenPrice: ITokenPriceQuery['token'],
  timeout?: number
): AccessDetails {
  const accessDetails = {} as AccessDetails

  // Return early when no supported pricing schema found.
  if (
    tokenPrice?.dispensers?.length === 0 &&
    tokenPrice?.fixedRateExchanges?.length === 0
  ) {
    accessDetails.type = 'NOT_SUPPORTED'
    return accessDetails
  }

  if (tokenPrice?.orders?.length > 0) {
    const order = tokenPrice.orders[0]
    const reusedOrder = order?.reuses?.length > 0 ? order.reuses[0] : null
    // asset is owned if there is an order and asset has timeout 0 (forever) or if the condition is valid
    accessDetails.isOwned =
      timeout === 0 || Date.now() / 1000 - order?.createdTimestamp < timeout
    // the last valid order should be the last reuse order tx id if there is one
    accessDetails.validOrderTx = reusedOrder?.tx || order?.tx
  }
  accessDetails.templateId = tokenPrice.templateId
  // TODO: fetch order fee from sub query
  accessDetails.publisherMarketOrderFee = tokenPrice?.publishMarketFeeAmount

  // free is always the best price
  if (tokenPrice?.dispensers?.length > 0) {
    const dispenser = tokenPrice.dispensers[0]
    accessDetails.type = 'free'
    accessDetails.addressOrId = dispenser.token.id

    accessDetails.price = '0'
    accessDetails.isPurchasable = dispenser.active
    accessDetails.datatoken = {
      address: dispenser.token.id,
      name: dispenser.token.name,
      symbol: dispenser.token.symbol
    }
  }

  // checking for fixed price
  if (tokenPrice?.fixedRateExchanges?.length > 0) {
    const fixed = tokenPrice.fixedRateExchanges[0]
    accessDetails.type = 'fixed'
    accessDetails.addressOrId = fixed.exchangeId
    accessDetails.price = fixed.price
    // in theory we should check dt balance here, we can skip this because in the market we always create fre with minting capabilities.
    accessDetails.isPurchasable = fixed.active
    accessDetails.baseToken = {
      address: fixed.baseToken.address,
      name: fixed.baseToken.name,
      symbol: fixed.baseToken.symbol,
      decimals: fixed.baseToken.decimals
    }
    accessDetails.datatoken = {
      address: fixed.datatoken.address,
      name: fixed.datatoken.name,
      symbol: fixed.datatoken.symbol
    }
  }

  return accessDetails
}
