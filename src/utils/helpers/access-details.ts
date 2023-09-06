import { OperationResult } from 'urql'
import { AccessDetails } from '../../@types'
import {
  fetchData,
  getAccessDetailsFromTokenPrice,
  getQueryContext
} from '../subgraph'
import { ITokenPriceQuery } from '../subgraph/TokenPriceQuery.gql.generated'
import { tokenPriceQuery } from '../subgraph/TokenPriceQuery.gql'
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
      ITokenPriceQuery,
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

    const tokenPrice: ITokenPriceQuery['token'] = tokenQueryResult.data.token
    const accessDetails = getAccessDetailsFromTokenPrice(tokenPrice, timeout)
    return accessDetails
  } catch (error) {
    LoggerInstance.error('Error getting access details: ', error.message)
  }
}
