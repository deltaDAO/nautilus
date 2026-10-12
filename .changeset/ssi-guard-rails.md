---
"@deltadao/nautilus": minor
---

SSI gating guard rails: `AssetBuilder.build()` checks the asset's SSI policies before
anything is published, and `WaltIdCredentialProvider` refuses, before presenting, a
credential the verifier would reject for `holder-binding`.

**Breaking (beta API)**

- **`AssetBuilder.build()` throws an `SsiPolicyError` for SSI policies that cannot work as
  written**, whatever the lint mode, which were published before:
  - an `SSIpolicy` that applies to a service requesting no credential, such as VC or VP
    policies on the asset next to an ungated service. The policy server refused every
    consumer of that service ("SSIpolicy was found, but failed to fetch request
    credentials"). Put the policies on the gated service (`ServiceBuilder.setVcPolicies` /
    `setVpPolicies`, new). On an edit, clear the asset's lists with
    `AssetBuilder.setVcPolicies(list, [])` and `setVpPolicies(list, [])` first: an
    `SSIpolicy` entry left empty is now removed;
  - a VC policy at asset or service level that needs arguments (`allowed-issuer`, `schema`,
    `webhook`, `dynamic`, `credential-status`). The policy server keeps only the name of
    such a policy, so walt.id failed it for every presentation (refusing every consumer).
    Put it in the `policies` of the requested credential instead. Any other VC policy with
    arguments ran without them: drop the arguments and keep the name. An edit of a published
    asset throws for stored VC policies of the five kinds that need arguments; others are
    written back as their name;
  - `minimum-credentials` or `maximum-credentials` without an integer `args`, and
    `vp_required_credentials` without `args` of the form `{ required: [...] }`, which
    walt.id fails for every presentation;
  - a per-credential `allowed-issuer` that names no issuer (no `args`, `[]`, `'*'`), which
    refuses every credential.
- **`WaltIdCredentialProvider` throws a `CredentialRejectedLocallyError`** (`policy:
  'holder-binding'`, `reason: 'no-sub' | 'sub-mismatch'`, `credentialType`, `serviceId`)
  when the service requires `holder-binding` and a selected credential's JWT has no `sub`, or
  a `sub` (up to a `#`) that is not the presenting DID (another DID, empty, not a string). It used to present it and get the
  verifier's "Presentation failed". Nothing is presented, ordered or paid. Credentials that
  are not plain JWTs are not judged. `preflight: false` turns the check off.

**New**

- `ServiceBuilder.setVcPolicies(list, policies)` and `setVpPolicies(list, policies)`: VC and
  VP policies for one service, so a service can be gated with the recommended set while a
  sibling service stays open. They replace the service's list, like the `AssetBuilder`
  setters.
- `build()` logs a `warn` event, each with `where` and, where it applies, `credentialType`,
  for:
  - a gate weaker than the recommended set, on each service's merged view: no VC
    `signature` (`identity.policy.no_vc_signature`), no VP `signature`
    (`identity.policy.no_vp_signature`), no `minimum-credentials` of at least 1
    (`identity.policy.no_minimum_credentials`);
  - `'*'` in the address allow list of a credential-gated service, as the policy server
    reads it (`identity.policy.wildcard_allow`);
  - `holder-binding` (`identity.policy.holder_binding`);
  - `presentation-definition` with a `jwt_vc_json` or `jwt_vc` request credential
    (`identity.policy.presentation_definition_vc_jwt`);
  - a requested type whose effective per-credential policies (walt.id keeps the last
    non-empty list per type, after the policy server drops repeats of an identical request)
    have no `allowed-issuer` (`identity.policy.no_issuer_trust`). Lists that never run
    throw (`credential-policies-replaced`; see the credential attribute changeset).

  `AssetBuilder.setSsiPolicyLint('warn' | 'error' | 'off')` chooses whether they are logged
  (the default), thrown as an `SsiPolicyError`, or skipped. The warnings go to the
  process-wide logger. Service ids and names in findings are sanitised.
- `SsiPolicyError` (`findings`: every finding, fatal first, each with `code`, `fatal`,
  `where`, `policy`, `credentialType`, `message`; the message lists the first 20),
  `SsiPolicyFinding` (its `code` typed as `SsiPolicyFatalCode | SsiPolicyWarningCode`),
  `SsiPolicyLintMode`, `CredentialRejectedLocallyError` and
  `CredentialRejectedLocallyReason` are exported.
- `WaltIdCredentialProvider` options `preflight` (default `true`) and `logger`; a `debug`
  event `identity.preflight.skipped` for a credential it cannot decode, with the raw form on
  the debug channel's `wallet` topic.
- The `DEFAULT_VC_POLICIES` doc comment no longer says they are the policy server's
  defaults: a deployment adds its own `DEFAULT_VC_POLICIES` and `DEFAULT_VP_POLICIES`.

None of these checks stops a consumer who builds their own presentation with a credential of
another type: that needs the policy server (see the identity guide's known limitation).
