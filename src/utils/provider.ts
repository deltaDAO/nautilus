import {
  approveWei,
  Arweave,
  ComputeAlgorithm,
  ComputeAsset,
  ComputeEnvironment,
  FileInfo,
  GraphqlQuery,
  Ipfs,
  LoggerInstance,
  ProviderComputeInitializeResults,
  ProviderInstance,
  Service,
  Smartcontract,
  UrlFile,
  UserCustomParameters
} from '@oceanprotocol/lib'
import Web3 from 'web3'
import { getOceanConfig } from '.'
import { AssetWithAccessDetails } from '../@types/Compute'

export async function isValidProvider(providerUrl: string): Promise<boolean> {
  try {
    // https://github.com/oceanprotocol/provider/blob/v4main/API.md#encrypt-endpoint
    const response = await ProviderInstance.isValidProvider(providerUrl)
    return response
  } catch (error) {
    LoggerInstance.error('Error verifying provider instance: ' + error.message)
    return false
  }
}

export async function getEncryptedFiles(
  files: any,
  chainId: number,
  providerUrl: string
): Promise<string> {
  try {
    // https://github.com/oceanprotocol/provider/blob/v4main/API.md#encrypt-endpoint
    LoggerInstance.debug('Encrytping files:')
    LoggerInstance.debug({ files, chainId, providerUrl })
    const response = await ProviderInstance.encrypt(files, chainId, providerUrl)
    return response
  } catch (error) {
    LoggerInstance.error('Error parsing json: ' + error.message)
  }
}

export async function initializeProvider(
  asset: AssetWithAccessDetails,
  accountId: string,
  service: Service,
  fileIndex = 0,
  consumerParameters?: UserCustomParameters
) {
  return await ProviderInstance.initialize(
    asset.id,
    service.id,
    fileIndex,
    accountId,
    service.serviceEndpoint,
    undefined,
    consumerParameters
  )
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

export async function getFileInfo(
  file: UrlFile | Arweave | GraphqlQuery | Smartcontract | Ipfs,
  providerUri: string,
  withChecksum?: boolean
): Promise<FileInfo[]> {
  return await ProviderInstance.getFileInfo(file, providerUri, withChecksum)
}
