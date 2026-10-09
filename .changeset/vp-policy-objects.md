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
- **Loaded VC policies are normalised too.** `{ policy }` objects in `vc_policies` become
  names (deduplicated).
- **The address helpers read bare-string addresses.** `addCredentialAddresses()` no longer
  writes `{ address: undefined }` and `removeCredentialAddresses()` no longer throws on an
  asset whose address `values` are bare strings. An entry stored as bare strings only stays
  that way, a mixed one is written back as `{ address }`, and an edit leaves address entries
  it does not touch as stored, since upstream ocean-node 4.2.0 without a policy server
  reads only bare strings. `AddressCredential.values` is typed
  `({ address: string } | string)[]` accordingly.
- **`removeCredentialAddresses()` removes from every address entry of the list.** It
  changed only the first, so an address also held by a second entry stayed allowed by the
  policy server, which reads them as one list.
- **Loading reads every stored shape the policy server accepts.** A single policy or request
  credential stored without its array is wrapped in one, and list entries that are not
  objects are skipped, so even a metadata-only edit of such an asset no longer throws.
- **Unreadable policies fail closed.** An edit throws, naming the entry, on a VP policy,
  request credential or per-credential policy it cannot read, rather than dropping it and
  leaving the asset open under the remaining policies. `setVpPolicies()` refuses one too,
  and writes a bare name from an untyped caller as `{ policy }`.
- **A stored per-credential policy is not encoded twice** when passed back into
  `addRequestCredentials()`.
- **Edits keep every `SSIpolicy` value.** Only the first value of the entry was kept, so the
  request credentials of the others were dropped. Values (and a second `SSIpolicy` entry in
  the same list) are merged into one, as the policy server reads them, so `setVcPolicies()`
  and `setVpPolicies()` replace the policies of all of them.
- **Removing the last allowed address keeps the gate.** `removeCredentialAddresses()`
  dropped the allow entry once it was empty, which lifted the address gate; the node and
  the policy server read an empty allow list as "deny everyone". The entry is now kept as
  `values: []`. An emptied deny entry is still dropped.

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
