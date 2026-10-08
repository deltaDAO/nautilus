---
'@deltadao/nautilus': patch
---

Address a compute job by the id ocean-node gives it, read the job's `output` and final logs,
request a CPU and memory limit by default, and publish algorithms without a dataset's
compute settings.

**Fixes**

- **A job's status, result and logs are the job's own.** nautilus shortened a started job's
  id to the bare `<jobId>` and asked the node for that. ocean-node filters on a job only by
  `<environmentHash>-<jobId>`, and given a bare id answers with every job of the consumer;
  nautilus then took the first, so an unknown or mistyped id returned another job's status
  and `getComputeResult()` that job's output URL. Every status request also transferred the
  consumer's whole job history. Jobs are now addressed by the qualified id, and
  `getComputeStatus()` (and `OceanNodeClient.getComputeJob()`) return `undefined` when no
  job matches.
- **`streamComputeResult()` streams the job's `output`.** It read the result at index 0,
  which on ocean-node 4.2 is the image log (`imageLog`, `configurationLog`, `algorithmLog`,
  `output`). It now picks the result as `getComputeResult()` does.
- **A failed job has finished.** A job counts as finished once the node sets its
  `dateFinished`, as the node itself decides, rather than from status `70`: failed jobs end
  below it (`2`, `11`, `13`, `21`, `22`, `31`, `41`, `42`, `61`, `62`, …), so
  `getComputeResult()` reported them as not finished forever and `getComputeLogs()` failed
  on them. Both now read a failed job's results.
- **A job at `71` without its `output` yet is not ready, not output-less.** The node sets
  `71` (`JobSettle`) before it writes `outputs.tar`, so `getComputeResult()` logs that the
  job has not listed its `output` yet instead of warning that it has none, and
  `streamComputeResult()` says so in its error.
- **`getComputeLogs()` works on a finished job.** The node serves live logs only while the
  algorithm runs, so once the job has finished it streams the job's `algorithmLog` result,
  also when the job finishes between the status check and the log request.
- **Job ids cannot add query parameters.** ocean.js puts the job id into the query string of
  signed requests unencoded, and nautilus accepted any id with a dash, so `h-x&index=3` added
  a parameter. Job ids must now be exactly what ocean-node builds (`0x` and 64 hex digits, a
  dash, 64 hex digits), result indexes non-negative safe integers; errors give a malformed
  id's length, not the id.
- **Node URIs in compute errors and logs show only their origin**, since a URI can carry
  credentials; job ids are left out of those messages too.
- **Jobs get a CPU and memory limit by default.** Without `resources`, each resource
  defaulted to the environment's minimum, `0` for RAM and disk on ocean-node 4.2
  environments, so free jobs ran without a memory limit. `cpu`, `ram` and `disk` now
  default to at least `1` within the resource's maximum, on free and paid jobs; other
  resources default to their minimum. A `resources` list is sent exactly as given.
- **Algorithms carry no `compute` block.** An algorithm's compute service was published with
  a dataset's settings (`allowRawAlgorithm`, `allowNetworkAccess`, an empty
  `publisherTrustedAlgorithms`, …), which ocean-node reads from datasets only. Assets of type
  `algorithm` are now published and edited without them.
- **Docs:** the `output` result is `outputs.tar`, a tar archive; `configurationLog` is no
  longer misspelt. A qualified job id is to be kept secret: ocean-node 4.2.2 checks that a
  live-log request is signed, not that the signer owns the job.
- **Example:** `retrieveComputeResult` no longer prints the signed result URL, and counts the
  archive's bytes as they stream instead of buffering it.

**Breaking (beta API)**

- **Job ids are `<environmentHash>-<jobId>`.** `compute()` and `freeCompute()` return the
  id as the node gives it, and `getComputeStatus()`, `getComputeResult()`,
  `streamComputeResult()`, `getComputeLogs()` and `stopCompute()` take it. A bare id throws,
  as it does on `OceanNodeClient`'s `computeStatus()`, `getComputeJob()`, `computeStop()`,
  `getComputeResultUrl()`, `getComputeResult()` and `getComputeLogs()`. Jobs from the
  node come back under the qualified id.
- **`getComputeStatus()` returns `NodeComputeJob | undefined`**, which adds the node's
  `environment`, `resources` and `payment` to `ComputeJob`; so do
  `OceanNodeClient.computeStatus()` and `getComputeJob()`. `compute()` and `freeCompute()`
  return `jobs: NodeComputeJob[]`, and `stopCompute()`, `OceanNodeClient.computeStart()`,
  `freeComputeStart()` and `computeStop()` return `NodeComputeJob[]`.
- **A job id must match ocean-node's exact format**, and `getComputeResultUrl()` and
  `getComputeResult()` throw a `RangeError` for an `index` that is not a non-negative safe
  integer.
- **`getComputeLogs()` returns a `ComputeResultStream`** (`AsyncIterable<Uint8Array>`)
  instead of `unknown`, on `Nautilus` and `OceanNodeClient`. `OceanNodeClient.getComputeLogs()`
  throws when the node returns no stream.
- **`streamComputeResult()` throws for a job that has not finished**, as well as for an
  unknown job or one without the result.
- **Paid jobs request at least 1 CPU, 1 GB of RAM and 1 GB of disk by default**, so their
  escrow quote can be higher than with beta.1's defaults. Pass `resources` to choose.

**Migration**

Wait for a job on `dateFinished`, not on status `70` or `71`; a failed job never reaches
them:

```ts
const job = await nautilus.getComputeStatus({ jobId })
if (job?.dateFinished) console.log('finished with', job.status, job.statusText)
```

Keep the `jobId` that `compute()` or `freeCompute()` returned, whole. To rebuild it from a
bare id stored with beta.1, put the first segment of the job's environment id in front of
it:

```ts
const jobId = `${environment.id.split('-')[0]}-${bareJobId}`
const job = await nautilus.getComputeStatus({ jobId })
```

Read logs as a stream:

```ts
for await (const chunk of await nautilus.getComputeLogs({ jobId }))
  process.stdout.write(chunk)
```
