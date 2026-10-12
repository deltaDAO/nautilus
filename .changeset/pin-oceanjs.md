---
"@deltadao/nautilus": minor
---

nautilus's own copy of ocean.js only changes deliberately.

nautilus works around several ocean.js behaviours instead of changing ocean.js: the nonce
guard and `confirmTransaction` rest on how ocean.js sends and waits for transactions and on
it returning `null` for a failed send, the log capture on its `LoggerInstance`, the order
path on its approvals, the node client on how it signs requests. A minor ocean.js release
that changed one of them would have arrived with a plain `npm install`, unreviewed.

**What changes for you**

- **`dependencies`: `@oceanprotocol/lib` `^9.2.1` → `~9.2.1`.** nautilus's own copy takes
  patch releases only; a newer minor arrives with a nautilus release that was tested
  against it.
- **`peerDependencies` stays `^9.2.1`.** Your app may still bring any ocean.js 9.x from
  9.2.1 on. nautilus is tested against 9.2.1, and every week against the newest 9.x; if you
  pin a newer 9.x yourself and something breaks, check
  [Supported ocean.js versions](https://github.com/deltaDAO/nautilus/blob/main/src/README.md#supported-oceanjs-versions)
  and report it.
- Nothing else: no API or behaviour change. Each ocean.js behaviour nautilus relies on is
  now pinned by a contract test (`test/unit/OceanJsContract.test.ts`), run against both
  ocean.js bundles, and weekly against the newest 9.x.
