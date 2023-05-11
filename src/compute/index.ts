import {
  Asset,
  ComputeAsset,
  ComputeEnvironment,
  ComputeOutput,
  Config,
  LoggerInstance,
  ProviderComputeInitialize,
  ProviderComputeInitializeResults,
  ProviderInstance
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import {
  AssetWithAccessDetails,
  ComputeConfig,
  ComputeResultConfig,
  OrderPriceAndFees
} from '../@types/Compute'
import { getDatatokenBalance, getServiceByName } from '../utils'
import {
  getAssetWithPrice,
  getAssetsWithAccessDetails
} from '../utils/helpers/assets'
import { isOrderable, order, reuseOrder } from '../utils/order'
import {
  approveProviderFee,
  initializeProviderForCompute
} from '../utils/provider'

export async function compute(computeConfig: ComputeConfig) {
  const {
    dataset: datasetConfig, // TODO consider syncing naming with type to prevent renaming
    algorithm: algorithmConfig,
    web3,
    chainConfig,
    additionalDatasets: additionalDatasetsConfig
  } = computeConfig
  const account = web3?.defaultAccount

  if (!datasetConfig || !algorithmConfig || !web3 || !account) {
    LoggerInstance.error('Missing config(s)', {
      datasetConfig,
      algorithmConfig,
      account
    })
    throw new Error('Cannot start compute. Missing config(s).')
  }

  const datasetDid = datasetConfig.did
  const algorithmDid = algorithmConfig.did

  LoggerInstance.log(
    '[compute] Starting compute order for dataset',
    datasetDid,
    '\nwith algorithm',
    algorithmDid,
    '\nfor account',
    account
  )

  const assetIdentifiers = [datasetConfig, algorithmConfig]
  additionalDatasetsConfig?.forEach((dataset) => {
    assetIdentifiers.push(dataset)
  })

  try {
    // 1. Get all assets and access details from DIDs
    const assets = await getAssetsWithAccessDetails(
      assetIdentifiers,
      chainConfig,
      web3
    )

    const dataset = assets.find((asset) => asset.id === datasetDid)
    const algo = assets.find((asset) => asset.id === algorithmDid)
    const additionalDatasets = additionalDatasetsConfig // TODO remove? never used
      ? assets.filter((asset) =>
          additionalDatasetsConfig
            .map((dataset) => dataset.did)
            .includes(asset.id)
        )
      : []

    // 2. Check if the asset is orderable
    // TODO: consider to do this first before loading all other assets
    const computeService = getServiceByName(dataset, 'compute')
    const allowed = await isOrderable(
      // TODO consider isAllowed or similar for boolean
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

    // 3. Initialize the provider
    const computeEnv = await getComputeEnviroment(dataset)

    LoggerInstance.debug('Initializing provider for compute')
    const providerInitializeResults = await initializeProviderForCompute(
      dataset,
      algo,
      web3.defaultAccount,
      computeEnv
    )
    // 4. Get prices and fees for the assets
    const { datasetWithPrice, algorithmWithPrice } =
      await getComputeAssetPrices(
        algo,
        dataset,
        web3,
        chainConfig,
        providerInitializeResults
      )
    if (!datasetWithPrice?.orderPriceAndFees)
      throw new Error('Error setting dataset price and fees!')

    if (!algorithmWithPrice?.orderPriceAndFees)
      throw new Error('Error setting algorithm price and fees!')

    // TODO remove? never used. maybe missing feature to check if datatoken already in wallet?
    const algoDatatokenBalance = await getDatatokenBalance(
      web3,
      algo.services[0].datatokenAddress
    )

    // TODO ==== Extract asset ordering start ====
    const algorithmOrderTx = await handleComputeOrder(
      web3,
      algo,
      algorithmWithPrice?.orderPriceAndFees,
      web3.defaultAccount,
      providerInitializeResults.algorithm,
      chainConfig,
      computeEnv.consumerAddress
    )
    if (!algorithmOrderTx) throw new Error('Failed to order algorithm.')

    // TODO remove? never used. maybe missing feature to check if datatoken already in wallet?
    const datasetDatatokenBalance = await getDatatokenBalance(
      web3,
      algo.services[0].datatokenAddress
    )

    const datasetOrderTx = await handleComputeOrder(
      web3,
      dataset,
      datasetWithPrice?.orderPriceAndFees,
      web3.defaultAccount,
      providerInitializeResults.datasets[0],
      chainConfig,
      computeEnv.consumerAddress
    )
    if (!datasetOrderTx) throw new Error('Failed to order dataset.')

    // ==== Extract asset ordering end ====

    // TODO ==== Extract compute job execution start ====
    LoggerInstance.log('[compute] Starting compute job.')
    const computeAsset: ComputeAsset = {
      documentId: datasetConfig.did,
      serviceId: dataset.services[0].id,
      transferTxId: datasetOrderTx,
      ...datasetConfig
    }

    const output: ComputeOutput = {
      publishAlgorithmLog: true, // TODO should be configuarable
      publishOutput: true // TODO should be configuarable
    }

    const controller = new AbortController()

    const response = await ProviderInstance.computeStart(
      dataset.services[0].serviceEndpoint,
      web3,
      web3.defaultAccount,
      computeEnv?.id,
      computeAsset,
      {
        documentId: algorithmConfig.did,
        serviceId: algo.services[0].id,
        transferTxId: algorithmOrderTx,
        ...algorithmConfig
      },
      controller.signal,
      null,
      output
    )
    if (!response) throw new Error('Error starting compute job.')

    // ==== Extract compute job execution end ====
    LoggerInstance.debug('[compute] Starting compute job response: ', response)
    return response
  } catch (e) {
    LoggerInstance.error(e)
    LoggerInstance.error('Failed computation:', e.message)
  }
}

async function getComputeAssetPrices(
  algo: AssetWithAccessDetails,
  dataset: AssetWithAccessDetails,
  web3: Web3,
  config: Config,
  providerInitializeResults: ProviderComputeInitializeResults
) {
  const datasetWithPrice = await getAssetWithPrice(dataset, web3, config)
  if (!datasetWithPrice?.orderPriceAndFees)
    throw new Error('Error setting dataset price and fees!')

  const algorithmWithPrice = await getAssetWithPrice(algo, web3, config)
  if (!algorithmWithPrice?.orderPriceAndFees)
    throw new Error('Error setting algorithm price and fees!')

  return { datasetWithPrice, algorithmWithPrice }
}

export async function getStatus(computeStatusConfig: any) {
  const { jobId, web3, config } = computeStatusConfig
  LoggerInstance.debug('[compute] Retrieve job status:', {
    jobId,
    config,
    account: web3.defaultAccount
  })
  try {
    const status = await ProviderInstance.computeStatus(
      config.providerUri,
      web3.defaultAccount,
      jobId
    )
    LoggerInstance.debug('[compute] computeStatus response: ', status)

    return Array.isArray(status)
      ? status.find((job) => job.jobId === jobId)
      : status
  } catch (e) {
    LoggerInstance.error(e)
  }
}

export async function retrieveResult(computeResultConfig: ComputeResultConfig) {
  const { config, web3, jobId, resultIndex } = computeResultConfig
  const job = await getStatus(computeResultConfig)

  if (job?.status !== 70) {
    LoggerInstance.log(
      '[compute] Retrieve results: job does not exist or is not yet finished.'
    )
    return
  }

  if (!job?.results || job.results.length < 1) {
    LoggerInstance.error(
      '[compute] Retrieve results: could not find results for the job.'
    )
    return
  }

  const index =
    resultIndex ||
    job.results.indexOf(job.results.find((result) => result.type === 'output'))

  if (index < 0) {
    LoggerInstance.error(
      '[compute] Retrieve results: resultIndex needs to be specified. No default output result found.'
    )
    return
  }

  LoggerInstance.debug(`[compute] Build result url...`)
  return await ProviderInstance.getComputeResultUrl(
    config.providerUri,
    web3,
    web3.defaultAccount,
    jobId,
    index
  )
}

export async function getComputeEnviroment(
  asset: Asset
): Promise<ComputeEnvironment> {
  if (asset?.services[0]?.type !== 'compute') return null
  try {
    // TODO: revisit once ocean.js types are updated
    const computeEnvs: any = await ProviderInstance.getComputeEnvironments(
      asset.services[0].serviceEndpoint
    )

    const chains = computeEnvs as {
      [chainId: string]: ComputeEnvironment[]
    }

    const chainComputeEnvs: ComputeEnvironment[] =
      chains[
        Object.keys(chains).find(
          (chainId) => chainId === asset.chainId.toString()
        )
      ]

    // TODO: provide way to select compute env
    const computeEnv = chainComputeEnvs[0]

    if (!computeEnv) return null
    return computeEnv
  } catch (e) {
    LoggerInstance.error('[compute] Fetch compute enviroment: ', e.message)
  }
}

export async function handleComputeOrder(
  web3: Web3,
  asset: AssetWithAccessDetails,
  orderPriceAndFees: OrderPriceAndFees,
  accountId: string,
  initializeData: ProviderComputeInitialize,
  config: Config,
  computeConsumerAddress?: string
): Promise<string> {
  LoggerInstance.debug(
    '[compute] Handle compute order for asset type: ',
    asset.metadata.type
  )

  try {
    // Return early when valid order is found, and no provider fees
    // are to be paid
    if (initializeData?.validOrder && !initializeData.providerFee) {
      LoggerInstance.debug(
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

      LoggerInstance.debug(
        '[compute] Approved provider fees:',
        txApproveProvider
      )
    }

    if (initializeData?.validOrder) {
      LoggerInstance.debug('[compute] Calling reuseOrder ...', initializeData)
      const txReuseOrder = await reuseOrder(
        web3,
        asset,
        accountId,
        initializeData.validOrder,
        initializeData.providerFee
      )
      if (!txReuseOrder) throw new Error('Failed to reuse order!')
      LoggerInstance.debug('[compute] Reused order:', txReuseOrder)
      return txReuseOrder?.transactionHash
    }

    LoggerInstance.debug('[compute] Calling order ...', initializeData)
    const txStartOrder = await order(
      web3,
      asset,
      orderPriceAndFees,
      accountId,
      config,
      initializeData.providerFee,
      computeConsumerAddress
    )
    LoggerInstance.debug('[compute] Order succeeded', txStartOrder)
    return txStartOrder?.transactionHash
  } catch (error) {
    LoggerInstance.error(`[compute] ${error.message}`)
  }
}
