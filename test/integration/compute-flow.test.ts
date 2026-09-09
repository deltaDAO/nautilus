import { beforeAll, describe, expect, it } from 'vitest'
import { getServices } from '../../src/ddo/read.js'
import { AssetBuilder, type Nautilus } from '../../src/index.js'
import { getNodeUri } from '../fixtures/Config.js'
import {
  computeService,
  createConsumer,
  createPublisher,
  freeAlgorithm,
  integrationEnabled,
  publishAndIndex
} from './helpers.js'

describe('compute', () => {
  if (!integrationEnabled) {
    it.skip('needs PRIVATE_KEY_TESTS_1/2 and NODE_URL to run', () => {})
    return
  }

  let nautilus: Nautilus
  /**
   * Paid compute pays the compute environment's consumerAddress, which is the
   * ocean-node's own account. The escrow reverts with "Payer cannot be payee"
   * if those are the same, so the paid job is funded by the second account
   * rather than the publisher — which is the realistic shape anyway.
   */
  let consumer: Nautilus
  let datasetDid: string
  let algorithmDid: string

  beforeAll(async () => {
    nautilus = await createPublisher()
    consumer = await createConsumer()

    /**
     * The dataset has to say which algorithms may run on it, or
     * `initializeCompute` refuses the job with "Algorithm <did> not allowed to
     * run on the dataset" — the node denies by default when neither
     * publisherTrustedAlgorithms nor publisherTrustedAlgorithmPublishers is set.
     *
     * `'*'` rather than this account's address, deliberately: ocean-node
     * compares the trusted-publisher list against the algorithm's **nftAddress**
     * (compute/utils.ts, validateAlgoForDataset), not the publisher's wallet, so
     * trusting an address that actually published the algorithm still fails.
     * That looks like a node bug given the field name; the wildcard sidesteps it
     * and says what this fixture means anyway — any algorithm may run here.
     *
     * Note `freeCompute` does *not* enforce any of this, so the free-compute
     * tests pass either way. Only the paid path checks it.
     */
    const dataset = new AssetBuilder()
      .setType('dataset')
      .setName('Nautilus Compute Dataset')
      .setDescription('Published for the compute integration suite')
      .setProvidedBy('deltaDAO AG')
      .setNftTokenName('Nautilus Compute NFT')
      .addService(
        computeService(getNodeUri())
          .setPricing({ type: 'free' })
          .addTrustedAlgorithmPublisher('*')
          .build()
      )
      .build()

    datasetDid = (await publishAndIndex(nautilus, dataset)).ddo.id as string
    algorithmDid = (await publishAndIndex(nautilus, freeAlgorithm())).ddo
      .id as string
  })

  describe('environments', () => {
    it('lists the environments with their resources and fees', async () => {
      const environments = await nautilus.getComputeEnvironments()

      expect(environments).to.be.an('array').and.not.empty

      const [environment] = environments

      expect(environment.id).to.be.a('string')
      expect(environment.consumerAddress).to.be.a('string')
      // C2D v2: resources are requested explicitly and priced per chain.
      expect(environment).to.have.property('fees')
    })

    it('resolves a specific environment by id', async () => {
      const [first] = await nautilus.getComputeEnvironments()
      const resolved = await nautilus.getComputeEnvironment(first.id)

      expect(resolved.id).to.equal(first.id)
    })

    it('names the available environments when the id is unknown', async () => {
      let message = ''
      try {
        await nautilus.getComputeEnvironment('not-an-environment')
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).to.contain('not-an-environment')
      expect(message).to.contain('Available')
    })
  })

  describe('free compute', () => {
    let jobId: string

    it('starts a job with no order, escrow or payment token', async () => {
      const environments = await nautilus.getComputeEnvironments()
      const free = environments.find((environment) => environment.free)

      if (!free) {
        // Not every deployment exposes free jobs; say so rather than failing silently.
        console.log('[compute] no free environment on this node; skipping')
        return
      }

      const result = await nautilus.freeCompute({
        dataset: { did: datasetDid },
        algorithm: { did: algorithmDid },
        computeEnv: free.id
      })

      expect(result.jobs).to.be.an('array').and.not.empty
      jobId = result.jobs[0].jobId
      expect(jobId).to.be.a('string')
    })

    it('reports the job status', async () => {
      if (!jobId) return

      const job = await nautilus.getComputeStatus({ jobId })

      expect(job?.jobId).to.equal(jobId)
      expect(job?.status).to.be.a('number')
    })

    it('refuses free compute on an environment that does not offer it', async () => {
      const environments = await nautilus.getComputeEnvironments()
      const paidOnly = environments.find((environment) => !environment.free)

      if (!paidOnly) return

      let message = ''
      try {
        await nautilus.freeCompute({
          dataset: { did: datasetDid },
          algorithm: { did: algorithmDid },
          computeEnv: paidOnly.id
        })
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).to.match(/does not offer free jobs/)
    })
  })

  describe('paid compute', () => {
    let jobId: string

    it('orders the inputs, funds escrow and starts a job', async () => {
      const environments = await nautilus.getComputeEnvironments()
      const chainId = nautilus.getOceanConfig().chainId
      const paid = environments.find(
        (environment) => (environment.fees?.[String(chainId)] || []).length > 0
      )

      if (!paid) {
        console.log(
          `[compute] no environment prices chain ${chainId}; skipping`
        )
        return
      }

      const result = await consumer.compute({
        dataset: { did: datasetDid },
        algorithm: { did: algorithmDid },
        computeEnv: paid.id
      })

      expect(result.jobs).to.be.an('array').and.not.empty
      expect(result.environment.id).to.equal(paid.id)
      // Both inputs had to be ordered, and each order id is recorded per
      // `<did>#<serviceId>` — the service is part of the key because one DID can back
      // two inputs (e.g. the algorithm doubling as a dataset).
      expect(
        Object.keys(result.orders).map((key) => key.split('#')[0])
      ).to.have.members([datasetDid, algorithmDid])

      jobId = result.jobs[0].jobId
    })

    // The node scopes jobs to the consumerAddress that started them, so these
    // have to ask as `consumer` — the account that paid — not the publisher.
    it('reports the job status', async () => {
      if (!jobId) return

      const job = await consumer.getComputeStatus({ jobId })

      expect(job?.jobId).to.equal(jobId)
    })

    it('returns a result URL once the job has finished', async () => {
      if (!jobId) return

      const url = await consumer.getComputeResult({ jobId })

      // Undefined while the job is still running, which is the common case here.
      if (url) expect(url).to.be.a('string').and.contain('http')
    })

    it('stops the job', async () => {
      if (!jobId) return

      /**
       * Only meaningful while the job is actually running. Against a local
       * chain these finish in a couple of seconds, so by now it usually has —
       * and stopping a finished job makes ocean-node's PUT route call
       * `streamToObject` on a null stream and answer a bare 500 rather than a
       * 4xx, which there is no way to tell apart from a real failure.
       */
      const job = await consumer.getComputeStatus({ jobId })

      if (job && [70, 71].includes(job.status)) {
        console.log(
          `[compute] job already finished (status ${job.status}); nothing to stop`
        )
        return
      }

      const stopped = await consumer.stopCompute({ jobId })

      expect(stopped).to.be.an('array')
    })
  })

  describe('multiple datasets', () => {
    it('passes every dataset in one array, as C2D v2 expects', async () => {
      const second = new AssetBuilder()
        .setType('dataset')
        .setName('Nautilus Second Compute Dataset')
        .setDescription('A second input')
        .setProvidedBy('deltaDAO AG')
        .addService(
          computeService(getNodeUri()).setPricing({ type: 'free' }).build()
        )
        .build()

      const secondDid = (await publishAndIndex(nautilus, second)).ddo
        .id as string

      const environments = await nautilus.getComputeEnvironments()
      const free = environments.find((environment) => environment.free)

      if (!free) return

      const result = await nautilus.freeCompute({
        dataset: { did: datasetDid },
        additionalDatasets: [{ did: secondDid }],
        algorithm: { did: algorithmDid },
        computeEnv: free.id
      })

      expect(result.jobs).to.be.an('array').and.not.empty
    })
  })

  describe('service selection', () => {
    it('names the asset when it has no compute service', async () => {
      const accessOnly = new AssetBuilder()
        .setType('dataset')
        .setName('Nautilus Access-Only Dataset')
        .setDescription('Has no compute service')
        .setProvidedBy('deltaDAO AG')
        .addService(
          (await import('./helpers.js'))
            .accessService()
            .setPricing({ type: 'free' })
            .build()
        )
        .build()

      const did = (await publishAndIndex(nautilus, accessOnly)).ddo.id as string
      const [environment] = await nautilus.getComputeEnvironments()

      let message = ''
      try {
        await nautilus.freeCompute({
          dataset: { did },
          algorithm: { did: algorithmDid },
          computeEnv: environment.id
        })
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).to.match(/has no 'compute' service/)
    })

    it('uses the compute service of a multi-service asset', async () => {
      const helpers = await import('./helpers.js')

      const both = new AssetBuilder()
        .setType('dataset')
        .setName('Nautilus Mixed Dataset')
        .setDescription('Access and compute')
        .setProvidedBy('deltaDAO AG')
        .addService(
          helpers.accessService().setPricing({ type: 'free' }).build()
        )
        .addService(
          computeService(getNodeUri()).setPricing({ type: 'free' }).build()
        )
        .build()

      const published = await publishAndIndex(nautilus, both)
      const computeServiceId = getServices(published.ddo).find(
        (service) => service.type === 'compute'
      )?.id

      expect(computeServiceId).to.be.a('string')
    })
  })
})
