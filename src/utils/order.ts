import {
  type Asset,
  type ComputeAlgorithm,
  type Config,
  Datatoken,
  Dispenser,
  FixedRateExchange,
  type FreOrderParams,
  LoggerInstance,
  type OrderParams,
  type ProviderFees,
  type Service,
  ZERO_ADDRESS,
  amountToUnits,
  approve
} from '@oceanprotocol/lib'
import type { Signer, providers } from 'ethers'
import { getServiceById } from '.'
import type { AssetWithAccessDetails, OrderPriceAndFees } from '../@types'

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

export async function reuseOrder({
  signer,
  asset,
  validOrderTx,
  providerFees
}: {
  signer: Signer
  asset: AssetWithAccessDetails
  validOrderTx: string
  providerFees: ProviderFees
}): Promise<providers.TransactionResponse> {
  const datatoken = new Datatoken(signer)

  const tx = await datatoken.reuseOrder(
    asset.accessDetails.datatoken.address,
    validOrderTx,
    providerFees
  )

  return tx
}

export async function order({
  signer,
  asset,
  orderPriceAndFees,
  accountId,
  config,
  providerFees,
  computeConsumerAddress
}: {
  signer: Signer
  asset: AssetWithAccessDetails
  orderPriceAndFees: OrderPriceAndFees
  accountId: string
  config: Config
  providerFees?: ProviderFees
  computeConsumerAddress?: string
}) {
  const datatoken = new Datatoken(signer)

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

  const templateId = Number(asset.accessDetails?.templateId)
  LoggerInstance.debug('[order] order templateId', templateId)

  switch (asset.accessDetails?.type) {
    case 'fixed': {
      const freParams = {
        exchangeContract: config.fixedRateExchangeAddress,
        exchangeId: asset.accessDetails.addressOrId,
        maxBaseTokenAmount: orderPriceAndFees.price,
        baseTokenAddress: asset?.accessDetails?.baseToken?.address,
        baseTokenDecimals: asset?.accessDetails?.baseToken?.decimals || 18,
        swapMarketFee: '0',
        marketFeeAddress: ZERO_ADDRESS
      } as FreOrderParams

      if (templateId === 1) {
        // buy datatoken
        const tx = await approve(
          signer,
          config,
          accountId,
          asset.accessDetails.baseToken.address,
          config.fixedRateExchangeAddress,
          await amountToUnits(
            signer,
            asset?.accessDetails?.baseToken?.address,
            orderPriceAndFees.price,
            asset?.accessDetails?.baseToken?.decimals
          ),
          false
        )

        const txApprove = typeof tx !== 'number' ? await tx.wait() : tx

        if (!txApprove) {
          LoggerInstance.error('Unable to approve datatoken tx')
          return
        }
        const fre = new FixedRateExchange(
          config.fixedRateExchangeAddress,
          signer
        )
        const freTx = await fre.buyDatatokens(
          asset.accessDetails?.addressOrId,
          '1',
          orderPriceAndFees.price,
          ZERO_ADDRESS,
          '0'
        )
        await freTx.wait()

        return await datatoken.startOrder(
          asset.accessDetails.datatoken.address,
          orderParams.consumer,
          orderParams.serviceIndex,
          orderParams._providerFee,
          orderParams._consumeMarketFee
        )
      }

      if (templateId === 2) {
        const tx = await approve(
          signer,
          config,
          accountId,
          asset.accessDetails.baseToken.address,
          asset.accessDetails.datatoken.address,
          await amountToUnits(
            signer,
            asset?.accessDetails?.baseToken?.address,
            orderPriceAndFees.price,
            asset?.accessDetails?.baseToken?.decimals
          ),
          false
        )

        const txApprove = typeof tx !== 'number' ? await tx.wait() : tx

        if (!txApprove) {
          LoggerInstance.error('Unable to approve datatoken tx')
          return
        }

        return await datatoken.buyFromFreAndOrder(
          asset.accessDetails.datatoken.address,
          orderParams,
          freParams
        )
      }
      break
    }
    case 'free': {
      LoggerInstance.debug(
        '[order] order with type "free" for templateId:',
        templateId
      )

      if (templateId === 1) {
        const dispenser = new Dispenser(config.dispenserAddress, signer)
        LoggerInstance.debug('[order] free order: dispenser', dispenser.address)
        const dispenserTx = await dispenser.dispense(
          asset.accessDetails?.datatoken.address,
          '1',
          accountId
        )
        await dispenserTx.wait()

        LoggerInstance.debug(
          '[order] free order: dispenser tx',
          dispenserTx.hash
        )

        return await datatoken.startOrder(
          asset.accessDetails.datatoken.address,
          orderParams.consumer,
          orderParams.serviceIndex,
          orderParams._providerFee,
          orderParams._consumeMarketFee
        )
      }
      if (templateId === 2) {
        LoggerInstance.debug('[order] buying from datatoken', {
          datatoken: asset.services[0].datatokenAddress,
          accountId,
          orderParams,
          dispenser: config.dispenserAddress
        })
        try {
          return await datatoken.buyFromDispenserAndOrder(
            asset.services[0].datatokenAddress,
            orderParams,
            config.dispenserAddress
          )
        } catch (e) {
          throw new Error(e)
        }
      }
      break
    }
  }
}
