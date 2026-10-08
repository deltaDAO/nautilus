import type { UserCustomParameters } from '@oceanprotocol/lib'
import type { ProviderFeeLimits } from '../utils/paymentLimits.js'

/**
 * Configuration for {@link Nautilus.access}.
 *
 * `maxProviderFee` / `confirmProviderFees` decide whether the node's provider fee may be
 * paid. Without either (here or in `Nautilus.create`), a non-zero fee is refused with a
 * `ProviderFeeNotAllowedError` before anything is spent. In a download the node is the
 * service's `serviceEndpoint`, which the publisher chooses. Setting either option here,
 * even to `undefined`, replaces both `Nautilus.create` defaults.
 */
export interface AccessConfig extends ProviderFeeLimits {
  assetDid: string
  /** Defaults to the asset's first `access` service. */
  serviceId?: string
  fileIndex?: number
  userdata?: UserCustomParameters
  /**
   * Skip the interactive credential presentation even when the service is gated.
   *
   * A provider that only replays a session you already hold — `StaticCredentialProvider` —
   * is still consulted, so this is the flag to set when you minted the session out of band.
   *
   * It also waives the pre-order check that a gated service has a session behind it. That
   * check is what keeps you from paying for an order you cannot use, so only skip it when
   * you know the deployment does not enforce the policy (ocean-node fails open when it has
   * no `POLICY_SERVER_URL`).
   */
  skipCredentials?: boolean
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
