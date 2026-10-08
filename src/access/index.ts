/**
 * Access: resolve, open the policy-server session, order, download.
 *
 * The ordering here is deliberate and load-bearing: **the policy session is opened before
 * any on-chain spend**. If the policy server refuses, the caller has paid nothing.
 */

import type { Config } from '@oceanprotocol/lib'
import { LoggerInstance } from '@oceanprotocol/lib'
import type { Signer } from 'ethers'
import type { AccessConfig, AccessResult } from '../@types/Access.js'
import { getDatatokenForService, getServiceIndex } from '../ddo/read.js'
import { PolicySessionResolver } from '../identity/PolicySessionResolver.js'
import type { OceanNodeClient } from '../node/OceanNodeClient.js'
import {
  assertProviderFeesAllowed,
  ceilingFor,
  quoteProviderFee
} from '../utils/paymentLimits.js'
import {
  initializeWithValidProviderFee,
  providerFeeToSend
} from '../utils/providerFee.js'
import { assertAccessRequest } from './guards.js'
import { settleOrder } from './settlement.js'

export { settleOrder } from './settlement.js'

export interface AccessContext {
  node: OceanNodeClient
  signer: Signer
  chainConfig: Config
  /**
   * Opens the policy-server sessions, and caches them. `Nautilus` passes one per
   * instance, holding its `credentials`. Without it, a resolver with no credential provider
   * is used: services gated by addresses work, and one that asks for a verifiable
   * presentation is refused before anything is spent.
   */
  policySessions?: PolicySessionResolver
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
  const { node, signer, chainConfig } = context
  const policySessions = context.policySessions ?? new PolicySessionResolver()
  const consumerAddress = await signer.getAddress()

  const asset = await node.resolve(config.assetDid)

  // Before any other node call or transaction: the service exists, is an 'access' service,
  // and `userdata` fits its consumer parameters. Only the checked `userdata`, without its
  // absent entries, is sent from here on.
  const { service, userdata } = assertAccessRequest(asset, config)

  // Everything that talks to a node talks to *this* one: the file object was encrypted
  // with a key local to the node in the service's own endpoint, so the quote, the policy
  // session and the download all have to come from there — the configured node would take
  // the payment and then fail to decrypt, and a session it minted is unknown to the node
  // that actually enforces the policy.
  const serviceNode = service.serviceEndpoint
    ? node.forEndpoint(service.serviceEndpoint)
    : node

  // 1. Open the policy session first, before spending anything. Whenever the node has a
  //    policy server and the asset or service has `credentials`, the download is checked
  //    against a session, and a service gated by addresses only needs one as much as an
  //    SSI-gated one does. A refusal throws a `PolicyDeniedError` here, with nothing paid.
  const policyServer = await policySessions.resolve({
    node: serviceNode,
    asset,
    serviceId: service.id,
    consumerAddress
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
        userdata
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
  // carrying the policy session when there is one.
  const url = await serviceNode.getDownloadUrl(
    asset.id,
    service.id,
    transferTxId,
    {
      fileIndex: config.fileIndex,
      policyServer,
      userdata
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
