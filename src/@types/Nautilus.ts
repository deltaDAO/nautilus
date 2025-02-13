import type { Asset } from '@oceanprotocol/lib'
import type {
  FileTypes,
  ServiceTypes
} from '../Nautilus/Asset/Service/NautilusService'

export interface NautilusOptions {
  skipDefaultConfig: boolean
}

export type ServiceBuilderConfig =
  | {
      serviceType: ServiceTypes
      fileType: FileTypes
    }
  | {
      aquariusAsset: Asset
      serviceId: string
    }

export interface IBuilder<T> {
  build: () => T
  reset: () => void
}

export enum CredentialListTypes {
  ALLOW = 'allow',
  DENY = 'deny'
}

export enum LifecycleStates {
  ACTIVE = 0,
  END_OF_LIFE = 1,
  DEPRECATED = 2,
  REVOKED_BY_PUBLISHER = 3,
  ORDERING_DISABLED_TEMPORARILY = 4,
  ASSET_UNLISTED = 5
}
