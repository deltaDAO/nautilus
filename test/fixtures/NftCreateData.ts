import { NftCreateData } from '@oceanprotocol/lib'

export const nftParams: Omit<NftCreateData, 'owner'> = {
  name: 'TEST_FRE_NFT_NAME',
  symbol: 'TEST_FRE_NFT_SYMBOL',
  templateIndex: 1,
  tokenURI: '',
  transferable: false
}
