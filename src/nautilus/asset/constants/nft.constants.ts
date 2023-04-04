import { NftCreateDataWithoutOwner } from '../../../@types/Publish'

const name = 'Ocean Dataservice NFT'
const symbol = 'OCEAN-NFT'
const templateIndex = 1
const tokenURI = ''
const transferable = false

export const createData: NftCreateDataWithoutOwner = {
  name,
  symbol,
  templateIndex,
  tokenURI,
  transferable
}
