/**
 * Compute job ids, statuses and results, as ocean-node reports them.
 *
 * ocean-node names a job `<environmentHash>-<jobId>`: the hash of the compute engine that
 * runs it, which is also the first segment of the id of every environment that engine
 * serves, then the job's own id. `computeStart` and `freeComputeStart` answer with that
 * form, and the status, result, logs and stop commands find the engine through it. The
 * status command filters on a job only when given that form; given a bare id, it lists
 * every job of the consumer. Its answer names each job by its bare id, with the
 * environment beside it.
 *
 * nautilus therefore uses the qualified id everywhere: it is what `compute()` and
 * `freeCompute()` return, what every job method takes, and what `getComputeStatus()`
 * reports back.
 */
import type { ComputeJob } from '@oceanprotocol/lib'

/** A job as the node reports it: `environment` is present at runtime. */
interface JobWithEnvironment {
  jobId: string
  environment?: string
}

/**
 * `<environmentHash>-<jobId>` exactly as ocean-node 4.2 builds it: the engine hash is `0x`
 * and a sha256 in lowercase hex (`create256Hash`), the job id a sha256 in lowercase hex
 * (`generateUniqueID`). ocean.js puts the id into query strings unencoded, so nothing
 * else may pass.
 */
const QUALIFIED_JOB_ID = /^0x[0-9a-f]{64}-[0-9a-f]{64}$/

/**
 * `JobSettle`. The node sets it once the algorithm has stopped and then writes the job's
 * `outputs.tar`; only its payment-claim cron moves the job on to `70` (`JobFinished`).
 */
const JOB_SETTLE = 71

/**
 * Whether the job has ended, successfully or not, so its results and final logs are
 * readable: the node sets `dateFinished` whenever it ends a job, and reads it the same way.
 * The status alone does not tell: failed jobs end at statuses below `70` (`2`, `11`, `13`,
 * `21`, `22`, `31`, `41`, `42`, `61`, `62`, …), and the claim cron later moves some of them
 * to `70` as well.
 */
export function isJobFinished(job: Pick<ComputeJob, 'dateFinished'>): boolean {
  return Boolean(job.dateFinished)
}

/**
 * Whether a finished job may still list its `output`: it is at `71` (`JobSettle`), which the
 * node sets before it writes `outputs.tar`, and lists none yet.
 */
export function isOutputPending(
  job: Pick<ComputeJob, 'status' | 'results'>
): boolean {
  return (
    job.status === JOB_SETTLE && findResultIndex(job, 'output') === undefined
  )
}

/**
 * The job with its id in the `<environmentHash>-<jobId>` form. Idempotent: an id that
 * already carries the environment's hash is kept, and so is one whose job names no
 * environment.
 */
export function withQualifiedJobId<T extends JobWithEnvironment>(job: T): T {
  const [environmentHash] = (job.environment ?? '').split('-')

  if (!environmentHash || job.jobId.startsWith(`${environmentHash}-`))
    return job

  return { ...job, jobId: `${environmentHash}-${job.jobId}` }
}

/**
 * Refuses a job id that is not `<environmentHash>-<jobId>` as the node builds it. Given a
 * bare id, the node's status command would list every job of the consumer rather than this
 * one, and the other commands cannot find the job's engine; anything else could add
 * parameters to the signed request. The message gives the id's length, not the id.
 */
export function assertQualifiedJobId(jobId: string): void {
  if (typeof jobId === 'string' && QUALIFIED_JOB_ID.test(jobId)) return

  const length =
    typeof jobId === 'string' ? `${jobId.length} characters` : typeof jobId

  throw new Error(
    `Malformed job id (${length}): it is not in the form <environmentHash>-<jobId>, 0x and 64 hex digits, a dash, then 64 hex digits. Pass the jobId that compute() or freeCompute() returned; to rebuild it from a bare id, put the first segment of the job's environment id and a dash in front of it.`
  )
}

/** Refuses a result index that is not a non-negative safe integer. */
export function assertResultIndex(index: number): void {
  if (Number.isSafeInteger(index) && index >= 0) return

  throw new RangeError('resultIndex must be a non-negative safe integer')
}

/**
 * The kinds of result ocean-node 4.2 lists for a job, in the order it lists them:
 * `imageLog`, `configurationLog`, `algorithmLog`, then `output` (the job's `outputs.tar`)
 * when the results stay on the node rather than going to `output` storage or a bucket, and
 * `publishLog` when the node wrote one. Each is listed only once its file exists.
 */
export type ComputeResultKind =
  | 'imageLog'
  | 'configurationLog'
  | 'algorithmLog'
  | 'output'
  | 'publishLog'

/** The index of the job's first result of `kind`, or `undefined` when it has none. */
export function findResultIndex(
  job: Pick<ComputeJob, 'results'>,
  kind: ComputeResultKind
): number | undefined {
  const position = (job.results ?? []).findIndex(
    (result) => (result.type as string) === kind
  )

  if (position < 0) return undefined

  // The node numbers its results; the position is the same index when it does not.
  return job.results[position].index ?? position
}
