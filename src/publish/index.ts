import {
  Aquarius,
  DispenserCreationParams,
  LoggerInstance,
  Nft,
  NftFactory,
  ProviderInstance
} from '@oceanprotocol/lib'
import { AssetConfig } from '../@types/Publish'

export async function publishAsset(assetConfig: AssetConfig) {
  // TODO don't forget to set return type
  const { web3, ddo, chainConfig } = assetConfig
  const publisherAccount = web3?.defaultAccount
  const chainId = await web3.eth.getChainId()
  const nftFactory = new NftFactory(chainConfig.nftFactoryAddress, web3)
  const nft = new Nft(web3)

  // --------------------------------------------------
  // 1. Create NFT & datatokens & create pricing schema
  // --------------------------------------------------
  // TODO  add try catch error handling
  const { erc721Address, datatokenAddress, txHash } =
    await createTokensAndPricing(assetConfig, publisherAccount, nftFactory)

  const isSuccess = Boolean(erc721Address && datatokenAddress && txHash)
  if (!isSuccess) throw new Error('No Token created. Please try again.')

  // TODO add these to return
  LoggerInstance.debug('[publish] createTokensAndPricing tx', txHash)
  LoggerInstance.debug('[publish] erc721Address', erc721Address)
  LoggerInstance.debug('[publish] datatokenAddress', datatokenAddress)

  // encrypt DDO
  LoggerInstance.debug('[publish] Encrypting DDO...')
  const encryptedDDO = await ProviderInstance.encrypt(
    ddo,
    ddo.chainId,
    chainConfig.providerUri
  )
  if (!encryptedDDO)
    throw new Error('No encrypted DDO received. Please try again.')

  // --------------------------------------------------
  // 3. Write DDO into NFT metadata
  // --------------------------------------------------

  // TODO we should put the metadata update in its own function which can be reused later
  LoggerInstance.debug(
    `[publish] Validating DDO via ${chainConfig.metadataCacheUri}`
  )
  const aquarius = new Aquarius(chainConfig.metadataCacheUri)
  const validateResult = await aquarius.validate(ddo)

  if (!validateResult.valid) throw new Error('Validating Metadata failed')

  const LIFECYCLE_STATE_ACTIVE = 0
  const FLAGS = '0x2' // market sets '0x02' insteadconst validateResult = await aquariusInstance.validate(ddo) of '0x2', theoretically used by aquarius or provider, not implemented yet, will remain hardcoded

  LoggerInstance.debug('[publish] Set Metadata...')
  await nft.setMetadata(
    erc721Address,
    publisherAccount,
    LIFECYCLE_STATE_ACTIVE,
    chainConfig.providerUri,
    '',
    FLAGS,
    encryptedDDO,
    validateResult.hash
  )

  LoggerInstance.debug(`[publish] published asset with DID "${ddo.id}"`)

  return { erc721Address, datatokenAddress, txHash, DID: ddo.id } // TODO return all kinds of addresses and ids, create interface
}

// TODO extract to other file
async function createTokensAndPricing(
  assetConfig: Pick<
    AssetConfig,
    'web3' | 'tokenParamaters' | 'pricing' | 'chainConfig'
  >,
  publisherAccount: string,
  nftFactory: NftFactory
) {
  const { web3, tokenParamaters, pricing, chainConfig } = assetConfig

  // const nftCreateData: NftCreateData = generateNftCreateData(
  //   values.metadata.nft,
  //   publisherAccount,
  //   values.metadata.transferable
  // )
  // LoggerInstance.log('[publish] Creating NFT with metadata', nftCreateData)

  // TODO: cap is hardcoded for now to 1000, this needs to be discussed at some point

  let erc721Address, datatokenAddress, txHash

  switch (pricing.type) {
    case 'fixed': {
      const result = await nftFactory.createNftWithDatatokenWithFixedRate(
        publisherAccount,
        tokenParamaters.nftParams,
        tokenParamaters.datatokenParams,
        pricing.freCreationParams
      )

      erc721Address = result.events.NFTCreated.returnValues[0]
      datatokenAddress = result.events.TokenCreated.returnValues[0]
      txHash = result.transactionHash

      break
    }
    case 'free': {
      // maxTokens -  how many tokens cand be dispensed when someone requests . If maxTokens=2 then someone can't request 3 in one tx
      // maxBalance - how many dt the user has in it's wallet before the dispenser will not dispense dt
      // both will be just 1 for the market

      const dispenserParams: DispenserCreationParams = {
        dispenserAddress: chainConfig.dispenserAddress,
        maxTokens: web3.utils.toWei('1'),
        maxBalance: web3.utils.toWei('1'),
        withMint: true,
        allowedSwapper: '0x0000000000000000000000000000000000000000' // TODO needed?
      }

      const result = await nftFactory.createNftWithDatatokenWithDispenser(
        publisherAccount,
        tokenParamaters.nftParams,
        tokenParamaters.datatokenParams,
        dispenserParams
      )
      erc721Address = result.events.NFTCreated.returnValues[0]
      datatokenAddress = result.events.TokenCreated.returnValues[0]
      txHash = result.transactionHash

      break
    }
    default: {
      throw new Error(
        `Invalid pricing 'type': should be 'fixed' or 'free', is currently: ${pricing.type}`
      )
    }
  }

  return { erc721Address, datatokenAddress, txHash }
}
