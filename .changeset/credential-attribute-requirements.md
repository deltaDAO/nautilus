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
- **`AssetBuilder.build()` throws an `SsiPolicyError`** for those policies on a stored asset
  being edited (code `credential-policy-arguments`), and for a credential type requested
  more than once with different formats or policies, asset and service level merged (code
  `duplicate-request-type`): walt.id keeps only the last request's per-credential policies
  for a type and silently dropped the others, e.g. issuer trust.
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
    per-credential `schema` policy from `{ path, equals | oneOf | exists }` requirements
    under `credentialSubject`; requirements and calls combine with AND. The schema has
    `credentialSubject` at the root, which is what walt.id validates for VCDM 2.0 `vc+jwt`
    (the payload) and VCDM 1.1 (the `vc` claim) alike;
  - `trustIssuers(type, dids, { format? })` writes the per-credential `allowed-issuer`,
    validating every DID; calls add issuers;
  - `setRequestCredentials(list, requestCredentials)` replaces the request credentials, so an
    edit can remove one or a policy; an empty list removes the list's `SSIpolicy` entry.
  Both helpers add to the one request credential of the type, and store issuer trust first,
  then the schema, then other policies, whatever the call order.
- `credentialAttributeSchema`, `evaluateAttributeSchema` and the types
  `CredentialAttributeRequirement`, `CredentialAttributeValue`,
  `CredentialRequirementOptions`, `AttributeSchemaVerdict` are exported, as are the
  functional `requireCredentialAttributes`, `trustIssuers` and `setRequestCredentials` on a
  credentials block.
- `build()` logs `identity.policy.unknown_name` (`warn`; `where`, `policy`,
  `credentialType`) for a VC, VP or per-credential policy name walt.id does not know.
- `CredentialRejectedLocallyReason` gains `'attribute-mismatch'`;
  `CredentialRejectedLocallyError` gains `path`. The `identity.preflight.skipped` event
  gains `policy`.

Like issuer trust, the attribute check runs only on presented credentials of the requested
type: a hand-built presentation with a self-issued credential of another type skips both
(see the identity guide's known limitation). It filters honest consumers; it is not access
control against someone who builds their own presentation.
