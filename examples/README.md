# Nautilus Examples

Runnable [nautilus](https://github.com/deltaDAO/nautilus) v2 examples: publishing, editing,
downloading, Compute-to-Data, and credential-gated flows using the walt.id identity stack.

These live inside the nautilus repository, so they always have a nautilus to run against —
the one in this checkout. You can point them at the published package instead; see
[Choosing your nautilus](#choosing-your-nautilus).

> **Beta.** nautilus 2.0.0 is a pre-release. The API can still change between betas and you
> should expect bugs. Please report anything you hit at
> [github.com/deltaDAO/nautilus/issues](https://github.com/deltaDAO/nautilus/issues).

> **Upgrading from v1?** These examples target nautilus **v2**, which sits on a different
> stack: ocean-node instead of Aquarius and Provider, DDO v5 instead of v4, and ethers v6
> instead of v5. See
> [MIGRATION.md](https://github.com/deltaDAO/nautilus/blob/main/MIGRATION.md) for a
> call-by-call map.

## Quick start

1. **Install:**

   ```sh
   cd examples
   npm install
   ```

   Requires Node 22 or later. There is no build step here — [`tsx`](https://tsx.is) runs the
   TypeScript directly, because `@oceanprotocol/lib` and `@oceanprotocol/ddo-js` are ESM-only.

   The default dependency is the nautilus in this repository (`file:../src`), which needs to
   have been built at least once:

   ```sh
   npm --prefix .. run build
   ```

   `npm run use:local` does both steps for you.

2. **Configure:**

   ```sh
   cp ./example.env ./.env
   ```

   | Variable | Value |
   | --- | --- |
   | `NETWORK` | `PONTUSXDEV` (rapid testing), `PONTUSXTEST` (staging), `OASISSAPPHIRE` (production MVP), `LOCAL` (the dev stack) |
   | `PRIVATE_KEY` | Private key of your account — export it from MetaMask |

   Your account needs funds for gas, and for any non-free asset it buys. On Pontus-X that
   means EURAU; on Oasis Sapphire, `ROSE` for gas and `PTX` for after-payment logging. Contact
   deltaDAO at contact@delta-dao.com for tokens and onboarding.

   Every other variable is optional and documented inline in `example.env`.

3. **Check your ocean-node** — do this before anything else:

   ```sh
   npm start -- check:node
   ```

   It tells you what is actually listening at your `oceanNodeUri`.

   > ⚠️ **nautilus v2 needs an ocean-node, and the public Pontus-X endpoints do not run one
   > yet.** At the time of writing `provider.dev.pontus-x.eu` and
   > `provider.test.pontus-x.eu` report `Provider 2.1.3` — the legacy standalone Provider —
   > and advertise none of the endpoints ocean-node adds (`PolicyServerPassthrough`,
   > `initializePSVerification`, `freeCompute`, …). The `oceanNodeUri` defaults in `config.ts`
   > are the *expected* ocean-node hostnames and are not resolvable yet.
   >
   > Set `OCEAN_NODE_URI` in `.env` to an ocean-node you can actually reach — one you run
   > yourself, or one deltaDAO points you at. `check:node` will confirm it:
   >
   > ```
   > ✓ https://your-ocean-node.example.org
   >   software:  Ocean Node 0.x.y
   >   ocean-node endpoints: PolicyServerPassthrough, initializePSVerification, freeCompute
   > ```
   >
   > Without one, publishing gets as far as encrypting files and then fails with
   > *"does not answer as an ocean-node"*.

4. **Run an example:**

   ```sh
   npm start -- help                      # every command, grouped
   npm start -- publish:access-dataset
   npm start -- access:download did:ope:…
   ```

## The CLI

Every example is a named command:

```sh
npm start -- <command> [args...]
```

`npm start -- help` is the authoritative list — it is generated from the command table in
`commands.ts`, so it cannot drift. The groups are:

| Group | What it covers |
| --- | --- |
| `check:` | Diagnostics. `check:node` is the one to run first. |
| `publish:` | Datasets, algorithms, SaaS offers, multi-service assets, local validation. |
| `asset:` | Inspecting, unlisting and revoking a published asset. |
| `edit:` | Metadata, descriptions, prices, services, trusted algorithms, lifecycle. |
| `access:` | Price checks, ordering, downloading, service selection, consumer parameters. |
| `compute:` | Environments, free and paid jobs, status, logs, results, multi-dataset jobs. |
| `ssi:` | **New in v2.** Credential-gated publishing and consuming with walt.id. |

End-to-end scenarios chain several commands together:

```sh
npm run scenario:e2e             # publish → order → download → compute
npm start -- ssi:round-trip      # the credential-gated round trip
```

## What is in each file

| File | What it covers |
| --- | --- |
| `index.ts` | Argument parsing and dispatch. |
| `commands.ts` | The command catalogue and the help output. |
| `nautilus.ts` | Shared setup: the signer, the chain config, the remote store, and `checkNode()`. |
| `config.ts` | Per-network addresses and ready-made pricing configs. |
| `assets.ts` | Where the example files are fetched from, and the algorithm container. |
| `publish.ts` | Datasets, algorithms, SaaS offers, multi-service assets, local validation. |
| `edit.ts` | Metadata, prices, services, trusted algorithms, lifecycle. |
| `access.ts` | Downloading, service selection, consumer parameters, price checks. |
| `compute.ts` | Environments, free and paid jobs, status, logs, results. |
| `identity.ts` | Credential-gated publishing and consuming with walt.id. |
| `scenarios/e2e.ts` | Runs every non-SSI command in order and reports what passed. |

## Choosing your nautilus

The examples can run against either the nautilus in this checkout or the one on npm.

```sh
npm run nautilus:which   # report which is active
npm run use:local        # build ../src and link it   (the default)
npm run use:npm          # switch to the published package
```

`use:local` is the committed default: `package.json` carries
`"@deltadao/nautilus": "file:../src"`, so a fresh clone works with no registry round-trip, and
any change you make to the library shows up in the examples after a rebuild.

`use:npm` rewrites the dependency to `^<version>`, reading the version from `src/package.json`
so it tracks whatever this checkout is about to release. To pin something specific:

```sh
npm run use:npm -- --spec 2.0.0-beta.0
npm run use:npm -- --spec beta
```

Two things to know:

- **Switching rewrites `package.json` and `package-lock.json`.** That churn is not meant to be
  committed — run `npm run use:local` before you commit, or check out the two files.
- **`use:npm` needs a published v2.** Until `2.0.0-beta.0` is on npm, a bare `npm run use:npm`
  warns that `src/package.json` is still on a v1 version and the install will fail. That is
  expected, not a bug.

It is a dependency rewrite rather than `npm link`, deliberately: nothing is written to your
global npm prefix, so the two modes cannot leak into unrelated projects.

## Three things that changed, and will surprise you

### Publishing needs a remote store

nautilus signs the DDO as a verifiable credential, stores it **off chain**, and writes only a
`{ remote }` pointer on chain. So `Nautilus.create` takes a `RemoteStore`, and because the
store itself needs an ocean-node client, the instance is built in two steps:

```ts
const bootstrap = await Nautilus.create(signer, { config })

const nautilus = await Nautilus.create(signer, {
  config,
  remoteStore: new NodePersistentRemoteStore(bootstrap.getNodeClient())
})
```

`nautilus.ts` does this for you. It defaults to the ocean-node's own persistent storage, so
the examples need no external service. Set `IPFS_UPLOAD_URL` in `.env` to use IPFS instead.

### One ocean-node replaces two URLs

`metadataCacheUri` (Aquarius) and `providerUri` (Provider) collapsed into a single
**`oceanNodeUri`**. `subgraphUri` is gone entirely — pricing now comes from chain reads and
the DDO's indexed stats.

Watch out for `nodeUri`, which is still the **blockchain RPC** and not the ocean-node.

### DDO v5 changed the metadata

- **`setProvidedBy` is required.** `build()` rejects a new asset without it.
- `description` and `displayTitle` are language-tagged; `license` is a structured object;
  `links` is a map. The builders still take plain strings and convert for you.
- `setContentLanguage` was repurposed: it now sets the language tag applied to those values,
  rather than writing a metadata field of its own.
- `additionalInformation` accepts only `string`, `number` and `boolean`. Nested objects have
  to be serialised — see `publishSaaSOffer` in `publish.ts`.
- DIDs use the `did:ope:` prefix. v4 assets used `did:op:`.

## Credential-gated assets

This is the new capability in v2, and `identity.ts` covers both halves of it.

Four components are involved, in a loop that lets the node observe every exchange:

```
nautilus ──▶ ocean-node ──▶ policy server ──▶ walt.id verifier
                                  ▲                   │
walt.id wallet ──▶ policy-server proxy ───────────────┘
```

nautilus talks only to ocean-node and to the walt.id wallet. What it needs out of the exchange
is one value — a verifier session id — which it then carries into the download or compute call.

**Setting it up:**

1. Set `SSI_WALLET_API` in `.env` to your walt.id wallet API.
2. Run `npm start -- ssi:connect`. It authenticates with your **Ethereum** key — no separate
   walt.id password — and prints the wallets, keys and DIDs your account holds.
3. Optionally pin them with `SSI_WALLET_ID`, `SSI_WALLET_KEY_ID` and `SSI_WALLET_DID`.
4. Run `npm start -- ssi:round-trip` to publish a gated dataset and consume it in one go.

**On the publishing side**, declare what you require:

```ts
assetBuilder
  .addRequestCredentials(CredentialListTypes.ALLOW, [
    { type: 'VerifiableId', format: 'jwt_vc_json' }
  ])
  .setVcPolicies(CredentialListTypes.ALLOW, ['signature', 'not-before'])
  .setVpPolicies(CredentialListTypes.ALLOW, ['holder-binding'])
```

VC policies check each credential; VP policies check the presentation as a whole. Gating also
works per service, so an asset can offer an open preview alongside a gated full dataset — see
`npm start -- ssi:publish-partial`.

**On the consuming side**, nothing changes at the call site. Configure a credential provider
once and `access()` looks exactly as it does for an open asset. Credentials are resolved
**before** any order is placed, so a policy you cannot satisfy costs nothing.

Selection is headless by default — every matching credential, the wallet's first DID — so
scripts work unattended. Pass `{ interactive: true }` to `createCredentialProvider` to see the
callback shape for a UI.

**Two things to check before concluding that gating works:**

- ocean-node **fails open** when its `POLICY_SERVER_URL` is unset, so an unconfigured node
  allows everything. nautilus detects this and continues without SSI rather than failing.
- Publish-time enforcement does not exist yet. The policy server's `newDDO`, `updateDDO`,
  `validateDDO`, `encrypt` and `decrypt` actions are stubs that always allow. Only `download`
  and `startCompute` are genuinely checked.

## Compute changed shape

C2D v2 is a different model, and `compute.ts` shows it:

- **Resources are requested explicitly**: `[{ id: 'cpu', amount: 2 }]`. Run
  `npm start -- compute:envs` to see what a node offers, what it costs per chain, and whether
  it allows free jobs.
- **Paid jobs lock funds in an escrow contract.** nautilus funds and authorises it from what
  the node quotes.
- **Free jobs need no order, no escrow and no payment token** — but the environment has to
  expose them, and its access list may restrict who can use them.
- **All datasets travel in one array**, so `additionalDatasets` is assembled for you.
- `getComputeStatus` and `getComputeResult` no longer take a `providerUri`.

## Pricing

`config.ts` holds ready-made pricing configs per network, with the payment-token addresses
filled in. To change a price, edit `fixedRate` — a decimal string, e.g. `'2.95'`.

To check what an asset costs before buying it, run `npm start -- access:price <did>`.

## Checks

```sh
npm run typecheck          # tsc --noEmit, from this directory
npm --prefix .. run lint   # biome, from the repo root — it covers examples/ too
```

CI runs both on every pull request, building the library first so the examples typecheck
against a real `_types` output.
