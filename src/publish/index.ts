import {
  Aquarius,
  Datatoken,
  DispenserParams,
  LoggerInstance,
  Nft,
  NftFactory,
  ProviderInstance
} from '@oceanprotocol/lib'
import {
  CreateAssetConfig,
  CreateDatatokenConfig,
  PublishDDOConfig
} from '../@types/Publish'
import { utils as ethersUtils, providers } from 'ethers'

export async function createAsset(assetConfig: CreateAssetConfig) {
  LoggerInstance.debug('[publish] Publishing new asset NFT...')
  // --------------------------------------------------
  // 1. Create NFT with NftFactory
  // --------------------------------------------------
  const { signer, chainConfig, nftParams } = assetConfig
  const publisherAccount = await signer?.getAddress()
  const nftFactory = new NftFactory(
    chainConfig.nftFactoryAddress,
    signer,
    chainConfig.network,
    chainConfig
  )

  // TODO  add try catch error handling
  const nftAddress = await nftFactory.createNFT(nftParams)

  LoggerInstance.debug('[publish] NFT published:', nftAddress)
  return { nftAddress }
}

export async function createDatatokenAndPricing(config: CreateDatatokenConfig) {
  // --------------------------------------------------
  // 1. Create Datatoken
  // --------------------------------------------------
  LoggerInstance.debug('[publish] Creating datatoken...')
  const { chainConfig, signer, nftAddress, datatokenParams, pricing } = config
  const publisherAccount = await signer?.getAddress()

  const nft = new Nft(signer, chainConfig.network, chainConfig)

  const datatokenAddress = await nft.createDatatoken(
    nftAddress,
    publisherAccount,
    datatokenParams.minter,
    datatokenParams.paymentCollector,
    datatokenParams.mpFeeAddress,
    datatokenParams.feeToken,
    datatokenParams.feeAmount,
    datatokenParams.cap,
    datatokenParams.name,
    datatokenParams.symbol,
    datatokenParams.templateIndex
  )

  LoggerInstance.debug('[publish] Datatoken created.', datatokenAddress)

  // --------------------------------------------------
  // 2. Create Pricing
  // --------------------------------------------------
  const datatoken = new Datatoken(signer, chainConfig.network, chainConfig)

  const dispenserParams: DispenserParams = {
    maxTokens: ethersUtils.parseEther('1').toString(),
    maxBalance: ethersUtils.parseEther('1').toString(),
    withMint: true,
    allowedSwapper: '0x0000000000000000000000000000000000000000' // TODO needed?
  }

  let pricingTransactionReceipt: providers.TransactionResponse
  switch (pricing.type) {
    case 'fixed':
      LoggerInstance.debug(
        '[publish] Creating fixed rate exchange for datatoken...',
        { datatokenAddress, pricing }
      )
      pricingTransactionReceipt = await datatoken.createFixedRate(
        datatokenAddress,
        publisherAccount,
        {
          ...pricing.freCreationParams,
          fixedRate: ethersUtils
            .parseEther(pricing.freCreationParams.fixedRate)
            .toString(),
          marketFee: ethersUtils
            .parseEther(pricing.freCreationParams.marketFee)
            .toString()
        }
      )
      break
    case 'free':
      LoggerInstance.debug('[publish] Creating dispenser for datatoken...', {
        pricing,
        datatoken,
        datatokenAddress,
        publisherAccount,
        dispenserAddress: chainConfig.dispenserAddress,
        dispenserParams
      })
      pricingTransactionReceipt = await datatoken.createDispenser(
        datatokenAddress,
        publisherAccount,
        chainConfig.dispenserAddress,
        dispenserParams
      )
  }

  LoggerInstance.debug(
    '[publish] Pricing scheme created.',
    pricingTransactionReceipt
  )

  return { datatokenAddress, pricingTransactionReceipt }
}

