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
