import { type FreCreationParams, ZERO_ADDRESS } from '@oceanprotocol/lib'

export const freParams: Omit<
  FreCreationParams,
  'owner' | 'fixedRateAddress' | 'baseTokenAddress'
> = {
  marketFeeCollector: ZERO_ADDRESS, // optional
  baseTokenDecimals: 18, // should come from a token config
  datatokenDecimals: 18, // should come from a token config
  fixedRate: '1', // PRICE
  marketFee: '0'
  // Optional parameters
  // allowedConsumer: '0x0000000000000000000000000000000000000000', //  only account that consume the exhchange
  // withMint: false // add FixedPriced contract as minter if withMint == true // TODO find out why oyu would do this
}
