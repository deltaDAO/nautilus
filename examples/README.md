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
   | `NETWORK` | `PONTUSXDEV` (rapid testing), `PONTUSXTEST` (staging), `OASISSAPPHIRE` (production MVP), `OPSEPOLIA` (OP Sepolia testnet), `LOCAL` (the local docker stack, chain 8996), `CUSTOM` (any other chain, from the environment) |
   | `PRIVATE_KEY` | Private key of the publishing account — export it from MetaMask |
   | `OCEAN_NODE_URI` | The ocean-node to use. Required for `OPSEPOLIA` and `CUSTOM`, and in practice everywhere (see step 3) |
   | `DDO_STORE` | `ipfs` or `s3` — where the encrypted DDO goes. Required to publish or edit (an `IPFS_UPLOAD_URL` on its own also selects `ipfs`); see [the DDO store](#publishing-needs-a-ddo-store) |
   | `CONSUMER_PRIVATE_KEY` | Optional. A second account that orders, downloads and runs compute; see [publisher and consumer](#publisher-and-consumer) |

   Your account needs funds for gas, and for any non-free asset it buys. On Pontus-X that
   means EURAU; on Oasis Sapphire, `ROSE` for gas and `PTX` for after-payment logging. Contact
   deltaDAO at contact@delta-dao.com for tokens and onboarding.

   Every other variable is optional and documented inline in `example.env`.

   **Which network?** `OPSEPOLIA` takes the contract addresses from ocean.js's
   `ConfigHelper`, so it needs only `OCEAN_NODE_URI` (and optionally `RPC_URL`). It assumes no
   payment token: set `PRICING_TOKEN_ADDRESS` and `PRICING_TOKEN_DECIMALS` for fixed prices
   (see [pricing](#pricing)). `LOCAL` is only the local docker stack on chain 8996; for any
   other chain use `CUSTOM` with `CHAIN_ID`, `RPC_URL` and `OCEAN_NODE_URI`, plus the contract
   addresses where ocean.js ships none. `setup()` checks that the RPC is on the chain
   `NETWORK` expects.

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

4. **Check your DDO store** — before your first publish:

   ```sh
   npm start -- store:check
   ```

   It runs the store's `check()`, the same preflight `publish()` runs before it mints
   anything, with no key and no transaction. For IPFS it uploads a fixed probe of a few
   bytes; for S3 it writes with the write key, reads back with the read key, and checks the
   read key can neither write nor delete.

5. **Run an example:**

   ```sh
   npm start -- help                      # every command, grouped
   npm start -- publish:access-dataset --help
   npm start -- publish:access-dataset
   npm start -- access:download did:ope:…
   ```

## The CLI

Every example is a named command:

```sh
npm start -- <command> [args...]
```

`npm start -- help` is the authoritative list — it is generated from the command table in
`commands.ts`, so it cannot drift. It marks the commands that need a DDO store (`S`) and the
ones that act as the consumer (`C`). `npm start -- <command> --help` prints one command's
usage and requirements without connecting to anything. The groups are:

| Group | What it covers |
| --- | --- |
| `check:` | Diagnostics. `check:node` is the one to run first. |
| `store:` | `store:check` — the DDO store's preflight, without a transaction. `store:remove <cid\|objectKey> [force]` — unpin or delete one stored envelope: an intermediate version, a revoked asset's, or one a failed write left. Refuses the creation or latest envelope `PUBLISH_LOG` lists unless `force`. |
| `publish:` | Datasets, algorithms, SaaS offers, multi-service assets, local validation, and `publish:resume` for a publish that stopped after the mint. |
| `asset:` | Inspecting, unlisting and revoking a published asset, and `asset:indexing-state` — why the node did or did not index it. |
| `edit:` | Metadata, descriptions, a service's name/description/timeout, files, endpoint and allowlist, prices, trusted algorithms. |
| `access:` | Price checks, ordering, downloading, service selection, consumer parameters. |
| `compute:` | Environments, free and paid jobs, status, logs, results, multi-dataset jobs. |
| `ssi:` | **New in v2.** Credential-gated publishing and consuming with walt.id. |

End-to-end scenarios chain several commands together:

```sh
npm run scenario:e2e             # publish → order → download → compute → revoke
npm start -- ssi:round-trip      # the credential-gated round trip
```

`scenario:e2e` revokes every asset it published when it is done (revoking is one-way); set
`E2E_KEEP_ASSETS=true` to keep them.

## What is in each file

| File | What it covers |
| --- | --- |
| `index.ts` | Argument parsing and dispatch. |
| `commands.ts` | The command catalogue and the help output. |
| `nautilus.ts` | Shared setup: the signers, the DDO store, the allowlist, indexer timing, `checkNode()` and `store:check`. |
| `config.ts` | Per-network addresses, the env-driven networks (`OPSEPOLIA`, `LOCAL`, `CUSTOM`) and pricing configs. |
| `indexing.ts` | What to do when a publish stops after the mint, or the node does not index a change; `asset:indexing-state`. |
| `ledger.ts` | The `PUBLISH_LOG` record of everything published and edited. |
| `assets.ts` | Where the example files are fetched from, and the algorithm container. |
| `publish.ts` | Datasets, algorithms, SaaS offers, multi-service assets, local validation. |
| `edit.ts` | Metadata, a service's general fields, files and allowlist, prices, trusted algorithms, lifecycle. |
| `access.ts` | Downloading, service selection, consumer parameters, price checks. |
| `compute.ts` | Environments, free and paid jobs, status, logs, results. |
| `identity.ts` | Credential-gated publishing (access and compute) and consuming with walt.id. |
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
- **These examples need the release they were written for.** They use `S3RemoteStore`,
  `completePublish`, `getIndexingState` and the throwing `waitForIndexer`, which are not in
  `2.0.0-beta.0`. Pin a version that has them (`--spec`), or stay on `use:local`.

A bare `use:npm` reads the version from `../src/package.json`; with `--spec` nothing outside
`examples/` is read, so it also works in a copy of this directory.

It is a dependency rewrite rather than `npm link`, deliberately: nothing is written to your
global npm prefix, so the two modes cannot leak into unrelated projects.

## What changed, and will surprise you

### Publishing needs a DDO store

nautilus signs the DDO as a verifiable credential, has the node encrypt it into an envelope,
stores that **off chain**, and writes only a node-encrypted `{ remote }` pointer on chain. So
publishing and editing need a `RemoteStore`. There is no plaintext mode any more: the
`encrypt` option is gone, and `encrypt: false` throws.

`nautilus.ts` builds it from `DDO_STORE`, and there is **no default**: the ocean-node's own
bucket storage (`NodePersistentRemoteStore`) cannot hold DDOs on ocean-node 4.2, because the
node resolves a DDO without a consumer address and a bucket refuses that read. nautilus
rejects it before any transaction.

**IPFS** (`DDO_STORE=ipfs`) — any endpoint taking a multipart file upload:

```sh
DDO_STORE="ipfs"
IPFS_UPLOAD_URL="http://127.0.0.1:5001/api/v0/add"                 # a Kubo node
# or Pinata, with a JWT whose key has the pin (pinFileToIPFS) and unpin scopes:
IPFS_UPLOAD_URL="https://api.pinata.cloud/pinning/pinFileToIPFS"   # not pinJSONToIPFS
IPFS_JWT="your-pinata-jwt"
IPFS_GATEWAY_URL="https://gateway.pinata.cloud"                     # needed for anything but Kubo
# IPFS_VERIFY="false"                                              # or: publish without the read-back
```

```ts
new IpfsRemoteStore({
  uploadUrl: process.env.IPFS_UPLOAD_URL,
  headers: { Authorization: `Bearer ${process.env.IPFS_JWT}` },
  probe: 'upload', // check() uploads a tiny probe before anything is minted
  gatewayUrl: process.env.IPFS_GATEWAY_URL // only when set
})
```

The ocean-node fetches the CID through **its own** IPFS gateway, so the content has to be
reachable from there. Every envelope is read back before the metadata transaction: through
`IPFS_GATEWAY_URL` when set (ideally the node's own `IPFS_GATEWAY`), otherwise, for a Kubo
node, through its `/api/v0/cat`. Pinata needs `IPFS_GATEWAY_URL`, or `IPFS_VERIFY=false` to
publish without the read-back; `store:check` says so before anything is minted. An S3
envelope is read back with the read key.

**S3** (`DDO_STORE=s3`) — AWS S3, Exoscale SOS or MinIO, with two key pairs:

```sh
DDO_STORE="s3"
S3_ENDPOINT="https://sos-de-fra-1.exo.io"   # MinIO: http://127.0.0.1:9000
S3_REGION="de-fra-1"                        # Exoscale: the zone. Default us-east-1
S3_BUCKET="my-ddos"
S3_PREFIX="ddo/"
# S3_NODE_ENDPOINT="http://minio:9000"      # if the node reaches the bucket differently
# S3_FORCE_PATH_STYLE="true"                # MinIO; defaults to true for IP/localhost endpoints
S3_WRITE_ACCESS_KEY_ID="..."                # uploads; never leaves this machine
S3_WRITE_SECRET_ACCESS_KEY="..."
S3_READ_ACCESS_KEY_ID="..."                 # read-only, scoped to S3_PREFIX
S3_READ_SECRET_ACCESS_KEY="..."
```

The read key is written, node-encrypted, into **every on-chain pointer, forever** — ocean-node
has no anonymous S3 read. Make it read-only and scoped to the prefix; rotating it breaks
re-indexing of the assets that point at it.

nautilus requires `https://` for `OCEAN_NODE_URI`, `S3_ENDPOINT` and `IPFS_UPLOAD_URL`, except
on `localhost`, `127.0.0.1`, `::1` and `*.localhost`; the examples have no switch to relax
that. `S3_NODE_ENDPOINT` may stay `http://` (e.g. `http://minio:9000`), because only the node
connects to it.

Run `npm start -- store:check` to test either store without a transaction. Each publish
prints where the envelope went (the CID, or the S3 object key), and `PUBLISH_LOG` keeps it.

Every edit stores a new envelope and leaves the old one in place, so the pointer on chain
keeps working until the edit lands. To clean up an intermediate version, or the envelopes of
a revoked asset, pass the CID or object key to `npm start -- store:remove`. It unpins on
Pinata (the key needs the unpin scope) or Kubo, or deletes the S3 object with the write key.

**Keep the creation envelope** (the one the publish stored) **and the current one** of every
asset that should stay indexed. A node reindex replays each asset from its creation event:
without that envelope the asset disappears from the index, even if its current version is
still stored, and without the current one it rolls back to an older version. When
`PUBLISH_LOG` lists the envelope as an asset's creation or latest one, `store:remove`
refuses unless you add `force` (for an asset you have revoked for good).

A publish or edit that fails before its metadata transaction is sent removes the envelope it
stored itself; the error's `stored` says what happened.

### When a publish or an edit does not end indexed

The DID derives from the NFT address, so `publish()` mints the NFT before it can store the
DDO. If anything fails after the mint, it throws a `PublishIncompleteError`, and the examples
print how to finish it on the **same** NFT instead of minting a second one:

```sh
npm start -- publish:resume publish:access-dataset 0xNFT… 0xDatatoken…
```

That re-runs the publish command — so use the same command, arguments and `.env` — and calls
`completePublish(nftAddress, asset)` with the datatokens the failed run created.
`completePublish` checks that you own the NFT and that the configured factory created it, and
reuses the datatokens already on it. In your own code, pass the same asset object (or one
rebuilt the same way) to `completePublish()`.

Once the metadata is on chain, the node still has to index it. `waitForIndexer` (and
`publish`/`edit` with `waitForIndexer`) now **throws** rather than returning `undefined`:
an `IndexingError` carrying the node's own message as soon as the node records that it could
not index the transaction, or an `OceanNodeError` after `INDEXER_TIMEOUT_MS` (default 5
minutes). The examples explain both. Either way the change is on chain, and in your own code
the error carries the full result as `error.published`. The node's record is the only place
that says why:

```sh
npm start -- asset:indexing-state 0xTxHash…   # failures are filed by transaction
npm start -- asset:indexing-state did:ope:…   # successes by DID
```

Two rules on edits. ocean-node indexes only the **first** metadata event of an asset in a
block: one `Nautilus` instance runs its writes to an asset one after the other, and when a
write from another process lands in the same block, nautilus throws a
`MetadataConflictError` (edit again to fix it). `edit()` does not wait for the previous change
to be indexed, but the edit examples wait for the indexer before they return, so running them
back to back is safe. And `DEPRECATED` and `REVOKED` are final — `publish()` and `edit()`
refuse them.

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

Gating applies to compute too: `npm start -- ssi:publish-gated-compute <algorithmDid>`
publishes a gated compute dataset that trusts that algorithm, and
`npm start -- ssi:compute <datasetDid> <algorithmDid>` runs a job on it, presenting the
credential before anything is ordered.

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

## Publisher and consumer

`PRIVATE_KEY` publishes and edits. Set `CONSUMER_PRIVATE_KEY` and the access and compute
commands (marked `C` in `help`), `ssi:consume` and `ssi:compute` run as that second account.
Its address is added to the allowlist of every allowlisted example asset, together with any
addresses in `CONSUMER_ADDRESSES` (comma separated — e.g. a consumer on another machine).
Without either, the assets are allowlisted to the publisher only, as before.

For credential-gated assets, the consumer logs in to walt.id with its own key; pin its wallet
with `CONSUMER_SSI_WALLET_ID` and `CONSUMER_SSI_WALLET_DID` (`npm start -- ssi:connect consumer`
lists them).

## Pricing

`config.ts` holds ready-made pricing configs per network, with the payment-token addresses
filled in. To change a price, edit `fixedRate` — a decimal string, e.g. `'2.95'`.

To price in a token of your choice on any network — including `OPSEPOLIA` and `CUSTOM`,
which have no ready-made token — set:

```sh
PRICING_TOKEN_ADDRESS="0x..."   # the ERC-20 to price in
PRICING_TOKEN_DECIMALS="6"      # required: a wrong value misprices by orders of magnitude
PRICING_FIXED_RATE="1"          # optional, default 1
```

The paid examples (`publish:access-algorithm`, `publish:saas`) use it ahead of the
network's EURAU/OCEAN configs; without any fixed config they publish for free and say so.

To check what an asset costs before buying it, run `npm start -- access:price <did>`.

## Checks

```sh
npm run typecheck              # tsc --noEmit, from this directory
npm --prefix .. run lint       # biome, from the repo root — it covers examples/ too
npm start -- help              # offline: no key, no chain, no node
npm start -- <command> --help  # offline as well
```

CI runs both on every pull request, building the library first so the examples typecheck
against a real `_types` output.
