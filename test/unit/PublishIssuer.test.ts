import { Wallet } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import { AssetBuilder } from '../../src/Nautilus/Asset/AssetBuilder.js'
import { Nautilus } from '../../src/Nautilus/Nautilus.js'
import type { OceanNodeClient } from '../../src/node/OceanNodeClient.js'
import type { RemoteStore } from '../../src/remote/RemoteStore.js'
import type { DdoSigner } from '../../src/signing/vc.js'
import {
  CHAIN_ID,
  DATATOKEN_ADDRESS,
  getAssetFixture,
  NFT_ADDRESS,
  OWNER_ADDRESS
} from '../fixtures/Asset.js'
import { expectThrowsAsync } from '../helpers.js'
import { createNodeMock } from '../mocks/node.js'

/**
 * Who a republished DDO is issued by — the `writeAsset()` issuer rules.
 *
 * The chain writes are stubbed out; everything up to and including signing runs for real,
 * so these tests cover the decision under test: the signer's identity is only the *default*
 * for `issuer`, and a deliberately declared one flows through to `toCredential()`'s
 * mismatch guard instead of being silently replaced.
 */

vi.mock('../../src/publish/index.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    writeMetadata: vi.fn(async () => ({ hash: '0xsetmetadata' })),
    waitForMetadataPermission: vi.fn(async () => undefined)
  }
})

// SHACL validation has its own suite; here it would only obscure where a publish stopped.
vi.mock('../../src/ddo/validate.js', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, assertValid: vi.fn(async () => undefined) }
})

const PRIVATE_KEY =
  '0x0123456789012345678901234567890123456789012345678901234567890123'

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/** A DdoSigner that issues as `identity` and records every DDO it is asked to sign. */
function fakeDdoSigner(identity: string) {
  const signed: Record<string, unknown>[] = []

  const signer: DdoSigner = {
    async getIssuer() {
      return identity
    },
    async sign(ddo: Record<string, unknown>) {
      signed.push(ddo)
      return {
        jwt: `${base64url('{}')}.${base64url(JSON.stringify(ddo))}.sig`,
        issuer: identity
      }
    }
  }

  return { signer, signed }
}

async function createNautilus(options: { ddoSigner?: DdoSigner } = {}) {
  const wallet = new Wallet(PRIVATE_KEY)

  // Only `getNetwork()` is reached during init; everything else stays on the node mock.
  const signer = wallet.connect({
    getNetwork: async () => ({ chainId: BigInt(CHAIN_ID) })
  } as never)

  const remoteStore = {
    put: async () => ({
      type: 'url',
      url: 'https://store.test.invalid/ddo',
      method: 'GET'
    })
  } as unknown as RemoteStore

  const nautilus = await Nautilus.create(signer, {
    remoteStore,
    ddoSigner: options.ddoSigner,
    config: {
      oceanNodeUri: 'https://node.test.invalid',
      nftFactoryAddress: NFT_ADDRESS,
      fixedRateExchangeAddress: DATATOKEN_ADDRESS,
      dispenserAddress: OWNER_ADDRESS
    }
  })

  // The node client is the only network seam left; swap in the mock behind it.
  ;(nautilus as unknown as { node: OceanNodeClient }).node =
    createNodeMock().client

  return { nautilus, wallet }
}

describe('writeAsset issuer rules', () => {
  it('stamps the signer identity when the asset declares no issuer', async () => {
    const { signer, signed } = fakeDdoSigner('did:key:fresh-identity')
    const { nautilus } = await createNautilus({ ddoSigner: signer })

    const asset = new AssetBuilder(
      getAssetFixture({ issuer: undefined })
    ).build()

    const response = await nautilus.edit(asset)

    expect(response.ddo.issuer).to.equal('did:key:fresh-identity')
    expect(signed[0].issuer).to.equal('did:key:fresh-identity')
  })

  it('keeps the issuer seeded from the resolved asset', async () => {
    // The fixture declares did:jwk:test-issuer; a signer with that identity re-signs it.
    const { signer, signed } = fakeDdoSigner('did:jwk:test-issuer')
    const { nautilus } = await createNautilus({ ddoSigner: signer })

    const asset = new AssetBuilder(getAssetFixture()).build()

    const response = await nautilus.edit(asset)

    expect(response.ddo.issuer).to.equal('did:jwk:test-issuer')
    expect(signed[0].issuer).to.equal('did:jwk:test-issuer')
  })

  it('refuses to republish under a signer that is not the declared issuer', async () => {
    // Previously writeAsset() overwrote the issuer unconditionally, so toCredential()'s
    // mismatch guard could never fire from the publish flow.
    const { nautilus } = await createNautilus()

    const asset = new AssetBuilder(getAssetFixture()).build()

    await expectThrowsAsync(
      () => nautilus.edit(asset),
      /declares issuer "did:jwk:test-issuer"/
    )
  })

  it('republishes with the same Ethereum signer end to end', async () => {
    // The default Eip191VcSigner issues as the wallet address; an asset it published
    // carries that address, so an edit by the same wallet must keep working.
    const { nautilus, wallet } = await createNautilus()

    const asset = new AssetBuilder(
      getAssetFixture({ issuer: wallet.address })
    ).build()

    const response = await nautilus.edit(asset)

    expect(response.ddo.issuer).to.equal(wallet.address)
    expect(response.credential?.issuer).to.equal(wallet.address)
  })
})
