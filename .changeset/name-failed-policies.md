---
"@deltadao/nautilus": minor
---

A refused presentation names the policies that failed, and no presentation error carries the
policy-server session id or the wallet's redirect URI any more.

**Breaking (beta API)**

- **A presentation the verifier refuses is a `PolicyDeniedError`, also when the wallet reports
  it.** walt.id answers a refused presentation with an HTTP 400, so `WaltIdCredentialProvider`
  threw a `CredentialPresentationError` whose message was the wallet's raw answer (the
  verifier's error URL with the policy-server session id included), and the verifier's
  per-policy results were never read. Now, when `present()` throws a
  `CredentialPresentationError` with `reason: 'verifier-rejected'`, or any other kind of
  error, nautilus reads
  the verifier's record of the session (`checkSessionId`, through the node, best effort, cut
  after 15 seconds): when it names failed policies, you get a `PolicyDeniedError` whose
  `reason` lists them, with `policyResults` and the wallet's error as `cause`. Otherwise, or
  when the record cannot be read, the wallet's error is thrown as before; a failure before
  the verifier (no matching credential, no wallet, …) is thrown without the read. Code that
  caught `CredentialPresentationError` for a refused presentation should catch
  `PolicyDeniedError` as well. A refused session is never cached.
- **A custom provider that throws `CredentialPresentationError` for a verifier refusal must
  pass `'verifier-rejected'` as the third argument.** Otherwise its `reason` is
  `'wallet-failed'` and the failed policies are not read.
- **`PolicyDeniedError.reason` for a refused presentation reads differently.** It was
  `the verifier did not accept the presentation (…)`; it is now `the node reports that the
  verifier did not accept the presentation (holder-binding: java.lang.NullPointerException)`,
  because the node relays the verifier's record (and for a download the node is the
  publisher's choice). Code that matches on the old text must change. The list in parentheses
  always fits the reason's 200 characters, closing parenthesis included: each failure is cut
  at 80 characters, as many as fit are listed and the rest counted (`; 2 more in
  policyResults`).
- **`CredentialPresentationError.details` no longer holds the wallet's whole answer.**
  `WaltIdHttpWallet` parses the wallet's 400 answer and keeps only its `errorMessage` (or the
  `message` of walt.id's error handler, for an exception in the wallet such as a malformed
  request), control characters stripped, credentials redacted, at most 500 characters. The
  `redirectUri`, the verifier's error page with the policy-server session id in it, is
  dropped. `details` is `{ errorMessage }` for a rejection (`'the wallet gave no reason'`
  when walt.id gives none), and `undefined` only when a custom wallet reports an error
  redirect without a message; no `redirectUri` is kept. The message reads `The verifier
  rejected the presentation: <errorMessage>` (or `The wallet could not present the
  credentials: …` when the wallet failed itself). `PresentationResult` gains
  `rejectedBy: 'verifier' | 'wallet'` for a 400 answer.

**New**

- **`CredentialPresentationError.reason`**, a stable `CredentialPresentationReason`:
  `'verifier-rejected'`, `'wallet-failed'`, `'no-matching-credential'`, `'none-selected'`,
  `'wallet-setup'` or `'request-invalid'`. The constructor takes it as a third argument
  (default `'wallet-failed'`). A custom provider that throws it with a reason other than
  `'verifier-rejected'` skips the verifier read.
- **`PolicyDeniedError.cause`**: the provider's error, when the refusal was read after a
  failed `present()`.

**Fixed**

- **The policy-server session id is redacted from the wallet's text.** walt.id's verifier
  quotes it bare for an expired or unknown session (`Id parameter <id> doesn't refer to an
  existing session`), and the wallet passes that on. `WaltIdCredentialProvider` now removes
  the session id (and each of its two halves) from the wallet's message, whatever its length,
  also the start of it that a cut left before the message's closing `…` (`WaltIdHttpWallet`
  bounds the message before the provider sees it, so an id that crosses the 500th character
  is cut), and every sanitiser
  redacts the policy server's id shape (`<64 hex>-<64 hex>`, not after `0x`, which is a
  compute job id) wherever it stands, in node text and per-policy errors too. A URL quoted in
  the wallet's text still keeps its origin, so the verifier's host can appear.
- **The node's per-policy results are bounded.** `checkPolicySession` keeps at most 50
  results (failures first), and strips control characters from, redacts and cuts at 100
  characters each policy and credential name and each error. Each is read up to 800
  characters only (a field of a bound of 100 characters or less is read at eight times it,
  not at 8,192), so a hostile record costs milliseconds.
- **The `setVpPolicies` JSDoc** recommends the safe set
  (`[{ policy: 'signature' }, { policy: 'minimum-credentials', args: '1' }]`) and no longer
  suggests `holder-binding`.

With `NAUTILUS_DEBUG=sensitive` and the `policy` and `wallet` topics, the wallet's answer and
the verifier's record reach the debug channel as sent, long-lived credentials still masked. Don't send `policyResults` to a
central log: a policy's error can quote a value of the presented credential.
