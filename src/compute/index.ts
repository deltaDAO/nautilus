import {
  amountToUnits,
  approve,
  Asset,
  ComputeAlgorithm,
  ComputeAsset,
  ComputeEnvironment,
  ComputeOutput,
  Datatoken,
  DDO,
  Dispenser,
  FixedRateExchange,
  FreOrderParams,
  LoggerInstance,
  OrderParams,
  PriceAndFees,
  ProviderComputeInitialize,
  ProviderFees,
  ProviderInstance,
  Service,
  unitsToAmount,
  ZERO_ADDRESS
} from '@oceanprotocol/lib'
import { OperationContext, OperationResult } from 'urql'
import {
  AccessDetails,
  AssetWithAccessDetails,
  ComputeConfig,
  ComputeResultConfig,
  OrderPriceAndFees
} from '../@types/Compute'
import {
  TokenPriceQuery,
  TokenPriceQuery_token as TokenPrice
} from '../@types/subgraph/TokenPriceQuery'
import { getAsset } from '../utils/aquarius'
import { fetchData, getAccessDetailsFromTokenPrice } from '../utils/subgraph'
import { tokenPriceQuery } from '../utils/subgraph/queries'
import {
  approveProviderFee,
  initializeProviderForCompute
} from '../utils/provider'
import Web3 from 'web3'
import Decimal from 'decimal.js'
import {
  getDatatokenBalance,
  getOceanConfig,
  getServiceById,
  getServiceByName
} from '../utils'

export async function compute(config: ComputeConfig) {
  const { datasetDid, algorithmDid, web3 } = config
  const account = web3?.defaultAccount

  if (!datasetDid || !algorithmDid || !web3 || !account) {
    LoggerInstance.error('Missing config(s)', {
      datasetDid,
      algorithmDid,
      account
    })
    throw new Error('Cannot start compute. Missing config(s).')
  }
  LoggerInstance.log(
    'Starting compute order for dataset ',
    datasetDid,
    ' with algorithm ',
    algorithmDid,
    ' for ',
    account
  )

  try {
    LoggerInstance.debug(`Using account: ${config.web3.defaultAccount}`)
    LoggerInstance.debug('Retrieve assets from metadata cache ...')
    const controller = new AbortController()

    const assets = await Promise.all([
      getAsset(config.datasetDid, controller.signal),
      getAsset(config.algorithmDid, controller.signal)
    ])

    LoggerInstance.debug('Retrieve access details for assets from subgraph ...')
    const assetAccessDetails = await Promise.all(
      assets.map((a) =>
        getAccessDetails(
          process.env.SUBGRAPH_URI,
          a.datatokens[0].address,
          a.services[0].timeout,
          config.web3.eth.accounts[0]
        )
      )
    )

    const dataset = { ...assets[0], accessDetails: assetAccessDetails[0] }
    const algo = { ...assets[1], accessDetails: assetAccessDetails[1] }
    const computeService = getServiceByName(dataset, 'compute')
    const allowed = await isOrderable(
      dataset,
      computeService.id,
      {
        documentId: algo.id,
        serviceId: algo.services[0].id
      },
      algo
    )
    LoggerInstance.debug('[compute] Is dataset orderable?', allowed)
    if (!allowed)
      throw new Error(
        'Dataset is not orderable in combination with given algorithm.'
      )

    const computeEnv = await getComputeEnviroment(dataset)

    LoggerInstance.debug('Initializing provider for compute')
    const providerInitializeResults = await initializeProviderForCompute(
      dataset,
      algo,
      config.web3.defaultAccount,
      computeEnv
    )

    const providerFeeAmount = await unitsToAmount(
      web3,
      providerInitializeResults?.datasets?.[0]?.providerFee?.providerFeeToken,
      providerInitializeResults?.datasets?.[0]?.providerFee?.providerFeeAmount
    )

    const datasetPriceAndFees = await getOrderPriceAndFees(
      dataset,
      web3,
      providerInitializeResults?.datasets?.[0]?.providerFee
    )
    if (!datasetPriceAndFees)
      throw new Error('Error setting dataset price and fees!')

    const algorithmOrderPriceAndFees = await getOrderPriceAndFees(
      algo,
      web3,
      providerInitializeResults.algorithm.providerFee
    )
    if (!algorithmOrderPriceAndFees)
      throw new Error('Error setting algorithm price and fees!')

    const algoDatatokenBalance = await getDatatokenBalance(
      web3,
      algo.services[0].datatokenAddress
    )

    const algorithmOrderTx = await handleComputeOrder(
      web3,
      algo,
      algorithmOrderPriceAndFees,
      web3.defaultAccount,
      algoDatatokenBalance >= 1,
      providerInitializeResults.algorithm,
      computeEnv.consumerAddress
    )
    if (!algorithmOrderTx) throw new Error('Failed to order algorithm.')

    const datasetDatatokenBalance = await getDatatokenBalance(
      web3,
      algo.services[0].datatokenAddress
    )

    const datasetOrderTx = await handleComputeOrder(
      web3,
      dataset,
      datasetPriceAndFees,
      web3.defaultAccount,
      datasetDatatokenBalance >= 1,
      providerInitializeResults.datasets[0],
      computeEnv.consumerAddress
    )
    if (!datasetOrderTx) throw new Error('Failed to order dataset.')

    LoggerInstance.log('[compute] Starting compute job.')
    const computeAsset: ComputeAsset = {
      documentId: dataset.id,
      serviceId: dataset.services[0].id,
      transferTxId: datasetOrderTx
    }

    const output: ComputeOutput = {
      publishAlgorithmLog: true,
      publishOutput: true
    }

    const response = await ProviderInstance.computeStart(
      dataset.services[0].serviceEndpoint,
      web3,
      web3.defaultAccount,
      computeEnv?.id,
      computeAsset,
      {
        documentId: algo.id,
        serviceId: algo.services[0].id,
        transferTxId: algorithmOrderTx
      },
      controller.signal,
      null,
      output
    )
    if (!response) throw new Error('Error starting compute job.')

    LoggerInstance.log('[compute] Starting compute job response: ', response)
  } catch (e) {
    LoggerInstance.error(e)
    LoggerInstance.error('Failed computation:', e.message)
  }
}

