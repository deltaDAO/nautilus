import { AssetConfig, PrePublishDDO } from '../@types/Publish'
import {
  DDO,
  NftFactory,
  LoggerInstance,
  generateDid,
  Nft,
  ProviderInstance,
  getHash,
  DispenserCreationParams,
  Service,
  Aquarius
} from '@oceanprotocol/lib'
import { SHA256 } from 'crypto-js'

export async function publishAsset(assetConfig: AssetConfig) {
  // TODO don't forget to set return type
  const { web3, metadata, services, chainConfig } = assetConfig
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

  // --------------------------------------------------
  // 2. Construct and encrypt DDO
  // --------------------------------------------------

  // add timestamps to metadata
  const currentTime = dateToStringNoMS(new Date())
  const ddoMetadata = {
    created: currentTime,
    updated: currentTime,
    ...metadata
  }

  const prePublishDDO: PrePublishDDO = {
    '@context': ['https://w3id.org/did/v1'],
    id: generateDid(erc721Address, chainId),
    version: '4.1.0',
    chainId,
    nftAddress: erc721Address,
    metadata: ddoMetadata,
    services
  }

  LoggerInstance.debug({ prePublishDDO })

  LoggerInstance.debug(
    '[publish] Encrypting files via',
    chainConfig.providerUri
  )
  // encrypt files
  const assetURL = {
    datatokenAddress,
    nftAddress: erc721Address,
    files: services[0].files // TODO: support multiple services.files (?)
  }

  const encryptedFiles = await ProviderInstance.encrypt(
    assetURL,
    prePublishDDO.chainId,
    chainConfig.providerUri
  )
  LoggerInstance.debug('[publish] Encrypted files:', encryptedFiles)

  // add encrypted files to DDO
  const service: Service = {
    ...prePublishDDO.services[0], // TODO: support multiple services.files (?)
    id: SHA256(encryptedFiles).toString(),
    files: encryptedFiles,
    datatokenAddress
  }

  const ddo: DDO = { ...prePublishDDO, services: [service] }

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

function dateToStringNoMS(date: Date): string {
  return date.toISOString().replace(/\.[0-9]{3}Z/, 'Z')
}

// TODO extract to other file
async function createTokensAndPricing(
  assetConfig: AssetConfig,
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
