import type { ComputeEnvironment, Nautilus } from '@deltadao/nautilus'

/**
 * Compute-to-Data examples.
 *
 * C2D v2 changed the model substantially from v1:
 *
 *   - **Resources are requested explicitly** — `[{ id: 'cpu', amount: 2 }]` — instead of
 *     fixed CPU/GPU descriptors. Environments advertise what they have and what it costs.
 *   - **Payment runs through an escrow contract.** The node quotes an amount and nautilus
 *     locks it before the job starts.
 *   - **All datasets travel in one array.** v1 had `dataset` plus `additionalDatasets`.
 *   - **Free compute exists**, with no order, no escrow and no payment token.
 *   - **`providerUri` is gone** from the status and result calls; they default to the node
 *     the instance is configured with.
 */

/** Lists the node's environments, so you can pick one deliberately. */
export async function listComputeEnvironments(nautilus: Nautilus) {
  const environments = await nautilus.getComputeEnvironments()

  console.log(
    `The node offers ${environments.length} compute environment(s):\n`
  )

  for (const environment of environments) {
    console.log(`  ${environment.id}`)
    console.log(`    consumer:      ${environment.consumerAddress}`)
    console.log(`    max duration:  ${environment.maxJobDuration ?? '—'}s`)
    console.log(`    running jobs:  ${environment.runningJobs}`)
    console.log(`    free jobs:     ${environment.free ? 'yes' : 'no'}`)

    for (const resource of environment.resources ?? [])
      console.log(
        `    resource:      ${resource.id} min=${resource.min ?? '—'} max=${resource.max}`
      )

    // fees is keyed by chain id: a token not listed for your chain cannot pay for a job.
    for (const [chainId, fees] of Object.entries(environment.fees ?? {}))
      for (const fee of fees)
        console.log(`    fee token:     ${fee.feeToken} (chain ${chainId})`)

    console.log()
  }

  return environments
}

/** Picks an environment offering free jobs, if the node has one. */
async function findFreeEnvironment(
  nautilus: Nautilus
): Promise<ComputeEnvironment | undefined> {
  const environments = await nautilus.getComputeEnvironments()

  return environments.find((environment) => environment.free)
}

/**
 * A free compute job.
 *
 * The simplest way to start: no datatoken is bought and no escrow is touched. The environment
 * must expose a `free` section, and its access list may restrict who can use it.
 *
 * Free of charge is not the same as ungated — credential policies still apply.
 */
export async function freeCompute(
  nautilus: Nautilus,
  datasetDid: string,
  algorithmDid: string
) {
  const environment = await findFreeEnvironment(nautilus)

  if (!environment) {
    console.log(
      'This node offers no free compute environment. Use compute() instead.'
    )
    return undefined
  }

  console.log(`Starting a free job in ${environment.id}...`)

  const result = await nautilus.freeCompute({
    dataset: { did: datasetDid },
    algorithm: { did: algorithmDid },
    computeEnv: environment.id
  })

  const job = result.jobs[0]

  console.log(`Job started: ${job.jobId}`)
  console.log(`  status: ${job.status} (${job.statusText})`)

  return job
}

/**
 * A paid compute job.
 *
 * `resources` and `paymentToken` default from the environment, so the minimal call is just
 * the dataset and the algorithm. They are shown here because choosing them deliberately is
 * usually what you want.
 */
export async function compute(
  nautilus: Nautilus,
  datasetDid: string,
  algorithmDid: string,
  computeEnv?: string
) {
  const environment = await nautilus.getComputeEnvironment(computeEnv)

  console.log(`Starting a paid job in ${environment.id}...`)

  const result = await nautilus.compute({
    dataset: {
      did: datasetDid
      // userdata: { myNumberParam: 8 } // optional consumer parameters
    },
    algorithm: {
      did: algorithmDid
      // algocustomdata: { epochs: 10 } // the algorithm's own parameters
      // envs: { LOG_LEVEL: 'debug' } // container environment variables
    },
    computeEnv: environment.id,
    resources: [
      { id: 'cpu', amount: 1 },
      { id: 'ram', amount: 1 }
    ],
    maxJobDuration: 3600
  })

  const job = result.jobs[0]

  console.log(`Job started: ${job.jobId}`)
  console.log(`  status: ${job.status} (${job.statusText})`)
  // One order per input, keyed by DID. A reused order shows the earlier transaction.
  console.log('  orders:', result.orders)

  if (result.initializeResults.payment)
    console.log('  escrow payment:', result.initializeResults.payment)

  return job
}

