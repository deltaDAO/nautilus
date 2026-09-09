---
'@deltadao/nautilus': minor
---

Require `@oceanprotocol/ddo-js` ^0.5.0 and drop the type-resolution postinstall patch.

ddo-js 0.5.0 is the first release whose `exports` map carries `types` conditions, so its
declarations are reachable under `nodenext`, `node16` and `bundler` without help. The
`postinstall` hook that rewrote the installed manifest — and the
`scripts/patch-ddo-js-types.mjs` it ran — are gone, so nautilus no longer runs a lifecycle
script on install and works unchanged under `--ignore-scripts` and pnpm.

0.5.0 is identical to 0.4.1 at runtime; only the packaging metadata changed.
