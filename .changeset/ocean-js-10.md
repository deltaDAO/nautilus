---
'@deltadao/nautilus': minor
---

Update to `@oceanprotocol/lib` 10.1.0 and `@oceanprotocol/ddo-js` 1.1.0. The peer
dependency on ocean.js is now `^10.1.0`. ocean.js no longer nests its own older ddo-js.

- **Escrow v1 and v2.** ocean.js 10's escrow ABI is Escrow v2 (`@oceanprotocol/contracts`
  3.x), whose authorisation has an expiry. pontusx-node and its deployments use Escrow v1
  (contracts 2.x), whose authorisation ocean.js 10 cannot decode and whose `authorize` it
  encodes with one argument too many. `compute()` now detects the quoted escrow's
  generation (ERC-165) and reads and writes it with its own ABI, so paid compute works
  with both.
- **Expiring authorisations (v2).** An authorisation without expiry stays without one. An
  expiring authorisation that would end before the job's lock (plus 120 seconds for the
  orders and the start call) is moved out to that point. An expired one, which is how a
  payer revokes, is refused with an `Error` before anything is sent, instead of being
  re-enabled.
- **Escrow addresses.** ocean.js 10's address data names the redeployed v2 contracts on
  every chain it ships escrows for. Without `config.escrow`, a node that still quotes its
  old v1 escrow on such a chain is refused before anything is spent. Funds left in an old
  escrow stay there.
- **`OceanNodeError.code`**, and `status` for calls through ocean.js: ocean.js 10's typed
  provider errors carry the node's HTTP status and machine-readable code, e.g.
  `MAINTENANCE_MODE`.
- **DDO types.** ddo-js 1.1 types `credentials` on `ServiceV5` and the v5
  `credentialSubject` as an object (`{ allow, deny, match_allow, match_deny }`) instead of
  an array.
- **Validation.** ddo-js 1.1 reports a DID that does not derive from `nftAddress` and
  `chainId` itself. `validate()` reports it once, with nautilus's message naming the
  expected DID.

**Verified** with the unit suite and against the pontusx e2e stack (pontusx-node `f1724658`
with Escrow v1 on anvil): SSI access, publish and consume, dc+sd-jwt, and free and paid
Compute-to-Data.