/** A job over several datasets. C2D v2 passes them all in one array. */
export async function computeMultipleDatasets(
  nautilus: Nautilus,
  datasetDids: string[],
  algorithmDid: string
) {
  const [first, ...additional] = datasetDids

  const environment = await findFreeEnvironment(nautilus)

  if (!environment) {
    console.log('This node offers no free compute environment; skipping.')
    return undefined
  }

  const result = await nautilus.freeCompute({
    dataset: { did: first },
    additionalDatasets: additional.map((did) => ({ did })),
    algorithm: { did: algorithmDid },
    computeEnv: environment.id
  })

  console.log(
    `Job started over ${datasetDids.length} datasets: ${result.jobs[0].jobId}`
  )

  return result.jobs[0]
}

/**
 * Reads a job's status.
 *
 * 70 is `JobFinished`. 71 (`JobSettle`) is also terminal — the algorithm has
 * run and the results are already listed; the node is only waiting on its
 * payment-claim cron, which a free job has nothing to do for. ocean-node's own
 * integration tests accept either, so treat both as done.
 */
export async function getComputeStatus(nautilus: Nautilus, jobId: string) {
  const job = await nautilus.getComputeStatus({ jobId })

  if (!job) {
    console.log(`The node does not know job ${jobId}.`)
    return undefined
  }

  console.log(`Job ${jobId}`)
  console.log(`  status:  ${job.status} (${job.statusText})`)
  console.log(`  created: ${job.dateCreated}`)
  console.log(`  results: ${job.results?.length ?? 0}`)

  for (const result of job.results ?? [])
    console.log(
      `    ${result.type.padEnd(14)} ${result.filename} (${result.filesize}b)`
    )

  return job
}

/** Polls until a job finishes, or the attempts run out. */
/** JobFinished and JobSettle — see getComputeStatus above. */
const TERMINAL_STATUSES = [70, 71]

export async function waitForComputeJob(
  nautilus: Nautilus,
  jobId: string,
  attempts = 60,
  intervalMs = 10000
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const job = await nautilus.getComputeStatus({ jobId })

    if (!job) throw new Error(`The node does not know job ${jobId}.`)

    console.log(
      `  [${attempt + 1}/${attempts}] ${job.status} ${job.statusText}`
    )

    if (TERMINAL_STATUSES.includes(job.status)) return job

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  console.log('The job did not finish within the polling window.')

  return undefined
}

/**
 * The container's logs, while the job is still running.
 *
 * New in v2, and the practical way to debug an algorithm you cannot otherwise observe.
 */
export async function getComputeLogs(nautilus: Nautilus, jobId: string) {
  const logs = await nautilus.getComputeLogs({ jobId })

  console.log('Job logs:', logs)

  return logs
}

/** A download URL for a finished job's output. */
export async function retrieveComputeResult(nautilus: Nautilus, jobId: string) {
  const url = await nautilus.getComputeResult({ jobId })

  if (!url) {
    // Also returned when the job has not finished, or produced no `output` result.
    console.log('No result available yet.')
    return undefined
  }

  console.log('Compute result URL:', url)

  const response = await fetch(url)
  const body = await response.text()

  console.log('Result:', body.slice(0, 1000))

  return body
}

/** Streams a result instead of downloading it through a URL. Better for large outputs. */
export async function streamComputeResult(nautilus: Nautilus, jobId: string) {
  const stream = await nautilus.streamComputeResult({ jobId })

  let bytes = 0

  for await (const chunk of stream) bytes += chunk.length

  console.log(`Streamed ${bytes} bytes from job ${jobId}`)

  return bytes
}

/** Stops a running job. */
export async function stopCompute(nautilus: Nautilus, jobId: string) {
  const jobs = await nautilus.stopCompute({ jobId })

  console.log(`Stop requested for ${jobId}`)
  for (const job of jobs) console.log(`  ${job.jobId}: ${job.statusText}`)

  return jobs
}

/** Start a free job, wait for it, and fetch the result. */
export async function runFullComputeFlow(
  nautilus: Nautilus,
  datasetDid: string,
  algorithmDid: string
) {
  const job = await freeCompute(nautilus, datasetDid, algorithmDid)

  if (!job) return undefined

  const finished = await waitForComputeJob(nautilus, job.jobId)

  if (!finished) return undefined

  return retrieveComputeResult(nautilus, job.jobId)
}
