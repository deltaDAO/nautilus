import {
  approveWei,
  ComputeAlgorithm,
  ComputeAsset,
  ComputeEnvironment,
  LoggerInstance,
  ProviderComputeInitializeResults,
  ProviderInstance
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { getOceanConfig } from '.'
import { AssetWithAccessDetails } from '../@types/Compute'

export async function getEncryptedFiles(
  files: any,
  chainId: number,
  providerUrl: string
): Promise<string> {
  try {
    // https://github.com/oceanprotocol/provider/blob/v4main/API.md#encrypt-endpoint
    const response = await ProviderInstance.encrypt(files, chainId, providerUrl)
    return response
  } catch (error) {
    LoggerInstance.error('Error parsing json: ' + error.message)
  }
}

export async function initializeProviderForCompute(
  dataset: AssetWithAccessDetails,
  algorithm: AssetWithAccessDetails,
  accountId: string,
  computeEnv: ComputeEnvironment = null
): Promise<ProviderComputeInitializeResults> {
  const computeAsset: ComputeAsset = {
    documentId: dataset.id,
    serviceId: dataset.services[0].id,
    transferTxId: dataset.accessDetails.validOrderTx
  }
  const computeAlgo: ComputeAlgorithm = {
    documentId: algorithm.id,
    serviceId: algorithm.services[0].id,
    transferTxId: algorithm.accessDetails.validOrderTx
  }

  const validUntil = getValidUntilTime(
    computeEnv?.maxJobDuration,
    dataset.services[0].timeout,
    algorithm.services[0].timeout
  )

  try {
    return await ProviderInstance.initializeCompute(
      [computeAsset],
      computeAlgo,
      computeEnv?.id,
      validUntil,
      dataset.services[0].serviceEndpoint,
      accountId
    )
  } catch (error) {
    LoggerInstance.error(`Error initializing provider for the compute job!`)
    return null
  }
}

export function getValidUntilTime(
  computeEnvMaxJobDuration: number,
  datasetTimeout?: number,
  algorithmTimeout?: number
) {
  const inputValues = []
  computeEnvMaxJobDuration && inputValues.push(computeEnvMaxJobDuration)
  datasetTimeout && inputValues.push(datasetTimeout)
  algorithmTimeout && inputValues.push(algorithmTimeout)

  const minValue = Math.min(...inputValues)
  const mytime = new Date()
  mytime.setMinutes(mytime.getMinutes() + Math.floor(minValue / 60))
  return Math.floor(mytime.getTime() / 1000)
}

export async function approveProviderFee(
  asset: AssetWithAccessDetails,
  accountId: string,
  web3: Web3,
  providerFeeAmount: string
): Promise<any> {
  const config = getOceanConfig(asset.chainId)
  const baseToken =
    asset?.accessDetails?.type === 'free'
      ? getOceanConfig(asset.chainId).oceanTokenAddress
      : asset?.accessDetails?.baseToken?.address
  const txApproveWei = await approveWei(
    web3,
    config,
    accountId,
    baseToken,
    asset?.accessDetails?.datatoken?.address,
    providerFeeAmount
  )
  return txApproveWei
}
