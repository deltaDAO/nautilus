/**
 * Access: resolve, satisfy any credential policy, order, download.
 *
 * The ordering here is deliberate and load-bearing: **credentials are resolved before any
 * on-chain spend**. If a policy cannot be satisfied, the caller has paid nothing.
 */

import type { Config } from '@oceanprotocol/lib'
import { LoggerInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type { AccessConfig, AccessResult } from '../@types/Access.js'
import {
  getDatatokenForService,
  getService,
  getServiceByType,
  getServiceIndex,
  supportsSsi
} from '../ddo/read.js'
import type { CredentialProvider } from '../identity/CredentialProvider.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import { order, reuseOrder } from '../utils/order.js'
import {
  getOrderPrice,
  getPricingInfo,
  hasReusableOrder
} from '../utils/pricing.js'

export interface AccessContext {
  node: OceanNodeClient
  signer: Signer
  chainConfig: Config
  credentials?: CredentialProvider
}

/**
 * Resolves a one-time download URL, ordering the service first if needed.
 *
 * @returns the URL plus the order it was authorised by
 */
export async function access(
  config: AccessConfig,
  context: AccessContext
): Promise<AccessResult> {
  const { node, signer, chainConfig, credentials } = context
  const consumerAddress = await signer.getAddress()

  const asset = await node.resolve(config.assetDid)

  const service = config.serviceId
    ? getService(asset, config.serviceId)
    : getServiceByType(asset, 'access')

  if (!service)
    throw new Error(
      config.serviceId
        ? `Asset ${config.assetDid} has no service with id ${config.serviceId}.`
        : `Asset ${config.assetDid} has no 'access' service to download from.`
    )

  // 1. Satisfy the policy first — before spending anything.
  const policyServer =
    config.skipCredentials || !credentials || !supportsSsi(asset)
      ? null
      : await credentials.resolve({
          asset,
          serviceId: service.id,
          consumerAddress
        })

  // 2. Ask the node for provider fees and whether a previous order can be reused.
  const initialized = await node.initialize(asset.id, service.id, {
    fileIndex: config.fileIndex,
    consumerAddress,
    userdata: config.userdata
  })

  const datatokenAddress =
    getDatatokenForService(asset, service.id) || initialized.datatoken

  if (!datatokenAddress)
    throw new Error(
      `Could not determine the datatoken for service ${service.id} of ${asset.id}.`
    )

  // 3. Reuse or place an order.
  const { transferTxId, reused } = await settleOrder({
    signer,
    chainConfig,
    datatokenAddress,
    serviceIndex: getServiceIndex(asset, service.id),
    initialized,
    consumer: consumerAddress
  })

  LoggerInstance.debug('[access] order settled', { transferTxId, reused })

  // 4. Build the download URL, carrying the verifier session when there is one.
  const url = await node.getDownloadUrl(asset.id, service.id, transferTxId, {
    fileIndex: config.fileIndex,
    policyServer,
    userdata: config.userdata
  })

  return {
    url,
    did: asset.id,
    serviceId: service.id,
    transferTxId,
    reusedOrder: reused
  }
}

/**
 * Reuses a valid order when the node says one exists and no new provider fee is due;
 * otherwise extends it, or places a fresh order.
 */
export async function settleOrder(params: {
  signer: Signer
  chainConfig: Config
  datatokenAddress: string
  serviceIndex: number
  initialized: { validOrder?: string; providerFee?: unknown }
  consumer: string
  payer?: string
}): Promise<{ transferTxId: string; reused: boolean }> {
  const { signer, chainConfig, datatokenAddress, serviceIndex, initialized } =
    params

  const providerFee = initialized.providerFee as
    | { providerFeeAmount?: string }
    | undefined

  const feeDue = Boolean(
    providerFee?.providerFeeAmount && providerFee.providerFeeAmount !== '0'
  )

  // Nothing to pay and an order already in force: reuse the transaction as it stands.
  if (hasReusableOrder(initialized) && !feeDue)
    return { transferTxId: initialized.validOrder as string, reused: true }

  // An order in force but a new fee period: extend it rather than buying again.
  if (hasReusableOrder(initialized))
    return reuseOrder({
      signer,
      config: chainConfig,
      datatokenAddress,
      validOrderTx: initialized.validOrder as string,
      // biome-ignore lint/suspicious/noExplicitAny: ocean.js returns this loosely typed
      providerFees: initialized.providerFee as any
    })

  const pricing = await getPricingInfo(signer, datatokenAddress, chainConfig)
  const price = await getOrderPrice(signer, pricing, chainConfig)

  return order({
    signer,
    config: chainConfig,
    pricing,
    price,
    serviceIndex,
    // biome-ignore lint/suspicious/noExplicitAny: ocean.js returns this loosely typed
    providerFees: initialized.providerFee as any,
    consumer: params.consumer,
    payer: params.payer
  })
}
