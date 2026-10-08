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
export interface JobWithEnvironment {
  jobId: string
  environment?: string
}

/**
 * The status from which a job's results are listed: `70` (`JobFinished`). `71`
 * (`JobSettle`) follows it while the node claims the escrow payment.
 */
export const JOB_FINISHED = 70

/** Whether the job has finished running, so its results and final logs are readable. */
export function isJobFinished(job: Pick<ComputeJob, 'status'>): boolean {
  return job.status >= JOB_FINISHED
}

/**
 * The job's `<environmentHash>-<jobId>` id. Idempotent: an id that already carries the
 * environment's hash is returned as it is, and so is one whose job names no environment.
 */
export function qualifiedJobId(job: JobWithEnvironment): string {
  const [environmentHash] = (job.environment ?? '').split('-')

  if (!environmentHash || job.jobId.startsWith(`${environmentHash}-`))
    return job.jobId

  return `${environmentHash}-${job.jobId}`
}

/** The job with its id in the `<environmentHash>-<jobId>` form. */
export function withQualifiedJobId<T extends JobWithEnvironment>(job: T): T {
  const jobId = qualifiedJobId(job)

  return jobId === job.jobId ? job : { ...job, jobId }
}

/**
 * Refuses a job id without its environment hash. Given one, the node's status command
 * would list every job of the consumer rather than this one, and the other commands
 * cannot find the job's engine.
 */
export function assertQualifiedJobId(jobId: string): void {
  const separator = jobId.indexOf('-')

  if (separator > 0 && separator < jobId.length - 1) return

  throw new Error(
    `Job id '${jobId}' is not in the form <environmentHash>-<jobId>. Pass the jobId that compute() or freeCompute() returned; to rebuild it from a bare id, put the first segment of the job's environment id and a dash in front of it.`
  )
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
