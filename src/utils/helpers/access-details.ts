import { OperationResult } from 'urql'
import { AccessDetails } from '../../@types'
import {
  fetchData,
  getAccessDetailsFromTokenPrice,
  getQueryContext
} from '../subgraph'
import {
  TokenPriceQuery,
  TokenPriceQuery_token as TokenPrice
} from '../../@types/subgraph/TokenPriceQuery'
import { tokenPriceQuery } from '../subgraph/queries'
import { LoggerInstance } from '@oceanprotocol/lib'

export async function getAccessDetails(
  subgraphUri: string,
  datatokenAddress: string,
  timeout?: number,
  account = ''
): Promise<AccessDetails> {
  try {
    const queryContext = getQueryContext(subgraphUri)
    const tokenQueryResult: OperationResult<
      TokenPriceQuery,
      { datatokenId: string; account: string }
    > = await fetchData(
      subgraphUri,
      tokenPriceQuery,
      {
        datatokenId: datatokenAddress.toLowerCase(),
        account: account?.toLowerCase()
      },
      queryContext
    )

    const tokenPrice: TokenPrice = tokenQueryResult.data.token
    const accessDetails = getAccessDetailsFromTokenPrice(tokenPrice, timeout)
    return accessDetails
  } catch (error) {
    LoggerInstance.error('Error getting access details: ', error.message)
  }
}
