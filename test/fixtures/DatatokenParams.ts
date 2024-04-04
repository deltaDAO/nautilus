import { type DatatokenCreateParams, ZERO_ADDRESS } from '@oceanprotocol/lib'

// datatoken parameters: name, symbol, templateIndex, etc.
export const datatokenParams: Omit<
  DatatokenCreateParams,
  'paymentCollector' | 'minter'
> = {
  name: 'TEST_FRE_DT_NAME',
  symbol: 'TEST_FRE_DT_SYMBOL',
  templateIndex: 2,
  cap: '100000',
  feeAmount: '0',
  mpFeeAddress: ZERO_ADDRESS, // replace with market fee address
  feeToken: ZERO_ADDRESS
}