export async function retrieveResult(config: ComputeResultConfig) {}

export async function getComputeEnviroment(
  asset: Asset
): Promise<ComputeEnvironment> {
  if (asset?.services[0]?.type !== 'compute') return null
  try {
    const computeEnvs = await ProviderInstance.getComputeEnvironments(
      asset.services[0].serviceEndpoint
    )
    if (!computeEnvs[0]) return null
    return computeEnvs[0]
  } catch (e) {
    LoggerInstance.error('[compute] Fetch compute enviroment: ', e.message)
  }
}

export function getQueryContext(subgraphUri: string): OperationContext {
  try {
    const queryContext: OperationContext = {
      url: `${subgraphUri}/subgraphs/name/oceanprotocol/ocean-subgraph`,
      requestPolicy: 'network-only'
    }
    return queryContext
  } catch (error) {
    LoggerInstance.error('Get query context error: ', error.message)
  }
}

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

export async function getAccessDetails(
  subgraphuri: string,
  datatokenAddress: string,
  timeout?: number,
  account = ''
): Promise<AccessDetails> {
  try {
    const queryContext = getQueryContext(subgraphuri)
    const tokenQueryResult: OperationResult<
      TokenPriceQuery,
      { datatokenId: string; account: string }
    > = await fetchData(
      tokenPriceQuery,
      {
        datatokenId: datatokenAddress.toLowerCase(),
        account: account?.toLowerCase()
      },
      queryContext
    )

    const tokenPrice: TokenPrice = tokenQueryResult.data.token
    const accessDetails = getAccessDetailsFromTokenPrice(tokenPrice, timeout)
    return accessDetails
  } catch (error) {
    LoggerInstance.error('Error getting access details: ', error.message)
  }
}

/**
 * This will be used to get price including fees before ordering
 * @param {AssetExtended} asset
 * @return {Promise<OrdePriceAndFee>}
 */
export async function getOrderPriceAndFees(
  asset: AssetWithAccessDetails,
  web3: Web3,
  providerFees?: ProviderFees
): Promise<OrderPriceAndFees> {
  const orderPriceAndFee = {
    price: '0',
    publisherMarketOrderFee: asset.accessDetails.publisherMarketOrderFee,
    consumeMarketOrderFee: '0',
    providerFee: {
      providerFeeAmount: '0'
    },
    opcFee: '0'
  } as OrderPriceAndFees

  // fetch provider fee
  const initializeData =
    !providerFees &&
    (await ProviderInstance.initialize(
      asset?.id,
      asset?.services[0].id,
      0,
      web3.defaultAccount,
      asset?.services[0].serviceEndpoint
    ))
  orderPriceAndFee.providerFee = providerFees || initializeData.providerFee

  // fetch price and swap fees
  if (asset?.accessDetails?.type === 'fixed') {
    const fixed = await getFixedBuyPrice(asset?.accessDetails, web3)
    orderPriceAndFee.price = fixed.baseTokenAmount
    orderPriceAndFee.opcFee = fixed.oceanFeeAmount
  }

  // calculate full price, we assume that all the values are in ocean, otherwise this will be incorrect
  orderPriceAndFee.price = new Decimal(+orderPriceAndFee.price || 0)
    .add(new Decimal(+orderPriceAndFee?.consumeMarketOrderFee || 0))
    .add(new Decimal(+orderPriceAndFee?.publisherMarketOrderFee || 0))
    .toString()

  return orderPriceAndFee
}

