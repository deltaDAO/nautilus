---
'@deltadao/nautilus': patch
---

Pay a node's provider fee and compute escrow payment only with the caller's consent, and
fund only the configured escrow contract.

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
  `ProviderFeeNotAllowedError` (`fees`, `reason`) before any chain read, approval,
  purchase, escrow or order. A zero fee needs nothing.
- **A paid compute job needs consent for its escrow payment**: within `maxEscrowPayment`
  or when `confirmEscrowPayment(payment)` returns `true`, or an
  `EscrowPaymentNotAllowedError` (`payment`, `reason`) is thrown before anything is sent.
  A zero payment needs nothing.
- **Only the chain config's `escrow` contract is funded.** A quote naming another
  contract, another chain, token or payee, or an inexact amount, is refused
  (`EscrowPaymentNotAllowedError`), and no callback overrides it. On a chain whose
  `ConfigHelper` defaults have no `escrow`, pass `config: { escrow: '0x…' }` to
  `Nautilus.create`.
- **Escrow is funded in exact amounts.** nautilus approves the escrow contract for the
  deposit only, deposits what escrow lacks for the job, and authorises the environment's
  account to lock the job's amount on top of its current locks, leaving a standing
  allowance or authorisation that already covers the job alone. A wallet that cannot cover
  the deposit is refused before any transaction.

**Migration**

Set the most you are prepared to pay, once for the instance or per call:

```ts
const nautilus = await Nautilus.create(signer, {
  config,
  maxProviderFee: { token: feeToken, amount: parseUnits('0.5', 18) },
  maxEscrowPayment: { token: paymentToken, amount: parseUnits('5', 18) }
})
```

A call's own option replaces the instance default of the same name. An app that asks its
user can pass `confirmProviderFees` / `confirmEscrowPayment` instead, or as well: they are
asked only for what the ceiling does not cover. `Nautilus.create` refuses a malformed
ceiling.

**New**

- `TokenAmount`, `ProviderFeeQuote`, `EscrowPaymentQuote`, `ProviderFeeLimits`,
  `EscrowPaymentLimits`, `ProviderFeeNotAllowedError` and `EscrowPaymentNotAllowedError`
  are exported, and so are the `OrderRequest` and `OrderResult` types.
