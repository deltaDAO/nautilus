import type { UserCustomParameters } from '@oceanprotocol/lib'

/** Configuration for {@link Nautilus.access}. */
export interface AccessConfig {
  assetDid: string
  /** Defaults to the asset's first `access` service. */
  serviceId?: string
  fileIndex?: number
  userdata?: UserCustomParameters
  /**
   * Skip the credential presentation even when the service is gated. Only useful if you
   * already hold a valid session and passed it in as a `StaticCredentialProvider`.
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
