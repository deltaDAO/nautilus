/**
 * A datatoken created before its pricing failed must stay on record, so recovery knows
 * about it instead of minting a second one (security review L7).
 */
import { Wallet } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import {
  type FileTypes,
  ServiceTypes
} from '../../src/Nautilus/Asset/Service/NautilusService.js'
import { ServiceBuilder } from '../../src/Nautilus/Asset/Service/ServiceBuilder.js'
import { createDatatokenForService } from '../../src/publish/index.js'
import { CHAIN_ID, DATATOKEN_ADDRESS, NFT_ADDRESS } from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'

vi.mock('@oceanprotocol/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    Nft: class {
      async createDatatoken() {
        return DATATOKEN_ADDRESS
      }
    },
    Datatoken: class {
      async createDispenser() {
        throw new Error('execution reverted: dispenser already exists')
      }
    }
  }
})

describe('createDatatokenForService', () => {
  it('records the datatoken on the service before its pricing is created', async () => {
    const service = new ServiceBuilder<ServiceTypes.ACCESS, FileTypes.URL>({
      serviceType: ServiceTypes.ACCESS
    })
      .setServiceEndpoint('https://node.test.invalid')
      .setName('Access Service')
      .setPricing({ type: 'free' })
      .addFile({
        type: 'url',
        url: 'https://files.test.invalid/a',
        method: 'GET'
      })
      .build()

    await expectThrowsAsync(
      () =>
        createDatatokenForService({
          signer: new Wallet(`0x${'01'.repeat(32)}`),
          chainConfig: {
            chainId: CHAIN_ID,
            dispenserAddress: NFT_ADDRESS
          } as never,
          nftAddress: NFT_ADDRESS,
          service,
          owner: NFT_ADDRESS
        }),
      /dispenser already exists/
    )

    expect(service.datatokenAddress).to.equal(DATATOKEN_ADDRESS)
  })
})
