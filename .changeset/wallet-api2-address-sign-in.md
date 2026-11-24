---
'@deltadao/nautilus': minor
---

Sign in to walt.id wallet-api2 with the key of an organisation address, so scripts,
backends and CI jobs present credentials (and sign DDOs) without a Hanko session token.

- **`WalletApi2CredentialProvider.withAddressSignIn({ gateway, signer, chainId?,
  smartAccount?, scopes? })`** signs in through the wallet UI's address gateway
  (`…/api/address-gateway`) and presents from the address's own wallet.
  `credentials.signIn` is the sign-in: `check()` reads what the address may do
  (`GET /auth/account`), `signOut()` revokes the token. `prepare()` signs in, checks that
  the signer is the consumer and that a pinned `walletId` is the address's wallet, and runs
  the pre-flight once, so a missing verifier or credential fails before any node session is
  opened. A preview evicted by newer previews (`handle_evicted`) is made again once.
- **`AddressSignIn`**: an ephemeral P-256 key in memory (WebCrypto, never exported), the
  EIP-4361 message rebuilt and compared byte for byte before the signer signs it (refused
  as `message_unexpected` with the expected and the actual line), a DPoP proof (RFC 9449)
  on every request, the token cached and renewed 60 s before it expires, one sign-in for
  concurrent callers, and one retry after a `401`.
- **`WalletApi2TokenSource`** and **`staticTokenSource()`**: `WalletApi2HttpClient` and
  the provider take a token source as `token`; a string or a function (a Hanko token) is
  sent as `Authorization: Bearer` as before. An address token is only sent to its gateway
  (`wrong_endpoint`). `WalletApi2HttpClient.account()` and `signDdo()` are new.
- **`WalletApi2VcSigner`** signs DDOs with a wallet-api2 key over a sign-in with the
  `sign-ddo` scope, in the DDO credential shape wallet-api2 accepts (no `iss`, `sub`, `jti`;
  no `credentialSubject.id` or `version`). `DdoSigner.prepareDocument()` (optional) lets a
  signer shape the document before publish and edit validate it.
- **Errors.** `CredentialPresentationReason` gains `'sign-in'` and `'not-permitted'`: an
  exhaustive `switch` over `error.reason` in your code needs a case for each. Both carry
  wallet-api2's or the gateway's code in `details.code` (and `hint`, `status`,
  `retryAfter`); `WaltIdWalletError` gains `code`, `hint` and `retryAfter`.
  `no-matching-credential` under an address token names the credential access list. A
  Hanko token keeps its reasons (`wallet-setup` for a 401/403), whatever the body.
- **401s** are retried at most once: a new sign-in after `token_invalid`/`token_expired`, a
  fresh proof after `dpop_invalid`, nothing else. Refused and replaced address tokens are
  revoked in the background. `AddressSignIn` takes `signInTimeoutMs` (default 60 s, covering
  `signMessage`) and an `AbortSignal` on `getToken()`, `authorize()` and `check()`.
- **Legacy walt.id client.** `WaltIdHttpWallet.authenticate()` signs only a one-line login
  nonce (trimmed), never a Sign-In with Ethereum message, a JWS signing input
  (`header.payload`, as `Eip191VcSigner` signs) or other text.
- **Redaction.** Address tokens (`pxa_…`), `DPoP` credentials and DPoP proofs are not
  printed at any `NAUTILUS_DEBUG` level, and are redacted from error text. After `Bearer`,
  `Basic` and `DPoP` only credential-shaped values are redacted in error text, so "the DPoP
  proof is invalid" keeps its words.
- **`FetchedText.wwwAuthenticate`**: the `WWW-Authenticate` header of a `401`.

Docs: the guide "Sign in from scripts and CI", `AddressSignIn` (with every error code, its
cause and who fixes it) and `WalletApi2VcSigner` reference pages, and the migration entry
"Replace a copied Hanko token".
