import type * as Types from '../../@types/subgraph/api'

export type ITokenPriceQueryVariables = Types.Exact<{
  datatokenId: Types.Scalars['ID']['input'];
  account?: Types.InputMaybe<Types.Scalars['String']['input']>;
}>;


export type ITokenPriceQuery = { __typename?: 'Query', token?: { __typename?: 'Token', id: string, symbol?: string | null, name?: string | null, templateId?: number | null, publishMarketFeeAddress?: string | null, publishMarketFeeToken?: string | null, publishMarketFeeAmount?: any | null, orders?: Array<{ __typename?: 'Order', tx: string, serviceIndex: number, createdTimestamp: number, reuses?: Array<{ __typename?: 'OrderReuse', id: string, caller: string, createdTimestamp: number, tx: string, block: number }> | null }> | null, dispensers?: Array<{ __typename?: 'Dispenser', id: string, active: boolean, isMinter?: boolean | null, maxBalance: any, token: { __typename?: 'Token', id: string, name?: string | null, symbol?: string | null } }> | null, fixedRateExchanges?: Array<{ __typename?: 'FixedRateExchange', id: string, exchangeId: string, price: any, publishMarketSwapFee?: any | null, active: boolean, baseToken: { __typename?: 'Token', symbol?: string | null, name?: string | null, address: string, decimals: number }, datatoken: { __typename?: 'Token', symbol?: string | null, name?: string | null, address: string } }> | null } | null };
