---
'@deltadao/nautilus': major
---

Modernize nautilus for the current Ocean stack.

nautilus v1 targeted `@oceanprotocol/lib` 3.4.6, ethers v5, Aquarius, Provider and DDO
v4.1.0 — none of which a current Ocean deployment runs. v2 targets
`@oceanprotocol/lib` 8.6.x, ethers v6, ocean-node, DDO v5 via `@oceanprotocol/ddo-js`,
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

See `MIGRATION.md` for a call-by-call mapping from v1.
