# @deltadao/nautilus

## 2.0.0-beta.0

### Major Changes

- [#182](https://github.com/deltaDAO/nautilus/pull/182) [`f636f33`](https://github.com/deltaDAO/nautilus/commit/f636f3360e4b09b182dfdac24f4ab0fe04428126) Thanks [@Abrom8](https://github.com/Abrom8)! - Modernize nautilus for the current Ocean stack.
  
  nautilus v1 targeted `@oceanprotocol/lib` 3.4.6, ethers v5, Aquarius, Provider and DDO
  v4.1.0 — none of which a current Ocean deployment runs. v2 targets
  `@oceanprotocol/lib` 9.x, ethers v6, ocean-node, DDO v5 via `@oceanprotocol/ddo-js`,
  and adds first-class support for the policy server and the walt.id identity stack.
  
  The builder pattern is unchanged as the primary API: `AssetBuilder`, `ServiceBuilder` and
  `ConsumerParameterBuilder` keep their fluent shape, and every v1 capability still has a
  method. This is a breaking major because the DDO model, the transport and the signer
  library all changed underneath.
  
  **What changed**
  
  - **ocean-node replaces Aquarius and Provider.** One `OceanNodeClient` wraps both, and
    `Config.oceanNodeUri` replaces `metadataCacheUri` and `providerUri`.
  - **The subgraph is gone.** Pricing is derived from chain reads and the DDO's indexed
    stats, so `urql`, `graphql` and graphql-codegen are no longer dependencies.
  - **DDO v5.** Assets are W3C Verifiable Credentials: everything moved under
    `credentialSubject`, DIDs use the `did:ope:` prefix, `description` and `displayTitle` are
    language-tagged, `license` is structured, and `providedBy` is required.
  - **DDOs are signed and stored off chain.** Only a `{remote}` pointer is written on chain.
    The remote backend is configurable — IPFS, or ocean-node's own persistent storage.
  - **Credential-gated access.** nautilus resolves policy-server challenges through the
    walt.id wallet and verifier, headless by default with optional selection callbacks.
  - **Compute is C2D v2.** Explicit resource requests, escrow payment, free compute,
    streamable logs and results.
  - **Local DDO validation** via ddo-js SHACL, before any gas is spent.
  - **`strict` TypeScript** is enabled, and ethers v6 is required.
  - **DDO v5 types from the package root.** nautilus re-exports the ddo-js v5 types its API
    surfaces — `AssetV5`, `ServiceV5`, `MetadataV5`, `State` and friends — so consumers need no
    direct `@oceanprotocol/ddo-js` dependency and never have to dedupe it.
  - **No install-time patching.** nautilus requires `@oceanprotocol/ddo-js` ^1.0.0, whose
    `exports` map carries `types` conditions, so its declarations resolve under `nodenext`,
    `node16` and `bundler` unaided. The `postinstall` hook that used to rewrite the installed
    manifest is gone: nautilus runs no lifecycle script on install, and works unchanged under
    `--ignore-scripts` and pnpm. ddo-js 1.0.0 also tightens the DDO v5 schema: `credentials`
    is now required on the asset and on every service. The builders always emit it, and an
    edit normalizes untouched services that lack it.
  
  See `MIGRATION.md` for a call-by-call mapping from v1.

## 1.1.0

### Minor Changes

- [#160](https://github.com/deltaDAO/nautilus/pull/160) [`2e7070b`](https://github.com/deltaDAO/nautilus/commit/2e7070b27db19fbd2526ef1ad84ba90030972d9a) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Adds functionality to compute on multiple datasets within one compute job

  - Currently only datasets that are encrypted by the same provider are supported

- [#160](https://github.com/deltaDAO/nautilus/pull/160) [`2e7070b`](https://github.com/deltaDAO/nautilus/commit/2e7070b27db19fbd2526ef1ad84ba90030972d9a) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Add helper functions to set name, symbol, tokenUri, transferable and templateIndex of data NFTs

## 1.0.3

### Patch Changes

- [#151](https://github.com/deltaDAO/nautilus/pull/151) [`034fd2d`](https://github.com/deltaDAO/nautilus/commit/034fd2d063db109a5ebee62e424e1f2ec276d465) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Bump dependencies

## 1.0.2

### Patch Changes

- [#134](https://github.com/deltaDAO/nautilus/pull/134) [`f7cc0a3`](https://github.com/deltaDAO/nautilus/commit/f7cc0a34d5c84ce270d2773a7721c5b4fcf8b7b5) Thanks [@Abrom8](https://github.com/Abrom8)! - Fix publishing/editing of multi-service assets

## 1.0.1

### Patch Changes

- [`c8b4d4d`](https://github.com/deltaDAO/nautilus/commit/c8b4d4d5978a4a48c7a5ab198f82042440d4b9c5) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Version Bump

## 1.0.0

### Patch Changes

- [#108](https://github.com/deltaDAO/nautilus/pull/108) [`3e8b148`](https://github.com/deltaDAO/nautilus/commit/3e8b1484fa5656a0a46fc818ca118dfda32786fc) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Fix error in next build

  - Fixes an error with starting compute jobs
  - Fixes `tslib` dependency issues

- [#103](https://github.com/deltaDAO/nautilus/pull/103) [`8f71689`](https://github.com/deltaDAO/nautilus/commit/8f71689b3cd4fa02502e01adddfe309afecdf5d2) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - next release

- [#106](https://github.com/deltaDAO/nautilus/pull/106) [`399cd55`](https://github.com/deltaDAO/nautilus/commit/399cd55ead131534f0165ef01f698553cb26290d) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - bump ocean.js

- [#83](https://github.com/deltaDAO/nautilus/pull/83) [`59b5d93`](https://github.com/deltaDAO/nautilus/commit/59b5d9348ca75300523c9857eba1f99abe441c01) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - - add stopCompute functionality
  - fix an issue with setting trusted algorithms

## 1.0.0-next.5

### Patch Changes

- [#108](https://github.com/deltaDAO/nautilus/pull/108) [`3e8b148`](https://github.com/deltaDAO/nautilus/commit/3e8b1484fa5656a0a46fc818ca118dfda32786fc) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - Fix error in next build
  - Fixes an error with starting compute jobs
  - Fixes `tslib` dependency issues

## 1.0.0-next.4

### Patch Changes

- [#106](https://github.com/deltaDAO/nautilus/pull/106) [`399cd55`](https://github.com/deltaDAO/nautilus/commit/399cd55ead131534f0165ef01f698553cb26290d) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - bump ocean.js

## 1.0.0-next.3

### Patch Changes

- [#103](https://github.com/deltaDAO/nautilus/pull/103) [`8f71689`](https://github.com/deltaDAO/nautilus/commit/8f71689b3cd4fa02502e01adddfe309afecdf5d2) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - next release

## 1.0.0-beta.2

### Patch Changes

- [#83](https://github.com/deltaDAO/nautilus/pull/83) [`59b5d93`](https://github.com/deltaDAO/nautilus/commit/59b5d9348ca75300523c9857eba1f99abe441c01) Thanks [@moritzkirstein](https://github.com/moritzkirstein)! - - add stopCompute functionality
  - fix an issue with setting trusted algorithms
