import { ZERO_ADDRESS } from '@oceanprotocol/lib'
import type { DatatokenCreateParamsWithoutOwner } from '../../../@types/Publish'

const templateIndex = 2 // TODO: research templateIndex 1 or 2
const cap = '100000'
const feeAmount = '0'
const mpFeeAddress = ZERO_ADDRESS
const feeToken = ZERO_ADDRESS

export const params: DatatokenCreateParamsWithoutOwner = {
  templateIndex,
  cap,
  feeAmount,
  mpFeeAddress,
  feeToken
}