export async function publishDDO(config: PublishDDOConfig) {
  const { chainConfig, signer, ddo } = config
  const publisherAccount = await signer?.getAddress()

  // --------------------------------------------------
  // 1. Validate DDO schema
  // --------------------------------------------------
  LoggerInstance.debug(
    `[publish] Validating DDO via ${chainConfig.metadataCacheUri}`
  )
  const aquarius = new Aquarius(chainConfig.metadataCacheUri)
  const validateResult = await aquarius.validate(ddo)

  if (!validateResult.valid) throw new Error('Validating Metadata failed')

  // --------------------------------------------------
  // 2. Encrypt DDO
  // --------------------------------------------------
  LoggerInstance.debug('[publish] Encrypting DDO...')
  const encryptedDDO = await ProviderInstance.encrypt(
    ddo,
    chainConfig.chainId,
    chainConfig.providerUri
  )
  if (!encryptedDDO)
    throw new Error('No encrypted DDO received. Please try again.')

  // --------------------------------------------------
  // 3. Write DDO into NFT metadata
  // --------------------------------------------------
  const nft = new Nft(signer, chainConfig.network, chainConfig)

  // TODO: let user set state
  const LIFECYCLE_STATE_ACTIVE = 0
  const FLAGS = '0x02' // market sets '0x02' insteadconst validateResult = await aquariusInstance.validate(ddo) of '0x2', theoretically used by aquarius or provider, not implemented yet, will remain hardcoded

  LoggerInstance.debug('[publish] Set Metadata...')
  const transactionReceipt = await nft.setMetadata(
    ddo.nftAddress,
    publisherAccount,
    LIFECYCLE_STATE_ACTIVE,
    chainConfig.providerUri,
    '',
    FLAGS,
    encryptedDDO,
    validateResult.hash
  )

  LoggerInstance.debug(`[publish] Published metadata on NFT.`, {
    ddo,
    transactionReceipt
  })

  return { transactionReceipt }
}

// TODO evaluate if we need these (1 transaction for multiple actions)
// async function createTokensAndPricing(
//   assetConfig: Pick<
//     PublishAssetConfig,
//     'web3' | 'tokenParamaters' | 'pricing' | 'chainConfig'
//   >,
//   publisherAccount: string,
//   nftFactory: NftFactory
// ) {
//   const { web3, tokenParamaters, pricing, chainConfig } = assetConfig

//   // const nftCreateData: NftCreateData = generateNftCreateData(
//   //   values.metadata.nft,
//   //   publisherAccount,
//   //   values.metadata.transferable
//   // )
//   // LoggerInstance.log('[publish] Creating NFT with metadata', nftCreateData)

//   // TODO: cap is hardcoded for now to 1000, this needs to be discussed at some point

//   let erc721Address, datatokenAddress, txHash

//   switch (pricing.type) {
//     case 'fixed': {
//       const result = await nftFactory.createNftWithDatatokenWithFixedRate(
//         publisherAccount,
//         tokenParamaters.nftParams,
//         tokenParamaters.datatokenParams,
//         pricing.freCreationParams
//       )

//       erc721Address = result.events.NFTCreated.returnValues[0]
//       datatokenAddress = result.events.TokenCreated.returnValues[0]
//       txHash = result.transactionHash

//       break
//     }
//     case 'free': {
//       // maxTokens -  how many tokens cand be dispensed when someone requests . If maxTokens=2 then someone can't request 3 in one tx
//       // maxBalance - how many dt the user has in it's wallet before the dispenser will not dispense dt
//       // both will be just 1 for the market

//       const dispenserParams: DispenserCreationParams = {
//         dispenserAddress: chainConfig.dispenserAddress,
//         maxTokens: web3.utils.toWei('1'),
//         maxBalance: web3.utils.toWei('1'),
//         withMint: true,
//         allowedSwapper: '0x0000000000000000000000000000000000000000' // TODO needed?
//       }

//       const result = await nftFactory.createNftWithDatatokenWithDispenser(
//         publisherAccount,
//         tokenParamaters.nftParams,
//         tokenParamaters.datatokenParams,
//         dispenserParams
//       )
//       erc721Address = result.events.NFTCreated.returnValues[0]
//       datatokenAddress = result.events.TokenCreated.returnValues[0]
//       txHash = result.transactionHash

//       break
//     }
//     default: {
//       throw new Error(
//         `Invalid pricing 'type': should be 'fixed' or 'free', is currently: ${pricing.type}`
//       )
//     }
//   }

//   return { erc721Address, datatokenAddress, txHash }
// }