/**
 * This is used to calculate the price to buy one datatoken from a fixed rate exchange. You need to pass either a web3 object or a chainId. If you pass a chainId a dummy web3 object will be created
 * @param {AccessDetails} accessDetails
 * @param {number} chainId
 * @param {Web3?} web3
 * @return {Promise<PriceAndFees>}
 */
export async function getFixedBuyPrice(
  accessDetails: AccessDetails,
  web3?: Web3
): Promise<PriceAndFees> {
  if (!web3)
    throw new Error("web3 and chainId can't be undefined at the same time!")

  const config = getOceanConfig(await web3.eth.net.getId())

  const fixed = new FixedRateExchange(config.fixedRateExchangeAddress, web3)
  const estimatedPrice = await fixed.calcBaseInGivenDatatokensOut(
    accessDetails.addressOrId,
    '1',
    '0'
  )
  return estimatedPrice
}

export async function handleComputeOrder(
  web3: Web3,
  asset: AssetWithAccessDetails,
  orderPriceAndFees: OrderPriceAndFees,
  accountId: string,
  hasDatatoken: boolean,
  initializeData: ProviderComputeInitialize,
  computeConsumerAddress?: string
): Promise<string> {
  LoggerInstance.log(
    '[compute] Handle compute order for asset type: ',
    asset.metadata.type
  )
  LoggerInstance.log('[compute] Using initializeData: ', initializeData)

  try {
    // Return early when valid order is found, and no provider fees
    // are to be paid
    if (initializeData?.validOrder && !initializeData.providerFee) {
      LoggerInstance.log(
        '[compute] Has valid order: ',
        initializeData.validOrder
      )
      return asset?.accessDetails?.validOrderTx
    }

    // Approve potential Provider fee amount first
    if (initializeData?.providerFee?.providerFeeAmount !== '0') {
      const txApproveProvider = await approveProviderFee(
        asset,
        accountId,
        web3,
        initializeData.providerFee.providerFeeAmount
      )

      if (!txApproveProvider)
        throw new Error('Failed to approve provider fees!')

      LoggerInstance.log('[compute] Approved provider fees:', txApproveProvider)
    }

    if (initializeData?.validOrder) {
      LoggerInstance.log('[compute] Calling reuseOrder ...', initializeData)
      const txReuseOrder = await reuseOrder(
        web3,
        asset,
        accountId,
        initializeData.validOrder,
        initializeData.providerFee
      )
      if (!txReuseOrder) throw new Error('Failed to reuse order!')
      LoggerInstance.log('[compute] Reused order:', txReuseOrder)
      return txReuseOrder?.transactionHash
    }

    LoggerInstance.log('[compute] Calling order ...', initializeData)
    const txStartOrder = await startOrder(
      web3,
      asset,
      orderPriceAndFees,
      accountId,
      hasDatatoken,
      initializeData,
      computeConsumerAddress
    )
    LoggerInstance.log('[compute] Order succeeded', txStartOrder)
    return txStartOrder?.transactionHash
  } catch (error) {
    LoggerInstance.error(`[compute] ${error.message}`)
  }
}

async function startOrder(
  web3: Web3,
  asset: AssetWithAccessDetails,
  orderPriceAndFees: OrderPriceAndFees,
  accountId: string,
  hasDatatoken: boolean,
  initializeData: ProviderComputeInitialize,
  computeConsumerAddress?: string
): Promise<any> {
  const tx = await order(
    web3,
    asset,
    orderPriceAndFees,
    accountId,
    initializeData.providerFee,
    computeConsumerAddress
  )
  LoggerInstance.log('[compute] Asset ordered:', tx)
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

export async function order(
  web3: Web3,
  asset: AssetWithAccessDetails,
  orderPriceAndFees: OrderPriceAndFees,
  accountId: string,
  providerFees: ProviderFees,
  computeConsumerAddress: string
): Promise<any> {
  const datatoken = new Datatoken(web3)
  const config = getOceanConfig(asset.chainId)

  const orderParams = {
    consumer: computeConsumerAddress || accountId,
    serviceIndex: 0,
    _providerFee: providerFees,
    _consumeMarketFee: {
      consumeMarketFeeAddress: ZERO_ADDRESS,
      consumeMarketFeeAmount: '0',
      consumeMarketFeeToken:
        asset?.accessDetails?.baseToken?.address ||
        '0x0000000000000000000000000000000000000000'
    }
  } as OrderParams

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
      if (asset.accessDetails.templateId === 1) {
        const dispenser = new Dispenser(config.dispenserAddress, web3)
        const dispenserTx = await dispenser.dispense(
          asset.accessDetails?.datatoken.address,
          accountId,
          '1',
          accountId
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
        return await datatoken.buyFromDispenserAndOrder(
          asset.services[0].datatokenAddress,
          accountId,
          orderParams,
          config.dispenserAddress
        )
      }
    }
  }
}
