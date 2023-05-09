import {
  Asset,
  ComputeAlgorithm,
  Config,
  Datatoken,
  Dispenser,
  FixedRateExchange,
  FreOrderParams,
  LoggerInstance,
  OrderParams,
  ProviderComputeInitialize,
  ProviderFees,
  Service,
  ZERO_ADDRESS,
  amountToUnits,
  approve
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { getServiceById } from '.'
import { AssetWithAccessDetails, OrderPriceAndFees } from '../@types'

export async function isOrderable(
  asset: Asset,
  serviceId: string,
  algorithm: ComputeAlgorithm,
  algorithmAsset: Asset
): Promise<boolean> {
  const datasetService: Service = getServiceById(asset, serviceId)
  if (!datasetService) return false

  if (datasetService.type === 'compute') {
    if (algorithm.meta) {
      // check if raw algo is allowed
      if (datasetService.compute.allowRawAlgorithm) return true
      LoggerInstance.error('ERROR: This service does not allow raw algorithm')
      return false
    }
    if (algorithm.documentId) {
      const algoService: Service = getServiceById(
        algorithmAsset,
        algorithm.serviceId
      )
      if (algoService && algoService.type === 'compute') {
        if (algoService.serviceEndpoint !== datasetService.serviceEndpoint) {
          LoggerInstance.error(
            'ERROR: Both assets with compute service are not served by the same provider'
          )
          return false
        }
      }
    }
  }
  return true
}

export async function startOrder(
  web3: Web3,
  asset: AssetWithAccessDetails,
  orderPriceAndFees: OrderPriceAndFees,
  accountId: string,
  config: Config,
  initializeData?: ProviderComputeInitialize,
  computeConsumerAddress?: string
) {
  const tx = await order(
    web3,
    asset,
    orderPriceAndFees,
    accountId,
    config,
    initializeData?.providerFee || orderPriceAndFees.providerFee,
    computeConsumerAddress
  )
  LoggerInstance.debug('[compute] Asset ordered:', tx)
  return tx
}

export async function reuseOrder(
  web3: Web3,
  asset: AssetWithAccessDetails,
  accountId: string,
  validOrderTx: string,
  providerFees: ProviderFees
): Promise<any> {
  const datatoken = new Datatoken(web3)

  const tx = await datatoken.reuseOrder(
    asset.accessDetails.datatoken.address,
    accountId,
    validOrderTx,
    providerFees
  )

  return tx
}

async function order(
  web3: Web3,
  asset: AssetWithAccessDetails,
  orderPriceAndFees: OrderPriceAndFees,
  accountId: string,
  config: Config,
  providerFees?: ProviderFees,
  computeConsumerAddress?: string
) {
  const datatoken = new Datatoken(web3)

  const orderParams = {
    consumer: computeConsumerAddress || accountId,
    serviceIndex: 0,
    _providerFee: providerFees,
    _consumeMarketFee: {
      consumeMarketFeeAddress: ZERO_ADDRESS,
      consumeMarketFeeAmount: '0',
      consumeMarketFeeToken: '0x0000000000000000000000000000000000000000'
    }
  } as OrderParams

  LoggerInstance.debug('[order] orderParams', orderParams)

  LoggerInstance.debug('[order] order type', asset.accessDetails?.type)

  switch (asset.accessDetails?.type) {
    case 'fixed': {
      // this assumes all fees are in ocean

      const freParams = {
        exchangeContract: config.fixedRateExchangeAddress,
        exchangeId: asset.accessDetails.addressOrId,
        maxBaseTokenAmount: orderPriceAndFees.price,
        baseTokenAddress: asset?.accessDetails?.baseToken?.address,
        baseTokenDecimals: asset?.accessDetails?.baseToken?.decimals || 18,
        swapMarketFee: '0',
        marketFeeAddress: ZERO_ADDRESS
      } as FreOrderParams

      if (asset.accessDetails.templateId === 1) {
        // buy datatoken
        const txApprove = await approve(
          web3,
          config,
          accountId,
          asset.accessDetails.baseToken.address,
          config.fixedRateExchangeAddress,
          await amountToUnits(
            web3,
            asset?.accessDetails?.baseToken?.address,
            orderPriceAndFees.price
          ),
          false
        )
        if (!txApprove) {
          return
        }
        const fre = new FixedRateExchange(config.fixedRateExchangeAddress, web3)
        const freTx = await fre.buyDatatokens(
          accountId,
          asset.accessDetails?.addressOrId,
          '1',
          orderPriceAndFees.price,
          ZERO_ADDRESS,
          '0'
        )

        return await datatoken.startOrder(
          asset.accessDetails.datatoken.address,
          accountId,
          orderParams.consumer,
          orderParams.serviceIndex,
          orderParams._providerFee,
          orderParams._consumeMarketFee
        )
      }
      if (asset.accessDetails.templateId === 2) {
        const txApprove = await approve(
          web3,
          config,
          accountId,
          asset.accessDetails.baseToken.address,
          asset.accessDetails.datatoken.address,
          await amountToUnits(
            web3,
            asset?.accessDetails?.baseToken?.address,
            orderPriceAndFees.price
          ),
          false
        )
        if (!txApprove) {
          return
        }
        return await datatoken.buyFromFreAndOrder(
          asset.accessDetails.datatoken.address,
          accountId,
          orderParams,
          freParams
        )
      }
      break
    }
    case 'free': {
      LoggerInstance.debug(
        '[order] order with type "free" for templateId:',
        asset.accessDetails.templateId
      )

      if (asset.accessDetails.templateId === 1) {
        const dispenser = new Dispenser(config.dispenserAddress, web3)
        LoggerInstance.debug('[order] free order: dispenser', dispenser.address)
        const dispenserTx = await dispenser.dispense(
          asset.accessDetails?.datatoken.address,
          accountId,
          '1',
          accountId
        )
        LoggerInstance.debug(
          '[order] free order: dispenser tx',
          dispenserTx.transactionHash
        )

        return await datatoken.startOrder(
          asset.accessDetails.datatoken.address,
          accountId,
          orderParams.consumer,
          orderParams.serviceIndex,
          orderParams._providerFee,
          orderParams._consumeMarketFee
        )
      }
      if (asset.accessDetails.templateId === 2) {
        LoggerInstance.debug('[order] buying from datatoken', {
          datatoken: asset.services[0].datatokenAddress,
          accountId,
          orderParams,
          dispenser: config.dispenserAddress
        })
        try {
          return await datatoken.buyFromDispenserAndOrder(
            asset.services[0].datatokenAddress,
            accountId,
            orderParams,
            config.dispenserAddress
          )
        } catch (e) {
          throw new Error(e)
        }
      }
    }
  }
}
