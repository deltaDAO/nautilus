---
'@deltadao/nautilus': patch
---

Store SSI policies in the form ocean-node 4.2.x indexes and the policy server parses, so
credential-gated assets are indexed.

**Fixes**

- **Credential-gated assets are indexed.** An asset whose `vp_policies` mixed a name with a
  `{ policy, args }` object, as the identity guide showed, was published but never indexed by
  ocean-node 4.2.x. Every VP policy is
  now written as `{ policy }` or `{ policy, args }`, as the enterprise market writes them.
- **Per-credential policies take effect.** `request_credentials[].policies` are stored
  JSON-encoded (`'signature'` becomes `'"signature"'`, an object its JSON), the form the
  policy server parses and the enterprise market writes. The policy server skipped a bare
  name, so those checks never ran.
- **Edits write no legacy form back.** Editing an asset normalises the policies it loads
  (asset level, every service, including services the edit does not touch): bare-name VP
  policies become objects, non-string `args` are JSON-stringified, and raw per-credential
  policies are encoded, so a per-credential check stored as a bare name starts being
  enforced once the edit is published.
- **Loaded VC policies and addresses are normalised too.** `{ policy }` objects in
  `vc_policies` become names (deduplicated), and bare-string address `values` become
  `{ address }`, so `addCredentialAddresses()` no longer writes `{ address: undefined }`
  and `removeCredentialAddresses()` no longer throws on such an asset.

**Breaking (beta API)**

- **`VpPolicy` is `{ policy: string; args?: string }`.** `setVpPolicies()` and the
  `vpPolicies` of `addRequestCredentials()` no longer accept bare names, and `args` is a
  string. The policy server parses it as JSON when it can, so `'1'` reaches the verifier
  as `1`.
- **`SsiPolicyValue.request_credentials` is `StoredRequestCredential[]`**, whose
  `policies` are JSON strings. `RequestCredential`, which the builders take, is unchanged.

**Migration**

VP policies are now stored as objects. Write each one as an object, and pass structured
arguments through `JSON.stringify`:

```ts
builder.setVpPolicies(CredentialListTypes.ALLOW, [
  { policy: 'holder-binding' }, // was 'holder-binding'
  { policy: 'minimum-credentials', args: '1' }
])
```

An asset already published with a mixed `vp_policies` list was never indexed, so publish
it again. An indexed asset with bare names is rewritten to objects by its next edit.
