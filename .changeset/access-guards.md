---
'@deltadao/nautilus': patch
---

Check the service and its consumer parameters before `access()` and `compute()` send
anything.

**Fixes**

- **Consumer parameters are validated.** A value of the wrong type was sent on: a service
  declaring `rows` as a `number` took `userdata: { rows: 'not-a-number' }`, and the order
  was placed and the file downloaded. `access()` now checks `userdata` against the
  service's `consumerParameters` before the node is asked for a fee, and `compute()` /
  `freeCompute()` check every input's `userdata` and the algorithm's `algocustomdata`
  before the environment is read. `algocustomdata` is checked against the algorithm
  metadata's `consumerParameters`, else, when that is absent or empty, the
  `container.consumerParameters` some DDOs carry.
- **`null` consumer parameters are not sent.** An explicit `null` counted as absent for an
  optional parameter but was still forwarded, reaching `initialize`, the download URL
  (`?age=null`) or the job. Keys set to `undefined` or `null` are now dropped from
  `userdata` and `algocustomdata` before anything is sent, whether or not the asset
  declares parameters; the caller's object is left unchanged.
- **`userdata` reaches the node intact over HTTP.** ocean.js appended it to the download
  URL with `encodeURI`, which leaves `&`, `#`, `+` and `=` as they are: a value holding one
  of them, or a number such as `1e21` (sent as `1e+21`), broke the query, and the node ran
  the paid download without any `userdata`. It is now encoded as one query component. The
  download signature does not cover it, so the URL stays valid. P2P is unchanged.
- **`access()` refuses a non-access service.** On a `compute` service it called the node's
  `initialize` and failed with a JSON parse error. It now throws before any node call, naming
  `compute()` and `freeCompute()`; an asset with only a `compute` service gets the same
  pointer.

**Breaking (beta API)**

- **`ConsumerParameterError`** (`did`, `serviceId`, `field`, `issues`) is thrown before
  anything is sent when the values do not fit what the asset declares. Each issue is
  `{ parameter, reason, message }`. A message gives the refused value's type and, for a
  string, its length, never the value, so a secret typed into the wrong field stays out of
  logs; parameter names and option keys, the publisher's text, are shown without control
  characters and cut to 40 characters, and lists of them, like the issues in the error's
  message, stop after 10 (`error.issues` keeps them all). `reason` is one of:
  - `'missing'`: a `required` parameter is absent (`undefined` or `null`);
  - `'wrong-type'`: `text` takes a string, `number` a finite number (not `'5'`), `boolean`
    a boolean, `select` a string, and any other type a string, a finite number or a
    boolean;
  - `'not-an-option'`: a `select` value is not the first key of one of its options (the
    key the node and the market read; other keys are refused);
  - `'invalid-declaration'`: a `select` whose options are missing, empty or malformed.
    Any value for it is refused (it used to take every string); an optional one can be
    left absent;
  - `'unknown'`: a key the asset does not declare;
  - `'not-object'`: the values are not a plain object. A `Date`, `Map`, `Set` or class
    instance is refused too.

  An asset that declares no parameters takes any keys, but not any values as it used to:
  they must be a plain object (`'not-object'`), each a string, a finite number or a
  boolean (`'wrong-type'`), since an object or an array reached the file's URL as
  `[object Object]`. Defaults are not filled in: an absent optional parameter stays
  absent, and values left empty once `undefined` and `null` keys are dropped are not sent.
- **`access()` downloads from `access` services only**, with an `Error` for any other
  service type.

**New**

- `checkConsumerParameters(declared, values)` returns the same issues without throwing, to
  validate a form before calling. `declared` is a `DeclaredConsumerParameter[]`, which a
  service's or an algorithm's `consumerParameters` and ddo-js's v4 `ConsumerParameter[]`
  all fit.
- `getAlgorithmConsumerParameters(asset)` returns the parameters an algorithm declares for
  `algocustomdata`.

**Migration**

Send values of the declared types, only for declared parameters, and every required one.
For an asset that declares none, send strings, numbers and booleans only:

```ts
await nautilus.access({
  assetDid,
  userdata: { rows: 5 } // was { rows: '5' }
})
```

For a `compute` service, run a job with `compute()` or `freeCompute()` instead of calling
`access()`.
