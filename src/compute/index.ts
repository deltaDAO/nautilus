import {
  type Asset,
  type ComputeAsset,
  type ComputeEnvironment,
  type ComputeOutput,
  type Config,
  LoggerInstance,
  type ProviderComputeInitialize,
  type ProviderComputeInitializeResults,
  ProviderInstance
} from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type {
  AssetWithAccessDetails,
  AssetWithAccessDetailsAndPrice,
  ComputeConfig,
  ComputeResultConfig,
  ComputeStatusConfig,
  OrderPriceAndFees,
  StopComputeConfig
} from '../@types/Compute'
import { getDatatokenBalance, getServiceByName } from '../utils'
import {
  getAssetWithPrice,
  getAssetsWithAccessDetails
} from '../utils/helpers/assets'
import { isOrderable, order, reuseOrder } from '../utils/order'
import {
  approveProviderFee,
  initializeProviderForCompute,
  startComputeJob,
  stopComputeJob
} from '../utils/provider'

export async function compute(computeConfig: ComputeConfig) {
  const {
    dataset: datasetConfig, // TODO consider syncing naming to prevent renaming
    algorithm: algorithmConfig,
    signer,
    chainConfig,
    additionalDatasets: additionalDatasetsConfig
  } = computeConfig

  const signerAddress = await signer.getAddress()

  if (!datasetConfig || !algorithmConfig || !signer || !signerAddress) {
    LoggerInstance.error('Missing config(s)', {
      datasetConfig,
      algorithmConfig,
      account: signerAddress
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
    signerAddress
  )

  const assetIdentifiers = [datasetConfig, algorithmConfig]

  // add additional datasets to identifiers, if they are set
  if (additionalDatasetsConfig)
    for (const dataset of additionalDatasetsConfig)
      assetIdentifiers.push(dataset)

  try {
    // 1. Get all assets and access details from DIDs
    const assets = await getAssetsWithAccessDetails(
      assetIdentifiers,
      chainConfig,
      signer
    )

    const dataset = assets.find((asset) => asset.id === datasetDid)
    const algo = assets.find((asset) => asset.id === algorithmDid)

    const additionalDatasets = additionalDatasetsConfig
      ? assets.filter((asset) =>
          additionalDatasetsConfig
            .map((dataset) => dataset.did)
            .includes(asset.id)
        )
      : []

    // 2. Check if the asset is orderable
    // TODO: consider to do this first before loading all other assets
    const isDatasetOrderable = isComputeAssetOrderable(dataset, algo)
    LoggerInstance.debug('[compute] Is dataset orderable?', isDatasetOrderable)

    if (!isDatasetOrderable)
      throw new Error(
        'Dataset is not orderable in combination with given algorithm.'
      )

    for (const dataset of additionalDatasets) {
      const isAdditionalDatasetOrderable = isComputeAssetOrderable(
        dataset,
        algo
      )
      LoggerInstance.debug(
        '[compute] Is additional dataset orderable?',
        isAdditionalDatasetOrderable
      )
      if (!isAdditionalDatasetOrderable)
        throw new Error(
          'Additional dataset is not orderable in combination with given algorithm.'
        )
    }

    // 3. Initialize the provider
    const computeEnv = await getComputeEnviroment(dataset)

    LoggerInstance.debug('Initializing provider for compute')
    const providerInitializeResults = await initializeProviderForCompute(
      dataset,
      algo,
      signerAddress,
      computeEnv,
      additionalDatasets
    )

    // 4. Get prices and fees for the assets
    const { datasetWithPrice, algorithmWithPrice } =
      await getComputeAssetPrices(
        algo,
        dataset,
        signer,
        chainConfig,
        providerInitializeResults
      )
    if (!datasetWithPrice?.orderPriceAndFees)
      throw new Error('Error setting dataset price and fees!')

    if (!algorithmWithPrice?.orderPriceAndFees)
      throw new Error('Error setting algorithm price and fees!')

    const additionalDatasetsWithPrice: AssetWithAccessDetailsAndPrice[] = []
    for (const additionalDataset of additionalDatasets) {
      const additionalDatasetWithPrice = await getAssetWithPrice(
        additionalDataset,
        signer,
        chainConfig,
        getProviderInitResultsForDataset(
          providerInitializeResults.datasets,
          additionalDataset
        ).providerFee
      )
      additionalDatasetsWithPrice.push(additionalDatasetWithPrice)
    }

    // TODO ==== Extract asset ordering start ====
    const algorithmOrderTx = await handleComputeOrder(
      signer,
      algo,
      algorithmWithPrice?.orderPriceAndFees,
      signerAddress,
      providerInitializeResults.algorithm,
      chainConfig,
      computeEnv.consumerAddress
    )
    if (!algorithmOrderTx) throw new Error('Failed to order algorithm.')

    const datasetOrderTx = await handleComputeOrder(
      signer,
      dataset,
      datasetWithPrice?.orderPriceAndFees,
      signerAddress,
      getProviderInitResultsForDataset(
        providerInitializeResults.datasets,
        dataset
      ),
      chainConfig,
      computeEnv.consumerAddress
    )
    if (!datasetOrderTx) throw new Error('Failed to order dataset.')

    const additionalDatasetOrderTxs: {
      documentId: string
      orderTx: string
    }[] = []
    for (const additionalDatasetWithPrice of additionalDatasetsWithPrice) {
      const orderTx = await handleComputeOrder(
        signer,
        additionalDatasetWithPrice,
        additionalDatasetWithPrice?.orderPriceAndFees,
        signerAddress,
        getProviderInitResultsForDataset(
          providerInitializeResults.datasets,
          additionalDatasetWithPrice
        ),
        chainConfig,
        computeEnv.consumerAddress
      )
      if (!orderTx)
        throw new Error(
          `Failed to order additional dataset with id ${additionalDatasetWithPrice.id}.`
        )
      additionalDatasetOrderTxs.push({
        documentId: additionalDatasetWithPrice.id,
        orderTx
      })
    }

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

    const additionalComputeAssets: ComputeAsset[] = []
    for (const additionalDataset of additionalDatasets) {
      const additionalComputeAsset: ComputeAsset = {
        documentId: additionalDataset.id,
        serviceId: additionalDataset.services[0].id,
        transferTxId: additionalDatasetOrderTxs.find(
          (order) => order.documentId === additionalDataset.id
        ).orderTx,
        ...additionalDataset
      }
      additionalComputeAssets.push(additionalComputeAsset)
    }

    const response = await startComputeJob(
      dataset.services[0].serviceEndpoint,
      computeAsset,
      {
        documentId: algorithmConfig.did,
        serviceId: algo.services[0].id,
        transferTxId: algorithmOrderTx,
        ...algorithmConfig
      },
      signer,
      computeEnv,
      output,
      additionalComputeAssets
    )

    // ==== Extract compute job execution end ====
    LoggerInstance.debug('[compute] Starting compute job response: ', response)
    return response
  } catch (e) {
    LoggerInstance.error(e)
    LoggerInstance.error('Failed computation:', e.message)
  }
}

async function isComputeAssetOrderable(
  asset: AssetWithAccessDetails,
  algorithm: AssetWithAccessDetails
) {
  const computeService = getServiceByName(asset, 'compute')
  const isAllowed = await isOrderable(
    asset,
    computeService.id,
    {
      documentId: algorithm.id,
      serviceId: algorithm.services[0].id
    },
    algorithm
  )
  LoggerInstance.debug('[compute] Is dataset orderable?', isAllowed)
  return isAllowed
}

async function getComputeAssetPrices(
  algo: AssetWithAccessDetails,
  dataset: AssetWithAccessDetails,
  signer: Signer,
  config: Config,
  providerInitializeResults: ProviderComputeInitializeResults
) {
  LoggerInstance.debug('Initializing provider for compute')

  const datasetInitializeResult = getProviderInitResultsForDataset(
    providerInitializeResults.datasets,
    dataset
  )

  const datasetWithPrice = await getAssetWithPrice(
    dataset,
    signer,
    config,
    datasetInitializeResult.providerFee
  )

  if (!datasetWithPrice?.orderPriceAndFees)
    throw new Error('Error setting dataset price and fees!')

  const algorithmWithPrice = await getAssetWithPrice(
    algo,
    signer,
    config,
    providerInitializeResults.algorithm.providerFee
  )
  if (!algorithmWithPrice?.orderPriceAndFees)
    throw new Error('Error setting algorithm price and fees!')

  return { datasetWithPrice, algorithmWithPrice }
}

export async function getStatus(computeStatusConfig: ComputeStatusConfig) {
  const { jobId, signer, providerUri } = computeStatusConfig
  const signerAddress = await signer.getAddress()

  LoggerInstance.debug('[compute] Retrieve job status:', {
    jobId,
    providerUri,
    account: signerAddress
  })
  try {
    const status = await ProviderInstance.computeStatus(
      providerUri,
      signerAddress,
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
  const { providerUri, signer, jobId, resultIndex } = computeResultConfig
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
      '[compute] Retrieve results: resultIndex needs to be specified. No default output result found.',
      index
    )
    return
  }

  LoggerInstance.debug('[compute] Build result url...')
  return await ProviderInstance.getComputeResultUrl(
    providerUri,
    signer,
    jobId,
    index
  )
}

export async function getComputeEnviroment(
  asset: Asset
): Promise<ComputeEnvironment> {
  if (asset?.services[0]?.type !== 'compute') return null
  try {
    const computeEnvs = await ProviderInstance.getComputeEnvironments(
      asset.services[0].serviceEndpoint
    )

    // TODO: provide way to select compute env
    const computeEnv = Array.isArray(computeEnvs)
      ? computeEnvs[0]
      : computeEnvs[asset.chainId][0]

    if (!computeEnv) return null
    return computeEnv
  } catch (e) {
    LoggerInstance.error('[compute] Fetch compute enviroment: ', e.message)
  }
}

export async function handleComputeOrder(
  signer: Signer,
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
    if (initializeData?.validOrder && !initializeData?.providerFee) {
      LoggerInstance.debug(
        '[compute] Has valid order: ',
        initializeData.validOrder
      )
      return asset?.accessDetails?.validOrderTx
    }

    // Approve potential Provider fee amount first
    if (
      initializeData?.providerFee?.providerFeeAmount &&
      initializeData?.providerFee?.providerFeeAmount !== '0'
    ) {
      const txApproveProvider = await approveProviderFee(
        asset,
        accountId,
        signer,
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
      const txReuseOrder = await reuseOrder({
        signer,
        asset,
        validOrderTx: initializeData.validOrder,
        providerFees: initializeData.providerFee
      })
      if (!txReuseOrder) throw new Error('Failed to reuse order!')
      const tx = await txReuseOrder.wait()
      LoggerInstance.debug('[compute] Reused order:', tx)
      return tx?.transactionHash
    }

    LoggerInstance.debug('[compute] Calling order ...', initializeData)
    const txStartOrder = await order({
      signer,
      asset,
      orderPriceAndFees,
      accountId,
      config,
      providerFees: initializeData?.providerFee,
      computeConsumerAddress
    })
    const tx = await txStartOrder.wait()
    LoggerInstance.debug('[compute] Order succeeded', tx)
    return tx?.transactionHash
  } catch (error) {
    LoggerInstance.error(`[compute] ${error.message}`)
  }
}

export async function stopCompute(stopComputeConfig: StopComputeConfig) {
  const { did, jobId, providerUri, signer } = stopComputeConfig

  return await stopComputeJob(providerUri, did, jobId, signer)
}

function getProviderInitResultsForDataset(
  providerInitResultDatasets: ProviderComputeInitializeResults['datasets'],
  dataset: AssetWithAccessDetails
): ProviderComputeInitialize {
  return providerInitResultDatasets.find((initResult) =>
    dataset.datatokens.map((dt) => dt.address).includes(initResult.datatoken)
  )
}
