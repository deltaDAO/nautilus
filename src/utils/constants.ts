import type { Asset, DDO } from '@oceanprotocol/lib'

// TODO look into more advanced type solutions
export type AssetSpecificProps = Exclude<keyof Asset, keyof DDO>

// these are the props which extend the DDO interface to be an aquarius Asset
// this const is needed to strip these away from an Asset to convert it into an DDO
export const AQUARIUS_ASSET_EXTENDED_DDO_PROPS: AssetSpecificProps[] = [
  'nft',
  'datatokens',
  'stats',
  'purgatory'
]
