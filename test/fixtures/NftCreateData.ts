import { NftCreateData } from '@oceanprotocol/lib'

export const nftParams: Omit<NftCreateData, 'owner'> = {
  name: 'Nautilus Dataservice NFT',
  symbol: 'NAUTILUS-NFT',
  templateIndex: 1,
  tokenURI: '',
  transferable: false
}
