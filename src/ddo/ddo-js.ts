/**
 * The DDO v5 types from `@oceanprotocol/ddo-js` that surface in nautilus's own public
 * API, re-exported so consumers can name what nautilus returns without a direct
 * dependency on ddo-js.
 *
 * An explicit list rather than `export *`: ddo-js star-exports its **v4**
 * `DDO`/`Asset`/`Metadata`/`Service`/`Credential`/`Credentials`, which would both shadow
 * nautilus's own names and hand consumers the wrong DDO version.
 *
 * What is *not* here is not an oversight — see `./types.ts`, which owns the rest of the v5
 * vocabulary: `RemoteObject`, `RemoteSource` and `LanguageValue`, which also come from
 * ddo-js but under nautilus's own names, plus the pieces ddo-js declares without exposing
 * (`License`), never declares at all (`ConsumerParameterV5`), or declares in a shape the
 * running stack does not accept (the credential block).
 */
export type {
  AlgorithmV5,
  AssetDatatoken,
  AssetV5,
  Compute,
  CredentialV5,
  IndexedMetadata,
  MetadataV5,
  PublisherTrustedAlgorithms,
  ServiceV5,
  State,
  Stats,
  ValidateMetadata,
  VersionedDDO
} from '@oceanprotocol/ddo-js'
