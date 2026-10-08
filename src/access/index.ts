/**
 * Access: resolve, satisfy any credential policy, order, download.
 *
 * The ordering here is deliberate and load-bearing: **credentials are resolved before any
 * on-chain spend**. If a policy cannot be satisfied, the caller has paid nothing.
 */

import type { Config, ProviderFees } from '@oceanprotocol/lib'
import { LoggerInstance } from '@oceanprotocol/lib'
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
import { order, payingAccount, reuseOrder } from '../utils/order.js'
import {
  assertProviderFeesAllowed,
  ceilingFor,
  type ProviderFeeLimits,
  quoteProviderFee
} from '../utils/paymentLimits.js'
import {
  getOrderPrice,
  getPricingInfo,
  hasReusableOrder
} from '../utils/pricing.js'
import {
  assertProviderFeeSignature,
  initializeWithValidProviderFee,
  isFeeDue,
  type ProviderFeeLike,
  providerFeeToSend
} from '../utils/providerFee.js'

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

  // Everything that talks to a node talks to *this* one: the file object was encrypted
  // with a key local to the node in the service's own endpoint, so the quote, the policy
  // session and the download all have to come from there — the configured node would take
  // the payment and then fail to decrypt, and a session it minted is unknown to the node
  // that actually enforces the policy.
  const serviceNode = service.serviceEndpoint
    ? node.forEndpoint(service.serviceEndpoint)
    : node

  // 1. Satisfy the policy first — before spending anything.
  const policyServer =
    supportsSsi(asset) &&
    shouldResolveCredentials(credentials, config.skipCredentials)
      ? await (credentials as CredentialProvider).resolve({
          asset,
          serviceId: service.id,
          consumerAddress,
          node: serviceNode
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

  // 2. Ask the service's node for provider fees and whether a previous order can be
  //    reused. The datatoken verifies each fee's signature, so it is checked locally first
  //    and a fee that would not pass is requested again: up to 3 calls in total, 1.1 s
  //    apart. A service with `timeout: 0` signs `validUntil = 0`, so its fee is the same on
  //    every request and is not requested again. A service without `timeout` is left on
  //    the default: DDO schemas require one, and without one the node's `validUntil` is
  //    `now + undefined` (NaN), so `initialize` answers with an error rather than a fee.
  const initialized = await initializeWithValidProviderFee(
    () =>
      serviceNode.initialize(asset.id, service.id, {
        fileIndex: config.fileIndex,
        consumerAddress,
        userdata: config.userdata
      }),
    (result) => [providerFeeToSend(result)],
    Number(service.timeout) === 0 ? { attempts: 1 } : {}
  )

  const datatokenAddress =
    getDatatokenForService(asset, service.id) || initialized.datatoken

  if (!datatokenAddress)
    throw new Error(
      `Could not determine the datatoken for service ${service.id} of ${asset.id}.`
    )

  // 3. The node chose the fee's token and amount, and in a download it is the
  //    publisher's node: pay a non-zero fee only within what the caller allowed, before
  //    any chain read or transaction.
  const fee = quoteProviderFee(providerFeeToSend(initialized), {
    datatoken: datatokenAddress,
    did: asset.id,
    serviceId: service.id
  })

  await assertProviderFeesAllowed([fee], config)

  // 4. Reuse or place an order, allowed to pay exactly the fee approved above.
  const { transferTxId, reused } = await settleOrder({
    signer,
    chainConfig,
    datatokenAddress,
    serviceIndex: getServiceIndex(asset, service.id),
    initialized,
    consumer: consumerAddress,
    maxProviderFee: ceilingFor([fee])
  })

  LoggerInstance.debug('[access] order settled', { transferTxId, reused })

  // 5. Build the download URL — on the service's node, which holds the decryption key —
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
 *
 * Every path but the first sends the node's provider fee to the datatoken, so it throws a
 * `ProviderFeeSignatureError` before any chain read or transaction when that fee is
 * missing, incomplete, or carries a signature the datatoken would reject. Those paths also
 * throw for a `payer` other than the signer (see `OrderRequest.payer`).
 * `order()`/`reuseOrder()` then refuse a non-zero fee `maxProviderFee` /
 * `confirmProviderFees` do not allow with a `ProviderFeeNotAllowedError`, before their
 * first approval.
 */
export async function settleOrder(
  params: {
    signer: Signer
    chainConfig: Config
    datatokenAddress: string
    serviceIndex: number
    initialized: { validOrder?: string; providerFee?: unknown }
    consumer: string
    payer?: string
  } & ProviderFeeLimits
): Promise<{ transferTxId: string; reused: boolean }> {
  const { signer, chainConfig, datatokenAddress, serviceIndex, initialized } =
    params
  const limits: ProviderFeeLimits = {
    maxProviderFee: params.maxProviderFee,
    confirmProviderFees: params.confirmProviderFees
  }

  const providerFee = initialized.providerFee as ProviderFeeLike | undefined

  // Nothing to pay and an order already in force: reuse the transaction as it stands.
  // Nothing is sent, so no fee is needed.
  if (hasReusableOrder(initialized) && !isFeeDue(providerFee))
    return { transferTxId: initialized.validOrder as string, reused: true }

  // Both remaining paths send the fee to the datatoken, which checks it first: refuse
  // one it would reject here, once. `order()` and `reuseOrder()` check again for their
  // direct callers, and approve what the fee pulls together with the rest of the order.
  assertProviderFeeSignature(providerFee)

  // Checked above: every field is present.
  const providerFees = providerFee as unknown as ProviderFees

  // The signer pays on both paths; `order()` checks again for its direct callers.
  await payingAccount(signer, params.payer)

  // An order in force but a new fee period: extend it rather than buying again.
  if (hasReusableOrder(initialized))
    return reuseOrder({
      signer,
      config: chainConfig,
      datatokenAddress,
      validOrderTx: initialized.validOrder as string,
      providerFees,
      ...limits
    })

  const pricing = await getPricingInfo(signer, datatokenAddress, chainConfig)
  const price = await getOrderPrice(signer, pricing, chainConfig)

  return order({
    signer,
    config: chainConfig,
    pricing,
    price,
    serviceIndex,
    providerFees,
    consumer: params.consumer,
    payer: params.payer,
    ...limits
  })
}
