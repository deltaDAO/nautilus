---
"@deltadao/nautilus": minor
---

Credential attribute requirements: access can depend on what a credential says, e.g. only
`gx:LegalPerson` credentials whose `gx:legalAddress.gx:countryCode` is `DE`, with issuer
trust and the request list managed by the builders, and a consumer told before presenting
when a credential does not have the attributes.

**Breaking (beta API)**

- **`addRequestCredentials` (asset and service builder) throws a `TypeError`** naming the
  credential type and the policy for a per-credential `schema` whose `args` are not a JSON
  Schema object (a string such as `JSON.stringify(schema)`, an array, none) and for an
  `allowed-issuer` without a non-empty list of DIDs (one DID string is accepted, as walt.id
  does). walt.id failed such a policy for every presentation, or never matched the issuer.
  It also throws for per-credential policies on `VerifiableCredential` or
  `VerifiablePresentation`: walt.id files a presented credential under the last entry of its
  `type`, so they never ran on a credential with a more specific type, which a wallet still
  presents.
- **`AssetBuilder.build()` throws an `SsiPolicyError`** in every lint mode for:
  - those policies on a stored asset being edited (codes `credential-policy-arguments`,
    `generic-request-type`);
  - a type requested more than once, asset and service level merged as the policy server
    merges them, where a non-empty per-credential list is dropped (code
    `credential-policies-replaced`): walt.id keeps only the last non-empty list per type, so
    a check you configured, e.g. issuer trust, never ran. A request of the type without
    policies next to one with policies is fine;
  - request credentials without a format, with different formats (one type in two formats
    included) or with one walt.id does not request (code `request-format`): walt.id refuses
    to open the session ("Credentials formats must be distinct for a presentation request").
- **`WaltIdCredentialProvider` throws a `CredentialRejectedLocallyError`** with `policy:
  'schema'`, `reason: 'attribute-mismatch'` and `path` (the failing attribute, from the root
  of the checked credential) when the service requires attributes of a selected credential's
  type and the credential lacks one or has another value. Nothing is presented, ordered or
  paid. The message names the attribute and the required value, never the credential's
  value, which goes to the debug channel (`wallet` topic, `sensitive` tier) only. Schemas
  using keywords beyond `type`, `required`, `properties`, `const` and `enum` are not judged
  (`debug` event `identity.preflight.schema_skipped`). `preflight: false` turns it off.

**New**

- `AssetBuilder` and `ServiceBuilder`:
  - `requireCredentialAttributes(type, requirements, { format? })` writes walt.id's
    per-credential `schema` policy from `{ path, equals | oneOf | exists: true }`
    requirements under `credentialSubject` (exactly one condition each; a key set to
    `undefined`, e.g. an unset variable, throws); requirements and calls combine with AND. The schema has
    `credentialSubject` at the root, which is what walt.id validates for VCDM 2.0 `vc+jwt`
    (the payload) and VCDM 1.1 (the `vc` claim) alike;
  - `trustIssuers(type, dids, { format? })` writes the per-credential `allowed-issuer`,
    validating every DID; calls add issuers;
  - `setRequestCredentials(list, requestCredentials)` replaces the request credentials, so an
    edit can remove one or a policy; an empty list removes the list's `SSIpolicy` entry and
    logs `identity.policy.gate_removed` (`warn`), and throws when that would leave no gate:
    an allow list admitting `'*'`, or one with no address or access-list entry left (the
    node lets every address in through an empty allow list) on the asset, or on an edited
    service whose asset admits everyone.
  Both helpers add to the request credentials of the type (a new one in the list's format),
  and store issuer trust first, then the schema, then other policies, whatever the call
  order. Their `format` option throws when it would add a second request of the type or a
  second format.
- `credentialAttributeSchema`, `evaluateAttributeSchema` and the types
  `CredentialAttributeRequirement`, `CredentialAttributeValue`,
  `CredentialRequirementOptions`, `AttributeSchemaVerdict` are exported, as are the
  functional `requireCredentialAttributes`, `trustIssuers` and `setRequestCredentials` on a
  credentials block.
- `build()` logs, at `warn`: `identity.policy.unknown_name` (`where`, `policy`,
  `credentialType`) for a VC, VP or per-credential policy name walt.id does not know;
  `identity.policy.weak_schema` for a hand-written `schema` that checks less than it seems
  (judged in the dialect walt.id's validator uses: the `$schema` given, or 2020-12 without one;
  keys that dialect does not define, such as draft 7's `dependencies` without a draft-07
  `$schema`, keys next to `$ref` under draft 4 to 7, no constraint, attributes left out of
  `required`, an unsupported `$schema` or an `items` list under 2020-12, which fail every
  presentation); `identity.policy.issuer_not_did`
  for a stored `allowed-issuer` entry that is not a DID (walt.id compares the raw `iss`);
  `identity.policy.format_ignores_type` for per-credential policies on a `vc+sd-jwt` or
  `mso_mdoc` request, whose presentation definition walt.id does not tie to the requested
  type.
- `CredentialRejectedLocallyError.credentialType` is sanitised (control characters stripped),
  for `holder-binding` too. The attribute check mirrors the policy server's merge (repeats
  dropped at their first position, unparseable policies dropped) and walt.id's type reading,
  and names `onSelectCredentials` when the wallet selected several credentials of the type.
- `CredentialRejectedLocallyReason` gains `'attribute-mismatch'`;
  `CredentialRejectedLocallyError` gains `path`. The `identity.preflight.skipped` event
  gains `policy`.

Like issuer trust, the attribute check runs only on presented credentials whose last `type`
entry is the requested type: a hand-built presentation with a self-issued credential of
another type skips both, and so does a self-issued credential that carries the requested type
before its last entry, which a normal wallet presents (see the identity guide's known
limitation). It filters honest consumers holding honest credentials; it is not access
control.
