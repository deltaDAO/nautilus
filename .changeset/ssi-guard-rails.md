---
"@deltadao/nautilus": minor
---

SSI gating guard rails: `AssetBuilder.build()` checks the asset's SSI policies before
anything is published, and `WaltIdCredentialProvider` refuses, before presenting, a
credential the verifier would reject for `holder-binding`.

**Breaking (beta API)**

- **`AssetBuilder.build()` throws an `SsiPolicyError` for SSI policies that cannot work as
  written**, which were published before:
  - a VC policy at asset or service level that carries arguments, or needs them
    (`allowed-issuer`, `schema`, `webhook`, `dynamic`, `credential-status`). The policy
    server keeps only the name of such a policy, so walt.id failed it for every presentation
    (refusing every consumer) or ran it without its arguments. Put it in the `policies` of
    the requested credential instead. This also applies to an edit of a published asset
    whose stored VC policies are of this kind;
  - `minimum-credentials`, `maximum-credentials` or `vp_required_credentials` without
    `args`, which walt.id fails for every presentation.
- **`WaltIdCredentialProvider` throws a `CredentialRejectedLocallyError`** (`policy:
  'holder-binding'`, `reason: 'no-sub' | 'sub-mismatch'`, `credentialType`, `serviceId`)
  when the service requires `holder-binding` and a selected credential's JWT has no `sub`, or
  a `sub` (up to a `#`) that is not the presenting DID. It used to present it and get the
  verifier's "Presentation failed". Nothing is presented, ordered or paid. Credentials that
  are not plain JWTs are not judged. `preflight: false` turns the check off.

**New**

- `build()` logs a `warn` event for `holder-binding` (`identity.policy.holder_binding`),
  for `presentation-definition` with a `jwt_vc_json` or `jwt_vc` request credential
  (`identity.policy.presentation_definition_vc_jwt`) and for a request credential without
  a per-credential `allowed-issuer` (`identity.policy.no_issuer_trust`), each with `where`
  and, where it applies, `credentialType`. `AssetBuilder.setSsiPolicyLint('warn' | 'error' |
  'off')` chooses whether they are logged (the default), thrown as an `SsiPolicyError`, or
  skipped. The warnings go to the process-wide logger.
- `SsiPolicyError` (`findings`: `code`, `fatal`, `where`, `policy`, `credentialType`,
  `message`), `SsiPolicyFinding`, `SsiPolicyLintMode`, `CredentialRejectedLocallyError` and
  `CredentialRejectedLocallyReason` are exported.
- `WaltIdCredentialProvider` options `preflight` (default `true`) and `logger`; a `debug`
  event `identity.preflight.skipped` for a credential it cannot decode, with the raw form on
  the debug channel's `wallet` topic.
- The `DEFAULT_VC_POLICIES` doc comment no longer says they are the policy server's
  defaults: a deployment adds its own `DEFAULT_VC_POLICIES` and `DEFAULT_VP_POLICIES`.

None of these checks stops a consumer who builds their own presentation with a credential of
another type: that needs the policy server (see the identity guide's known limitation).
