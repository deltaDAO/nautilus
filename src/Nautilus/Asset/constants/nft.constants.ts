import { NftCreateDataWithoutOwner } from '../../../@types/Publish'

const name = 'Nautilus Dataservice NFT'
const symbol = 'NAUTILUS-NFT'
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
