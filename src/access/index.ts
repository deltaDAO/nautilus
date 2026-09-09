/**
 * Access: resolve, satisfy any credential policy, order, download.
 *
 * The ordering here is deliberate and load-bearing: **credentials are resolved before any
 * on-chain spend**. If a policy cannot be satisfied, the caller has paid nothing.
 */

import type { Config } from '@oceanprotocol/lib'
import { allowanceWei, approveWei, LoggerInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type { AccessConfig, AccessResult } from '../@types/Access.js'
import {
  getCredentials,
  getDatatokenForService,
  getService,
  getServiceByType,
  getServiceCredentials,
  getServiceIndex,
  supportsSsi
} from '../ddo/read.js'
import type { CredentialProvider } from '../identity/CredentialProvider.js'
import {
  assertPolicySatisfied,
  shouldResolveCredentials
} from '../identity/policy.js'
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
    supportsSsi(asset) &&
    shouldResolveCredentials(credentials, config.skipCredentials)
      ? await (credentials as CredentialProvider).resolve({
          asset,
          serviceId: service.id,
          consumerAddress
        })
      : null

  // ...and refuse to go on without one where the service actually demands it. An
  // unresolved policy used to be indistinguishable from "no gating applies", so the flow
  // ordered, paid, and only then found out it could not download.
  assertPolicySatisfied({
    did: asset.id,
    serviceId: service.id,
    assetCredentials: getCredentials(asset),
    serviceCredentials: getServiceCredentials(service),
    resolved: policyServer,
    skipped: config.skipCredentials
  })

  // 2. Ask the node for provider fees and whether a previous order can be reused.
  //
  // Not necessarily the configured node: the file object was encrypted with a key local to
  // the node in the service's own endpoint, so the quote and the download must come from
  // there — the configured node would take the payment and then fail to decrypt.
  const serviceNode = service.serviceEndpoint
    ? node.forEndpoint(service.serviceEndpoint)
    : node

  const initialized = await serviceNode.initialize(asset.id, service.id, {
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

  // 4. Build the download URL — on the service's node, which holds the decryption key —
  // carrying the verifier session when there is one.
  const url = await serviceNode.getDownloadUrl(
    asset.id,
    service.id,
    transferTxId,
    {
      fileIndex: config.fileIndex,
      policyServer,
      userdata: config.userdata
    }
  )

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
    | { providerFeeAmount?: string; providerFeeToken?: string }
    | undefined

  const feeDue = Boolean(
    providerFee?.providerFeeAmount && providerFee.providerFeeAmount !== '0'
  )

  // Nothing to pay and an order already in force: reuse the transaction as it stands.
  if (hasReusableOrder(initialized) && !feeDue)
    return { transferTxId: initialized.validOrder as string, reused: true }

  // Both remaining paths hand the fee to the datatoken, whose `_checkProviderFee` settles
  // it with `transferFrom` — and neither `startOrder` nor `reuseOrder` approves anything,
  // so without this any non-zero provider fee reverts on chain.
  if (feeDue && providerFee?.providerFeeToken)
    await approveProviderFee({
      signer,
      chainConfig,
      datatokenAddress,
      providerFeeToken: providerFee.providerFeeToken,
      providerFeeAmount: providerFee.providerFeeAmount as string
    })

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

/**
 * Approves the datatoken to pull the provider fee before the order that consumes it.
 *
 * The amount the node quotes is already in wei, hence `approveWei` rather than `approve`,
 * which expects human units and would scale the amount by the token's decimals again.
 */
async function approveProviderFee(params: {
  signer: Signer
  chainConfig: Config
  datatokenAddress: string
  providerFeeToken: string
  providerFeeAmount: string
}): Promise<void> {
  const { signer, chainConfig, datatokenAddress } = params
  const account = await signer.getAddress()

  // A standing allowance that covers the fee needs no transaction.
  const standing = await allowanceWei(
    signer,
    params.providerFeeToken,
    account,
    datatokenAddress
  )

  if (BigInt(standing) >= BigInt(params.providerFeeAmount)) return

  const response = await approveWei(
    signer,
    chainConfig,
    account,
    params.providerFeeToken,
    datatokenAddress,
    params.providerFeeAmount,
    // Force: the allowance was already checked above, with >= where ocean.js uses a
    // strict >, so an allowance exactly equal to the fee is not re-approved.
    true
  )

  // ocean.js waits for the approval itself but swallows a failed send and returns null;
  // surface that here rather than letting the order revert on a missing allowance.
  if (!response)
    throw new Error(
      `Could not approve the provider fee of ${params.providerFeeAmount} wei on token ${params.providerFeeToken} for ${datatokenAddress}.`
    )
}
