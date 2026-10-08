---
'@deltadao/nautilus': patch
---

Pay a node's provider fee and compute escrow payment only with the caller's consent, and
fund only the escrow contract pinned for the chain: the chain's `EnterpriseEscrow` by
default.

The node chooses the provider fee of a download or compute input (its token, its amount
and who receives it). For a download that node is the service's `serviceEndpoint`, which
the publisher chooses, and the fee signature check only proves the node signed the fee.
For a paid compute job the node also names the escrow contract and the amount to lock.
nautilus approved and paid what the node quoted, and funded escrow through ocean.js's
`verifyFundsForEscrowPayment`, which approves the escrow contract for an amount scaled by
the token's decimals a second time.

**Breaking (beta API)**

- **A non-zero provider fee needs consent.** `access()`, `compute()`, `order()`,
  `reuseOrder()` and `settleOrder()` pay one only within `maxProviderFee` (per token, in
  the token's smallest unit; a compute job's fees are summed per token) or when
  `confirmProviderFees(fees)` returns `true`. Otherwise they throw a
  `ProviderFeeNotAllowedError` (`fees`, `reason`) before any approval, purchase, escrow
  or order. A zero fee needs nothing.
- **A paid compute job needs consent for its escrow payment**: within `maxEscrowPayment`
  or when `confirmEscrowPayment(payment)` returns `true`, or an
  `EscrowPaymentNotAllowedError` (`payment`, `reason`) is thrown before anything is sent.
  A zero payment needs nothing: its amount is read first, and a zero amount funds nothing
  and is not checked further, so it may name no escrow contract. A malformed amount is
  still refused.
- **Exactly one escrow contract is funded, `EnterpriseEscrow` first**:
  1. `config.escrow`, when the caller passes it to `Nautilus.create`: that contract, and no
     other;
  2. otherwise the chain's `EnterpriseEscrow` in Ocean's address data (ocean.js's bundled
     addresses, or `ADDRESS_FILE` when set), the contract ocean-node 4.2.0 uses where the
     chain has one (OP Sepolia, Optimism, Sepolia, Ethereum mainnet);
  3. otherwise the chain's `Escrow`.

  The `escrow` ocean.js's `ConfigHelper` fills in (the address data's plain `Escrow`) is not
  a caller's choice and is not used, so on OP Sepolia the plain `Escrow` is refused unless
  set explicitly. A quote naming any other contract, another chain, token or payee, or an
  inexact amount, is refused (`EscrowPaymentNotAllowedError`, its message naming the
  expected contract and the rule that chose it), and no callback overrides it. On a chain
  with no escrow in the address data (Pontus-X devnet among them), paid compute is refused
  until `config.escrow` is set to the chain's EnterpriseEscrow contract. A malformed
  `config.escrow` fails `Nautilus.create`. The standalone `compute(config, context)` takes
  the explicit choice as `context.escrow`, and does not read `context.chainConfig.escrow`.
- **Escrow is funded in exact amounts.** nautilus approves the escrow contract for the
  deposit only, deposits what escrow lacks for the job, and authorises the environment's
  account to lock the job's amount on top of its current locks, leaving a standing
  allowance or authorisation that already covers the job alone. A wallet that cannot cover
  the deposit is refused before any transaction.
- **Every input is checked before escrow is funded.** `compute()` reads each input's
  pricing and refuses one that cannot be ordered before the escrow approval, deposit or
  authorisation, so every refusal comes before the first transaction.
- **Paid jobs are serialised per payer within an instance.** A `Nautilus` instance runs
  the escrow reads, deposit, authorisation, orders and `computeStart` of jobs that share a
  chain, payer, payment token and environment account one at a time, so concurrent
  `compute()` calls do not overwrite each other's escrow authorisation. Jobs from other
  instances or processes are not covered. The standalone `compute(config, context)`
  serialises when given a lock as `context.escrowLock`.

**Migration**

Set the most you are prepared to pay, once for the instance or per call:

```ts
const nautilus = await Nautilus.create(signer, {
  config,
  maxProviderFee: { token: feeToken, amount: parseUnits('0.5', 18) },
  maxEscrowPayment: { token: paymentToken, amount: parseUnits('5', 18) }
})
```

The instance defaults come in pairs, `maxProviderFee` with `confirmProviderFees` and
`maxEscrowPayment` with `confirmEscrowPayment`: a call that sets either option of a pair,
even to `undefined`, uses its own pair and neither default of it, so a tighter per-call
ceiling never falls back to a permissive default callback. An app that asks its user can
pass `confirmProviderFees` / `confirmEscrowPayment` instead, or as well: they are asked
only for what the ceiling does not cover. `Nautilus.create` refuses a malformed ceiling.

**New**

- `TokenAmount`, `ProviderFeeQuote`, `EscrowPaymentQuote`, `ProviderFeeLimits`,
  `EscrowPaymentLimits`, `ProviderFeeNotAllowedError` and `EscrowPaymentNotAllowedError`
  are exported, and so are the `OrderRequest` and `OrderResult` types.
