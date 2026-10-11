import type { UserCustomParameters } from '@oceanprotocol/lib'
import type { ProviderFeeLimits } from '../utils/paymentLimits.js'

/**
 * Configuration for {@link Nautilus.access}.
 *
 * `maxProviderFee` / `confirmProviderFees` decide whether the node's provider fee may be
 * paid. Without either (here or in `Nautilus.create`), a non-zero fee is refused with a
 * `ProviderFeeNotAllowedError` before anything is spent. They are consulted only for a fee
 * the call pays: not when a previous order is used as it stands. In a download the node is
 * the service's `serviceEndpoint`, which the publisher chooses. Setting either option here,
 * even to `undefined`, replaces both `Nautilus.create` defaults.
 */
export interface AccessConfig extends ProviderFeeLimits {
  assetDid: string
  /** Defaults to the asset's first `access` service. */
  serviceId?: string
  fileIndex?: number
  userdata?: UserCustomParameters
  /**
   * What to do when the previous order cannot be checked on chain (the RPC rate-limits the
   * lookup, does not answer, or answers with an error, or the lookup cannot read back over
   * the whole order window) and the service costs anything.
   *
   * By default `access()` stops before paying and throws an `OrderCheckError`: if the
   * account already holds a valid order, buying again would pay twice. `true` (only `true`)
   * places a new order anyway, with a warning. A free service is ordered either way, with
   * a warning. "No previous order found" is not a failure: it always orders.
   *
   * @default false
   */
  orderOnLookupFailure?: boolean
}

/** What `access()` resolved on the way to the download URL. */
export interface AccessResult {
  /** The one-time download URL. */
  url: string
  did: string
  serviceId: string
  /** The order reused or created for this access. */
  transferTxId: string
  /** `true` when an existing order was reused rather than a new one paid for. */
  reusedOrder: boolean
}
