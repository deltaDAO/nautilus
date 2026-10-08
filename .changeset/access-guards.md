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
  (against its algorithm metadata) before the environment is read.
- **`access()` refuses a non-access service.** On a `compute` service it called the node's
  `initialize` and failed with a JSON parse error. It now throws before any node call, naming
  `compute()` and `freeCompute()`; an asset with only a `compute` service gets the same
  pointer.

**Breaking (beta API)**

- **`ConsumerParameterError`** (`did`, `serviceId`, `field`, `issues`) is thrown before
  anything is sent when the values do not fit what the asset declares. Each issue is
  `{ parameter, reason, message }`, `reason` one of:
  - `'missing'`: a `required` parameter is absent (`undefined` or `null`);
  - `'wrong-type'`: `text` takes a string, `number` a finite number (not `'5'`), `boolean`
    a boolean, `select` a string;
  - `'not-an-option'`: a `select` value is not one of its option keys;
  - `'unknown'`: a key the asset does not declare. An asset that declares no parameters
    takes any values, as before;
  - `'not-object'`: the values are not an object.

  Defaults are not filled in: an absent optional parameter stays absent.
- **`access()` downloads from `access` services only**, with an `Error` for any other
  service type.

**New**

- `checkConsumerParameters(declared, values)` returns the same issues without throwing, to
  validate a form before calling.

**Migration**

Send values of the declared types, only for declared parameters, and every required one:

```ts
await nautilus.access({
  assetDid,
  userdata: { rows: 5 } // was { rows: '5' }
})
```

For a `compute` service, run a job with `compute()` or `freeCompute()` instead of calling
`access()`.
