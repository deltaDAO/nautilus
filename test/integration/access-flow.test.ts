import { beforeAll, describe, expect, it } from 'vitest'
import { getServices } from '../../src/ddo/read.js'
import type { Nautilus } from '../../src/index.js'
import {
  createConsumer,
  createPublisher,
  freeDataset,
  integrationEnabled,
  publishAndIndex
} from './helpers.js'

describe('access', () => {
  if (!integrationEnabled) {
    it.skip('needs PRIVATE_KEY_TESTS_1/2 and NODE_URL to run', () => {})
    return
  }

  let publisher: Nautilus
  let consumer: Nautilus
  let did: string
  let serviceId: string

  beforeAll(async () => {
    publisher = await createPublisher()
    consumer = await createConsumer()

    const published = await publishAndIndex(publisher, freeDataset())

    did = published.ddo.id as string
    serviceId = getServices(published.ddo)[0].id
  })

  it('orders a free service and returns a download URL', async () => {
    const result = await consumer.access({ assetDid: did })

    expect(result.url).to.be.a('string').and.contain('http')
    expect(result.did).to.equal(did)
    expect(result.serviceId).to.equal(serviceId)
    expect(result.transferTxId).to.be.a('string')
    expect(result.reusedOrder).to.equal(false)
  })

  /**
   * Skipped because ocean-node cannot currently satisfy it, not because the
   * expectation is wrong.
   *
   * Order reuse depends on `initialize` reporting an existing valid order, but
   * oe-ocean-node 3.2.21's access initialize returns only
   * `{ providerFee, datatoken, nonce, computeAddress }` — there is no
   * `validOrder` field for it to report (see FeesHandler). So
   * `hasReusableOrder()` is always false and every access buys a datatoken
   * again, even inside the service timeout. On a paid asset that means paying
   * twice.
   *
   * Verified directly against the local stack: four accesses of the same asset
   * over 20s each produced a new transferTxId.
   *
   * Un-skip when the node returns `validOrder` again — the v4 Provider did.
   */
  it.skip('reuses the existing order on a second access', async () => {
    const result = await consumer.access({ assetDid: did })

    expect(result.reusedOrder).to.equal(true)
  })

  it('fetches the data behind the URL', async () => {
    const { url } = await consumer.access({ assetDid: did })
    const response = await fetch(url)

    expect(response.ok).to.equal(true)
    expect((await response.text()).length).to.be.greaterThan(0)
  })

  it('accepts an explicit serviceId', async () => {
    const result = await consumer.access({ assetDid: did, serviceId })

    expect(result.serviceId).to.equal(serviceId)
  })

  it('names the asset when the serviceId does not exist', async () => {
    let message = ''
    try {
      await consumer.access({ assetDid: did, serviceId: 'not-a-service' })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).to.contain('not-a-service')
  })
})
